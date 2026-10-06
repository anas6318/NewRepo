/**
 * admin-actions — consolidated authorized admin mutations. Every branch
 * re-verifies the caller's role server-side (spec §26/§35); the UI is never
 * the security boundary. The frontend calls the aliases listed in ROUTES —
 * deploy this function once per alias (supabase functions deploy <alias>)
 * or route via query param; both patterns documented in docs/deployment-guide.md.
 *
 * Actions: save-product, import-products, update-order, save-zones,
 * save-settings, dashboard, list-badges, save-badges, list-promotions,
 * save-promotions.
 */
import { audit, dbInsert, dbRpc, dbSelect, dbUpdate, dbUpsert, db, handleError, HttpError, json, preflight, requireAdminOrOwner, requireStaff } from "../_shared/helpers.ts";
import { auditDetail, canManagePricing, canUpdateOrders, planOrderUpdate, type LifecycleOrder, type UpdateOrderPlan } from "../_shared/order-lifecycle.ts";
import { productImageUrlProblems } from "../_shared/image-url.ts";
import { normalizeProductTags, parseImportedClub } from "../_shared/clubs.ts";
import {
  DASHBOARD_AWAITING_SUPPLIER,
  DASHBOARD_DISPATCHED,
  DASHBOARD_IN_PRODUCTION,
  DASHBOARD_IN_TRANSIT,
  DASHBOARD_PENDING_PAYMENT,
  inBucket,
  patchMatchedNoRows,
  zonePriceProblem,
} from "../_shared/zones.ts";
import {
  alreadySent,
  bankInstructionsDue,
  CUSTOMER_EMAIL_EVENTS,
  deliverStatusEmail,
  eventForStatusChange,
  readCustomerEmailConfig,
  sendCustomerStatusEmail,
  type CustomerEmailEvent,
  type CustomerEmailRecord,
} from "../_shared/customer-notifications.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const url = new URL(req.url);
    // action = explicit query param, else the function alias name.
    const action = url.searchParams.get("action") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    switch (action.replace(/^admin-/, "")) {
      case "save-product":
        return await saveProduct(req, body);
      case "import-products":
        return await importProducts(req, body as { rows: Record<string, string>[] });
      case "update-order":
        return await updateOrder(req, body as { orderNumber: string; patch: Record<string, unknown> });
      case "resend-customer-email":
        return await resendCustomerEmail(req, body as { orderNumber: string; event: string });
      case "list-promotions":
        return await listPromotions(req);
      case "save-promotions":
        return await savePromotions(req, body as { promotions: PromotionRow[] });
      case "list-badges":
        return await listBadges(req);
      case "save-badges":
        return await saveBadges(req, body as { badges: BadgeOption[] });
      case "save-zones":
        return await saveZones(req, body as { zones: { id: string; active: boolean }[] });
      case "save-settings":
        return await saveSettings(req, body);
      case "dashboard":
        return await dashboard(req);
      default:
        return json({ error: `unknown action "${action}"` }, 400);
    }
  } catch (err) {
    return handleError(err);
  }
});

/* ── badge / patch options ────────────────────────────────────────────────
   The internal supplier reference lives in its own `supplier_ref` column,
   which migration 0004 revokes from anon/authenticated. It is therefore only
   reachable through this service-role path, never from a storefront query. */
interface BadgeOption {
  id: string;
  code: string;
  name: { ar: string; he: string; en: string };
  description?: { ar: string; he: string; en: string };
  priceIls: number;
  active: boolean;
  sortOrder: number;
  iconUrl?: string;
  supplierReference?: string;
}

/* ── cart promotions ──────────────────────────────────────────────────────
   Campaign rows are public data (the label is customer-facing) but only
   staff may write them — RLS in migration 0006 plus the checks below. */
interface PromotionRow {
  id: string;
  type: string;
  enabled: boolean;
  discountPercent: number;
  minimumQuantity: number;
  repeatPerPair: boolean;
  stackWithProductSales: boolean;
  startsAt?: string;
  endsAt?: string;
  label: { ar: string; he: string; en: string };
  eligibleProductIds?: string[];
  eligibleCategorySlugs?: string[];
  excludedProductIds?: string[];
  sortOrder: number;
}

