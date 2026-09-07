/** Domain model shared by the demo service, the Supabase service and the UI. */

export interface LocalizedText {
  ar: string;
  he: string;
  en: string;
}

export type ProductStatus = "available" | "made_to_order" | "unavailable" | "draft" | "archived";
export type JerseyVersion = "fan" | "player" | "retro" | "kids";
export type SleeveStyle = "short" | "long";
export type RightsStatus = "pending_review" | "cleared" | "blocked";

export interface CategoryDef {
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  /** Base price applied when a product has no explicit override. */
  basePriceIls: number;
  sizeChartId: string;
  image: string;
  sortOrder: number;
}

export interface ProductVersionOption {
  version: JerseyVersion;
  /** Adjustment relative to the product base price (can be 0 or negative). */
  adjustmentIls: number;
}

export interface Product {
  id: string;
  slug: string;
  categorySlug: string;
  name: LocalizedText;
  description: LocalizedText;
  details: LocalizedText;
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  status: ProductStatus;
  basePriceIls: number;
  compareAtPriceIls?: number;
  versions: ProductVersionOption[];
  sleeves: SleeveStyle[];
  longSleeveAdjustmentIls: number;
  sizes: string[];
  personalizable: boolean;
  /** @deprecated superseded by `badges`. Legacy rows (and any product saved
   * before migration 0004) still carry it; `productBadgeSettings()` upgrades
   * it at read time so no hard-coded fallback list is ever needed. */
  patchIds: string[];
  /** Which global badge options this product supports, and at what price. */
  badges?: ProductBadgeSetting[];
  /** Whether the customer may choose "no badge". Absent → true. */
  allowNoBadge?: boolean;
  /** Badge preselected on the product page. Absent → "no badge". */
  defaultBadgeId?: string;
  /** Sale configuration. Absent → no sale. Never overwrites `basePriceIls`. */
  sale?: SaleConfig;
  era?: string;
  season?: string;
  nationalTeam?: boolean;
  kids?: boolean;
  qualifiesForFreeDelivery: boolean;
  featured: boolean;
  /** Ordered media. Entry roles drive the styled/real presentation; entries
   * without a role are ordinary gallery images, exactly as before. */
  images: ProductImage[];
  relatedSlugs: string[];
  tags: string[];
  rightsStatus: RightsStatus;
  supplier?: { sku?: string; reference?: string; costUsd?: number };
  /** Product-level supplier availability. Absent → derived from `status`. */
  availability?: AvailabilityRecord;
  /** Per-version overrides (fan availability never implies player). */
  versionAvailability?: Partial<Record<JerseyVersion, AvailabilityRecord>>;
  /** Per-size overrides keyed `${version|*}:${size}`. */
  sizeAvailability?: Record<string, AvailabilityRecord>;
  /** Per-version allowed sizes; falls back to `sizes` when unset. */
  versionSizes?: Partial<Record<JerseyVersion, string[]>>;
  isDemo: boolean;
  createdAt: string;
}

/* ── Product media ─────────────────────────────────────────────────────────
   The styled preview and the real product photograph are not a second image
   system: they are ordinary members of `images` carrying a role. That keeps
   one ordered gallery (so a role image is never duplicated as an extra
   slide), needs no schema change on the jsonb-backed products table, and
   leaves untagged legacy images behaving exactly as they always have. */

/** `styled` = premium presentation image, possibly AI-generated or styled.
 *  `real` = photograph of the actual product the customer receives.
 *  Absent = an ordinary gallery image making neither claim. */
export type ProductImageRole = "styled" | "real";

export interface ProductImage {
  src: string;
  alt: LocalizedText;
  role?: ProductImageRole;
}

/* ── Badge / patch options ─────────────────────────────────────────────────
   A single global catalog the owner manages from Admin. Products opt in to
   individual options and may override the price. Nothing about badges is
   hard-coded in the frontend — prices, names and availability are data. */

export interface BadgeOption {
  /** Stable identifier; referenced by products, carts and order snapshots. */
  id: string;
  /** Internal slug (e.g. `ucl`). Never shown to customers. */
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  /** Default price adjustment in ILS. Must be ≥ 0. */
  priceIls: number;
  active: boolean;
  sortOrder: number;
  /** Optional customer-facing icon. */
  iconUrl?: string;
  /** Internal only — stripped from every public response. */
  supplierReference?: string;
}

