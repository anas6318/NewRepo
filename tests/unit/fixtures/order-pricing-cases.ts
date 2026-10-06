/**
 * Golden cases for the place-order validation + pricing path.
 *
 * Each case is a full request body plus the database rows the handler would
 * read for it. `tests/unit/fixtures/capture-order-pricing-golden.ts` ran the
 * BASELINE handler (c532a2b) over these cases, with only its I/O stubbed, and
 * froze the results in `order-pricing-golden.json`. The golden test replays
 * the CURRENT handler over the same cases and requires identical output,
 * except for entries that carry a documented `deviation`.
 *
 * Products follow the intended CROWNED rules: Retro regular ₪169 with an
 * active Retro-only sale to ₪149 (S–2XL); current-season Fan ₪149 (S–4XL
 * where configured) and Player ₪179 (S–2XL); personalization free.
 */

export const GOLDEN_NOW = "2026-06-15T12:00:00.000Z";
const FRESH = "2026-06-14T12:00:00.000Z"; // 1 day before now
const STALE = "2026-06-01T00:00:00.000Z"; // 14 days before now → no longer confirms
export const SALE_START = "2026-06-01T00:00:00.000Z";
export const SALE_END = "2026-07-01T00:00:00.000Z";

export type Row = Record<string, unknown>;

export interface OrderFixture {
  settings?: Row;
  zones: Row[];
  products: Row[];
  patches: Row[];
  /** In "database order": the handler reads `order=sort_order`, so the harness
   * sorts by the `sort_order` column and keeps this order on ties (a tie's
   * real order is unspecified — that is exactly A2-B11). */
  promotions: Row[];
}

export interface GoldenCase {
  name: string;
  nowIso: string;
  body: unknown;
  db: OrderFixture;
}

const L = (en: string, ar = `${en}-ar`, he = `${en}-he`) => ({ ar, he, en });

export const SETTINGS: Row = {
  paymentMethods: [
    { id: "bank_transfer", enabled: true, configured: true },
    { id: "card", enabled: true, configured: true },
    { id: "paypal", enabled: false, configured: false },
    { id: "bit", enabled: true, configured: false },
  ],
  freeDeliveryMinItems: 3,
  bankTransferInstructions: { ar: "bank-ar", he: "bank-he", en: "bank-en" },
};

export const ZONES: Row[] = [
  { id: "north", active: true, data: { id: "north", priceIls: 35 } },
  { id: "center", active: true, data: { id: "center", priceIls: 25 } },
  { id: "eilat", active: false, data: { id: "eilat", priceIls: 60 } },
];

export const PATCHES: Row[] = [
  { id: "pl", active: true, data: { id: "pl", code: "PL", name: L("Premier League"), priceIls: 10, active: true }, supplier_ref: "SUP-PL" },
  { id: "ucl", active: true, data: { id: "ucl", code: "UCL", name: L("Champions League"), priceIls: 15, active: true }, supplier_ref: null },
  { id: "old", active: false, data: { id: "old", code: "OLD", name: L("Old"), priceIls: 5, active: false } },
  // Column and data disagree (A2-B10): the storefront hides this one.
  { id: "drift", active: false, data: { id: "drift", code: "DRIFT", name: L("Drift"), priceIls: 5, active: true } },
  // Pre-0004 row: no `active`/`code` in data.
  { id: "legacy", active: true, data: { id: "legacy", name: L("Legacy"), priceIls: 5 } },
  { id: "neg", active: true, data: { id: "neg", code: "NEG", name: L("Negative"), priceIls: -5, active: true } },
];

const ADULT = ["S", "M", "L", "XL", "2XL"];
const ADULT_4XL = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const available = { status: "available", lastCheckedAt: FRESH };

function product(id: string, status: string, data: Row): Row {
  return {
    id,
    status,
    data: {
      id,
      slug: id,
      name: L(`Product ${id}`),
      categorySlug: "clubs",
      images: [{ src: `/img/${id}.webp` }],
      basePriceIls: 149,
      versions: [],
      sleeves: ["short"],
      longSleeveAdjustmentIls: 0,
      sizes: ADULT,
      personalizable: true,
      badges: [{ badgeId: "pl", enabled: true }],
      qualifiesForFreeDelivery: true,
      availability: available,
      ...data,
    },
  };
}

