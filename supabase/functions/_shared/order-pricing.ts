/**
 * Authoritative order validation + pricing — the pure core of place-order.
 *
 * No Deno, no fetch, no crypto, no database: the handler reads the rows and
 * passes them in, and this module decides whether the order is valid and
 * what it costs. Because it is pure it runs under Node too, so the unit tests
 * call it directly (tests/unit/order-tamper.test.ts, order-pricing-parity) and
 * replay the handler around it (order-pricing-golden).
 *
 * Nothing about a price is ever read from the request body: not a unit
 * price, a line total, a sale, a promotion, a badge price, a delivery fee or
 * a total. The body contributes only ids, options and quantities.
 *
 * The sale / promotion / badge rules mirror src/lib/{sales,promotions,badges}.ts
 * (edge functions cannot import from src/). tests/unit/order-pricing-parity
 * runs both sides over the same carts and requires identical numbers.
 */

/* ── limits (server and client agree — see the shared contract) ────────── */

/** Units per order line. */
export const MAX_LINE_QUANTITY = 10;
/** Lines per order. */
export const MAX_ORDER_LINES = 30;
/** `orders.locale` CHECK constraint (0001_schema.sql). */
export const ALLOWED_LOCALES = ["ar", "he", "en"] as const;
/** Mirrors the checkout schema in src/pages/storefront/CheckoutPage.tsx. */
export const CUSTOMER_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  emailMax: 254,
  cityMin: 2,
  cityMax: 40,
  addressMin: 4,
  addressMax: 160,
  notesMax: 500,
} as const;
/** src/lib/schema.ts `.email()`. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** src/lib/schema.ts `.phone()` — 7–18 characters. */
export const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,17}$/;
/** Mirrors the product page (ProductPage.tsx): letters, marks, space, ' . - */
export const PERSONALIZATION_NAME_MAX = 14;
export const PERSONALIZATION_NAME_PATTERN = /^[\p{L}\p{M}' .-]{1,14}$/u;
export const PERSONALIZATION_NUMBER_PATTERN = /^\d{1,2}$/;

/** The only customer keys ever persisted (the handler adds `customerId`
 * from the verified JWT). Anything else in the request is dropped. */
export const CUSTOMER_KEYS = ["name", "email", "phone", "city", "address", "notes"] as const;
/** The only personalization keys ever persisted. */
export const PERSONALIZATION_KEYS = ["name", "number"] as const;

/* ── request shape ─────────────────────────────────────────────────────── */

export interface OrderLineInput {
  productId: string;
  version?: string;
  sleeve?: string;
  size: string;
  personalization?: { name?: string; number?: string };
  /** Only the id is accepted. The price is always resolved here. */
  badgeId?: string;
  /** @deprecated pre-0004 clients; treated exactly like `badgeId`. */
  patchId?: string;
  quantity: number;
}

export interface OrderRequestBody {
  locale: "ar" | "he" | "en";
  customer: { name: string; email: string; phone: string; city: string; address: string; notes?: string };
  zoneId: string;
  paymentMethod: string;
  lines: OrderLineInput[];
  marketingConsent?: boolean;
}

/* ── database rows the handler passes in ───────────────────────────────── */

export interface StoreSettingsData {
  paymentMethods: { id: string; enabled: boolean; configured: boolean }[];
  freeDeliveryMinItems?: number;
  bankTransferInstructions?: Record<string, string>;
}

export interface ZoneRow {
  id: string;
  active: boolean;
  data: { priceIls: number };
}

/** Global badge catalog row (`patches`). */
export interface BadgeRow {
  id: string;
  active: boolean;
  data: { id: string; code?: string; name: unknown; priceIls: number; active?: boolean; sortOrder?: number };
  supplier_ref?: string | null;
}

export interface ProductBadgeSetting {
  badgeId: string;
  enabled: boolean;
  priceOverrideIls?: number;
}

/** Sale configuration stored on the product. Mirrors src/lib/sales.ts. */
export interface SaleConfig {
  enabled: boolean;
  type: "none" | "percentage" | "fixed_amount" | "fixed_price";
  percentOff?: number;
  amountOffIls?: number;
  salePriceIls?: number;
  startsAt?: string;
  endsAt?: string;
  label?: Record<string, string>;
  autoPercentLabel?: boolean;
  showBeforeStart?: boolean;
  includeAddOns?: boolean;
}

interface AvailabilityRecord {
  status: string;
  lastCheckedAt?: string;
}

export interface ProductData {
  slug: string;
  name: unknown;
  categorySlug?: string;
  images: { src: string }[];
  basePriceIls: number;
  versions: { version: string; adjustmentIls: number }[];
  versionSizes?: Record<string, string[] | undefined>;
  sleeves: string[];
  longSleeveAdjustmentIls: number;
  sizes: string[];
  personalizable: boolean;
  patchIds?: string[];
  badges?: ProductBadgeSetting[];
  allowNoBadge?: boolean;
  sale?: SaleConfig;
  qualifiesForFreeDelivery: boolean;
  availability?: AvailabilityRecord;
  versionAvailability?: Record<string, AvailabilityRecord>;
  sizeAvailability?: Record<string, AvailabilityRecord>;
}

export interface ProductRow {
  id: string;
  status: string;
  data: ProductData;
}

/** Cart promotion campaign. Mirrors src/lib/promotions.ts. */
export interface PromotionConfig {
  id: string;
  type: string;
  enabled: boolean;
  discountPercent: number;
  minimumQuantity: number;
  repeatPerPair: boolean;
  stackWithProductSales: boolean;
  startsAt?: string;
  endsAt?: string;
  label: Record<string, string>;
  eligibleProductIds?: string[];
  eligibleCategorySlugs?: string[];
  excludedProductIds?: string[];
  sortOrder: number;
}

export interface PricingInput {
  /** The parsed request body, untrusted. */
  body: unknown;
  /** `store_settings.data` for id=main, or undefined when the row is missing. */
  settings: StoreSettingsData | undefined;
  /** The `shipping_zones` row for body.zoneId, or undefined. */
  zone: ZoneRow | undefined;
  /** Every product referenced by the lines, prefetched in one query. A line
   * whose product is missing here is `product_unavailable`. */
  products: Map<string, ProductRow>;
  /** The global badge catalog (`patches`), incl. supplier_ref. */
  badges: BadgeRow[];
  /** Campaign configs (`promotions.data`). */
  promotions: PromotionConfig[];
  /** The ONE server clock reading used for every time-dependent rule. */
  nowMs: number;
}

export type PricingErrorCode =
  | "invalid_customer"
  | "invalid_locale"
  | "empty_cart"
  | "too_many_lines"
  | "store_not_configured"
  | "payment_method_unavailable"
  | "zone_unavailable"
  | "invalid_quantity"
  | "product_unavailable"
  | "invalid_size"
  | "size_unavailable"
  | "invalid_version"
  | "invalid_sleeve"
  | "invalid_badge"
  | "personalization_unavailable"
  | "invalid_personalization"
  | "pricing_error";

export interface PricingFailure {
  ok: false;
  status: 400 | 500;
  error: PricingErrorCode;
}

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  notes?: string;
}