/** @deprecated legacy name for {@link BadgeOption}. */
export type PatchDef = BadgeOption;

/** Product-level enablement of a global badge option. */
export interface ProductBadgeSetting {
  badgeId: string;
  enabled: boolean;
  /** Overrides the global price for this product only. Absent → inherit. */
  priceOverrideIls?: number;
}

/** A badge as offered on one specific product, price already resolved. */
export interface ResolvedBadge {
  id: string;
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  priceIls: number;
  iconUrl?: string;
  /** Where `priceIls` came from — surfaced in Admin, never to customers. */
  priceSource: "override" | "global";
  /** Internal only — never sent to the storefront. */
  supplierReference?: string;
}

/** Immutable per-order-item record of what was actually sold and charged.
 * Editing or deleting a badge option later never rewrites this. */
export interface BadgeSnapshot {
  badgeId: string;
  code: string;
  /** Full trilingual name as it stood when the order was placed. */
  name: LocalizedText;
  /** Customer-facing name in the order's own locale. */
  label: string;
  /** Adjustment actually charged, per unit, in ILS. */
  priceIls: number;
  /** Internal only — stripped from customer-facing responses. */
  supplierReference?: string;
}

/** Measurement keys used by size-chart rows. `widthFlatCm` is armpit-to-armpit
 * width with the garment laid flat — never a chest circumference. `bustCm` is
 * the supplier-supplied chest value (training suits only). `legacyChestCm`
 * carries pre-2026 unverified data so old rows keep rendering. */
export type MeasurementKey =
  | "lengthCm"
  | "widthFlatCm"
  | "bustCm"
  | "halfChestCm"
  | "shortsLengthCm"
  | "waistCm"
  | "heightCm"
  | "weightKg"
  | "age"
  | "legacyChestCm";

/** A supplier measurement. `max` omitted means a single exact value. */
export interface MeasurementRange {
  min: number;
  max?: number;
}

export interface SizeChartColumn {
  key: MeasurementKey;
  /** i18n key for the column header. */
  labelKey: string;
  unit: "cm" | "kg" | "age";
}

export interface SizeChartRow {
  size: string;
  values: Partial<Record<MeasurementKey, MeasurementRange>>;
  /** @deprecated legacy flat fields, kept so pre-existing rows still load. */
  chestCm?: number;
  /** @deprecated legacy flat fields, kept so pre-existing rows still load. */
  lengthCm?: number;
}

export interface SizeChart {
  id: string;
  name: LocalizedText;
  note: LocalizedText;
  columns: SizeChartColumn[];
  rows: SizeChartRow[];
  /** Whether the supplier has confirmed these measurements. */
  confirmation: "supplier_confirmed" | "preliminary";
  /** @deprecated use `confirmation`; retained for stored data compatibility. */
  isPlaceholder: boolean;
}

/* ── Sales ─────────────────────────────────────────────────────────────────
   A sale is configuration, never a rewrite of the price. The regular price
   stays in `basePriceIls`; ending a sale simply stops applying it.

   Publishing, supplier availability and being on sale are three independent
   states — a product can be on sale and still `confirmation_required`. */

export type SaleType = "none" | "percentage" | "fixed_amount" | "fixed_price";

export interface SaleConfig {
  /** Master switch. False → the product sells at its regular price. */
  enabled: boolean;
  type: SaleType;
  /** `percentage`: 0 < value ≤ 100. */
  percentOff?: number;
  /** `fixed_amount`: ILS off, must be less than the discountable price. */
  amountOffIls?: number;
  /** `fixed_price`: the final discountable price, below the regular one. */
  salePriceIls?: number;
  /** ISO-8601 UTC. Absent → no start bound (active immediately). */
  startsAt?: string;
  /** ISO-8601 UTC, exclusive. Absent → no end bound. */
  endsAt?: string;
  /** Owner-written label. Absent/blank → the automatic label is used. */
  label?: LocalizedText;
  /** Derive "20% off" / "خصم 20%" / "20% הנחה" instead of a written label. */
  autoPercentLabel?: boolean;
  /** Show a truthful "starts on …" note before the sale opens. Never
   * displays a discounted price ahead of time. */
  showBeforeStart?: boolean;
  /** Whether paid add-ons (badge, long sleeve) are discounted too.
   * Absent → false: the sale applies to the base price and the version
   * adjustment only. */
  includeAddOns?: boolean;
}