export const PRODUCTS: Row[] = [
  // Retro regular ₪169, active Retro-only sale to ₪149, S–2XL.
  product("retro-1", "available", {
    categorySlug: "retro",
    basePriceIls: 169,
    badges: [
      { badgeId: "pl", enabled: true },
      { badgeId: "ucl", enabled: true, priceOverrideIls: 0 },
    ],
    sale: { enabled: true, type: "fixed_price", salePriceIls: 149, startsAt: SALE_START, endsAt: SALE_END, label: L("Retro sale") },
  }),
  product("retro-2", "available", {
    categorySlug: "retro",
    basePriceIls: 169,
    sale: { enabled: true, type: "fixed_price", salePriceIls: 149, startsAt: SALE_START, endsAt: SALE_END, label: L("Retro sale") },
  }),
  // Current season: Fan ₪149 S–4XL, Player ₪179 S–2XL.
  product("season-1", "available", {
    categorySlug: "season",
    basePriceIls: 149,
    versions: [
      { version: "fan", adjustmentIls: 0 },
      { version: "player", adjustmentIls: 30 },
    ],
    sizes: ADULT_4XL,
    versionSizes: { fan: ADULT_4XL, player: ADULT },
    sleeves: ["short", "long"],
    longSleeveAdjustmentIls: 20,
  }),
  product("hold-1", "available", {
    basePriceIls: 120,
    sizes: ["M", "L"],
    availability: undefined,
    sale: { enabled: true, type: "percentage", percentOff: 10, endsAt: SALE_END },
  }),
  product("stale-1", "available", { availability: { status: "available", lastCheckedAt: STALE } }),
  product("unavail-1", "available", { sizeAvailability: { "*:L": { status: "unavailable" } } }),
  product("disc-1", "available", {
    versions: [
      { version: "fan", adjustmentIls: 0 },
      { version: "player", adjustmentIls: 30 },
    ],
    versionAvailability: { player: { status: "discontinued" } },
  }),
  product("draft-1", "draft", {}),
  product("archived-1", "archived", {}),
  product("made-1", "made_to_order", {}),
  product("sale-pct", "available", {
    basePriceIls: 200,
    sleeves: ["short", "long"],
    longSleeveAdjustmentIls: 20,
    sale: { enabled: true, type: "percentage", percentOff: 20, includeAddOns: true, startsAt: SALE_START },
  }),
  product("sale-amt", "available", { basePriceIls: 180, sale: { enabled: true, type: "fixed_amount", amountOffIls: 30, label: L("Thirty off") } }),
  product("sale-sched", "available", { sale: { enabled: true, type: "percentage", percentOff: 50, startsAt: "2026-07-01T00:00:00.000Z" } }),
  product("sale-exp", "available", { sale: { enabled: true, type: "percentage", percentOff: 50, endsAt: "2026-06-15T12:00:00.000Z" } }),
  product("sale-invalid", "available", { sale: { enabled: true, type: "percentage", percentOff: 150 } }),
  product("sale-auto", "available", { basePriceIls: 160, sale: { enabled: true, type: "fixed_amount", amountOffIls: 40, autoPercentLabel: true } }),
  product("badge-req", "available", { allowNoBadge: false, badges: [{ badgeId: "pl", enabled: true, priceOverrideIls: 12 }] }),
  product("legacy-patch", "available", { badges: undefined, patchIds: ["legacy"] }),
  product("drift-badge", "available", { badges: [{ badgeId: "drift", enabled: true }] }),
  product("np-1", "available", { personalizable: false, qualifiesForFreeDelivery: false, basePriceIls: 99 }),
  product("neg-1", "available", {
    basePriceIls: 10,
    versions: [{ version: "fan", adjustmentIls: -50 }],
    badges: [{ badgeId: "neg", enabled: true }],
  }),
];

const PROMO_BASE = {
  type: "second_item_percentage",
  enabled: true,
  discountPercent: 15,
  minimumQuantity: 2,
  repeatPerPair: true,
  stackWithProductSales: false,
  label: L("Buy 2 get 15%"),
};

export const promo = (id: string, sortOrder: number, extra: Row = {}): Row => ({ id, sort_order: sortOrder, data: { ...PROMO_BASE, id, sortOrder, ...extra } });

export const CUSTOMER = { name: "Dana Levi", email: "dana@example.com", phone: "0501234567", city: "Haifa", address: "1 Herzl St" };

type LineInput = Record<string, unknown>;
export const line = (productId: string, extra: LineInput = {}): LineInput => ({ productId, size: "M", quantity: 1, ...extra });

export function body(lines: unknown, extra: Row = {}): Row {
  return { locale: "en", customer: CUSTOMER, zoneId: "north", paymentMethod: "bank_transfer", lines, ...extra };
}

export function db(extra: Partial<OrderFixture> = {}): OrderFixture {
  return { settings: SETTINGS, zones: ZONES, products: PRODUCTS, patches: PATCHES, promotions: [], ...extra };
}

const c = (name: string, b: unknown, fixture: OrderFixture = db()): GoldenCase => ({ name, nowIso: GOLDEN_NOW, body: b, db: fixture });