export interface OrderPersonalization {
  name?: string;
  number?: string;
}

export interface PricedOrder {
  ok: true;
  locale: OrderLocale;
  /** Allowlisted and trimmed — never the request object itself. */
  customer: OrderCustomer;
  zoneId: string;
  paymentMethod: string;
  items: Record<string, unknown>[];
  subtotalIls: number;
  promotion?: Record<string, unknown>;
  promotionDiscountIls: number;
  deliveryIls: number;
  freeDelivery: boolean;
  totalIls: number;
  pendingConfirmation: { slug: string; version?: string; size: string }[];
  supplierConfirmation?: { required: true; status: "pending"; items: { slug: string; version?: string; size: string }[] };
  initialPaymentStatus: string;
  initialFulfillmentStatus: string;
  tracking: { status: string; at: string }[];
}

export type PricingResult = PricingFailure | PricedOrder;

export type OrderLocale = (typeof ALLOWED_LOCALES)[number];

const fail = (error: PricingErrorCode, status: 400 | 500 = 400): PricingFailure => ({ ok: false, status, error });

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ── sale ──────────────────────────────────────────────────────────────── */

/**
 * Server-side sale resolution. Nothing about a sale is read from the request
 * body. The schedule is evaluated against the server clock in UTC, so a
 * browser with a wrong or manipulated clock cannot open or extend a sale.
 *
 * Start is inclusive, end is exclusive — identical to src/lib/sales.ts.
 */