export type SaleStatus = "disabled" | "scheduled" | "active" | "expired" | "invalid";

/** A sale resolved against a specific product price at a specific instant. */
export interface ResolvedSale {
  status: SaleStatus;
  type: Exclude<SaleType, "none">;
  /** The configured value for the type (percent, ILS off, or final price). */
  value: number;
  /** ILS taken off the discountable portion. 0 unless status is `active`. */
  discountIls: number;
  label: LocalizedText;
  /** Whole-percent saving, only when it divides exactly enough to state. */
  percentOff?: number;
  startsAt?: string;
  endsAt?: string;
  includeAddOns: boolean;
}

/** Immutable per-order-item record of the price actually charged. */
export interface PriceSnapshot {
  regularBasePriceIls: number;
  versionAdjustmentIls: number;
  optionAdjustmentsIls: number;
  badgeAdjustmentIls: number;
  /** Unit price before any sale. */
  regularUnitPriceIls: number;
  saleType?: Exclude<SaleType, "none">;
  saleValue?: number;
  saleDiscountIls: number;
  /** Unit price actually charged. */
  finalUnitPriceIls: number;
  /** Label shown to the customer, in the order's locale. */
  saleLabel?: string;
  saleStartsAt?: string;
  saleEndsAt?: string;
  /** For orders held for supplier confirmation: when this price stops being
   * guaranteed. Absent → the price has no expiry. */
  priceValidUntil?: string;
}

/* ── Cart promotions ───────────────────────────────────────────────────────
   A promotion is a CART-level rule, deliberately separate from the
   product-level `sale` above: a sale reduces one product's own price, while a
   promotion looks at the whole basket. Keeping them apart avoids the
   confusing semantics of expressing "buy 2, get 15% off the second" as a
   property of a single product.

   Only `second_item_percentage` exists today. The shape leaves room for
   further rules (buy 3, category rules, a fixed second-item amount) without
   becoming a coupon engine. */

export type PromotionType = "second_item_percentage";

export interface PromotionConfig {
  id: string;
  type: PromotionType;
  /** Master switch. Ships disabled; the owner turns it on deliberately. */
  enabled: boolean;
  /** Percentage taken off the discounted unit. 0 < value ≤ 100. */
  discountPercent: number;
  /** Eligible units needed to earn one discount. 2 = "buy 2". */
  minimumQuantity: number;
  /** Whether further complete groups each earn another discount. */
  repeatPerPair: boolean;
  /** Whether a unit already carrying a product sale may also be discounted
   * here. Off by default — no accidental double-discounting. */
  stackWithProductSales: boolean;
  /** ISO-8601 UTC. Absent → no bound. End is exclusive, as for sales. */
  startsAt?: string;
  endsAt?: string;
  label: LocalizedText;
  /** Empty/absent → every product is eligible. */
  eligibleProductIds?: string[];
  /** Optional additional eligibility by category. */
  eligibleCategorySlugs?: string[];
  /** Always wins over any eligibility rule. */
  excludedProductIds?: string[];
  sortOrder: number;
}

/** One unit that actually received the promotion. */
export interface PromotionAllocation {
  productId: string;
  slug: string;
  title: LocalizedText;
  /** Cart line the unit came from, so the UI can annotate the right row. */
  lineKey?: string;
  /** Merchandise value of this single unit — excludes badge and delivery. */
  unitMerchandiseIls: number;
  discountIls: number;
}

/** Immutable record of the promotion as applied to one order. Editing or
 * disabling the campaign later never rewrites this. */
export interface PromotionSnapshot {
  promotionId: string;
  type: PromotionType;
  /** Full trilingual label as it stood when the order was placed. */
  label: LocalizedText;
  /** Customer-facing label in the order's own locale. */
  labelText: string;
  discountPercent: number;
  minimumQuantity: number;
  repeatPerPair: boolean;
  stackWithProductSales: boolean;
  startsAt?: string;
  endsAt?: string;
  /** Eligible units counted, and how many earned a discount. */
  eligibleUnits: number;
  discountedUnits: number;
  /** Eligible merchandise before the promotion, the discount, and after. */
  originalMerchandiseIls: number;
  discountIls: number;
  finalMerchandiseIls: number;
  items: PromotionAllocation[];
}

