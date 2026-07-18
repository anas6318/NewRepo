/**
 * Service boundary between the UI and data. Two implementations:
 *  - DemoDataService  — clearly-labeled local development data (spec §36)
 *  - SupabaseDataService — production implementation over Supabase
 * Resolution happens once in services/index.ts based on configuration.
 */
import type {
  AuditEntry,
  CategoryDef,
  Customer,
  DashboardStats,
  FulfillmentStatus,
  ImportRowResult,
  IssueReport,
  Lead,
  Order,
  PatchDef,
  PaymentStatus,
  Product,
  ProductFilters,
  Review,
  ShippingZone,
  SizeChart,
  StoreSettings,
} from "./types.ts";

export interface PlaceOrderInput {
  locale: "ar" | "he" | "en";
  customer: { name: string; email: string; phone: string; city: string; address: string; notes?: string };
  zoneId: string;
  paymentMethod: Order["paymentMethod"];
  lines: {
    productId: string;
    version?: string;
    sleeve?: string;
    size: string;
    personalization?: { name?: string; number?: string };
    patchId?: string;
    quantity: number;
  }[];
  marketingConsent?: boolean;
}

export interface PlaceOrderResult {
  ok: boolean;
  orderNumber?: string;
  /** Secret needed (with the order number) to view tracking as a guest. */
  trackingContact?: string;
  error?: string;
  order?: Order;
}

export interface SessionInfo {
  customer: Customer | null;
}

export interface DataService {
  readonly mode: "demo" | "supabase";

  /* catalog */
  listCategories(): Promise<CategoryDef[]>;
  listProducts(filters?: ProductFilters): Promise<Product[]>;
  getProduct(slug: string): Promise<Product | null>;
  searchSuggestions(query: string): Promise<Product[]>;
  listPatches(): Promise<PatchDef[]>;
  listSizeCharts(): Promise<SizeChart[]>;

  /* reviews */
  listApprovedReviews(productSlug?: string): Promise<Review[]>;
  submitReview(review: Omit<Review, "id" | "createdAt" | "status" | "verified" | "isDemo">): Promise<{ ok: boolean; error?: string }>;

  /* orders */
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  trackOrder(orderNumber: string, contact: string): Promise<Order | null>;
  listCustomerOrders(customerId: string): Promise<Order[]>;

  /* leads */
  submitLead(lead: Omit<Lead, "id" | "createdAt">): Promise<{ ok: boolean }>;
  submitIssueReport(report: Omit<IssueReport, "id" | "createdAt" | "status">): Promise<{ ok: boolean }>;

  /* auth */
  session(): Promise<SessionInfo>;
  login(email: string, password: string): Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  register(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  logout(): Promise<void>;

  /* wishlist (account-backed; guest wishlist lives in the local store) */
  getWishlist(customerId: string): Promise<string[]>;
  setWishlist(customerId: string, slugs: string[]): Promise<void>;

  /* settings */
  getSettings(): Promise<StoreSettings>;
  listZones(): Promise<ShippingZone[]>;

  /* ── admin (server-authorized in supabase mode; demo-simulated locally) ── */
  adminListProducts(): Promise<Product[]>;
  adminSaveProduct(product: Product): Promise<{ ok: boolean; error?: string }>;
  adminDeleteProduct(id: string): Promise<{ ok: boolean }>;
  adminImportProducts(rows: Record<string, string>[]): Promise<{ results: ImportRowResult[]; created: number }>;
  adminListOrders(): Promise<Order[]>;
  adminUpdateOrder(
    orderNumber: string,
    patch: Partial<{
      paymentStatus: PaymentStatus;
      fulfillmentStatus: FulfillmentStatus;
      supplierReference: string;
      trackingNumber: string;
      trackingUrl: string;
      estimatedDeliveryAt: string;
      internalNotes: string;
    }>,
  ): Promise<{ ok: boolean; order?: Order }>;
  adminResyncOrder(orderNumber: string): Promise<{ ok: boolean; message: string }>;
  adminListCustomers(): Promise<Customer[]>;
  adminListReviews(): Promise<Review[]>;
  adminModerateReview(id: string, status: Review["status"], verified?: boolean): Promise<{ ok: boolean }>;
  adminSaveZones(zones: ShippingZone[]): Promise<{ ok: boolean }>;
  adminSaveSettings(settings: StoreSettings): Promise<{ ok: boolean }>;
  adminDashboard(): Promise<DashboardStats>;
  adminAuditLog(): Promise<AuditEntry[]>;
}