export function resolveSaleServerSide(sale: SaleConfig | undefined, discountableIls: number, nowMs: number) {
  if (!sale || !sale.enabled || sale.type === "none") return undefined;

  const start = sale.startsAt ? Date.parse(sale.startsAt) : undefined;
  const end = sale.endsAt ? Date.parse(sale.endsAt) : undefined;
  if ((sale.startsAt && Number.isNaN(start!)) || (sale.endsAt && Number.isNaN(end!))) return undefined;
  if (start !== undefined && end !== undefined && end <= start) return undefined;
  if (start !== undefined && nowMs < start) return undefined; // scheduled → regular price
  if (end !== undefined && nowMs >= end) return undefined; // expired → regular price

  let value: number;
  let discount: number;
  if (sale.type === "percentage") {
    value = sale.percentOff ?? NaN;
    if (!Number.isFinite(value) || value <= 0 || value > 100) return undefined;
    discount = round2((discountableIls * value) / 100);
  } else if (sale.type === "fixed_amount") {
    value = sale.amountOffIls ?? NaN;
    if (!Number.isFinite(value) || value <= 0 || value > discountableIls) return undefined;
    discount = round2(value);
  } else {
    value = sale.salePriceIls ?? NaN;
    if (!Number.isFinite(value) || value < 0 || value >= discountableIls) return undefined;
    discount = round2(discountableIls - value);
  }
  discount = Math.max(0, Math.min(discount, discountableIls));

  const percentOff = discountableIls > 0 ? round2((discount / discountableIls) * 100) : 0;
  const label: Record<string, string> =
    sale.label && (sale.label.en?.trim() || sale.label.ar?.trim() || sale.label.he?.trim())
      ? sale.label
      : sale.autoPercentLabel && percentOff > 0
        ? autoPercentLabel(percentOff)
        : { ar: "تخفيض", he: "מבצע", en: "Sale" };

  return { type: sale.type, value, discount, label, startsAt: sale.startsAt, endsAt: sale.endsAt };
}

function autoPercentLabel(percent: number): Record<string, string> {
  const n = Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, "");
  return { ar: `خصم ${n}%`, he: `${n}% הנחה`, en: `${n}% off` };
}

/* ── cart promotion ────────────────────────────────────────────────────── */

interface PromoUnit {
  productId: string;
  slug: string;
  title: unknown;
  categorySlug?: string;
  merchandiseUnitIls: number;
  hasProductSale: boolean;
  index: number;
}

/** Same validation as the client: an unsafe campaign is treated as absent. */
export function promotionIsApplicable(p: PromotionConfig, nowMs: number): boolean {
  if (!p?.enabled) return false;
  if (!Number.isFinite(p.discountPercent) || p.discountPercent <= 0 || p.discountPercent > 100) return false;
  if (!Number.isInteger(p.minimumQuantity) || p.minimumQuantity < 2) return false;
  if (!p.label?.en?.trim() || !p.label?.ar?.trim() || !p.label?.he?.trim()) return false;
  const start = p.startsAt ? Date.parse(p.startsAt) : undefined;
  const end = p.endsAt ? Date.parse(p.endsAt) : undefined;
  if (p.startsAt && Number.isNaN(start!)) return false;
  if (p.endsAt && Number.isNaN(end!)) return false;
  if (start !== undefined && end !== undefined && end <= start) return false;
  if (start !== undefined && nowMs < start) return false; // scheduled
  if (end !== undefined && nowMs >= end) return false; // expired
  return true;
}

