/**
 * Production data service over Supabase. Storefront reads use RLS-guarded
 * anon queries; order placement and secure tracking go through edge
 * functions (they need service-role trust and secret handling); admin
 * mutations run with the staff member's JWT — authorization is enforced by
 * database RLS/role checks, never only by the UI (spec §26/§35).
 *
 * IMPORTANT: this implementation is architecture-complete but has NOT been
 * exercised against a live Supabase project in the delivery environment
 * (no external network). Run the smoke steps in docs/deployment-guide.md §4
 * against a real project before relying on it — see docs/test-report.md.
 */
import type { DataService, PlaceOrderInput, PlaceOrderResult, SessionInfo } from "../DataService.ts";
import type {
  AuditEntry,
  Customer,
  DashboardStats,
  ImportRowResult,
  IssueReport,
  Lead,
  Order,
  PatchDef,
  Product,
  ProductFilters,
  Review,
  ShippingZone,
  SizeChart,
  StoreSettings,
} from "../types.ts";
import { SupabaseClient } from "./client.ts";
import { filterProducts } from "../catalog.ts";
import { demoCategories } from "../demo/seed-data.ts";

/** Table rows store the domain objects in a `data` jsonb column plus a few
 * indexed scalar columns — see supabase/migrations/. */
interface Row<T> {
  id: string;
  data: T;
}

export class SupabaseDataService implements DataService {
  readonly mode = "supabase" as const;
  private sb = new SupabaseClient();
  private settingsCache: StoreSettings | null = null;

  private notConfigured(): never {
    throw new Error("Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or run in demo mode).");
  }

  private guard(): SupabaseClient {
    if (!this.sb.configured) this.notConfigured();
    return this.sb;
  }

  /* ── catalog ── */
  async listCategories() {
    const rows = await this.guard().select<Row<(typeof demoCategories)[number]>>("categories", "select=id,data&order=id");
    return rows.map((r) => r.data);
  }

  async listProducts(filters?: ProductFilters) {
    const rows = await this.guard().select<Row<Product>>("products", "select=id,data&status=not.in.(draft,archived)");
    return filterProducts(rows.map((r) => r.data), filters ?? {}, await this.listCategories());
  }

  async getProduct(slug: string) {
    const rows = await this.guard().select<Row<Product>>("products", `select=id,data&slug=eq.${encodeURIComponent(slug)}&status=not.in.(draft,archived)&limit=1`);
    return rows[0]?.data ?? null;
  }

  async searchSuggestions(query: string) {
    return (await this.listProducts({ query })).slice(0, 6);
  }

  async listPatches() {
    const rows = await this.guard().select<Row<PatchDef>>("patches", "select=id,data&active=eq.true");
    return rows.map((r) => r.data);
  }

  async listSizeCharts() {
    const rows = await this.guard().select<Row<SizeChart>>("size_charts", "select=id,data");
    return rows.map((r) => r.data);
  }

  /* ── reviews ── */
  async listApprovedReviews(productSlug?: string) {
    const filter = productSlug ? `&product_slug=eq.${encodeURIComponent(productSlug)}` : "";
    const rows = await this.guard().select<Row<Review>>("reviews", `select=id,data&status=eq.approved${filter}&order=created_at.desc`);
    return rows.map((r) => r.data);
  }