/* ── Supplier availability ─────────────────────────────────────────────── */

/** Catalog presence is not inventory: `confirmation_required` is the honest
 * default for anything the supplier has not recently confirmed. */
export type AvailabilityState = "available" | "confirmation_required" | "unavailable" | "discontinued";

export interface AvailabilityRecord {
  status: AvailabilityState;
  /** ISO timestamp of the last manual supplier check. */
  lastCheckedAt?: string;
  /** Internal only — stripped before reaching the storefront. */
  supplierNote?: string;
}

export interface ShippingZone {
  id: string;
  name: LocalizedText;
  priceIls: number;
  etaDays: string;
  active: boolean;
}

export type PaymentMethodId = "card" | "bit" | "paybox" | "paypal" | "bank_transfer";

export interface PaymentMethodSetting {
  id: PaymentMethodId;
  enabled: boolean;
  testMode: boolean;
  /** True only when real credentials are configured server-side. */
  configured: boolean;
  label: LocalizedText;
}

export type PaymentStatus =
  | "pending"
  | "awaiting_payment"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "under_review";

export type FulfillmentStatus =
  | "order_received"
  /** Customer requested an item the supplier has not confirmed yet. Nothing
   * is reserved, ordered or produced while an order sits in this state. */
  | "awaiting_supplier_confirmation"
  | "supplier_unavailable"
  | "awaiting_payment"
  | "payment_confirmed"
  | "sent_to_supplier"
  | "production_started"
  | "supplier_processing"
  | "quality_inspection"
  | "supplier_dispatched"
  | "in_transit"
  | "arrived_locally"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "delivered"
  | "issue_reported"
  | "cancelled"
  | "refunded";

/** The main customer-visible timeline. Statuses outside this flow (e.g.
 * supplier_processing, ready_for_pickup, issue_reported) render as the
 * current step appended after the reached flow steps. */
export const FULFILLMENT_FLOW: FulfillmentStatus[] = [
  "order_received",
  "payment_confirmed",
  "sent_to_supplier",
  "production_started",
  "quality_inspection",
  "supplier_dispatched",
  "in_transit",
  "arrived_locally",
  "out_for_delivery",
  "delivered",
];

export interface Personalization {
  name?: string;
  number?: string;
}

export interface CartLine {
  key: string;
  productId: string;
  slug: string;
  /** Needed for category-scoped cart promotions. */
  categorySlug?: string;
  title: LocalizedText;
  image: string;
  version?: JerseyVersion;
  sleeve?: SleeveStyle;
  size: string;
  personalization?: Personalization;
  /** Selected badge, price already resolved. Absent → no badge. */
  badge?: BadgeSnapshot;
  /** Full price breakdown as displayed. Re-validated server-side on order. */
  price?: PriceSnapshot;
  /** @deprecated mirrors `badge` so carts saved before 0004 keep working. */
  patchId?: string;
  /** @deprecated mirrors `badge.name`. */
  patchName?: LocalizedText;
  unitPriceIls: number;
  quantity: number;
  qualifiesForFreeDelivery: boolean;
  isDemo: boolean;
}

export interface OrderItem {
  productId: string;
  slug: string;
  title: LocalizedText;
  image: string;
  version?: JerseyVersion;
  sleeve?: SleeveStyle;
  size: string;
  personalization?: Personalization;
  /** Immutable snapshot — never re-resolved from the live badge catalog. */
  badge?: BadgeSnapshot;
  /** Immutable price breakdown, computed and validated server-side. Editing
   * or ending a sale later never changes this. */
  price?: PriceSnapshot;
  /** @deprecated mirrors `badge`; retained so pre-0004 orders still render. */
  patchId?: string;
  /** @deprecated mirrors `badge.name`. */
  patchName?: LocalizedText;
  unitPriceIls: number;
  quantity: number;
  lineTotalIls: number;
}

