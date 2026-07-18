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
  patchIds: string[];
  era?: string;
  season?: string;
  nationalTeam?: boolean;
  kids?: boolean;
  qualifiesForFreeDelivery: boolean;
  featured: boolean;
  images: { src: string; alt: LocalizedText }[];
  relatedSlugs: string[];
  tags: string[];
  rightsStatus: RightsStatus;
  supplier?: { sku?: string; reference?: string; costUsd?: number };
  isDemo: boolean;
  createdAt: string;
}

export interface PatchDef {
  id: string;
  name: LocalizedText;
  priceIls: number;
  active: boolean;
}

export interface SizeChartRow {
  size: string;
  chestCm: number;
  lengthCm: number;
}

export interface SizeChart {
  id: string;
  name: LocalizedText;
  note: LocalizedText;
  rows: SizeChartRow[];
  isPlaceholder: boolean;
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
  | "awaiting_payment"
  | "payment_confirmed"
  | "sent_to_supplier"
  | "production_started"
  | "supplier_processing"
  | "supplier_dispatched"
  | "in_transit"
  | "arrived_locally"
  | "out_for_delivery"
  | "delivered"
  | "issue_reported"
  | "cancelled"
  | "refunded";

export const FULFILLMENT_FLOW: FulfillmentStatus[] = [
  "order_received",
  "payment_confirmed",
  "sent_to_supplier",
  "production_started",
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
  title: LocalizedText;
  image: string;
  version?: JerseyVersion;
  sleeve?: SleeveStyle;
  size: string;
  personalization?: Personalization;
  patchId?: string;
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
  patchId?: string;
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