export const GOLDEN_CASES: GoldenCase[] = [
  /* ── request-level errors ── */
  c("err: invalid_customer (bad email)", body([line("retro-1")], { customer: { ...CUSTOMER, email: "nope" } })),
  c("err: invalid_customer (missing name)", body([line("retro-1")], { customer: { ...CUSTOMER, name: "  " } })),
  c("limit: one-character name", body([line("retro-1")], { customer: { ...CUSTOMER, name: "D" } })),
  c("limit: over-length address (161)", body([line("retro-1")], { customer: { ...CUSTOMER, address: "a".repeat(161) } })),
  c("limit: over-length notes (501)", body([line("retro-1")], { customer: { ...CUSTOMER, notes: "n".repeat(501) } })),
  c("err: empty_cart (no lines)", body([])),
  c("err: too_many_lines (31 lines)", body(Array.from({ length: 31 }, () => line("retro-1")))),
  c("err: store_not_configured", body([line("retro-1")]), db({ settings: undefined })),
  c("err: payment_method_unavailable (disabled)", body([line("retro-1")], { paymentMethod: "paypal" })),
  c("err: payment_method_unavailable (not configured)", body([line("retro-1")], { paymentMethod: "bit" })),
  c("err: zone_unavailable (inactive)", body([line("retro-1")], { zoneId: "eilat" })),
  c("err: zone_unavailable (unknown)", body([line("retro-1")], { zoneId: "mars" })),
  c("precedence: invalid_customer beats empty_cart", body([], { customer: { ...CUSTOMER, phone: "x" } })),

  /* ── per-line errors ── */
  c("err: invalid_quantity 0", body([line("retro-1", { quantity: 0 })])),
  c("err: invalid_quantity 1.5", body([line("retro-1", { quantity: 1.5 })])),
  c("err: invalid_quantity \"2\"", body([line("retro-1", { quantity: "2" })])),
  c("err: invalid_quantity 11", body([line("retro-1", { quantity: 11 })])),
  c("err: product_unavailable (unknown)", body([line("ghost")])),
  c("err: product_unavailable (draft)", body([line("draft-1")])),
  c("err: product_unavailable (archived)", body([line("archived-1")])),
  c("err: invalid_size", body([line("retro-1", { size: "5XL" })])),
  c("err: size_unavailable (size record)", body([line("unavail-1", { size: "L" })])),
  c("err: size_unavailable (discontinued version)", body([line("disc-1", { version: "player" })])),
  c("err: invalid_version", body([line("season-1", { version: "legend" })])),
  c("err: invalid_version (missing)", body([line("season-1")])),
  c("err: invalid_sleeve", body([line("season-1", { version: "fan", sleeve: "none" })])),
  c("err: invalid_badge (unknown)", body([line("retro-1", { badgeId: "fake" })])),
  c("err: invalid_badge (globally disabled)", body([line("retro-1", { badgeId: "old" })])),
  c("err: invalid_badge (required, none given)", body([line("badge-req")])),
  c("err: invalid_badge (not enabled on product)", body([line("season-1", { version: "fan", sleeve: "short", badgeId: "ucl" })])),
  c("err: invalid_badge (negative price)", body([line("neg-1", { version: "fan", badgeId: "neg" })])),
  c("err: personalization_unavailable", body([line("np-1", { personalization: { name: "DANA" } })])),
  c("err: invalid_personalization (number)", body([line("retro-1", { personalization: { number: "123" } })])),
  c("err: invalid_personalization (name 15)", body([line("retro-1", { personalization: { name: "ABCDEFGHIJKLMNO" } })])),
  c("err: pricing_error (negative unit)", body([line("neg-1", { version: "fan" })])),
  c("precedence: first bad line wins (qty before later unknown product)", body([line("retro-1"), line("retro-1", { quantity: 0 }), line("ghost")])),
  c("precedence: unknown product before later bad quantity", body([line("ghost"), line("retro-1", { quantity: 0 })])),
  c("precedence: badge error on line 1 before size error on line 2", body([line("retro-1", { badgeId: "fake" }), line("retro-1", { size: "9XL" })])),

  /* ── priced orders ── */
  c("ok: retro sale fixed_price, qty 1, bank", body([line("retro-1")])),
  c("ok: retro sale, qty 10, card (free delivery)", body([line("retro-1", { quantity: 10 })], { paymentMethod: "card", zoneId: "center" })),
  c("ok: season fan short, no badge", body([line("season-1", { version: "fan", sleeve: "short" })])),
  c("ok: season player long + badge, card", body([line("season-1", { version: "player", sleeve: "long", badgeId: "pl" })], { paymentMethod: "card" })),
  c("versionSizes: player 4XL", body([line("season-1", { version: "player", size: "4XL", sleeve: "short" })])),
  c("versionSizes: fan 4XL", body([line("season-1", { version: "fan", size: "4XL", sleeve: "short" })])),
  c("ok: sale percentage includeAddOns with long sleeve + badge", body([line("sale-pct", { sleeve: "long", badgeId: "pl" })])),
  c("ok: sale fixed_amount", body([line("sale-amt")])),
  c("ok: sale scheduled → regular price", body([line("sale-sched")])),
  c("ok: sale expired at now (end exclusive) → regular price", body([line("sale-exp")])),
  c("ok: sale invalid config → regular price", body([line("sale-invalid")])),
  c("ok: sale auto percent label, locale he", body([line("sale-auto")], { locale: "he" })),
  c("ok: supplier hold + sale priceValidUntil, bank", body([line("hold-1", { size: "L" })])),
  c("ok: stale confirmation holds, card", body([line("stale-1")], { paymentMethod: "card" })),
  c("ok: made_to_order product", body([line("made-1")])),
  c("ok: badge override ₪0 on retro", body([line("retro-1", { badgeId: "ucl" })])),
  c("ok: legacy patchIds product via legacy patchId field", body([line("legacy-patch", { patchId: "legacy" })])),
  c("ok: required badge with product override", body([line("badge-req", { badgeId: "pl" })])),
  c("badge-active: column inactive but data active", body([line("drift-badge", { badgeId: "drift" })])),
  c("ok: personalization is free", body([line("retro-2", { personalization: { name: "DANA", number: "10" } })])),
  c("ok: delivery threshold not met (2 qualifying + 1 non-qualifying)", body([line("retro-2", { quantity: 2 }), line("np-1")])),
  c("ok: delivery threshold met exactly across lines", body([line("retro-2", { quantity: 2 }), line("made-1")])),
  c("ok: 30 lines", body(Array.from({ length: 30 }, (_, i) => line(i % 2 ? "retro-2" : "made-1")))),

  /* ── promotions ── */
  c(
    "promo: repeat, no stacking (sale units skipped)",
    body([line("retro-2", { quantity: 2 }), line("made-1", { quantity: 2 }), line("sale-amt")]),
    db({ promotions: [promo("p1", 10)] }),
  ),
  c(
    "promo: single group only (repeatPerPair off)",
    body([line("made-1", { quantity: 4 })]),
    db({ promotions: [promo("p1", 10, { repeatPerPair: false })] }),
  ),
  c(
    "promo: stacking with product sales",
    body([line("retro-2", { quantity: 3 })]),
    db({ promotions: [promo("p1", 10, { stackWithProductSales: true, discountPercent: 50 })] }),
  ),
  c(
    "promo: badge excluded from merchandise value",
    body([line("retro-1", { badgeId: "pl" }), line("made-1", { badgeId: "pl" })], { locale: "ar" }),
    db({ promotions: [promo("p1", 10, { stackWithProductSales: true })] }),
  ),
  c(
    "promo: eligible categories and excluded ids",
    body([line("retro-2"), line("season-1", { version: "fan", sleeve: "short" }), line("made-1"), line("stale-1")]),
    db({ promotions: [promo("p1", 10, { stackWithProductSales: true, eligibleCategorySlugs: ["retro", "season"], eligibleProductIds: ["made-1"], excludedProductIds: ["season-1"] })] }),
  ),
  c(
    "promo: scheduled and invalid campaigns skipped, next applies",
    body([line("made-1", { quantity: 2 })]),
    db({
      promotions: [
        promo("p-sched", 10, { startsAt: "2026-07-01T00:00:00.000Z" }),
        promo("p-nolabel", 20, { label: { en: "x", ar: "", he: "y" } }),
        promo("p-ok", 30, { discountPercent: 25, startsAt: SALE_START, endsAt: SALE_END }),
      ],
    }),
  ),
  c(
    "promo tie-break: equal sort_order, DB returns higher id first",
    body([line("made-1", { quantity: 2 })]),
    db({ promotions: [promo("p-b", 10, { discountPercent: 40 }), promo("p-a", 10, { discountPercent: 20 })] }),
  ),
  c(
    "promo: cart below minimum earns nothing",
    body([line("made-1")]),
    db({ promotions: [promo("p1", 10)] }),
  ),

  /* ── hardening targets (baseline behaviour frozen; later fixes documented) ── */
  c("locale: invalid locale", body([line("retro-1")], { locale: "xx" })),
  c("locale: missing locale", body([line("retro-1")], { locale: undefined })),
  c(
    "allowlist: customer extra keys and whitespace",
    body([line("retro-1")], { customer: { ...CUSTOMER, name: "  Dana Levi  ", notes: "ring twice", isAdmin: true, customerId: "spoofed" } }),
  ),
  c("allowlist: personalization extra keys", body([line("retro-2", { personalization: { name: "DANA", number: "7", priceIls: -50, html: "<b>" } })])),
  c("version: non-empty version on a product without versions", body([line("retro-2", { version: "player" })])),
  c("personalization: name with digits", body([line("retro-2", { personalization: { name: "DANA10" } })])),
];