export function promotionIncludesProduct(p: PromotionConfig, productId: string, categorySlug?: string): boolean {
  if ((p.excludedProductIds ?? []).includes(productId)) return false;
  const ids = p.eligibleProductIds ?? [];
  const cats = p.eligibleCategorySlugs ?? [];
  if (ids.length === 0 && cats.length === 0) return true;
  if (ids.includes(productId)) return true;
  return !!categorySlug && cats.includes(categorySlug);
}

/** Identical ordering and grouping to src/lib/promotions.ts. */
export function applyPromotion(p: PromotionConfig, units: PromoUnit[]) {
  const sorted = [...units].sort(
    (a, b) =>
      b.merchandiseUnitIls - a.merchandiseUnitIls ||
      a.productId.localeCompare(b.productId) ||
      a.slug.localeCompare(b.slug) ||
      a.index - b.index,
  );
  const groupSize = p.minimumQuantity;
  const complete = Math.floor(sorted.length / groupSize);
  const groups = p.repeatPerPair ? complete : Math.min(complete, 1);

  const items: Record<string, unknown>[] = [];
  let discount = 0;
  for (let g = 0; g < groups; g++) {
    const group = sorted.slice(g * groupSize, (g + 1) * groupSize);
    const candidates = [...group].reverse(); // cheapest first
    const chosen = p.stackWithProductSales ? candidates[0] : candidates.find((u) => !u.hasProductSale);
    if (!chosen) continue;
    const unitDiscount = round2((chosen.merchandiseUnitIls * p.discountPercent) / 100);
    if (unitDiscount <= 0) continue;
    discount = round2(discount + unitDiscount);
    items.push({
      productId: chosen.productId,
      slug: chosen.slug,
      title: chosen.title,
      unitMerchandiseIls: chosen.merchandiseUnitIls,
      discountIls: unitDiscount,
    });
  }
  const original = round2(sorted.reduce((sum, u) => sum + u.merchandiseUnitIls, 0));
  return { items, discount, original, final: round2(original - discount), eligibleUnits: sorted.length };
}

/* ── validation ────────────────────────────────────────────────────────── */

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Allowlists and validates the customer block exactly like the checkout
 * schema: every field trimmed, then length/format checked. Returns null when
 * anything is missing, the wrong type, too short or too long. Unknown keys
 * are dropped, never persisted.
 */
export function sanitizeCustomer(raw: unknown): OrderCustomer | null {
  if (!isPlainObject(raw)) return null;
  const text = (k: string): string | null => (typeof raw[k] === "string" ? (raw[k] as string).trim() : null);
  const L = CUSTOMER_LIMITS;
  const name = text("name");
  const email = text("email");
  const phone = text("phone");
  const city = text("city");
  const address = text("address");
  if (name === null || name.length < L.nameMin || name.length > L.nameMax) return null;
  if (email === null || email.length > L.emailMax || !EMAIL_PATTERN.test(email)) return null;
  if (phone === null || !PHONE_PATTERN.test(phone)) return null;
  if (city === null || city.length < L.cityMin || city.length > L.cityMax) return null;
  if (address === null || address.length < L.addressMin || address.length > L.addressMax) return null;
  // Optional, as in the checkout schema: absent, null and "" all mean none.
  const rawNotes = raw.notes;
  let notes: string | undefined;
  if (rawNotes !== undefined && rawNotes !== null && rawNotes !== "") {
    if (typeof rawNotes !== "string" || rawNotes.length > L.notesMax) return null;
    notes = rawNotes.trim() || undefined;
  }
  return { name, email, phone, city, address, ...(notes ? { notes } : {}) };
}

/**
 * Allowlists and validates one line's personalization: only `name` and
 * `number`, each optional, trimmed, and matching the product page's rules.
 * `value` is undefined when nothing non-empty remains.
 */
export function sanitizePersonalization(raw: unknown): { ok: true; value?: OrderPersonalization } | { ok: false } {
  if (!isPlainObject(raw)) return { ok: false };
  const out: OrderPersonalization = {};
  for (const key of PERSONALIZATION_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { ok: false };
    const t = v.trim();
    if (t === "") continue;
    const pattern = key === "name" ? PERSONALIZATION_NAME_PATTERN : PERSONALIZATION_NUMBER_PATTERN;
    if (!pattern.test(t)) return { ok: false };
    out[key] = t;
  }
  return out.name !== undefined || out.number !== undefined ? { ok: true, value: out } : { ok: true };
}

