/**
 * Dedicated tests for each deliberate server fix in the pure place-order core
 * (supabase/functions/_shared/order-pricing.ts), plus the handler wiring.
 *
 * One test block per fix: versionSizes (A2-B4), quantity/line limits, input
 * length limits, key allowlists, locale 400 (A2-B9), badge-active source
 * (A2-B10), promotion tie-break (A2-B11), fabricated version on a product
 * without versions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_LOCALES,
  CUSTOMER_KEYS,
  CUSTOMER_LIMITS,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  PERSONALIZATION_KEYS,
  orderProductIds,
  postgrestInList,
  sanitizeCustomer,
  sanitizePersonalization,
  validateAndPriceOrder,
  validateOrderRequest,
  type PricedOrder,
  type PricingResult,
} from "../../supabase/functions/_shared/order-pricing.ts";
import { sizeOptionsFor } from "../../src/services/sizing.ts";
import type { Product } from "../../src/services/types.ts";
import { CUSTOMER, PATCHES, PRODUCTS, body, db, line, promo, type OrderFixture, type Row } from "./fixtures/order-pricing-cases.ts";
import { pricingInput } from "./fixtures/order-pricing-input.ts";

const price = (b: unknown, fixture?: OrderFixture): PricingResult => validateAndPriceOrder(pricingInput(b, fixture));
const ok = (r: PricingResult): PricedOrder => {
  if (!r.ok) assert.fail(`expected a priced order, got ${r.error}`);
  return r;
};
const errorOf = (r: PricingResult) => (r.ok ? "ok" : r.error);

/* ── versionSizes (A2-B4) ── */

test("versionSizes: the server accepts exactly the sizes the storefront offers for each version", () => {
  const row = PRODUCTS.find((p) => p.id === "season-1")!;
  const product = row.data as unknown as Product;
  for (const version of ["fan", "player"] as const) {
    const offered = new Set(sizeOptionsFor(product, version).map((o) => o.size));
    for (const size of ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]) {
      const r = price(body([line("season-1", { version, sleeve: "short", size })]));
      assert.equal(r.ok, offered.has(size), `${version} ${size}: server ${errorOf(r)}, storefront offers=${offered.has(size)}`);
      if (!r.ok) assert.equal(r.error, "invalid_size");
    }
  }
});

test("versionSizes: an empty override falls back to sizes; a prototype key is not an override", () => {
  const products = PRODUCTS.map((p) =>
    p.id === "season-1" ? { ...p, data: { ...(p.data as Row), versionSizes: { fan: [], player: ["S", "M"] } } } : p,
  );
  const fixture = db({ products });
  assert.equal(price(body([line("season-1", { version: "fan", sleeve: "short", size: "4XL" })]), fixture).ok, true);
  assert.equal(errorOf(price(body([line("season-1", { version: "player", sleeve: "short", size: "L" })]), fixture)), "invalid_size");
  // "constructor" is not an own key of versionSizes: sizes apply, then the version is refused.
  assert.equal(errorOf(price(body([line("season-1", { version: "constructor", sleeve: "short", size: "M" })]), fixture)), "invalid_version");
});

/* ── quantity / line limits ── */

test("limits: MAX_LINE_QUANTITY=10 and MAX_ORDER_LINES=30 are exported and enforced", () => {
  assert.equal(MAX_LINE_QUANTITY, 10);
  assert.equal(MAX_ORDER_LINES, 30);
  assert.equal(errorOf(price(body([line("made-1", { quantity: 11 })]))), "invalid_quantity");
  assert.equal(price(body([line("made-1", { quantity: 10 })])).ok, true);
  assert.equal(errorOf(price(body(Array.from({ length: 31 }, () => line("made-1"))))), "too_many_lines");
  assert.equal(price(body(Array.from({ length: 30 }, () => line("made-1", { quantity: 10 })))).ok, true);
  // A non-object line is a bad quantity, never a crash.
  assert.equal(errorOf(price(body([null]))), "invalid_quantity");
  assert.equal(errorOf(price(body(["retro-1"]))), "invalid_quantity");
});

/* ── length limits (checkout schema) ── */

