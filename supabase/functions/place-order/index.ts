/**
 * place-order — the only way an order enters the database.
 * Recomputes every price server-side from the products table (client totals
 * are never trusted), validates options, applies the quantity-based
 * free-delivery rule, generates an unguessable order number, stores a
 * contact hash for guest tracking, queues the Sheets sync, and sends the
 * confirmation email (console mode unless a provider is configured).
 */
import { audit, callerProfile, contactHash, db, dbInsert, dbSelect, handleError, json, preflight } from "../_shared/helpers.ts";
import { orderConfirmationEmail } from "../_shared/emails.ts";

interface Line {
  productId: string;
  version?: string;
  sleeve?: string;
  size: string;
  personalization?: { name?: string; number?: string };
  patchId?: string;
  quantity: number;
}

interface Payload {
  locale: "ar" | "he" | "en";
  customer: { name: string; email: string; phone: string; city: string; address: string; notes?: string };
  zoneId: string;
  paymentMethod: string;
  lines: Line[];
  marketingConsent?: boolean;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = (await req.json()) as Payload;

    /* basic validation */
    const c = body.customer ?? ({} as Payload["customer"]);
    if (!c.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email ?? "") || !/^\+?[0-9][0-9\s-]{6,17}$/.test(c.phone ?? "") || !c.city?.trim() || !c.address?.trim()) {
      return json({ ok: false, error: "invalid_customer" }, 400);
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 30) {
      return json({ ok: false, error: "empty_cart" }, 400);
    }

    /* settings + method + zone */
    const settingsRows = await dbSelect<{ data: Record<string, unknown> }>("store_settings?select=data&id=eq.main");
    const settings = settingsRows[0]?.data as {
      paymentMethods: { id: string; enabled: boolean; configured: boolean }[];
      freeDeliveryMinItems: number;
      bankTransferInstructions: Record<string, string>;
    };
    if (!settings) return json({ ok: false, error: "store_not_configured" }, 500);

    const method = settings.paymentMethods.find((m) => m.id === body.paymentMethod);
    if (!method?.enabled || !method.configured) return json({ ok: false, error: "payment_method_unavailable" }, 400);

    const zones = await dbSelect<{ id: string; active: boolean; data: { priceIls: number } }>(`shipping_zones?select=id,active,data&id=eq.${encodeURIComponent(body.zoneId)}`);
    const zone = zones[0];
    if (!zone?.active) return json({ ok: false, error: "zone_unavailable" }, 400);

    /* recompute pricing from the database */
    const items: Record<string, unknown>[] = [];
    let subtotal = 0;
    let qualifyingCount = 0;

    const patches = await dbSelect<{ id: string; active: boolean; data: { priceIls: number; name: unknown } }>("patches?select=id,active,data");

    for (const line of body.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10) return json({ ok: false, error: "invalid_quantity" }, 400);
      const rows = await dbSelect<{ id: string; status: string; data: Record<string, unknown> }>(`products?select=id,status,data&id=eq.${encodeURIComponent(line.productId)}`);
      const product = rows[0];
      if (!product || ["draft", "archived", "unavailable"].includes(product.status)) return json({ ok: false, error: "product_unavailable" }, 400);
      const d = product.data as {
        slug: string;
        name: unknown;
        images: { src: string }[];
        basePriceIls: number;
        versions: { version: string; adjustmentIls: number }[];
        sleeves: string[];
        longSleeveAdjustmentIls: number;
        sizes: string[];
        personalizable: boolean;
        patchIds: string[];
        qualifiesForFreeDelivery: boolean;
      };
      if (!d.sizes.includes(line.size)) return json({ ok: false, error: "invalid_size" }, 400);

      let unit = d.basePriceIls;
      let version: string | undefined;
      if (d.versions.length > 0) {
        const v = d.versions.find((x) => x.version === line.version);
        if (!v) return json({ ok: false, error: "invalid_version" }, 400);
        version = v.version;
        unit += v.adjustmentIls;
      }
      let sleeve: string | undefined;
      if (d.sleeves.length > 1) {
        if (line.sleeve !== "short" && line.sleeve !== "long") return json({ ok: false, error: "invalid_sleeve" }, 400);
        sleeve = line.sleeve;
        if (sleeve === "long") unit += d.longSleeveAdjustmentIls;
      } else if (d.sleeves[0] === "long") sleeve = "long";

      let patchName: unknown;
      if (line.patchId) {
        const patch = patches.find((p) => p.id === line.patchId && p.active && d.patchIds.includes(p.id));
        if (!patch) return json({ ok: false, error: "invalid_patch" }, 400);
        unit += patch.data.priceIls;
        patchName = patch.data.name;
      }
      if (line.personalization && !d.personalizable) return json({ ok: false, error: "personalization_unavailable" }, 400);
      if (line.personalization?.number && !/^\d{1,2}$/.test(line.personalization.number)) return json({ ok: false, error: "invalid_personalization" }, 400);
      if (line.personalization?.name && line.personalization.name.length > 14) return json({ ok: false, error: "invalid_personalization" }, 400);
      if (unit < 0) return json({ ok: false, error: "pricing_error" }, 500);

      const lineTotal = Math.round(unit * line.quantity * 100) / 100;
      subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
      if (d.qualifiesForFreeDelivery) qualifyingCount += line.quantity;

      items.push({
        productId: product.id,
        slug: d.slug,
        title: d.name,
        image: d.images[0]?.src ?? "",
        version,
        sleeve,
        size: line.size,
        personalization: line.personalization,
        patchId: line.patchId,
        patchName,
        unitPriceIls: unit,
        quantity: line.quantity,
        lineTotalIls: lineTotal,
      });
    }

    /* delivery: quantity-based free delivery (spec §12) */
    const minItems = settings.freeDeliveryMinItems ?? 3;
    const freeDelivery = qualifyingCount >= minItems;
    const deliveryIls = freeDelivery ? 0 : zone.data.priceIls;
    const total = Math.round((subtotal + deliveryIls) * 100) / 100;

    /* order number via DB function (unique, unguessable) */
    const numRes = await db("rpc/generate_order_number", { method: "POST", body: "{}" });
    if (!numRes.ok) return json({ ok: false, error: "order_number_failed" }, 500);
    const orderNumber = (await numRes.json()) as string;

    const caller = await callerProfile(req);
    const isBank = body.paymentMethod === "bank_transfer";
    const now = new Date().toISOString();
    const hash = await contactHash(c.email);

    const orderData = {
      id: crypto.randomUUID(),
      orderNumber,
      createdAt: now,
      locale: body.locale,
      customer: { ...c, customerId: caller?.id },
      items,
      subtotalIls: subtotal,
      deliveryIls,
      freeDelivery,
      totalIls: total,
      zoneId: zone.id,
      paymentMethod: body.paymentMethod,
      paymentStatus: isBank ? "awaiting_payment" : "pending",
      fulfillmentStatus: isBank ? "awaiting_payment" : "order_received",
      tracking: [{ status: "order_received", at: now }, ...(isBank ? [{ status: "awaiting_payment", at: now }] : [])],
      sheetsSync: { status: "pending" },
      isDemo: false,
    };

    await dbInsert("orders", {
      id: orderData.id,
      order_number: orderNumber,
      customer_id: caller?.id ?? null,
      contact_hash: hash,
      payment_status: orderData.paymentStatus,
      fulfillment_status: orderData.fulfillmentStatus,
      total_ils: total,
      locale: body.locale,
      data: orderData,
      created_at: now,
    });

    await dbInsert("sheets_sync_log", { order_number: orderNumber, status: "pending" });
    if (body.marketingConsent) {
      await dbInsert("leads", { kind: "email", value: c.email, consent: true, consent_source: "checkout" });
    }
    await audit("storefront", "order_created", orderNumber, `total=${total}`);

    /* confirmation email — best effort, never blocks the order */
    try {
      const email = orderConfirmationEmail(body.locale, {
        orderNumber,
        totalIls: total,
        bankInstructions: isBank ? settings.bankTransferInstructions?.[body.locale] : undefined,
      });
      await sendEmailSafe(c.email, email.subject, email.html);
    } catch (e) {
      console.error("[place-order] email failed:", e);
    }

    /* fire-and-forget sheets sync attempt */
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sheets-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "content-type": "application/json" },
        body: JSON.stringify({ orderNumber }),
      });
    } catch {
      /* retried by cron — see docs/google-sheets-setup.md */
    }

    return json({ ok: true, orderNumber, trackingContact: c.email, order: orderData });
  } catch (err) {
    return handleError(err);
  }
});

async function sendEmailSafe(to: string, subject: string, html: string): Promise<void> {
  const { sendEmail } = await import("../_shared/helpers.ts");
  await sendEmail(to, subject, html);
}