export function isAllowedLocale(v: unknown): v is OrderLocale {
  return typeof v === "string" && (ALLOWED_LOCALES as readonly string[]).includes(v);
}

/**
 * Request-level checks that need no database: customer, cart shape, locale.
 * The handler runs this BEFORE any database read so an obviously bad request
 * costs nothing; `validateAndPriceOrder` runs it again as its first step, so
 * the precedence is the same either way:
 *   invalid_customer → empty_cart → too_many_lines → invalid_locale →
 *   (settings, method, zone) → per line, in order.
 */
export function validateOrderRequest(rawBody: unknown): PricingFailure | null {
  const body = isPlainObject(rawBody) ? rawBody : {};
  if (!sanitizeCustomer(body.customer ?? {})) return fail("invalid_customer");
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0) return fail("empty_cart");
  if (lines.length > MAX_ORDER_LINES) return fail("too_many_lines");
  // Checked here rather than left to the orders.locale CHECK, which would
  // surface as a 500 after the order number was already spent (A2-B9).
  if (!isAllowedLocale(body.locale)) return fail("invalid_locale");
  return null;
}

/** Distinct product ids referenced by the lines — what the handler prefetches. */
export function orderProductIds(rawBody: unknown): string[] {
  const lines = (rawBody as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return [];
  const ids = new Set<string>();
  for (const l of lines) {
    const id = (l as { productId?: unknown } | null)?.productId;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  return [...ids];
}

/** A PostgREST `in.(…)` list: every value double-quoted (with `"` and `\`
 * backslash-escaped) and URI-encoded, so an id containing a comma, a
 * parenthesis or a quote can never widen or break the filter. */
export function postgrestInList(ids: string[]): string {
  return ids.map((id) => encodeURIComponent(`"${id.replace(/["\\]/g, "\\$&")}"`)).join(",");
}

/* ── the core ──────────────────────────────────────────────────────────── */

export function validateAndPriceOrder(input: PricingInput): PricingResult {
  const early = validateOrderRequest(input.body);
  if (early) return early;
  const body = input.body as Record<string, unknown>;
  const customer = sanitizeCustomer(body.customer)!; // validated above
  const locale = body.locale as OrderLocale; // validated above
  const rawLines = body.lines as unknown[]; // validated above
  const { settings, zone, products, badges: badgeRows, nowMs } = input;

  /* settings + method + zone */
  if (!settings) return fail("store_not_configured", 500);
  const paymentMethods = Array.isArray(settings.paymentMethods) ? settings.paymentMethods : [];
  const method = paymentMethods.find((m) => m.id === body.paymentMethod);
  if (!method?.enabled || !method.configured) return fail("payment_method_unavailable");
  if (!zone?.active) return fail("zone_unavailable");

  /* recompute pricing from the database rows */
  const items: Record<string, unknown>[] = [];
  let subtotal = 0;
  let qualifyingCount = 0;

  const pendingConfirmation: { slug: string; version?: string; size: string }[] = [];
  const promoUnits: PromoUnit[] = [];
  for (const rawLine of rawLines) {
    const line = (isPlainObject(rawLine) ? rawLine : {}) as Partial<OrderLineInput> & Record<string, unknown>;
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) return fail("invalid_quantity");
    const product = typeof line.productId === "string" ? products.get(line.productId) : undefined;
    if (!product || ["draft", "archived", "unavailable"].includes(product.status)) return fail("product_unavailable");
    const d = product.data;
    const lineVersion = typeof line.version === "string" ? line.version : undefined;
    const size = typeof line.size === "string" ? line.size : undefined;

    // A size must be valid for the SELECTED version (A2-B4). Same rule as
    // the storefront's sizeOptionsFor (src/services/sizing.ts): a non-empty
    // `versionSizes[version]` replaces `sizes`; otherwise `sizes` applies.
    const override =
      lineVersion !== undefined && d.versionSizes && Object.prototype.hasOwnProperty.call(d.versionSizes, lineVersion)
        ? d.versionSizes[lineVersion]
        : undefined;
    const sizeList = Array.isArray(override) && override.length > 0 ? override : d.sizes;
    if (size === undefined || !sizeList.includes(size)) return fail("invalid_size");

    // Supplier availability, resolved most-specific-first. A size the
    // supplier confirmed as unavailable can never be ordered; anything
    // unconfirmed holds the order before production (see below).
    const availabilityOf = (): string => {
      const k = (v: string | undefined) => `${v ?? "*"}:${size}`;
      // `available` only counts when a real check was recorded AND that
      // check is still within the 7-day freshness window. Stored decisions
      // are never rewritten here — a stale one simply stops confirming.
      const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
      const eff = (r?: AvailabilityRecord) => {
        if (!r) return undefined;
        if (r.status !== "available") return r.status; // decisions do not expire
        const checked = r.lastCheckedAt ? Date.parse(r.lastCheckedAt) : NaN;
        return !Number.isNaN(checked) && nowMs - checked <= FRESH_MS ? "available" : "confirmation_required";
      };
      const chain = [
        eff(d.sizeAvailability?.[k(lineVersion)] ?? d.sizeAvailability?.[k(undefined)]),
        eff(lineVersion ? d.versionAvailability?.[lineVersion] : undefined),
        eff(d.availability),
      ];
      // A broader `available` never overrides a narrower restriction.
      if (chain.includes("discontinued") || product.status === "archived") return "discontinued";
      if (chain.includes("unavailable") || product.status === "unavailable") return "unavailable";
      // Publication status is not confirmation: unconfirmed by default.
      return chain.find((s) => s !== undefined) ?? "confirmation_required";
    };
    const availability = availabilityOf();
    if (availability === "unavailable" || availability === "discontinued") return fail("size_unavailable");

    let versionAdjustmentIls = 0;
    let version: string | undefined;
    if (d.versions.length > 0) {
      const v = d.versions.find((x) => x.version === line.version);
      if (!v) return fail("invalid_version");
      version = v.version;
      versionAdjustmentIls = v.adjustmentIls;
    } else if (line.version !== undefined && line.version !== null && line.version !== "") {
      // A product without versions has nothing to select: a version sent for
      // it is fabricated and would otherwise be stored in the hold items.
      return fail("invalid_version");
    }
    if (availability === "confirmation_required") {
      pendingConfirmation.push({ slug: d.slug, version, size });
    }
    let optionAdjustmentsIls = 0;
    let sleeve: string | undefined;
    if (d.sleeves.length > 1) {
      if (line.sleeve !== "short" && line.sleeve !== "long") return fail("invalid_sleeve");
      sleeve = line.sleeve;
      if (sleeve === "long") optionAdjustmentsIls += d.longSleeveAdjustmentIls;
    } else if (d.sleeves[0] === "long") sleeve = "long";
    let unit = d.basePriceIls + versionAdjustmentIls + optionAdjustmentsIls;

    // ── badge / patch ───────────────────────────────────────────────────
    // The browser sends an id and nothing else. The price charged is the
    // product's own override if it has one, otherwise the global catalog
    // price. A fabricated id, a globally disabled option, an option this
    // product does not enable, or a negative price is refused outright —
    // never silently charged at ₪0.
    const selectedBadgeId = line.badgeId ?? line.patchId;
    // `badges` is authoritative; legacy `patchIds` rows upgrade in place.
    const badgeSettings: ProductBadgeSetting[] = d.badges ?? (d.patchIds ?? []).map((badgeId) => ({ badgeId, enabled: true }));
    let badgeSnapshot: Record<string, unknown> | undefined;
    let badgeAdjustmentIls = 0;
    if (selectedBadgeId) {
      const row = badgeRows.find((b) => b.id === selectedBadgeId);
      const setting = badgeSettings.find((s) => s.badgeId === selectedBadgeId);
      // Same source of truth as the storefront (A2-B10): the storefront only
      // ever reads rows with the `active` COLUMN true (SupabaseDataService
      // listBadges `active=eq.true`, RLS patches_public_read), then hides a
      // row whose data says `active: false` (normalizeBadgeOption). A badge is
      // selectable only when both agree.
      const globallyActive = row ? row.active === true && row.data?.active !== false : false;
      if (!row || !globallyActive || !setting?.enabled) return fail("invalid_badge");
      const override = setting.priceOverrideIls;
      const badgePrice = typeof override === "number" && Number.isFinite(override) ? override : row.data.priceIls;
      if (!Number.isFinite(badgePrice) || badgePrice < 0) return fail("invalid_badge");
      unit += badgePrice;
      badgeAdjustmentIls = badgePrice;
      const names = (row.data.name ?? {}) as Record<string, string>;
      badgeSnapshot = {
        badgeId: row.id,
        code: row.data.code ?? row.id,
        name: row.data.name,
        label: names[locale] || names.en || row.id,
        priceIls: badgePrice,
        ...(row.supplier_ref ? { supplierReference: row.supplier_ref } : {}),
      };
    } else if (d.allowNoBadge === false) {
      return fail("invalid_badge");
    }
    // ── sale ────────────────────────────────────────────────────────────
    // Resolved here from the stored configuration and the server clock.
    // The regular price stays intact; the discount is applied on top.
    const includeAddOns = d.sale?.includeAddOns === true;
    const discountable = includeAddOns
      ? round2(d.basePriceIls + versionAdjustmentIls + optionAdjustmentsIls + badgeAdjustmentIls)
      : round2(d.basePriceIls + versionAdjustmentIls);
    const regularUnit = round2(unit);
    const activeSale = resolveSaleServerSide(d.sale, discountable, nowMs);
    const saleDiscountIls = activeSale ? Math.max(0, Math.min(activeSale.discount, discountable)) : 0;
    unit = round2(regularUnit - saleDiscountIls);

    // Personalization is free: it is validated and allowlisted here and
    // never contributes to the price.
    let personalization: OrderPersonalization | undefined;
    if (line.personalization) {
      if (!d.personalizable) return fail("personalization_unavailable");
      const p = sanitizePersonalization(line.personalization);
      if (!p.ok) return fail("invalid_personalization");
      personalization = p.value;
    }
    if (unit < 0) return fail("pricing_error", 500);

    const lineTotal = Math.round(unit * quantity * 100) / 100;
    subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
    if (d.qualifiesForFreeDelivery) qualifyingCount += quantity;

    items.push({
      productId: product.id,
      slug: d.slug,
      title: d.name,
      image: d.images[0]?.src ?? "",
      version,
      sleeve,
      size,
      personalization,
      // Immutable: later catalog edits never reach back into this order.
      ...(badgeSnapshot ? { badge: badgeSnapshot, patchId: badgeSnapshot.badgeId, patchName: badgeSnapshot.name } : {}),
      // Immutable price breakdown. Editing or ending the sale afterwards
      // cannot reach back into a placed order.
      price: {
        regularBasePriceIls: d.basePriceIls,
        versionAdjustmentIls,
        optionAdjustmentsIls,
        badgeAdjustmentIls,
        regularUnitPriceIls: regularUnit,
        ...(saleDiscountIls > 0 && activeSale ? { saleType: activeSale.type, saleValue: activeSale.value } : {}),
        saleDiscountIls,
        finalUnitPriceIls: unit,
        ...(saleDiscountIls > 0 && activeSale ? { saleLabel: activeSale.label[locale] || activeSale.label.en } : {}),
        ...(saleDiscountIls > 0 && activeSale?.startsAt ? { saleStartsAt: activeSale.startsAt } : {}),
        ...(saleDiscountIls > 0 && activeSale?.endsAt ? { saleEndsAt: activeSale.endsAt } : {}),
        // For a request held pending supplier confirmation, the sale price
        // is only guaranteed for as long as the sale itself runs.
        ...(saleDiscountIls > 0 && activeSale?.endsAt && availability === "confirmation_required" ? { priceValidUntil: activeSale.endsAt } : {}),
      },
      unitPriceIls: unit,
      quantity,
      lineTotalIls: lineTotal,
    });

    // One promotion unit per ordered unit — quantity 2 counts as two.
    for (let u = 0; u < quantity; u++) {
      promoUnits.push({
        productId: product.id,
        slug: d.slug,
        title: d.name,
        ...(d.categorySlug ? { categorySlug: d.categorySlug } : {}),
        // Merchandise only: the badge charge is subtracted, and any
        // product sale is already reflected in `unit`.
        merchandiseUnitIls: round2(unit - badgeAdjustmentIls),
        hasProductSale: saleDiscountIls > 0,
        index: u,
      });
    }
  }

  /* ── cart promotion, recomputed from the stored campaigns ── */
  // Campaign order is the storefront's (src/lib/promotions.ts
  // activePromotion): sortOrder ascending, ties broken by id — never the
  // database's unspecified order for equal sort_order rows (A2-B11).
  const campaign = [...input.promotions]
    .filter((p): p is PromotionConfig => isPlainObject(p))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id)))
    .find((p) => promotionIsApplicable(p, nowMs));
  let promotion: Record<string, unknown> | undefined;
  let promotionDiscountIls = 0;
  if (campaign) {
    const eligible = promoUnits.filter((u) => promotionIncludesProduct(campaign, u.productId, u.categorySlug));
    const applied = applyPromotion(campaign, eligible);
    if (applied.discount > 0) {
      promotionDiscountIls = applied.discount;
      promotion = {
        promotionId: campaign.id,
        type: campaign.type,
        label: campaign.label,
        labelText: campaign.label[locale] || campaign.label.en,
        discountPercent: campaign.discountPercent,
        minimumQuantity: campaign.minimumQuantity,
        repeatPerPair: campaign.repeatPerPair,
        stackWithProductSales: campaign.stackWithProductSales,
        ...(campaign.startsAt ? { startsAt: campaign.startsAt } : {}),
        ...(campaign.endsAt ? { endsAt: campaign.endsAt } : {}),
        eligibleUnits: applied.eligibleUnits,
        discountedUnits: applied.items.length,
        originalMerchandiseIls: applied.original,
        discountIls: applied.discount,
        finalMerchandiseIls: applied.final,
        items: applied.items,
      };
    }
  }

  /* delivery: quantity-based free delivery (spec §12) */
  const minItems = settings.freeDeliveryMinItems ?? 3;
  const freeDelivery = qualifyingCount >= minItems;
  const deliveryIls = freeDelivery ? 0 : zone.data.priceIls;
  // The promotion reduces merchandise only; delivery is never discounted.
  const merchandiseAfterPromotion = round2(subtotal - promotionDiscountIls);
  const total = round2(merchandiseAfterPromotion + deliveryIls);

  /* initial statuses: unconfirmed supplier availability holds the order —
     nothing is reserved, ordered from the supplier or produced in this state. */
  const needsSupplierCheck = pendingConfirmation.length > 0;
  const isBank = method.id === "bank_transfer";
  const at = new Date(nowMs).toISOString();

  return {
    ok: true,
    locale,
    customer,
    zoneId: zone.id,
    paymentMethod: method.id,
    items,
    subtotalIls: subtotal,
    ...(promotion ? { promotion } : {}),
    promotionDiscountIls,
    deliveryIls,
    freeDelivery,
    totalIls: total,
    pendingConfirmation,
    ...(needsSupplierCheck ? { supplierConfirmation: { required: true as const, status: "pending" as const, items: pendingConfirmation } } : {}),
    initialPaymentStatus: isBank ? "awaiting_payment" : "pending",
    initialFulfillmentStatus: needsSupplierCheck ? "awaiting_supplier_confirmation" : isBank ? "awaiting_payment" : "order_received",
    tracking: [
      { status: "order_received", at },
      ...(needsSupplierCheck ? [{ status: "awaiting_supplier_confirmation", at }] : isBank ? [{ status: "awaiting_payment", at }] : []),
    ],
  };
}