test("length limits: customer fields at and beyond each bound", () => {
  const L = CUSTOMER_LIMITS;
  const cases: [Row, boolean][] = [
    [{ name: "ab" }, true],
    [{ name: "a".repeat(L.nameMax) }, true],
    [{ name: "a".repeat(L.nameMax + 1) }, false],
    [{ name: " a " }, false], // trimmed to 1 char
    [{ email: `${"a".repeat(L.emailMax - 12)}@example.com` }, true],
    [{ email: `${"a".repeat(L.emailMax - 11)}@example.com` }, false],
    [{ phone: "+972 50-123-4567" }, true],
    [{ phone: "123456" }, false],
    [{ city: "c".repeat(L.cityMax) }, true],
    [{ city: "c".repeat(L.cityMax + 1) }, false],
    [{ address: "abcd" }, true],
    [{ address: "abc" }, false],
    [{ address: "a".repeat(L.addressMax + 1) }, false],
    [{ notes: "n".repeat(L.notesMax) }, true],
    [{ notes: "n".repeat(L.notesMax + 1) }, false],
    [{ notes: "" }, true],
    [{ notes: null }, true],
  ];
  for (const [patch, valid] of cases) {
    const r = sanitizeCustomer({ ...CUSTOMER, ...patch });
    assert.equal(r !== null, valid, JSON.stringify(patch).slice(0, 60));
    assert.equal(errorOf(price(body([line("made-1")], { customer: { ...CUSTOMER, ...patch } }))) === "invalid_customer", !valid);
  }
});

test("length limits: personalization name ≤ 14 letters, number 1–2 digits, trimmed", () => {
  assert.deepEqual(sanitizePersonalization({ name: "  Messi ", number: " 10 " }), { ok: true, value: { name: "Messi", number: "10" } });
  assert.deepEqual(sanitizePersonalization({ name: "أحمد" }), { ok: true, value: { name: "أحمد" } });
  assert.deepEqual(sanitizePersonalization({ name: "O'Neil-Jr. A" }), { ok: true, value: { name: "O'Neil-Jr. A" } });
  assert.deepEqual(sanitizePersonalization({ name: "", number: "" }), { ok: true });
  assert.deepEqual(sanitizePersonalization({ name: "ABCDEFGHIJKLMN" }), { ok: true, value: { name: "ABCDEFGHIJKLMN" } });
  for (const bad of [{ name: "ABCDEFGHIJKLMNO" }, { name: "R9" }, { number: "100" }, { number: "1a" }, { number: 9 }, { name: ["x"] }]) {
    assert.deepEqual(sanitizePersonalization(bad), { ok: false }, JSON.stringify(bad));
  }
});

/* ── allowlists ── */

test("allowlist: only known customer keys are persisted, trimmed", () => {
  assert.deepEqual([...CUSTOMER_KEYS], ["name", "email", "phone", "city", "address", "notes"]);
  const r = ok(price(body([line("made-1")], { customer: { name: " Dana ", email: " dana@example.com ", phone: " 0501234567 ", city: " Haifa ", address: " 1 Herzl St ", notes: " hi ", customerId: "x", isAdmin: true, __proto__: { polluted: 1 } } })));
  assert.deepEqual(r.customer, { name: "Dana", email: "dana@example.com", phone: "0501234567", city: "Haifa", address: "1 Herzl St", notes: "hi" });
});

test("allowlist: only personalization name/number are persisted", () => {
  assert.deepEqual([...PERSONALIZATION_KEYS], ["name", "number"]);
  const r = ok(price(body([line("retro-2", { personalization: { number: "9", color: "gold", priceIls: 0 } })])));
  assert.deepEqual((r.items[0] as Row).personalization, { number: "9" });
});

/* ── locale (A2-B9) ── */

test("locale: anything but ar/he/en is 400 invalid_locale, before any database-dependent check", () => {
  assert.deepEqual([...ALLOWED_LOCALES], ["ar", "he", "en"]);
  for (const locale of ["xx", "__proto__", "AR", "", undefined, null, 1]) {
    const r = price(body([line("made-1")], { locale }), db({ settings: undefined }));
    assert.deepEqual(r, { ok: false, status: 400, error: "invalid_locale" }, String(locale));
  }
  for (const locale of ALLOWED_LOCALES) assert.equal(ok(price(body([line("made-1")], { locale }))).locale, locale);
  // Precedence: customer, then cart shape, then locale.
  assert.equal(validateOrderRequest(body([], { locale: "xx" }))?.error, "empty_cart");
  assert.equal(validateOrderRequest(body([line("made-1")], { locale: "xx", customer: {} }))?.error, "invalid_customer");
});

/* ── badge active source (A2-B10) ── */

test("badge-active: selectable only when the patches.active column is true and data.active is not false", () => {
  const variants: [boolean, boolean | undefined, boolean][] = [
    [true, true, true],
    [true, undefined, true],
    [true, false, false],
    [false, true, false],
    [false, undefined, false],
  ];
  for (const [column, dataActive, selectable] of variants) {
    const patches = PATCHES.map((p) => {
      if (p.id !== "pl") return p;
      const data = { ...(p.data as Row) };
      if (dataActive === undefined) delete data.active;
      else data.active = dataActive;
      return { ...p, active: column, data };
    });
    const r = price(body([line("retro-1", { badgeId: "pl" })]), db({ patches }));
    assert.equal(r.ok, selectable, `column=${column} data.active=${dataActive}`);
    if (!r.ok) assert.equal(r.error, "invalid_badge");
  }
});

