/**
 * admin-actions — consolidated authorized admin mutations. Every branch
 * re-verifies the caller's role server-side (spec §26/§35); the UI is never
 * the security boundary. The frontend calls the aliases listed in ROUTES —
 * deploy this function once per alias (supabase functions deploy <alias>)
 * or route via query param; both patterns documented in docs/deployment-guide.md.
 *
 * Actions: save-product, import-products, update-order, save-zones,
 * save-settings, dashboard.
 */
import { audit, dbInsert, dbSelect, dbUpdate, db, handleError, HttpError, json, preflight, requireAdminOrOwner, requireStaff } from "../_shared/helpers.ts";
import { dispatchedEmail } from "../_shared/emails.ts";

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

async function saveProduct(req: Request, product: Record<string, unknown>): Promise<Response> {
  const staff = await requireStaff(req);
  const status = String(product.status ?? "draft");
  const rights = String(product.rightsStatus ?? "pending_review");
  // Rights gate re-checked server-side (also enforced by a DB constraint).
  if (!["draft", "archived"].includes(status) && rights !== "cleared") {
    throw new HttpError(400, "rights_not_cleared");
  }
  const row = {
    id: String(product.id),
    slug: String(product.slug),
    status,
    rights_status: rights,
    category_slug: String(product.categorySlug),
    data: product,
    created_at: product.createdAt ?? new Date().toISOString(),
  };
  const res = await db(`products?id=eq.${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify(row) });
  if (!res.ok) throw new Error(await res.text());
  const patched = await res.text();
  if (!patched || patched === "[]") {
    await dbInsert("products", row);
  }
  await audit(staff.email, "product_saved", row.slug);
  return json({ ok: true });
}

async function importProducts(req: Request, body: { rows: Record<string, string>[] }): Promise<Response> {
  const staff = await requireStaff(req);
  const rows = body.rows ?? [];
  if (rows.length > 500) throw new HttpError(400, "too_many_rows");
  const existing = await dbSelect<{ slug: string }>("products?select=slug");
  const known = new Set(existing.map((e) => e.slug));
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
      qualifiesForFreeDelivery: true,
      featured: false,
      images: [],
      relatedSlugs: [],
      tags: [],
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

async function updateOrder(req: Request, body: { orderNumber: string; patch: Record<string, unknown> }): Promise<Response> {
  const staff = await requireStaff(req);
  const rows = await dbSelect<{ data: Record<string, unknown> }>(`orders?select=data&order_number=eq.${encodeURIComponent(body.orderNumber)}`);
  const order = rows[0]?.data as
    | {
        paymentStatus: string;
        fulfillmentStatus: string;
        tracking: { status: string; at: string }[];
        locale: "ar" | "he" | "en";
        customer: { email: string };
        trackingNumber?: string;
        productionStartedAt?: string;
        supplierDispatchedAt?: string;
      }
    | undefined;
  if (!order) return json({ ok: false }, 404);

  const patch = body.patch ?? {};
  const now = new Date().toISOString();
  const nextFulfillment = patch.fulfillmentStatus as string | undefined;
  if (nextFulfillment && nextFulfillment !== order.fulfillmentStatus) {
    order.tracking.push({ status: nextFulfillment, at: now });
    if (nextFulfillment === "production_started") order.productionStartedAt = now;
    if (nextFulfillment === "supplier_dispatched") {
      order.supplierDispatchedAt = now;
      const email = dispatchedEmail(order.locale, body.orderNumber, (patch.trackingNumber as string) ?? order.trackingNumber);
      const { sendEmail } = await import("../_shared/helpers.ts");
      await sendEmail(order.customer.email, email.subject, email.html).catch(() => undefined);
    }
  }
  Object.assign(order, patch);

  await dbUpdate(`orders?order_number=eq.${encodeURIComponent(body.orderNumber)}`, {
    payment_status: order.paymentStatus,
    fulfillment_status: order.fulfillmentStatus,
    data: order,
  });
  await dbInsert("sheets_sync_log", { order_number: body.orderNumber, status: "pending" });
  await audit(staff.email, "order_updated", body.orderNumber, Object.keys(patch).join(","));
  return json({ ok: true, order });
}

async function saveZones(req: Request, body: { zones: { id: string; active: boolean }[] }): Promise<Response> {
  const staff = await requireStaff(req);
  for (const zone of body.zones ?? []) {
    const z = zone as { id: string; active: boolean; priceIls?: number } & Record<string, unknown>;
    const price = Number((z as { priceIls?: number }).priceIls);
    if (Number.isFinite(price) && (price < 35 || price > 55)) throw new HttpError(400, "zone_price_out_of_range");
    const res = await db(`shipping_zones?id=eq.${encodeURIComponent(z.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: z.active, data: z }),
    });
    if (!res.ok) throw new Error(await res.text());
    const txt = await res.text();
    if (!txt || txt === "[]") await dbInsert("shipping_zones", { id: z.id, active: z.active, data: z });
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
    pendingPayments: orders.filter((o) => ["pending", "awaiting_payment"].includes(o.payment_status)).length,
    awaitingSupplier: orders.filter((o) => o.fulfillment_status === "payment_confirmed").length,
    inProduction: orders.filter((o) => ["sent_to_supplier", "production_started", "supplier_processing"].includes(o.fulfillment_status)).length,
    dispatched: orders.filter((o) => o.fulfillment_status === "supplier_dispatched").length,
    inTransit: orders.filter((o) => ["in_transit", "arrived_locally", "out_for_delivery"].includes(o.fulfillment_status)).length,
    avgOrderValueIls: paid.length ? Math.round(revenue / paid.length) : 0,
    topProducts: [...byProduct.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topCategories: [],
    customerCount: profiles.filter((p) => p.role === "customer").length,
  });
}
