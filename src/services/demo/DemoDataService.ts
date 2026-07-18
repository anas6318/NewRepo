/**
 * DEVELOPMENT-ONLY data service. Serves the clearly-labeled demo catalog and
 * persists mutations (orders, reviews, admin edits, session) to localStorage
 * so the whole store — storefront AND admin — is fully inspectable with no
 * external services and no real money movement (spec §36).
 *
 * Payment behavior in demo mode is SIMULATED and labeled as such in the UI;
 * it never claims to be a genuine transaction.
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
  Product,
  ProductFilters,
  Review,
  ShippingZone,
  StoreSettings,
} from "../types.ts";
import {
  DEMO_CREDENTIALS,
  demoCategories,
  demoCustomers,
  demoOrders,
  demoPatches,
  demoProducts,
  demoReviews,
  demoSettings,
  demoSizeCharts,
  demoZones,
} from "./seed-data.ts";
import { filterProducts } from "../catalog.ts";
import { priceLine, cartSubtotal } from "../../lib/pricing.ts";
import { evaluateFreeDelivery, resolveDeliveryFee } from "../../lib/delivery.ts";

const LS_KEY = "crowned_demo_db_v1";
const SESSION_KEY = "crowned_demo_session_v1";

interface DemoDb {
  products: Product[];
  orders: Order[];
  reviews: Review[];
  customers: Customer[];
  zones: ShippingZone[];
  settings: StoreSettings;
  wishlists: Record<string, string[]>;
  leads: Lead[];
  issues: IssueReport[];
  audit: AuditEntry[];
}

function freshDb(): DemoDb {
  return {
    products: structuredClone(demoProducts),
    orders: structuredClone(demoOrders),
    reviews: structuredClone(demoReviews),
    customers: structuredClone(demoCustomers),
    zones: structuredClone(demoZones),
    settings: structuredClone(demoSettings),
    wishlists: {},
    leads: [],
    issues: [],
    audit: [
      { id: "a0", at: new Date().toISOString(), actor: "system", action: "demo_seeded", target: "database", detail: "Demo database initialized" },
    ],
  };
}

function loadDb(): DemoDb {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as DemoDb;
  } catch {
    /* corrupted storage → reseed */
  }
  return freshDb();
}

export class DemoDataService implements DataService {
  readonly mode = "demo" as const;
  private db: DemoDb;

  constructor() {
    this.db = typeof localStorage === "undefined" ? freshDb() : loadDb();
  }

