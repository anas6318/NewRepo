/**
 * Regression cover for the issues found in code review of the
 * ui-integrity-fixes branch. Each test names the defect it re-creates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { imageUrlProblem as clientImageUrlProblem } from "../../src/lib/media.ts";
import { imageUrlProblem as sharedImageUrlProblem, productImageUrlProblems } from "../../supabase/functions/_shared/image-url.ts";
import {
  DASHBOARD_AWAITING_SUPPLIER,
  DASHBOARD_IN_PRODUCTION,
  DASHBOARD_IN_TRANSIT,
  DASHBOARD_PENDING_PAYMENT,
  inBucket,
} from "../../supabase/functions/_shared/zones.ts";
import { cartNeedsSupplierConfirmation } from "../../src/lib/orders.ts";
import type { Product } from "../../src/services/types.ts";

const ADMIN = readFileSync("supabase/functions/admin-actions/index.ts", "utf8");

/* ── 1 · server-side image URL validation ───────────────────────────────── */

const BAD_URLS = [
  "file:///C:/Users/PC/Pictures/shirt.jpg",
  "file:///home/me/shirt.png",
  "C:\\Users\\PC\\Pictures\\shirt.jpg",
  "C:/Users/PC/Pictures/shirt.jpg",
  "\\\\nas\\share\\shirt.jpg",
  "blob:https://example.com/9f3a",
  "data:image/png;base64,iVBORw0KGgo=",
  "http://localhost:3000/shirt.jpg",
  "http://127.0.0.1/shirt.jpg",
  "http://example.com/shirt.jpg",
  "shirt.jpg",
  "just some words",
];

test("the server rejects every URL the Admin form rejects", () => {
  for (const bad of BAD_URLS) {
    assert.ok(sharedImageUrlProblem(bad), `server must reject ${bad}`);
    assert.ok(clientImageUrlProblem(bad), `client must reject ${bad}`);
  }
});

test("client and server agree on every absolute URL — the mirror cannot drift", () => {
  const CASES = [...BAD_URLS, "https://abc.supabase.co/storage/v1/object/public/products/a.webp", "https://cdn.example.com/x.jpg", "", "   "];
  for (const url of CASES) {
    assert.equal(
      sharedImageUrlProblem(url, { allowSiteRelative: true }),
      clientImageUrlProblem(url),
      `divergence on "${url}"`,
    );
  }
});

test("site-relative paths are allowed in the browser and refused for stored product data", () => {
  // The storefront genuinely bundles /brand and /demo assets; a SAVED product
  // must reference an upload, not an asset a build happened to include.
  assert.equal(clientImageUrlProblem("/demo/p-crimson-2005.webp"), undefined);
  assert.equal(sharedImageUrlProblem("/demo/p-crimson-2005.webp", { allowSiteRelative: true }), undefined);
  assert.equal(sharedImageUrlProblem("/demo/p-crimson-2005.webp"), "relative_path");
});

test("a Supabase Storage public URL is accepted on both sides", () => {
  const url = "https://abcdefg.supabase.co/storage/v1/object/public/products/crimson-2005/real.webp";
  assert.equal(sharedImageUrlProblem(url), undefined);
  assert.equal(clientImageUrlProblem(url), undefined);
});

test("productImageUrlProblems checks styled, real AND gallery entries", () => {
  const bad = productImageUrlProblems([
    { src: "https://cdn.example.com/styled.webp", role: "styled" },
    { src: "file:///C:/Users/PC/real.jpg", role: "real" },
    { src: "https://cdn.example.com/back.webp" },
    { src: "C:\\extras\\detail.jpg" },
  ]);
  assert.equal(bad.length, 2);
  assert.equal(bad[0]!.where, "real");
  assert.equal(bad[1]!.where, "gallery[3]");
});

test("a styled image with a local URL is caught too, not only the real one", () => {
  const bad = productImageUrlProblems([{ src: "file:///C:/styled.png", role: "styled" }]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.where, "styled");
});

test("a product with no images at all is not an error", () => {
  assert.deepEqual(productImageUrlProblems([]), []);
  assert.deepEqual(productImageUrlProblems(undefined), []);
});