/* ── promotion tie-break (A2-B11) ── */

test("promotion tie-break: equal sortOrder is decided by id, whatever order the database returns", () => {
  const a = promo("p-a", 10, { discountPercent: 20 });
  const b = promo("p-b", 10, { discountPercent: 40 });
  for (const promotions of [[a, b], [b, a]]) {
    const r = ok(price(body([line("made-1", { quantity: 2 })]), db({ promotions })));
    assert.equal((r.promotion as Row).promotionId, "p-a");
    assert.equal(r.promotionDiscountIls, 29.8);
  }
  // A lower sortOrder still wins regardless of id.
  const r = ok(price(body([line("made-1", { quantity: 2 })]), db({ promotions: [a, promo("p-z", 5, { discountPercent: 40 })] })));
  assert.equal((r.promotion as Row).promotionId, "p-z");
});

/* ── version on a product without versions ── */

test("version: a non-empty version on a product without versions is invalid_version", () => {
  assert.equal(errorOf(price(body([line("retro-2", { version: "player" })]))), "invalid_version");
  assert.equal(errorOf(price(body([line("retro-2", { version: "fan" })]))), "invalid_version");
  const r = ok(price(body([line("hold-1", { size: "L", version: "" })])));
  assert.deepEqual(r.pendingConfirmation, [{ slug: "hold-1", version: undefined, size: "L" }]);
});

/* ── single clock ── */

test("one injected clock drives sales, promotions, supplier freshness and timestamps", () => {
  const r = ok(price(body([line("retro-1")])));
  assert.ok(r.tracking.every((t) => t.at === "2026-06-15T12:00:00.000Z"));
});

/* ── product prefetch helpers ── */

test("orderProductIds / postgrestInList: distinct string ids, each quoted and encoded", () => {
  assert.deepEqual(orderProductIds(body([line("a"), line("b"), line("a"), { productId: 5 }, null])), ["a", "b"]);
  assert.deepEqual(orderProductIds({}), []);
  const list = postgrestInList(["a", 'x"),id.neq.(', "c,d", "back\\slash"]);
  assert.ok(!/[(),]/.test(list.split(",").map(decodeURIComponent).join("").replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, "")), "nothing escapes the quotes");
  assert.equal(list.split(",").length, 4);
  assert.equal(decodeURIComponent(list.split(",")[1]!), '"x\\"),id.neq.("');
});

/* ── handler wiring ── */

const handlerSrc = readFileSync(fileURLToPath(new URL("../../supabase/functions/place-order/index.ts", import.meta.url)), "utf8");

test("place-order imports and calls validateAndPriceOrder and keeps no pricing logic of its own", () => {
  assert.match(handlerSrc, /import \{[^}]*\bvalidateAndPriceOrder\b[^}]*\} from "\.\.\/_shared\/order-pricing\.ts";/);
  assert.equal(handlerSrc.split("validateAndPriceOrder({").length - 1, 1, "called exactly once");
  assert.ok(handlerSrc.includes("const early = validateOrderRequest(body);"), "cheap request checks before any DB read");
  assert.ok(handlerSrc.indexOf("validateOrderRequest(body)") < handlerSrc.indexOf("await dbSelect"), "request checks precede reads");
  assert.ok(handlerSrc.indexOf("validateAndPriceOrder({") < handlerSrc.indexOf('dbInsert("orders"'), "priced before insert");
  assert.ok(handlerSrc.includes("if (!priced.ok) return json({ ok: false, error: priced.error }, priced.status);"));
  for (const leftover of [
    "resolveSaleServerSide",
    "applyPromotion",
    "promotionIsApplicable",
    "promotionIncludesProduct",
    "basePriceIls",
    "adjustmentIls",
    "priceOverrideIls",
    "Number.isInteger",
    "round2",
    "freeDeliveryMinItems",
    "invalid_size",
    "invalid_badge",
    "line.quantity",
  ]) {
    assert.ok(!handlerSrc.includes(leftover), `place-order still contains pricing/validation logic: ${leftover}`);
  }
  // Products are prefetched in one query, not per line.
  assert.equal(handlerSrc.split("products?select=").length - 1, 1);
  assert.ok(handlerSrc.includes("id=in.(${postgrestInList(productIds)})"));
});

test("the core stays pure: no Deno, fetch, crypto or database access", () => {
  const core = readFileSync(fileURLToPath(new URL("../../supabase/functions/_shared/order-pricing.ts", import.meta.url)), "utf8");
  for (const banned of ["Deno.", "fetch(", "crypto.", "dbSelect", "Date.now("]) {
    assert.ok(!core.includes(banned), `order-pricing.ts must not use ${banned}`);
  }
  assert.ok(!/^import\s/m.test(core), "order-pricing.ts has no imports at all");
});