async function listPromotions(req: Request): Promise<Response> {
  await requireStaff(req);
  const rows = await dbSelect<{ id: string; data: PromotionRow; sort_order: number | null }>("promotions?select=id,data,sort_order&order=sort_order");
  return json({ promotions: rows.map((r, i) => ({ ...r.data, id: r.id, sortOrder: r.sort_order ?? (i + 1) * 10 })) });
}

async function savePromotions(req: Request, body: { promotions: PromotionRow[] }): Promise<Response> {
  const staff = await requireStaff(req);
  // A promotion is a pricing decision (a 100% campaign is free stock): owner/admin only (A2-S4).
  if (!canManagePricing(staff.role)) throw new HttpError(403, "forbidden");
  const promotions = body.promotions ?? [];
  if (promotions.length > 50) throw new HttpError(400, "too_many_promotions");

  // Server-side validation — the admin UI is never the boundary. An unsafe
  // campaign is refused outright rather than stored and silently ignored.
  const seen = new Set<string>();
  for (const p of promotions) {
    if (!p?.id?.trim()) throw new HttpError(400, "promotion_missing_id");
    if (seen.has(p.id)) throw new HttpError(400, "promotion_duplicate");
    seen.add(p.id);
    if (p.type !== "second_item_percentage") throw new HttpError(400, "promotion_unknown_type");
    if (!Number.isFinite(p.discountPercent) || p.discountPercent <= 0 || p.discountPercent > 100) throw new HttpError(400, "promotion_invalid_percent");
    if (!Number.isInteger(p.minimumQuantity) || p.minimumQuantity < 2) throw new HttpError(400, "promotion_invalid_quantity");
    if (!p.label?.en?.trim() || !p.label?.ar?.trim() || !p.label?.he?.trim()) throw new HttpError(400, "promotion_missing_label");
    if (p.startsAt && Number.isNaN(Date.parse(p.startsAt))) throw new HttpError(400, "promotion_invalid_start");
    if (p.endsAt && Number.isNaN(Date.parse(p.endsAt))) throw new HttpError(400, "promotion_invalid_end");
    if (p.startsAt && p.endsAt && Date.parse(p.endsAt) <= Date.parse(p.startsAt)) throw new HttpError(400, "promotion_invalid_window");
  }

  const existing = await dbSelect<{ id: string }>("promotions?select=id");
  const keep = new Set(promotions.map((p) => p.id));
  for (const row of existing) {
    // Deleting a campaign never rewrites order history: every order carries
    // its own immutable promotion snapshot.
    if (!keep.has(row.id)) {
      const res = await db(`promotions?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    }
  }

  for (const [i, promo] of promotions.entries()) {
    const sortOrder = (i + 1) * 10;
    const row = { id: promo.id, enabled: promo.enabled === true, sort_order: sortOrder, data: { ...promo, sortOrder } };
    // Same reason as products: an empty PATCH body is success, not absence.
    await dbUpsert("promotions", row);
  }

  await audit(staff.email, "promotions_updated", `${promotions.length} campaigns`);
  return json({ ok: true });
}

async function listBadges(req: Request): Promise<Response> {
  await requireStaff(req);
  const rows = await dbSelect<{ id: string; active: boolean; sort_order: number | null; data: BadgeOption; supplier_ref: string | null }>(
    "patches?select=id,active,sort_order,data,supplier_ref&order=sort_order",
  );
  const badges = rows.map((r, i) => ({
    ...r.data,
    id: r.id,
    code: r.data?.code ?? r.id,
    active: r.active,
    sortOrder: r.sort_order ?? (i + 1) * 10,
    ...(r.supplier_ref ? { supplierReference: r.supplier_ref } : {}),
  }));
  return json({ badges });
}

async function saveBadges(req: Request, body: { badges: BadgeOption[] }): Promise<Response> {
  const staff = await requireStaff(req);
  // Badge prices are charged at checkout: owner/admin only (A2-S4).
  if (!canManagePricing(staff.role)) throw new HttpError(403, "forbidden");
  const badges = body.badges ?? [];
  if (badges.length > 200) throw new HttpError(400, "too_many_badges");

  // Server-side validation — the admin UI is never the boundary.
  const seenId = new Set<string>();
  const seenCode = new Set<string>();
  for (const b of badges) {
    if (!b?.id?.trim() || !b?.code?.trim()) throw new HttpError(400, "badge_missing_id_or_code");
    if (!b.name?.en?.trim() || !b.name?.ar?.trim() || !b.name?.he?.trim()) throw new HttpError(400, "badge_missing_name");
    if (!Number.isFinite(b.priceIls) || b.priceIls < 0) throw new HttpError(400, "badge_invalid_price");
    if (seenId.has(b.id) || seenCode.has(b.code)) throw new HttpError(400, "badge_duplicate");
    seenId.add(b.id);
    seenCode.add(b.code);
  }

  const existing = await dbSelect<{ id: string }>("patches?select=id");
  const keep = new Set(badges.map((b) => b.id));
  // Deleting an option never rewrites order history: every order item carries
  // its own immutable snapshot of the name and price it was sold at.
  for (const row of existing) {
    if (!keep.has(row.id)) {
      const res = await db(`patches?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    }
  }

  for (const [i, badge] of badges.entries()) {
    const { supplierReference, ...publicData } = badge;
    const sortOrder = (i + 1) * 10;
    const row = {
      id: badge.id,
      active: badge.active,
      sort_order: sortOrder,
      // The public jsonb deliberately excludes the supplier reference.
      data: { ...publicData, sortOrder },
      supplier_ref: supplierReference ?? null,
    };
    // Same reason as products: an empty PATCH body is success, not absence.
    await dbUpsert("patches", row);
  }

  await audit(staff.email, "badges_updated", `${badges.length} options`);
  return json({ ok: true });
}

async function saveProduct(req: Request, product: Record<string, unknown>): Promise<Response> {
  const staff = await requireStaff(req);
  const status = String(product.status ?? "draft");
  const rights = String(product.rightsStatus ?? "pending_review");
  // Rights gate re-checked server-side (also enforced by a DB constraint).
  if (!["draft", "archived"].includes(status) && rights !== "cleared") {
    throw new HttpError(400, "rights_not_cleared");
  }
  // Availability hygiene, enforced server-side rather than trusted from the
  // client: an `available` claim with no recorded check date is not a
  // confirmation, and a check date is never fabricated here.
  const avail = product.availability as { status?: string; lastCheckedAt?: string } | undefined;
  if (avail?.status === "available" && !avail.lastCheckedAt) {
    product.availability = { ...avail, status: "confirmation_required" };
  }

  // Image URLs are validated HERE, not only in the Admin form. Anyone can
  // POST to this function directly, and a local-file URL saved that way looks
  // perfect to whoever typed it and is a broken image for every customer.
  // Site-relative paths are refused for stored product data: a saved product
  // must point at an uploaded image, not at an asset a particular build
  // happened to bundle. Every image is checked — styled, real and gallery.
  const badImages = productImageUrlProblems(product.images);
  if (badImages.length) {
    throw new HttpError(400, "product_invalid_image_url", badImages.map((b) => `${b.where}: ${b.problem}`).join("; "));
  }

  // Club tags are normalized HERE too: a product carries at most one
  // registry club tag, stored in its canonical lowercase form so the
  // storefront `?club=` filter finds it. Every other tag is kept exactly
  // (value, case, order). Two different clubs is refused, never guessed.
  const tagCheck = normalizeProductTags(product.tags);
  if (tagCheck.error) throw new HttpError(400, tagCheck.error);
  product.tags = tagCheck.tags;

  const row = {
    id: String(product.id),
    slug: String(product.slug),
    status,
    rights_status: rights,
    category_slug: String(product.categorySlug),
    data: product,
    created_at: product.createdAt ?? new Date().toISOString(),
  };
  // Upsert, not PATCH-then-maybe-INSERT: a successful PostgREST PATCH answers
  // 204 with an EMPTY body, which the old code read as "row missing" and
  // followed with an INSERT — a duplicate-key failure on every re-save of an
  // existing product. merge-duplicates is one atomic write with no read-back.
  await dbUpsert("products", row);
  await audit(staff.email, "product_saved", row.slug);
  return json({ ok: true });
}

async function importProducts(req: Request, body: { rows: Record<string, string>[] }): Promise<Response> {
  const staff = await requireStaff(req);
  const rows = body.rows ?? [];
  if (rows.length > 500) throw new HttpError(400, "too_many_rows");
  const existing = await dbSelect<{ slug: string }>("products?select=slug");
  const known = new Set(existing.map((e) => e.slug));
  // Imported rows may only reference badge options the owner already
  // created. Untrusted supplier text never creates a global badge.
  const catalog = await dbSelect<{ id: string; data: { code?: string } }>("patches?select=id,data");
  const badgeByCode = new Map(catalog.map((b) => [(b.data?.code ?? b.id).toLowerCase(), b.id]));
  const results: { row: number; ok: boolean; slug?: string; errors: string[] }[] = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors: string[] = [];
    const slug = (row.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    const price = Number(row.price_ils);
    if (!slug) errors.push("missing slug");
    if (!row.name_en?.trim()) errors.push("missing name_en");
    if (!Number.isFinite(price) || price <= 0) errors.push("invalid price_ils");
    if (known.has(slug)) errors.push("duplicate slug — skipped");
    const badgeImport = parseImportedBadges(row, badgeByCode);
    errors.push(...badgeImport.errors);
    // Optional `club` column: a registry tag (any case) or blank. Unknown
    // supplier text fails the row; it never becomes a tag.
    const clubImport = parseImportedClub(row);
    errors.push(...clubImport.errors);
    if (errors.length) {
      results.push({ row: i + 1, ok: false, slug, errors });
      continue;
    }
    known.add(slug);
    const name = { en: row.name_en.trim(), ar: row.name_ar?.trim() ?? "", he: row.name_he?.trim() ?? "" };
    const product = {
      id: `imp-${crypto.randomUUID()}`,
      slug,
      categorySlug: row.category?.trim() || "retro",
      name,
      description: { ar: row.desc_ar?.trim() ?? "", he: row.desc_he?.trim() ?? "", en: row.desc_en?.trim() ?? "" },
      details: { ar: "", he: "", en: "" },
      seoTitle: name,
      seoDescription: { ar: "", he: "", en: "" },
      status: "draft", // imports NEVER publish automatically (spec §25)
      basePriceIls: price,
      versions: [],
      sleeves: ["short"],
      longSleeveAdjustmentIls: 0,
      sizes: ["S", "M", "L", "XL", "2XL"],
      personalizable: row.personalizable !== "false",
      patchIds: [],
      badges: badgeImport.settings,
      allowNoBadge: true,
      qualifiesForFreeDelivery: true,
      featured: false,
      images: [],
      relatedSlugs: [],
      tags: clubImport.tags,
      rightsStatus: "pending_review",
      supplier: { sku: row.supplier_sku?.trim(), reference: row.supplier_ref?.trim(), costUsd: Number(row.supplier_cost_usd) || undefined },
      isDemo: false,
      createdAt: new Date().toISOString(),
    };
    await dbInsert("products", { id: product.id, slug, status: "draft", rights_status: "pending_review", category_slug: product.categorySlug, data: product });
    created++;
    results.push({ row: i + 1, ok: true, slug, errors: [] });
  }
  await audit(staff.email, "products_imported", `${created} created (draft)`);
  return json({ results, created });
}

/** Mirrors parseImportedBadges() in src/lib/badges.ts. */
function parseImportedBadges(row: Record<string, string>, byCode: Map<string, string>): { settings: { badgeId: string; enabled: boolean; priceOverrideIls?: number }[]; errors: string[] } {
  const errors: string[] = [];
  const codes = (row.badge_codes ?? "").split(/[|,]/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  const overrides = new Map<string, number>();
  for (const pair of (row.badge_price_overrides ?? "").split(/[|,]/).map((p) => p.trim()).filter(Boolean)) {
    const [rawCode, rawPrice] = pair.split(":");
    const code = (rawCode ?? "").trim().toLowerCase();
    const priceText = (rawPrice ?? "").trim();
    const price = Number(priceText);
    if (!code || priceText === "" || !Number.isFinite(price)) errors.push(`invalid badge price override "${pair}" — expected code:price`);
    else if (price < 0) errors.push(`negative badge price override for "${code}"`);
    else if (!codes.includes(code)) errors.push(`badge price override for "${code}" which is not in badge_codes`);
    else overrides.set(code, price);
  }
  const settings: { badgeId: string; enabled: boolean; priceOverrideIls?: number }[] = [];
  for (const code of codes) {
    const badgeId = byCode.get(code);
    if (!badgeId) {
      errors.push(`unknown badge code "${code}" — create it under Badge / patch options first`);
      continue;
    }
    const override = overrides.get(code);
    settings.push({ badgeId, enabled: true, ...(override === undefined ? {} : { priceOverrideIls: override }) });
  }
  return { settings, errors };
}

/* ── compare-and-set order writes (migration 0008) ─────────────────────────
   An order update is decided from a snapshot (lifecycle checks, the email
   decision, the appended paymentHistory / tracking arrays). The write below
   lands only if the row still has the version that snapshot was read at
   (`transition_order_data`: ONE conditional UPDATE), so of N concurrent
   identical requests exactly one wins and only the winner emails, audits
   and queues a Sheets row. Losers re-read and re-plan (bounded). */

/** Attempts per request before giving up with 409 `concurrent_update`. */
const MAX_TRANSITION_ATTEMPTS = 3;

interface VersionedOrder {
  order: Record<string, unknown>;
  version: number;
}

type TransitionResult = { applied: true; data: Record<string, unknown>; version: number } | { applied: false; version: number | null };

async function readVersionedOrder(orderNumber: string): Promise<VersionedOrder | null> {
  const rows = await dbSelect<{ data: Record<string, unknown>; version: number }>(
    `orders?select=data,version&order_number=eq.${encodeURIComponent(orderNumber)}`,
  );
  const row = rows[0];
  return row?.data ? { order: row.data, version: Number(row.version) } : null;
}

/** Merge `patch` (top-level keys) + optional status columns iff the row is
 * still at `expectedVersion`. Never a read-then-write. */
async function transitionOrder(
  orderNumber: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
  statuses: { paymentStatus?: string; fulfillmentStatus?: string } = {},
): Promise<TransitionResult> {
  return await dbRpc<TransitionResult>("transition_order_data", {
    p_order_number: orderNumber,
    p_expected_version: expectedVersion,
    p_patch: patch,
    p_payment_status: statuses.paymentStatus ?? null,
    p_fulfillment_status: statuses.fulfillmentStatus ?? null,
  });
}

/** Records ONE milestone in the ledger (`data.customerEmails.<event>` only,
 * server-side) and returns the stored data, or null when no order matched. */
async function recordOrderCustomerEmail(orderNumber: string, event: CustomerEmailEvent, record: CustomerEmailRecord): Promise<Record<string, unknown> | null> {
  return await dbRpc<Record<string, unknown> | null>("record_order_customer_email", {
    p_order_number: orderNumber,
    p_event: event,
    p_record: record,
  });
}

/** Bank-transfer instructions for the order's language, when this milestone should carry them. */
async function bankInstructionsFor(order: Record<string, unknown>, event: CustomerEmailEvent): Promise<string | undefined> {
  if (!bankInstructionsDue(order, event)) return undefined;
  const rows = await dbSelect<{ data: { bankTransferInstructions?: Record<string, string> } }>("store_settings?select=data&id=eq.main");
  const locale = order.locale === "he" || order.locale === "en" ? order.locale : "ar";
  return rows[0]?.data?.bankTransferInstructions?.[locale] || undefined;
}

async function updateOrder(req: Request, body: { orderNumber: string; patch: Record<string, unknown> }): Promise<Response> {
  const staff = await requireStaff(req);
  // content_manager (and any non-order role) cannot touch orders at all (A2-S4).
  if (!canUpdateOrders(staff.role)) throw new HttpError(403, "forbidden");
  if (typeof body.orderNumber !== "string" || !body.orderNumber) throw new HttpError(400, "order_number_required");

  let plan: UpdateOrderPlan | undefined;
  let stored: Record<string, unknown> | undefined;
  for (let attempt = 1; !stored; attempt++) {
    const current = await readVersionedOrder(body.orderNumber);
    const order = current?.order as LifecycleOrder | undefined;
    if (!current || !order) return json({ ok: false }, 404);

    // Allowlist, enum + transition matrix, role gates, implied changes and
    // the email decision all live in the pure module (_shared/order-lifecycle.ts).
    // A loser of a race re-plans here against the winner's committed state.
    const now = new Date().toISOString();
    const planned = planOrderUpdate(order, body.patch, { email: staff.email, role: staff.role }, now);
    if (!planned.ok) throw new HttpError(planned.status, planned.error, planned.detail);
    // Idempotent: the requested state is already stored (a re-save, or a
    // concurrent request just applied it) — writes nothing, emails nobody,
    // audits nothing.
    if (planned.noop) return json({ ok: true, order: current.order, alreadyApplied: true });

    // 1 · persist the change first (compare-and-set), so no email ever
    //     describes an unsaved state and only one concurrent request wins.
    const statuses = {
      ...(planned.paymentStatus ? { paymentStatus: planned.paymentStatus } : {}),
      ...(planned.fulfillmentStatus ? { fulfillmentStatus: planned.fulfillmentStatus } : {}),
    };
    const result = await transitionOrder(body.orderNumber, current.version, planned.dataPatch, statuses);
    if (result.applied) {
      plan = planned;
      stored = result.data;
    } else if (result.version === null) {
      return json({ ok: false }, 404);
    } else if (attempt >= MAX_TRANSITION_ATTEMPTS) {
      throw new HttpError(409, "concurrent_update");
    }
  }
  if (!plan) throw new Error("updateOrder: transition applied without a plan");

  // Everything below runs ONLY for the request whose transition applied.
  if (plan.supplierDecision) await audit(staff.email, `supplier_${plan.supplierDecision}`, body.orderNumber);

  /* ── 2 · customer status email ─────────────────────────────────────────
     One milestone gets at most one email ever (`deliverStatusEmail` checks
     the order's own ledger); a failure is recorded, never thrown. Only
     `customerEmails.<event>` is written back, server-side. */
  const event = plan.specialEmail ?? eventForStatusChange(plan.emailChange);
  if (event) {
    try {
      const bankInstructions = await bankInstructionsFor(stored, event);
      const record = await deliverStatusEmail(stored, event, undefined, bankInstructions ? { bankInstructions } : {});
      if (record) stored = (await recordOrderCustomerEmail(body.orderNumber, event, record)) ?? stored;
    } catch (e) {
      // An order update must never fail because of an email.
      console.error("[admin-actions] customer status email failed:", e instanceof Error ? e.message : "unknown");
    }
  }

  await dbInsert("sheets_sync_log", { order_number: body.orderNumber, status: "pending" });
  await audit(staff.email, "order_updated", body.orderNumber, auditDetail(plan.changes));
  return json({ ok: true, order: stored });
}

/** A resend of one milestone is claimed on the order before sending, and a
 * claim blocks further resends of that milestone for this long (double-click,
 * two tabs, two staff) … */
const RESEND_COOLDOWN_MS = 30_000;
/** … and, while its outcome has not been recorded, for up to this long (a
 * claim whose sender died is abandoned after it). */
const RESEND_CLAIM_TTL_MS = 120_000;

interface ResendClaim {
  at: string;
  by: string;
  /** Ledger attempts for the milestone when the claim was taken. */
  attempts: number;
}

/** Why a resend of `event` must not start now, or null when it may. */
function resendBlocked(order: Record<string, unknown>, event: CustomerEmailEvent, nowMs: number): string | null {
  const claims = (order.customerEmailResends ?? {}) as Record<string, ResendClaim | undefined>;
  const claim = claims[event];
  if (!claim) return null;
  const age = nowMs - Date.parse(claim.at);
  if (!Number.isFinite(age)) return null;
  if (age >= 0 && age < RESEND_COOLDOWN_MS) return "That email was just re-sent — wait a moment before trying again.";
  const ledger = (order.customerEmails ?? {}) as Record<string, { attempts?: number } | undefined>;
  const resolved = (ledger[event]?.attempts ?? 0) > claim.attempts;
  if (!resolved && age >= 0 && age < RESEND_CLAIM_TTL_MS) return "A resend of that email is already in progress.";
  return null;
}

/**
 * Retries one customer status email that did not reach the customer.
 *
 * The idempotency rule is the same as everywhere else and is enforced here
 * too, not just in the UI: a milestone already delivered is never sent
 * again, however many times this is called. Concurrent resends are
 * serialized by an atomic claim (compare-and-set on the order version)
 * taken BEFORE sending, so N simultaneous clicks send at most one email.
 */
async function resendCustomerEmail(req: Request, body: { orderNumber: string; event: string }): Promise<Response> {
  const staff = await requireStaff(req);
  if (!canUpdateOrders(staff.role)) throw new HttpError(403, "forbidden");
  if (!CUSTOMER_EMAIL_EVENTS.includes(body.event as CustomerEmailEvent)) {
    return json({ ok: false, error: "Unknown email type.", message: "Unknown email type." }, 400);
  }
  const event = body.event as CustomerEmailEvent;
  const current = typeof body.orderNumber === "string" && body.orderNumber ? await readVersionedOrder(body.orderNumber) : null;
  const order = current?.order;
  if (!current || !order) return json({ ok: false, error: "Order not found.", message: "Order not found." }, 404);
  if (alreadySent(order, event)) return json({ ok: false, error: "That email was already delivered — it is never sent twice.", message: "That email was already delivered — it is never sent twice." }, 409);
  const blocked = resendBlocked(order, event, Date.now());
  if (blocked) return json({ ok: false, error: blocked, message: blocked }, 409);

  // Claim first: of N requests that read this version, exactly one takes it.
  const claims = (order.customerEmailResends ?? {}) as Record<string, ResendClaim | undefined>;
  const priorAttempts = ((order.customerEmails ?? {}) as Record<string, { attempts?: number } | undefined>)[event]?.attempts ?? 0;
  const claim: ResendClaim = { at: new Date().toISOString(), by: staff.email, attempts: priorAttempts };
  const claimed = await transitionOrder(body.orderNumber, current.version, { customerEmailResends: { ...claims, [event]: claim } });
  if (!claimed.applied) {
    return json({ ok: false, error: "The order changed while re-sending (another resend or update) — refresh and try again.", message: "The order changed while re-sending (another resend or update) — refresh and try again." }, 409);
  }
  const claimedOrder = claimed.data;

  const bankInstructions = await bankInstructionsFor(claimedOrder, event);
  const record = await sendCustomerStatusEmail(claimedOrder, event, readCustomerEmailConfig(), bankInstructions ? { bankInstructions } : {});
  // Only `customerEmails.<event>` is written (A2-B6 / 0008).
  await recordOrderCustomerEmail(body.orderNumber, event, record);
  await audit(staff.email, "customer_email_retried", body.orderNumber, `${event}=${record.status}`);
  return json({
    ok: record.status === "sent",
    message: record.status === "sent" ? "Email sent." : `Not sent (${record.status}): ${record.error ?? "no detail"}`,
  });
}

async function saveZones(req: Request, body: { zones: { id: string; active: boolean }[] }): Promise<Response> {
  const staff = await requireStaff(req);
  for (const zone of body.zones ?? []) {
    const z = zone as { id: string; active: boolean; priceIls?: number } & Record<string, unknown>;
    // Server-side and authoritative: the Admin UI check is a courtesy.
    if (zonePriceProblem((z as { priceIls?: number }).priceIls)) throw new HttpError(400, "zone_price_out_of_range");

    // PATCH asking for the affected rows back. Without return=representation
    // PostgREST answers 204 with an empty body, which the previous version
    // read as "row missing" and followed with an INSERT — so the second save
    // of any existing zone failed on a duplicate key. patchMatchedNoRows()
    // distinguishes "nothing matched" from "succeeded, said nothing".
    const res = await db(`shipping_zones?id=eq.${encodeURIComponent(z.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: z.active, data: z }),
      headers: { Prefer: "return=representation" },
    });
    if (!res.ok) throw new Error(await res.text());
    if (patchMatchedNoRows(res.status, await res.text())) {
      // Genuinely a new zone. merge-duplicates keeps this safe even if two
      // admins save at once, rather than racing into a duplicate-key error.
      await dbUpsert("shipping_zones", { id: z.id, active: z.active, data: z });
    }
  }
  await audit(staff.email, "zones_saved", `${body.zones?.length ?? 0} zones`);
  return json({ ok: true });
}

async function saveSettings(req: Request, settings: Record<string, unknown>): Promise<Response> {
  const staff = await requireAdminOrOwner(req);
  await dbUpdate("store_settings?id=eq.main", { data: settings });
  await audit(staff.email, "settings_saved", "store_settings");
  return json({ ok: true });
}

async function dashboard(req: Request): Promise<Response> {
  await requireStaff(req);
  const orders = await dbSelect<{ payment_status: string; fulfillment_status: string; total_ils: number; created_at: string; data: { items: { slug: string; title: unknown; quantity: number }[] } }>(
    "orders?select=payment_status,fulfillment_status,total_ils,created_at,data&limit=1000&order=created_at.desc",
  );
  const profiles = await dbSelect<{ role: string }>("profiles?select=role");
  const today = new Date().toISOString().slice(0, 10);
  const paid = orders.filter((o) => o.payment_status === "paid");
  const revenue = paid.reduce((s, o) => s + Number(o.total_ils), 0);
  const byProduct = new Map<string, { slug: string; title: unknown; count: number }>();
  for (const o of orders) {
    for (const item of o.data.items ?? []) {
      const e = byProduct.get(item.slug) ?? { slug: item.slug, title: item.title, count: 0 };
      e.count += item.quantity;
      byProduct.set(item.slug, e);
    }
  }
  return json({
    ordersToday: orders.filter((o) => o.created_at.slice(0, 10) === today).length,
    revenueIls: revenue,
    paidOrders: paid.length,
    pendingPayments: orders.filter((o) => inBucket(DASHBOARD_PENDING_PAYMENT, o.payment_status)).length,
    // Was `payment_confirmed` — an order that has PAID, not one waiting on
    // the supplier, and in CROWNED's flow the supplier step comes first.
    awaitingSupplier: orders.filter((o) => inBucket(DASHBOARD_AWAITING_SUPPLIER, o.fulfillment_status)).length,
    inProduction: orders.filter((o) => inBucket(DASHBOARD_IN_PRODUCTION, o.fulfillment_status)).length,
    dispatched: orders.filter((o) => inBucket(DASHBOARD_DISPATCHED, o.fulfillment_status)).length,
    inTransit: orders.filter((o) => inBucket(DASHBOARD_IN_TRANSIT, o.fulfillment_status)).length,
    avgOrderValueIls: paid.length ? Math.round(revenue / paid.length) : 0,
    topProducts: [...byProduct.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topCategories: [],
    customerCount: profiles.filter((p) => p.role === "customer").length,
  });
}