test("saveProduct validates images server-side before writing anything", () => {
  const fn = ADMIN.slice(ADMIN.indexOf("async function saveProduct"), ADMIN.indexOf("async function importProducts"));
  assert.ok(/productImageUrlProblems\(product\.images\)/.test(fn), "every image is checked");
  assert.ok(/throw new HttpError\(400, "product_invalid_image_url"/.test(fn), "rejected with a clear 400 code");
  // The validation must precede the write, or a bad row lands before it fails.
  assert.ok(fn.indexOf("productImageUrlProblems") < fn.indexOf("dbUpsert"), "validation runs before persistence");
  // And it must NOT pass allowSiteRelative.
  assert.ok(!/productImageUrlProblems\(product\.images,\s*\{[^}]*allowSiteRelative:\s*true/.test(fn), "stored product data may not be site-relative");
});

/* ── 2 · the PATCH → empty body → INSERT anti-pattern ───────────────────── */

const WRITE_PATHS = ["saveProduct", "saveBadges", "savePromotions", "saveZones"];

test("no save path treats an empty PATCH body as a missing row", () => {
  for (const name of WRITE_PATHS) {
    const start = ADMIN.indexOf(`async function ${name}`);
    assert.ok(start > -1, `${name} exists`);
    const fn = ADMIN.slice(start, ADMIN.indexOf("async function ", start + 10));
    assert.ok(!/patched\s*===\s*"\[\]"/.test(fn), `${name}: the "|| patched === '[]'" check is gone`);
    assert.ok(!/if \(!patched/.test(fn), `${name}: the empty-body branch is gone`);
  }
});

test("product, badge and promotion saves persist with an upsert", () => {
  for (const [name, table] of [
    ["saveProduct", "products"],
    ["saveBadges", "patches"],
    ["savePromotions", "promotions"],
  ] as const) {
    const start = ADMIN.indexOf(`async function ${name}`);
    const fn = ADMIN.slice(start, ADMIN.indexOf("async function ", start + 10));
    assert.ok(new RegExp(`dbUpsert\\("${table}"`).test(fn), `${name} upserts into ${table}`);
    assert.ok(!new RegExp(`dbInsert\\("${table}"`).test(fn), `${name} no longer plain-INSERTs into ${table}`);
  }
});

test("dbUpsert really asks PostgREST to merge duplicates", () => {
  const helpers = readFileSync("supabase/functions/_shared/helpers.ts", "utf8");
  const fn = helpers.slice(helpers.indexOf("export async function dbUpsert"), helpers.indexOf("export async function dbUpdate"));
  assert.ok(/resolution=merge-duplicates/.test(fn), "merge-duplicates is what makes a re-save safe");
  assert.ok(/method: "POST"/.test(fn));
});

test("the zone fix is preserved", () => {
  const start = ADMIN.indexOf("async function saveZones");
  const fn = ADMIN.slice(start, ADMIN.indexOf("async function ", start + 10));
  assert.ok(/patchMatchedNoRows\(/.test(fn), "still distinguishes a silent success from a missing row");
  assert.ok(/Prefer: "return=representation"/.test(fn));
  assert.ok(!/price < 35 \|\| price > 55/.test(fn), "the ₪55 ceiling stays gone");
});

/* ── 7 · dashboard status buckets ───────────────────────────────────────── */

test("awaitingSupplier counts orders awaiting supplier confirmation", () => {
  assert.deepEqual([...DASHBOARD_AWAITING_SUPPLIER], ["awaiting_supplier_confirmation"]);
  assert.equal(inBucket(DASHBOARD_AWAITING_SUPPLIER, "awaiting_supplier_confirmation"), true);
  // The old, wrong value: an order that has PAID is not awaiting a supplier.
  assert.equal(inBucket(DASHBOARD_AWAITING_SUPPLIER, "payment_confirmed"), false);
});

test("quality_inspection is counted as in production rather than falling through", () => {
  assert.equal(inBucket(DASHBOARD_IN_PRODUCTION, "quality_inspection"), true);
  for (const status of ["sent_to_supplier", "production_started", "supplier_processing"]) {
    assert.equal(inBucket(DASHBOARD_IN_PRODUCTION, status), true, status);
  }
});

test("the buckets do not overlap", () => {
  const all = [...DASHBOARD_AWAITING_SUPPLIER, ...DASHBOARD_IN_PRODUCTION, ...DASHBOARD_IN_TRANSIT];
  assert.equal(new Set(all).size, all.length, "a status belongs to at most one fulfilment bucket");
});

test("pendingPayments still reads payment_status, not fulfilment", () => {
  assert.equal(inBucket(DASHBOARD_PENDING_PAYMENT, "awaiting_payment"), true);
  assert.equal(inBucket(DASHBOARD_PENDING_PAYMENT, "paid"), false);
});

test("the edge function and the demo service share one bucket definition", () => {
  assert.ok(/DASHBOARD_AWAITING_SUPPLIER/.test(ADMIN), "edge uses the shared constant");
  const demo = readFileSync("src/services/demo/DemoDataService.ts", "utf8");
  assert.ok(/DASHBOARD_AWAITING_SUPPLIER/.test(demo), "demo uses the same constant");
  assert.ok(!/fulfillmentStatus === "payment_confirmed"/.test(demo), "the demo copy of the bug is gone");
  assert.ok(!/fulfillment_status === "payment_confirmed"/.test(ADMIN), "the edge copy of the bug is gone");
});

/* ── 6 · bank details wait for supplier confirmation ────────────────────── */

function productWith(status: string): Product {
  return {
    id: "p1",
    slug: "shirt",
    name: { ar: "", he: "", en: "Shirt" },
    categorySlug: "retro",
    status: "published",
    basePriceIls: 170,
    images: [],
    availability: { status, ...(status === "available" ? { lastCheckedAt: new Date().toISOString() } : {}) },
  } as unknown as Product;
}

test("a cart line whose product needs a supplier check is detected", () => {
  const needs = cartNeedsSupplierConfirmation([{ slug: "shirt", size: "L" }], [productWith("confirmation_required")]);
  assert.equal(needs, true);
});

test("a confirmed-available cart does not withhold payment details", () => {
  const needs = cartNeedsSupplierConfirmation([{ slug: "shirt", size: "L" }], [productWith("available")]);
  assert.equal(needs, false);
});

test("one unconfirmed line is enough to hold the whole order's payment details", () => {
  const needs = cartNeedsSupplierConfirmation(
    [
      { slug: "shirt", size: "L" },
      { slug: "other", size: "M" },
    ],
    [productWith("available"), { ...productWith("confirmation_required"), slug: "other" } as Product],
  );
  assert.equal(needs, true);
});

test("an unknown product withholds details rather than assuming availability", () => {
  assert.equal(cartNeedsSupplierConfirmation([{ slug: "missing", size: "L" }], []), true);
});

test("checkout hides bank details behind the supplier check and offers an explanation", () => {
  const src = readFileSync("src/pages/storefront/CheckoutPage.tsx", "utf8");
  assert.ok(/method === "bank_transfer" && settings && !needsSupplierCheck/.test(src), "details only when no check is pending");
  assert.ok(/method === "bank_transfer" && needsSupplierCheck/.test(src), "an explanation is shown instead");
  assert.ok(
    /const \[needsSupplierCheck, setNeedsSupplierCheck\] = useState\(true\)/.test(src),
    "defaults to withholding while the answer is still unknown",
  );
  assert.ok(/\.catch\(\(\) => \{[\s\S]{0,160}?setNeedsSupplierCheck\(true\)/.test(src), "a failed availability lookup also withholds");
  assert.ok(/cartNeedsSupplierConfirmation/.test(src), "uses the shared availability rule, not a second source of truth");
});

test("the held-payment explanation exists in all three languages", () => {
  for (const locale of ["ar", "he", "en"]) {
    const dict = JSON.parse(readFileSync(`src/lib/i18n/${locale}.json`, "utf8")) as { checkout: Record<string, string> };
    for (const key of ["bankTransferAfterConfirmation", "bankTransferHeldBody"]) {
      assert.ok(dict.checkout[key] && dict.checkout[key].length > 8, `${locale}.checkout.${key}`);
    }
  }
});

/* ── 3 & 4 · media hook guarantees, at the source ───────────────────────── */

const HOOK = readFileSync("src/components/product/MediaSwitch.tsx", "utf8");

test("every async reveal is gated on the intent that started it", () => {
  assert.ok(/const intent = useRef\(0\)/.test(HOOK), "an intent token exists");
  // Both async completions must compare it.
  const reveals = HOOK.match(/intent\.current !== token/g) ?? [];
  assert.ok(reveals.length >= 2, `choose() and preview() both check the token (found ${reveals.length})`);
  assert.ok(/const token = \+\+intent\.current;[\s\S]{0,400}?setView\(next\);/.test(HOOK), "leaving hover bumps the token, invalidating an in-flight reveal");
});

test("a deliberate tap can retry after a failure; passive callers cannot", () => {
  assert.ok(/statusRef\.current === "error" && !force/.test(HOOK), "an error only short-circuits passive callers");
  assert.ok(/loadReal\(true\)/.test(HOOK), "choose() forces a fresh attempt");
  const prefetch = HOOK.slice(HOOK.indexOf("const prefetchReal"), HOOK.indexOf("const choose"));
  assert.ok(!/loadReal\(true\)/.test(prefetch), "hover/touch warm-up never forces — a broken URL is not re-requested on every pointer move");
});

test("the preload verifies the exact URL the frame will render", () => {
  assert.ok(!/retry=\$\{Date\.now\(\)\}/.test(HOOK), "no cache-busting query string: it would validate a different resource");
});

test("concurrent callers share one in-flight request", () => {
  assert.ok(/inFlight\.current \?\? Promise\.resolve\(false\)/.test(HOOK));
});

/* ── 5 · the fallback keeps the image's own layout box ──────────────────── */

test("SafeImage's placeholder is an <img> with the same attributes", () => {
  const src = readFileSync("src/components/ui/SafeImage.tsx", "utf8");
  assert.ok(!/style=\{\{[\s\S]{0,160}?width: rest\.width \? `\$\{rest\.width\}px`/.test(src), "the hard inline pixel width is gone");
  assert.ok(/<img[\s\S]{0,200}?data-testid="img-fallback"/.test(src), "the placeholder is an img, so CSS governs it exactly as before");
  assert.ok(/\{\.\.\.rest\}/.test(src), "width/height are passed through as attributes, not inline styles");
});

test("a decorative image stays decorative when it falls back", () => {
  const src = readFileSync("src/components/ui/SafeImage.tsx", "utf8");
  assert.ok(/alt=\{decorative \? "" : alt\}/.test(src));
});

test("the placeholder cannot loop through its own error handler", () => {
  const src = readFileSync("src/components/ui/SafeImage.tsx", "utf8");
  assert.ok(/onError=\{undefined\}/.test(src), "an unrenderable placeholder must not retrigger setFailed");
});
