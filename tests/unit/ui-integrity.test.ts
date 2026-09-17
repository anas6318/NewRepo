/**
 * Regression cover for the storefront bugs found on a real device and in
 * real orders. Everything here is a source-or-behaviour assertion about the
 * shipped modules, not a restatement of the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { translator, hasTranslation } from "../../src/lib/i18n/translate.ts";
import { customerTimeline } from "../../src/lib/orders.ts";
import { imageUrlProblem, imageUrlProblemMessage, productImageIssues } from "../../src/lib/media.ts";
import { localizeIssue, localizeIssues } from "../../src/lib/form-errors.ts";
import { zonePriceProblem, patchMatchedNoRows, ZONE_PRICE_MAX_ILS } from "../../supabase/functions/_shared/zones.ts";
import { s, type Issue } from "../../src/lib/schema.ts";

const LOCALES = ["ar", "he", "en"] as const;

/* ── 1 · interpolation placeholders never reach a customer ──────────────── */

test("confirmation.body interpolates the order number in every language", () => {
  for (const locale of LOCALES) {
    const t = translator(locale);
    const out = t("confirmation.body", { orderNumber: "CR-SJ7NTH" });
    assert.ok(out.includes("CR-SJ7NTH"), `${locale}: order number present`);
    assert.ok(!out.includes("{orderNumber}"), `${locale}: no raw placeholder — got "${out}"`);
  }
});

test("footer.rights interpolates the year in every language", () => {
  for (const locale of LOCALES) {
    const out = translator(locale)("footer.rights", { year: 2031 });
    assert.ok(out.includes("2031"), `${locale}: year present`);
    assert.ok(!out.includes("{year}"), `${locale}: no raw placeholder — got "${out}"`);
  }
});

test("the confirmation page passes orderNumber into the translation", () => {
  const src = readFileSync("src/pages/storefront/ConfirmationPage.tsx", "utf8");
  assert.ok(
    /t\("confirmation\.body",\s*\{\s*orderNumber\s*\}\)/.test(src),
    "confirmation.body must be called with { orderNumber }",
  );
});