  private save(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.db));
    } catch {
      /* storage full/unavailable — keep in memory */
    }
  }

  private audit(actor: string, action: string, target: string, detail?: string): void {
    this.db.audit.unshift({ id: `a${Date.now()}${Math.floor(Math.random() * 1e4)}`, at: new Date().toISOString(), actor, action, target, detail });
    this.db.audit = this.db.audit.slice(0, 200);
  }

  /* ── catalog ── */
  async listCategories() {
    return demoCategories;
  }

  async listProducts(filters?: ProductFilters) {
    return filterProducts(this.db.products, filters ?? {}, demoCategories);
  }

  async getProduct(slug: string) {
    return this.db.products.find((p) => p.slug === slug && p.status !== "draft" && p.status !== "archived") ?? null;
  }

  async searchSuggestions(query: string) {
    return (await this.listProducts({ query, sort: "featured" })).slice(0, 6);
  }

  async listPatches() {
    return demoPatches;
  }

  async listSizeCharts() {
    return demoSizeCharts;
  }

  /* ── reviews ── */
  async listApprovedReviews(productSlug?: string) {
    return this.db.reviews.filter((r) => r.status === "approved" && (!productSlug || r.productSlug === productSlug));
  }

  async submitReview(review: Omit<Review, "id" | "createdAt" | "status" | "verified" | "isDemo">) {
    const r: Review = {
      ...review,
      id: `rv${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: "pending", // moderation required — never auto-published (spec §22)
      verified: false,
      isDemo: true,
    };
    this.db.reviews.unshift(r);
    this.save();
    return { ok: true };
  }

  /* ── orders ── */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const settings = this.db.settings;
    const method = settings.paymentMethods.find((m) => m.id === input.paymentMethod);
    if (!method?.enabled) return { ok: false, error: "payment_method_unavailable" };

    const zone = this.db.zones.find((z) => z.id === input.zoneId && z.active);
    if (!zone) return { ok: false, error: "zone_unavailable" };
    if (input.lines.length === 0) return { ok: false, error: "empty_cart" };

    // Server-side price recomputation — client totals are never trusted.
    const items: Order["items"] = [];
    for (const line of input.lines) {
      const product = this.db.products.find((p) => p.id === line.productId);
      if (!product || product.status === "draft" || product.status === "archived" || product.status === "unavailable") {
        return { ok: false, error: "product_unavailable" };
      }
      if (!product.sizes.includes(line.size)) return { ok: false, error: "invalid_size" };
      const adjustments: number[] = [];
      let version: Order["items"][number]["version"];
      if (product.versions.length > 0) {
        const v = product.versions.find((x) => x.version === line.version);
        if (!v) return { ok: false, error: "invalid_version" };
        version = v.version;
        adjustments.push(v.adjustmentIls);
      }
      let sleeve: Order["items"][number]["sleeve"];
      if (product.sleeves.length > 1) {
        if (line.sleeve !== "short" && line.sleeve !== "long") return { ok: false, error: "invalid_sleeve" };
        sleeve = line.sleeve;
        if (sleeve === "long") adjustments.push(product.longSleeveAdjustmentIls);
      } else if (product.sleeves[0] === "long") {
        sleeve = "long";
      }
      let patchName: Order["items"][number]["patchName"];
      let patchPrice = 0;
      if (line.patchId) {
        if (!product.patchIds.includes(line.patchId)) return { ok: false, error: "invalid_patch" };
        const patch = demoPatches.find((p) => p.id === line.patchId && p.active);
        if (!patch) return { ok: false, error: "invalid_patch" };
        patchName = patch.name;
        patchPrice = patch.priceIls;
      }
      if (line.personalization && !product.personalizable) return { ok: false, error: "personalization_unavailable" };
      const priced = priceLine({ basePriceIls: product.basePriceIls, adjustmentsIls: adjustments, patchPriceIls: patchPrice, quantity: line.quantity });
      items.push({
        productId: product.id,
        slug: product.slug,
        title: product.name,
        image: product.images[0]?.src ?? "",
        version,
        sleeve,
        size: line.size,
        personalization: line.personalization,
        patchId: line.patchId,
        patchName,
        unitPriceIls: priced.unitPriceIls,
        quantity: priced.quantity,
        lineTotalIls: priced.lineTotalIls,
      });
    }

    const subtotal = cartSubtotal(items.map((i) => ({ lineTotalIls: i.lineTotalIls })));
    const fd = evaluateFreeDelivery(
      items.map((i) => {
        const product = this.db.products.find((p) => p.id === i.productId);
        return { countsForFreeDelivery: product?.qualifiesForFreeDelivery ?? false, quantity: i.quantity };
      }),
      settings.freeDeliveryMinItems,
    );
    let deliveryIls: number;
    try {
      deliveryIls = resolveDeliveryFee({ priceIls: zone.priceIls, isActive: zone.active }, fd);
    } catch {
      return { ok: false, error: "zone_unavailable" };
    }

    const orderNumber = this.newOrderNumber();
    const now = new Date().toISOString();
    const isBank = input.paymentMethod === "bank_transfer";
    const session = this.readSession();
    const order: Order = {
      id: `ord-${Date.now()}`,
      orderNumber,
      createdAt: now,
      locale: input.locale,
      customer: { ...input.customer, customerId: session.customer?.id },
      items,
      subtotalIls: subtotal,
      deliveryIls,
      freeDelivery: fd.isFreeDeliveryUnlocked,
      totalIls: subtotal + deliveryIls,
      zoneId: zone.id,
      paymentMethod: input.paymentMethod,
      paymentStatus: isBank ? "awaiting_payment" : "pending",
      fulfillmentStatus: isBank ? "awaiting_payment" : "order_received",
      tracking: [
        { status: "order_received", at: now },
        ...(isBank ? [{ status: "awaiting_payment" as const, at: now }] : []),
      ],
      sheetsSync: { status: "pending" },
      isDemo: true,
    };
    this.db.orders.unshift(order);
    if (input.marketingConsent) {
      this.db.leads.push({ id: `lead-${Date.now()}`, kind: "email", value: input.customer.email, consent: true, consentSource: "checkout", createdAt: now });
    }
    // Demo-mode "sync": records intent only. Real syncing is the
    // sheets-sync edge function — never claimed to have run here.
    order.sheetsSync = { status: "disabled", error: "Demo mode — Google Sheets not connected" };
    this.audit("storefront", "order_created", orderNumber);
    this.save();
    return { ok: true, orderNumber, trackingContact: input.customer.email, order };
  }

  private newOrderNumber(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 50; attempt++) {
      let n = "CR-";
      for (let i = 0; i < 6; i++) n += chars[Math.floor(Math.random() * chars.length)];
      if (!this.db.orders.some((o) => o.orderNumber === n)) return n;
    }
    return `CR-${Date.now().toString(36).toUpperCase()}`;
  }

  async trackOrder(orderNumber: string, contact: string): Promise<Order | null> {
    // Order number alone is never enough (spec §16): a matching email or
    // phone is required, and failures are indistinguishable.
    const norm = (v: string) => v.trim().toLowerCase().replace(/[\s-]/g, "");
    const order = this.db.orders.find((o) => o.orderNumber.toUpperCase() === orderNumber.trim().toUpperCase());
    if (!order) return null;
    const c = norm(contact);
    if (c.length < 4) return null;
    if (norm(order.customer.email) !== c && norm(order.customer.phone) !== c) return null;
    return order;
  }

  async listCustomerOrders(customerId: string) {
    return this.db.orders.filter((o) => o.customer.customerId === customerId);
  }

  /* ── leads / issues ── */
  async submitLead(lead: Omit<Lead, "id" | "createdAt">) {
    this.db.leads.push({ ...lead, id: `lead-${Date.now()}`, createdAt: new Date().toISOString() });
    this.save();
    return { ok: true };
  }

  async submitIssueReport(report: Omit<IssueReport, "id" | "createdAt" | "status">) {
    this.db.issues.push({ ...report, id: `iss-${Date.now()}`, createdAt: new Date().toISOString(), status: "open" });
    this.save();
    return { ok: true };
  }

  /* ── auth (demo only — see docs/admin-guide.md) ── */
  private readSession(): SessionInfo {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw) as SessionInfo;
    } catch {
      /* ignore */
    }
    return { customer: null };
  }

  private writeSession(info: SessionInfo): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(info));
    } catch {
      /* ignore */
    }
  }

  async session() {
    return this.readSession();
  }

  async login(email: string, password: string) {
    const e = email.trim().toLowerCase();
    const valid =
      (e === DEMO_CREDENTIALS.customer.email && password === DEMO_CREDENTIALS.customer.password) ||
      (e === DEMO_CREDENTIALS.admin.email && password === DEMO_CREDENTIALS.admin.password);
    if (!valid) return { ok: false, error: "invalid_credentials" };
    const customer = this.db.customers.find((c) => c.email === e);
    if (!customer) return { ok: false, error: "invalid_credentials" };
    this.writeSession({ customer });
    return { ok: true, customer };
  }

  async register(name: string, email: string, _password: string) {
    const e = email.trim().toLowerCase();
    if (this.db.customers.some((c) => c.email === e)) return { ok: false, error: "email_taken" };
    const customer: Customer = { id: `cust-${Date.now()}`, email: e, name: name.trim(), role: "customer", createdAt: new Date().toISOString(), isDemo: true };
    this.db.customers.push(customer);
    this.writeSession({ customer });
    this.save();
    return { ok: true, customer };
  }

  async logout() {
    this.writeSession({ customer: null });
  }

  /* ── wishlist ── */
  async getWishlist(customerId: string) {
    return this.db.wishlists[customerId] ?? [];
  }

  async setWishlist(customerId: string, slugs: string[]) {
    this.db.wishlists[customerId] = slugs;
    this.save();
  }

  /* ── settings ── */
  async getSettings() {
    return this.db.settings;
  }

  async listZones() {
    return this.db.zones.filter((z) => z.active);
  }

  /* ── admin ── */
  private requireStaff(): Customer {
    const c = this.readSession().customer;
    if (!c || c.role === "customer") throw new Error("forbidden");
    return c;
  }

  async adminListProducts() {
    this.requireStaff();
    return this.db.products;
  }

  async adminSaveProduct(product: Product) {
    const staff = this.requireStaff();
    // Rights gate (spec §30): a product cannot leave draft until rights are cleared.
    if (product.status !== "draft" && product.status !== "archived" && product.rightsStatus !== "cleared") {
      return { ok: false, error: "rights_not_cleared" };
    }
    const idx = this.db.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) this.db.products[idx] = product;
    else this.db.products.unshift(product);
    this.audit(staff.email, idx >= 0 ? "product_updated" : "product_created", product.slug);
    this.save();
    return { ok: true };
  }

  async adminDeleteProduct(id: string) {
    const staff = this.requireStaff();
    this.db.products = this.db.products.filter((p) => p.id !== id);
    this.audit(staff.email, "product_deleted", id);
    this.save();
    return { ok: true };
  }

  async adminImportProducts(rows: Record<string, string>[]) {
    const staff = this.requireStaff();
    const results: ImportRowResult[] = [];
    let created = 0;
    rows.forEach((row, i) => {
      const errors: string[] = [];
      const slug = (row.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
      const nameEn = (row.name_en ?? "").trim();
      const price = Number(row.price_ils);
      const cat = (row.category ?? "").trim();
      if (!slug) errors.push("missing slug");
      if (!nameEn) errors.push("missing name_en");
      if (!Number.isFinite(price) || price <= 0) errors.push("invalid price_ils");
      if (!demoCategories.some((c) => c.slug === cat)) errors.push(`unknown category "${cat}"`);
      const duplicate = this.db.products.some((p) => p.slug === slug);
      if (duplicate) errors.push("duplicate slug — skipped");
      if (errors.length) {
        results.push({ row: i + 1, ok: false, slug, errors, duplicate });
        return;
      }
      const name = { en: `Demo import — ${nameEn}`, ar: row.name_ar?.trim() || `استيراد تجريبي — ${nameEn}`, he: row.name_he?.trim() || `ייבוא דמו — ${nameEn}` };
      this.db.products.unshift({
        id: `imp-${Date.now()}-${i}`,
        slug,
        categorySlug: cat,
        name,
        description: { ar: row.desc_ar?.trim() ?? "", he: row.desc_he?.trim() ?? "", en: row.desc_en?.trim() ?? "" },
        details: { ar: "", he: "", en: "" },
        seoTitle: name,
        seoDescription: { ar: "", he: "", en: "" },
        status: "draft", // imports ALWAYS start as draft (spec §25)
        basePriceIls: price,
        versions: [],
        sleeves: ["short"],
        longSleeveAdjustmentIls: 0,
        sizes: ["S", "M", "L", "XL", "2XL"],
        personalizable: row.personalizable !== "false",
        patchIds: [],
        qualifiesForFreeDelivery: true,
        featured: false,
        images: [],
        relatedSlugs: [],
        tags: [],
        rightsStatus: "pending_review",
        supplier: { sku: row.supplier_sku?.trim(), reference: row.supplier_ref?.trim(), costUsd: Number(row.supplier_cost_usd) || undefined },
        isDemo: true,
        createdAt: new Date().toISOString(),
      });
      created++;
      results.push({ row: i + 1, ok: true, slug, errors: [] });
    });
    this.audit(staff.email, "products_imported", `${created} created`);
    this.save();
    return { results, created };
  }

  async adminListOrders() {
    this.requireStaff();
    return this.db.orders;
  }

  async adminUpdateOrder(orderNumber: string, patch: Parameters<DataService["adminUpdateOrder"]>[1]) {
    const staff = this.requireStaff();
    const order = this.db.orders.find((o) => o.orderNumber === orderNumber);
    if (!order) return { ok: false };
    if (patch.fulfillmentStatus && patch.fulfillmentStatus !== order.fulfillmentStatus) {
      order.tracking.push({ status: patch.fulfillmentStatus, at: new Date().toISOString() });
      if (patch.fulfillmentStatus === "production_started") order.productionStartedAt = new Date().toISOString();
      if (patch.fulfillmentStatus === "supplier_dispatched") order.supplierDispatchedAt = new Date().toISOString();
    }
    Object.assign(order, patch);
    this.audit(staff.email, "order_updated", orderNumber, JSON.stringify(Object.keys(patch)));
    this.save();
    return { ok: true, order };
  }

  async adminResyncOrder(orderNumber: string) {
    const staff = this.requireStaff();
    const order = this.db.orders.find((o) => o.orderNumber === orderNumber);
    if (!order) return { ok: false, message: "Order not found" };
    order.sheetsSync = { status: "disabled", lastAttemptAt: new Date().toISOString(), error: "Demo mode — Google Sheets is not connected. Resync recorded, not sent." };
    this.audit(staff.email, "order_resync_requested", orderNumber);
    this.save();
    return { ok: true, message: "Demo mode: resync recorded locally. No external sync was performed (Google Sheets is not connected)." };
  }

  async adminListCustomers() {
    this.requireStaff();
    return this.db.customers;
  }

  async adminListReviews() {
    this.requireStaff();
    return this.db.reviews;
  }

  async adminModerateReview(id: string, status: Review["status"], verified?: boolean) {
    const staff = this.requireStaff();
    const review = this.db.reviews.find((r) => r.id === id);
    if (!review) return { ok: false };
    review.status = status;
    if (verified !== undefined) review.verified = verified;
    this.audit(staff.email, "review_moderated", id, status);
    this.save();
    return { ok: true };
  }

  async adminSaveZones(zones: ShippingZone[]) {
    const staff = this.requireStaff();
    this.db.zones = zones;
    this.audit(staff.email, "zones_updated", `${zones.length} zones`);
    this.save();
    return { ok: true };
  }

  async adminSaveSettings(settings: StoreSettings) {
    const staff = this.requireStaff();
    this.db.settings = settings;
    this.audit(staff.email, "settings_updated", "store_settings");
    this.save();
    return { ok: true };
  }

  async adminDashboard(): Promise<DashboardStats> {
    this.requireStaff();
    const orders = this.db.orders;
    const today = new Date().toISOString().slice(0, 10);
    const paid = orders.filter((o) => o.paymentStatus === "paid");
    const revenue = paid.reduce((s, o) => s + o.totalIls, 0);
    const byProduct = new Map<string, { slug: string; title: Order["items"][number]["title"]; count: number }>();
    const byCategory = new Map<string, number>();
    for (const o of orders) {
      for (const item of o.items) {
        const e = byProduct.get(item.slug) ?? { slug: item.slug, title: item.title, count: 0 };
        e.count += item.quantity;
        byProduct.set(item.slug, e);
        const product = this.db.products.find((p) => p.id === item.productId);
        if (product) byCategory.set(product.categorySlug, (byCategory.get(product.categorySlug) ?? 0) + item.quantity);
      }
    }
    return {
      ordersToday: orders.filter((o) => o.createdAt.slice(0, 10) === today).length,
      revenueIls: revenue,
      paidOrders: paid.length,
      pendingPayments: orders.filter((o) => o.paymentStatus === "awaiting_payment" || o.paymentStatus === "pending").length,
      awaitingSupplier: orders.filter((o) => o.fulfillmentStatus === "payment_confirmed").length,
      inProduction: orders.filter((o) => ["sent_to_supplier", "production_started", "supplier_processing"].includes(o.fulfillmentStatus)).length,
      dispatched: orders.filter((o) => o.fulfillmentStatus === "supplier_dispatched").length,
      inTransit: orders.filter((o) => ["in_transit", "arrived_locally", "out_for_delivery"].includes(o.fulfillmentStatus)).length,
      avgOrderValueIls: paid.length ? Math.round(revenue / paid.length) : 0,
      topProducts: [...byProduct.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      topCategories: [...byCategory.entries()].map(([slug, count]) => ({ slug, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      customerCount: this.db.customers.filter((c) => c.role === "customer").length,
    };
  }

  async adminAuditLog() {
    this.requireStaff();
    return this.db.audit;
  }

  /** Reset the demo database (exposed in the admin UI in demo mode). */
  resetDemoData(): void {
    this.db = freshDb();
    this.save();
  }
}