  async submitReview(review: Omit<Review, "id" | "createdAt" | "status" | "verified" | "isDemo">) {
    try {
      await this.guard().invoke("submit-review", review);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "review_failed" };
    }
  }

  /* ── orders (edge functions — prices recomputed server-side) ── */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    try {
      return await this.guard().invoke<PlaceOrderResult>("place-order", input);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "order_failed" };
    }
  }

  async trackOrder(orderNumber: string, contact: string): Promise<Order | null> {
    try {
      const res = await this.guard().invoke<{ order: Order | null }>("track-order", { orderNumber, contact });
      return res.order;
    } catch {
      return null; // indistinguishable from not-found — anti-enumeration
    }
  }

  async listCustomerOrders(customerId: string) {
    const rows = await this.guard().select<Row<Order>>("orders", `select=id,data&customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc`);
    return rows.map((r) => r.data);
  }

  /* ── leads / issues ── */
  async submitLead(lead: Omit<Lead, "id" | "createdAt">) {
    await this.guard().insert("leads", { kind: lead.kind, value: lead.value, consent: lead.consent, consent_source: lead.consentSource });
    return { ok: true };
  }

  async submitIssueReport(report: Omit<IssueReport, "id" | "createdAt" | "status">) {
    await this.guard().insert("issue_reports", { order_number: report.orderNumber, data: report });
    return { ok: true };
  }

  /* ── auth ── */
  async session(): Promise<SessionInfo> {
    if (!this.sb.configured) return { customer: null };
    const s = await this.sb.refreshIfNeeded();
    if (!s) return { customer: null };
    const rows = await this.sb.select<{ id: string; email: string; name: string; phone: string | null; role: Customer["role"]; created_at: string }>(
      "profiles",
      `select=id,email,name,phone,role,created_at&id=eq.${s.user.id}`,
    );
    const p = rows[0];
    if (!p) return { customer: null };
    return { customer: { id: p.id, email: p.email, name: p.name, phone: p.phone ?? undefined, role: p.role, createdAt: p.created_at, isDemo: false } };
  }

  async login(email: string, password: string) {
    try {
      const { error } = await this.guard().signInWithPassword(email, password);
      if (error) return { ok: false, error };
      const { customer } = await this.session();
      return customer ? { ok: true, customer } : { ok: false, error: "profile_missing" };
    } catch {
      // Network/backend failure must surface as a normal rejection, never a
      // hung form or unhandled promise.
      return { ok: false, error: "network_error" };
    }
  }

  async register(name: string, email: string, password: string) {
    try {
      const { error } = await this.guard().signUp(email, password, name);
      if (error) return { ok: false, error };
      const { customer } = await this.session();
      return customer ? { ok: true, customer } : { ok: false, error: "confirm_email" };
    } catch {
      return { ok: false, error: "network_error" };
    }
  }

  async logout() {
    await this.sb.signOut();
  }

  /* ── wishlist ── */
  async getWishlist(customerId: string) {
    const rows = await this.guard().select<{ product_slug: string }>("wishlists", `select=product_slug&customer_id=eq.${customerId}`);
    return rows.map((r) => r.product_slug);
  }

  async setWishlist(customerId: string, slugs: string[]) {
    await this.guard().delete("wishlists", `customer_id=eq.${customerId}`);
    if (slugs.length) {
      await this.guard().insert("wishlists", slugs.map((product_slug) => ({ customer_id: customerId, product_slug })));
    }
  }

  /* ── settings ── */
  async getSettings(): Promise<StoreSettings> {
    if (this.settingsCache) return this.settingsCache;
    const rows = await this.guard().select<Row<StoreSettings>>("store_settings", "select=id,data&id=eq.main");
    const settings = rows[0]?.data;
    if (!settings) throw new Error("store_settings missing — run supabase/seed.sql");
    this.settingsCache = settings;
    return settings;
  }

  async listZones() {
    const rows = await this.guard().select<Row<ShippingZone>>("shipping_zones", "select=id,data&active=eq.true");
    return rows.map((r) => r.data);
  }

  /* ── admin ── */
  async adminListProducts() {
    const rows = await this.guard().select<Row<Product>>("products", "select=id,data&order=created_at.desc");
    return rows.map((r) => r.data);
  }

  async adminSaveProduct(product: Product) {
    if (product.status !== "draft" && product.status !== "archived" && product.rightsStatus !== "cleared") {
      return { ok: false, error: "rights_not_cleared" };
    }
    try {
      await this.guard().invoke("admin-actions?action=save-product", product);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "save_failed" };
    }
  }

  async adminDeleteProduct(id: string) {
    await this.guard().delete("products", `id=eq.${encodeURIComponent(id)}`);
    return { ok: true };
  }

  async adminImportProducts(rows: Record<string, string>[]) {
    try {
      return await this.guard().invoke<{ results: ImportRowResult[]; created: number }>("admin-actions?action=import-products", { rows });
    } catch (e) {
      return { results: [{ row: 0, ok: false, errors: [e instanceof Error ? e.message : "import_failed"] }], created: 0 };
    }
  }

  async adminListOrders() {
    const rows = await this.guard().select<Row<Order>>("orders", "select=id,data&order=created_at.desc&limit=500");
    return rows.map((r) => r.data);
  }

  async adminUpdateOrder(orderNumber: string, patch: Parameters<DataService["adminUpdateOrder"]>[1]) {
    try {
      return await this.guard().invoke<{ ok: boolean; order?: Order }>("admin-actions?action=update-order", { orderNumber, patch });
    } catch {
      return { ok: false };
    }
  }

  async adminResyncOrder(orderNumber: string) {
    try {
      return await this.guard().invoke<{ ok: boolean; message: string }>("sheets-sync", { orderNumber, manual: true });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "resync_failed" };
    }
  }

  async adminListCustomers() {
    const rows = await this.guard().select<{ id: string; email: string; name: string; phone: string | null; role: Customer["role"]; created_at: string }>(
      "profiles",
      "select=id,email,name,phone,role,created_at&order=created_at.desc",
    );
    return rows.map((p) => ({ id: p.id, email: p.email, name: p.name, phone: p.phone ?? undefined, role: p.role, createdAt: p.created_at, isDemo: false }));
  }

  async adminListReviews() {
    const rows = await this.guard().select<Row<Review>>("reviews", "select=id,data&order=created_at.desc");
    return rows.map((r) => r.data);
  }

  async adminModerateReview(id: string, status: Review["status"], verified?: boolean) {
    await this.guard().update("reviews", `id=eq.${encodeURIComponent(id)}`, { status, ...(verified !== undefined ? { verified } : {}) });
    return { ok: true };
  }

  async adminSaveZones(zones: ShippingZone[]) {
    await this.guard().invoke("admin-actions?action=save-zones", { zones });
    return { ok: true };
  }

  async adminSaveSettings(settings: StoreSettings) {
    await this.guard().invoke("admin-actions?action=save-settings", settings);
    this.settingsCache = settings;
    return { ok: true };
  }

  async adminDashboard(): Promise<DashboardStats> {
    return await this.guard().invoke<DashboardStats>("admin-actions?action=dashboard", {});
  }

  async adminAuditLog() {
    const rows = await this.guard().select<{ id: string; at: string; actor: string; action: string; target: string; detail: string | null }>(
      "audit_log",
      "select=id,at,actor,action,target,detail&order=at.desc&limit=200",
    );
    return rows.map((r) => ({ ...r, detail: r.detail ?? undefined }) as AuditEntry);
  }
}