test("the footer renders exactly one copyright statement", () => {
  const src = readFileSync("src/components/layout/Footer.tsx", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // A hand-built "© {year} CROWNED." next to footer.rights printed it twice.
  assert.equal((code.match(/©/g) ?? []).length, 0, "no literal © in JSX — the translation owns the whole sentence");
  assert.ok(/t\("footer\.rights",\s*\{\s*year:/.test(code), "footer.rights is called with a year");
});

/**
 * A deliberate tripwire. Every name below is a placeholder that some t() call
 * is known to supply. Adding a NEW {placeholder} to a dictionary fails this
 * test until it is listed here — which is the moment to check that the call
 * site actually passes it, instead of finding out from a customer looking at
 * "your order {orderNumber}".
 */
const SUPPLIED_PLACEHOLDERS = new Set(["orderNumber", "year", "name", "date", "min", "max", "count", "size", "sizes", "product", "query", "url"]);

test("every translation placeholder is one a t() call supplies", () => {
  for (const locale of LOCALES) {
    const dict = readFileSync(`src/lib/i18n/${locale}.json`, "utf8");
    for (const match of dict.matchAll(/\{([a-zA-Z]+)\}/g)) {
      assert.ok(
        SUPPLIED_PLACEHOLDERS.has(match[1]!),
        `${locale}: unlisted placeholder {${match[1]}} — confirm the t() call passes it, then add it to SUPPLIED_PLACEHOLDERS`,
      );
    }
  }
});

test("the placeholder set is identical across the three languages", () => {
  const setFor = (locale: string) =>
    [...readFileSync(`src/lib/i18n/${locale}.json`, "utf8").matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort().join(",");
  assert.equal(setFor("ar"), setFor("en"), "ar/en placeholders differ");
  assert.equal(setFor("he"), setFor("en"), "he/en placeholders differ");
});

/* ── 2 · tracking timeline order ────────────────────────────────────────── */

test("supplier confirmation comes BEFORE awaiting payment on a bank transfer", () => {
  const flow = customerTimeline({ paymentMethod: "bank_transfer", supplierConfirmation: { required: true } });
  const supplier = flow.indexOf("awaiting_supplier_confirmation");
  const payment = flow.indexOf("awaiting_payment");
  assert.ok(supplier > -1 && payment > -1, "both steps are shown");
  assert.ok(supplier < payment, `supplier check must precede payment — got ${flow.join(" → ")}`);
  assert.equal(flow[0], "order_received", "the order still starts at order received");
  assert.ok(flow.indexOf("payment_confirmed") > payment, "payment_confirmed follows awaiting_payment");
});

test("a bank transfer with no supplier check is unchanged", () => {
  const flow = customerTimeline({ paymentMethod: "bank_transfer" });
  assert.deepEqual(flow.slice(0, 3), ["order_received", "awaiting_payment", "payment_confirmed"]);
  assert.equal(flow.includes("awaiting_supplier_confirmation"), false);
});

test("a supplier check with a non-bank payment method is unchanged", () => {
  const flow = customerTimeline({ paymentMethod: "card", supplierConfirmation: { required: true } });
  assert.deepEqual(flow.slice(0, 3), ["order_received", "awaiting_supplier_confirmation", "payment_confirmed"]);
  assert.equal(flow.includes("awaiting_payment"), false);
});

test("an ordinary order gets the plain flow, with no extra steps", () => {
  const flow = customerTimeline({ paymentMethod: "card" });
  assert.equal(flow.includes("awaiting_payment"), false);
  assert.equal(flow.includes("awaiting_supplier_confirmation"), false);
  assert.equal(flow[0], "order_received");
  assert.equal(flow[flow.length - 1], "delivered");
});

test("no step is ever duplicated or lost", () => {
  for (const order of [
    { paymentMethod: "bank_transfer", supplierConfirmation: { required: true } },
    { paymentMethod: "bank_transfer" },
    { paymentMethod: "card", supplierConfirmation: { required: true } },
    { paymentMethod: "card" },
  ]) {
    const flow = customerTimeline(order);
    assert.equal(new Set(flow).size, flow.length, `no duplicates in ${flow.join(",")}`);
    assert.ok(flow.includes("delivered"), "delivered is always the destination");
  }
});

/* ── 3 · unknown backend error codes ────────────────────────────────────── */

test("t() echoes an unknown key, which is why has() must gate it", () => {
  // Pins the exact behaviour that made `t(key) || fallback` useless.
  assert.equal(translator("en")("checkout.error_totally_made_up"), "checkout.error_totally_made_up");
  assert.equal(hasTranslation("en", "checkout.error_totally_made_up"), false);
  assert.equal(hasTranslation("en", "checkout.error_generic"), true);
});

test("every locale can render the generic checkout error", () => {
  for (const locale of LOCALES) {
    const out = translator(locale)("checkout.error_generic");
    assert.notEqual(out, "checkout.error_generic", `${locale} has real wording`);
    assert.ok(out.length > 4);
  }
});

test("checkout gates the server error code through has() before showing it", () => {
  const src = readFileSync("src/pages/storefront/CheckoutPage.tsx", "utf8");
  assert.ok(/has\(key\)\s*\?\s*t\(key\)\s*:\s*t\("checkout\.error_generic"\)/.test(src), "unknown codes fall back to the generic message");
  assert.ok(!/t\(`checkout\.error_\$\{[^}]*\}`[^)]*\)\s*\|\|/.test(src), "the broken `|| fallback` form is gone");
});

test("a known backend code still gets its own specific wording", () => {
  for (const locale of LOCALES) {
    for (const code of ["zone_unavailable", "empty_cart", "product_unavailable", "invalid_size"]) {
      const key = `checkout.error_${code}`;
      assert.equal(hasTranslation(locale, key), true, `${locale} has ${key}`);
      assert.notEqual(translator(locale)(key), translator(locale)("checkout.error_generic"), `${key} is not just the generic text`);
    }
  }
});

/* ── 4 · admin image URL validation ─────────────────────────────────────── */

test("local filesystem paths are rejected", () => {
  for (const bad of [
    "file:///C:/Users/PC/Pictures/shirt.jpg",
    "file:///home/me/shirt.png",
    "C:\\Users\\PC\\Pictures\\shirt.jpg",
    "C:/Users/PC/Pictures/shirt.jpg",
    "\\\\nas\\share\\shirt.jpg",
    "http://localhost:3000/shirt.jpg",
  ]) {
    assert.ok(imageUrlProblem(bad), `must reject ${bad}`);
  }
});

test("a real Supabase Storage public URL is accepted", () => {
  assert.equal(imageUrlProblem("https://abcdefg.supabase.co/storage/v1/object/public/products/crimson-2005/real.webp"), undefined);
});

test("bundled site-absolute assets keep working", () => {
  assert.equal(imageUrlProblem("/demo/crimson-front.webp"), undefined);
  assert.equal(imageUrlProblem("/brand/crowned-logo-white.png"), undefined);
});

test("plain http is rejected as mixed content on an https storefront", () => {
  assert.equal(imageUrlProblem("http://example.com/shirt.jpg"), "insecure_scheme");
});

test("an empty URL is not an error — no image is a valid state", () => {
  assert.equal(imageUrlProblem(""), undefined);
  assert.equal(imageUrlProblem("   "), undefined);
});

test("nonsense that is not a URL at all is rejected", () => {
  assert.equal(imageUrlProblem("shirt.jpg"), "not_a_url");
  assert.equal(imageUrlProblem("just some words"), "not_a_url");
});

test("the admin message names the file and never rewrites it", () => {
  const src = "file:///C:/Users/PC/Pictures/shirt.jpg";
  const message = imageUrlProblemMessage(imageUrlProblem(src)!, src);
  assert.ok(message.includes("C:/Users/PC/Pictures/shirt.jpg"), "quotes what was actually typed");
  assert.ok(/https:\/\//.test(message), "says what to do instead");
});

test("productImageIssues names which slot is wrong", () => {
  const issues = productImageIssues([
    { src: "https://cdn.example.com/a.webp", alt: { ar: "", he: "", en: "" }, role: "styled" },
    { src: "file:///C:/Users/PC/real.jpg", alt: { ar: "", he: "", en: "" }, role: "real" },
    { src: "C:\\extras\\back.jpg", alt: { ar: "", he: "", en: "" } },
  ]);
  assert.equal(issues.length, 2, "the good https URL is not flagged");
  assert.ok(issues[0]!.startsWith("Real product photo:"), issues[0]);
  assert.ok(issues[1]!.startsWith("Gallery image 3:"), issues[1]);
});

test("admin refuses to save a product carrying a bad image URL", () => {
  const src = readFileSync("src/pages/admin/AdminCatalog.tsx", "utf8");
  assert.ok(/const imageIssues = productImageIssues\(product\.images\)/.test(src), "issues are computed before save");
  assert.ok(/if \(imageIssues\.length\) \{[\s\S]{0,200}?return;/.test(src), "save is aborted when there are issues");
});

/* ── 5 · localized form validation ──────────────────────────────────────── */

test("schema issues carry a translatable code, not only English", () => {
  const schema = s.object({ displayName: s.string().trim().min(2).max(40) });
  const parsed = schema.safeParse({ displayName: "a" });
  assert.equal(parsed.success, false);
  const issue = (parsed as { issues: Issue[] }).issues[0]!;
  assert.equal(issue.code, "too_short");
  assert.equal(issue.params?.min, 2);
});

test("a too-short field is localized in all three languages, never English", () => {
  const schema = s.object({ body: s.string().trim().min(10) });
  const parsed = schema.safeParse({ body: "hi" });
  const issue = (parsed as { issues: Issue[] }).issues[0]!;
  for (const locale of LOCALES) {
    const text = localizeIssue(issue, translator(locale));
    assert.ok(!text.includes("Must be at least"), `${locale} must not leak the schema's English`);
    assert.ok(text.includes("10"), `${locale} states the minimum: "${text}"`);
    if (locale !== "en") assert.ok(!/[A-Za-z]{4,}/.test(text), `${locale} has no English words: "${text}"`);
  }
});

test("an unmapped issue degrades to a localized generic message, not English", () => {
  for (const locale of LOCALES) {
    const text = localizeIssue({ path: "x", message: "Some brand new English rule" }, translator(locale));
    assert.notEqual(text, "Some brand new English rule", `${locale} never passes the raw message through`);
    assert.equal(text, translator(locale)("errors.invalidValue"));
  }
});

test("localizeIssues keeps the first error per field", () => {
  const map = localizeIssues(
    [
      { path: "title", message: "a", code: "too_short", params: { min: 2 } },
      { path: "title", message: "b", code: "too_long", params: { max: 5 } },
      { path: "body", message: "c", code: "required" },
    ],
    translator("en"),
  );
  assert.equal(Object.keys(map).length, 2);
  assert.ok(map.title!.includes("2"), "first issue wins");
});

test("the reviews form localizes instead of using issue.message", () => {
  const src = readFileSync("src/components/product/ReviewsSection.tsx", "utf8");
  assert.ok(/localizeIssues\(parsed\.issues, t\)/.test(src), "uses the shared localizer");
  assert.ok(!/map\[issue\.path\] = issue\.message/.test(src), "the raw-English path is gone");
});

/* ── 6 · forms never claim a success that did not happen ────────────────── */

const SUBMITTING_FORMS = [
  ["src/components/layout/Footer.tsx", "newsletter signup"],
  ["src/pages/storefront/InfoPages.tsx", "contact form"],
  ["src/components/checkout/IssueReportForm.tsx", "issue report"],
  ["src/components/product/ReviewsSection.tsx", "review form"],
] as const;

test("every submitting form checks the result and catches throws", () => {
  for (const [file, label] of SUBMITTING_FORMS) {
    const src = readFileSync(file, "utf8");
    assert.ok(/\} catch \{/.test(src), `${label}: a thrown network error is caught`);
    assert.ok(/if \(!res\??\.ok\)/.test(src), `${label}: the result is checked before claiming success`);
    assert.ok(/errors\.submitFailedKeep/.test(src), `${label}: failure is reported to the customer`);
  }
});

test("every submitting form guards against double submission", () => {
  for (const [file, label] of SUBMITTING_FORMS) {
    const src = readFileSync(file, "utf8");
    assert.ok(/disabled=\{busy/.test(src), `${label}: the button is disabled while in flight`);
  }
});

test("the failure message promises the details were kept, in every language", () => {
  for (const locale of LOCALES) {
    const text = translator(locale)("errors.submitFailedKeep");
    assert.notEqual(text, "errors.submitFailedKeep", `${locale} has real wording`);
    assert.ok(text.length > 10);
  }
});

/* ── 7 · shipping zones, synced with the live hot-fix ───────────────────── */

test("every configured CROWNED zone price is accepted", () => {
  // Nazareth & Surroundings 40, Haifa 40, North 55, Jerusalem & Hebron 60, South 60.
  for (const price of [40, 40, 55, 60, 60]) {
    assert.equal(zonePriceProblem(price), undefined, `₪${price} must be saveable`);
  }
  assert.ok(ZONE_PRICE_MAX_ILS >= 60, "the ceiling covers the ₪60 zones the old ₪55 limit rejected");
});

test("a fat-finger price is still rejected", () => {
  assert.equal(zonePriceProblem(6000), "out_of_range");
  assert.equal(zonePriceProblem(0), "out_of_range");
  assert.equal(zonePriceProblem("abc"), "not_a_number");
});

test("an absent price is not an error — save-zones also just toggles active", () => {
  assert.equal(zonePriceProblem(undefined), undefined);
  assert.equal(zonePriceProblem(null), undefined);
  assert.equal(zonePriceProblem(""), undefined);
});

test("a successful PATCH is never mistaken for a missing row", () => {
  assert.equal(patchMatchedNoRows(204, ""), false, "204 No Content is a success");
  assert.equal(patchMatchedNoRows(200, ""), false, "an empty body proves nothing");
  assert.equal(patchMatchedNoRows(200, '[{"id":"haifa"}]'), false, "a row came back — it matched");
  assert.equal(patchMatchedNoRows(200, "[]"), true, "an explicit empty array means nothing matched");
});

test("saveZones asks for the representation it then inspects", () => {
  const src = readFileSync("supabase/functions/admin-actions/index.ts", "utf8");
  const fn = src.slice(src.indexOf("async function saveZones"), src.indexOf("async function saveSettings"));
  assert.ok(/Prefer: "return=representation"/.test(fn), "without this PostgREST returns 204 and the check is blind");
  assert.ok(/patchMatchedNoRows\(/.test(fn), "uses the shared rule");
  assert.ok(/dbUpsert\(/.test(fn), "insert path is an upsert, so a second save cannot duplicate-key");
  assert.ok(!/dbInsert\("shipping_zones"/.test(fn), "the plain INSERT that caused the live failure is gone");
  assert.ok(!/price < 35 \|\| price > 55/.test(fn), "the ₪55 ceiling is gone");
});

test("the zone price range is validated server-side, not only in Admin", () => {
  const src = readFileSync("supabase/functions/admin-actions/index.ts", "utf8");
  assert.ok(/zonePriceProblem\([\s\S]{0,80}?\)\) throw new HttpError\(400, "zone_price_out_of_range"\)/.test(src));
});