export interface TrackingEvent {
  status: FulfillmentStatus;
  at: string;
  note?: LocalizedText;
}

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  locale: "ar" | "he" | "en";
  customer: {
    name: string;
    email: string;
    phone: string;
    city: string;
    address: string;
    notes?: string;
    customerId?: string;
  };
  items: OrderItem[];
  subtotalIls: number;
  /** Cart-level promotion actually applied, recomputed server-side. */
  promotion?: PromotionSnapshot;
  /** Promotion discount taken off the subtotal. 0 when none applied. */
  promotionDiscountIls?: number;
  deliveryIls: number;
  freeDelivery: boolean;
  totalIls: number;
  zoneId: string;
  paymentMethod: PaymentMethodId;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  tracking: TrackingEvent[];
  supplierReference?: string;
  productionStartedAt?: string;
  supplierDispatchedAt?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDeliveryAt?: string;
  internalNotes?: string;
  /** Supplier-confirmation gate. Present when any line needed checking. */
  supplierConfirmation?: {
    required: boolean;
    status: "pending" | "confirmed" | "rejected";
    /** Lines that triggered the check: `${version|*}:${size}` per product slug. */
    items?: { slug: string; version: JerseyVersion | undefined; size: string }[];
    decidedBy?: string;
    decidedAt?: string;
    /** Internal only — never shown to the customer. */
    note?: string;
  };
  customerVisibleMessage?: LocalizedText;
  sheetsSync: { status: "pending" | "synced" | "failed" | "disabled"; lastAttemptAt?: string; error?: string };
  isDemo: boolean;
}

export interface Review {
  id: string;
  productSlug?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  displayName: string;
  locale: "ar" | "he" | "en";
  photo?: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "hidden";
  verified: boolean;
  isDemo: boolean;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: "customer" | "owner" | "admin" | "order_manager" | "content_manager";
  createdAt: string;
  isDemo: boolean;
}

export interface Lead {
  id: string;
  kind: "email" | "whatsapp";
  value: string;
  consent: boolean;
  consentSource: string;
  createdAt: string;
}

export interface IssueReport {
  id: string;
  orderNumber: string;
  name: string;
  contact: string;
  category:
    | "damaged"
    | "defective"
    | "incorrect_item"
    | "incorrect_size_supplied"
    | "incorrect_personalization"
    | "missing_item"
    | "delivery_problem"
    | "other";
  description: string;
  requestedResolution: string;
  createdAt: string;
  status: "open" | "in_review" | "resolved";
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail?: string;
}

export interface StoreSettings {
  announcement: LocalizedText;
  whatsappNumber: string;
  instagramUsername: string;
  freeDeliveryMinItems: number;
  /** IANA zone used to enter and display sale schedules in Admin. Timestamps
   * themselves are always stored in UTC. Absent → Asia/Jerusalem. */
  timezone?: string;
  supplierEtaText: LocalizedText;
  bankTransferInstructions: LocalizedText;
  internationalMode: "disabled" | "waitlist" | "enabled";
  internationalNote: LocalizedText;
  paymentMethods: PaymentMethodSetting[];
  nonAffiliationNote: LocalizedText;
  legalEntity: { name: string; registrationNumber: string; taxNote: string };
  policies: Record<"returns" | "privacy" | "terms" | "accessibility", { title: LocalizedText; body: LocalizedText; needsLegalReview: boolean }>;
}

export interface ProductFilters {
  category?: string;
  version?: JerseyVersion;
  size?: string;
  sleeve?: SleeveStyle;
  audience?: "adult" | "kids";
  era?: string;
  season?: string;
  national?: boolean;
  personalizable?: boolean;
  status?: "available" | "made_to_order";
  featured?: boolean;
  priceMin?: number;
  priceMax?: number;
  query?: string;
  sort?: "newest" | "price_asc" | "price_desc" | "featured";
}

export interface DashboardStats {
  ordersToday: number;
  revenueIls: number;
  paidOrders: number;
  pendingPayments: number;
  awaitingSupplier: number;
  inProduction: number;
  dispatched: number;
  inTransit: number;
  avgOrderValueIls: number;
  topProducts: { slug: string; title: LocalizedText; count: number }[];
  topCategories: { slug: string; count: number }[];
  customerCount: number;
}

export interface ImportRowResult {
  row: number;
  ok: boolean;
  slug?: string;
  errors: string[];
  duplicate?: boolean;
}
