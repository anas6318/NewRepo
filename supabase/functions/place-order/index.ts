/**
 * place-order — the only way an order enters the database.
 * Recomputes every price server-side from the products table (client totals
 * are never trusted), validates options, applies the quantity-based
 * free-delivery rule, generates an unguessable order number, stores a
 * contact hash for guest tracking, queues the Sheets sync, sends the
 * confirmation email (console mode unless a provider is configured) and
 * alerts the owner that a new order landed.
 *
 * Every validation and pricing rule lives in the pure core
 * `_shared/order-pricing.ts` (`validateAndPriceOrder`); this handler only
 * reads the rows it needs, calls the core, and persists/notifies.
 *
 * Ordering matters: the order is committed FIRST. The customer email, the
 * owner alert and the Sheets sync are all best-effort steps that run after
 * the row exists, and none of them can fail the order or change the
 * response the customer gets.
 *
 * Idempotency (A2-S3, `_shared/order-idempotency.ts`): a request carrying
 * `idempotencyKey` (UUID v4, one per checkout attempt) is looked up BEFORE
 * any side effect. The same attempt again (same request hash, same contact)
 * gets the stored order back with `duplicate: true` and nothing is re-sent;
 * a different request under that key is a 409 that reveals nothing. Two
 * concurrent requests with one key race on the UNIQUE index
 * `orders_idempotency_key_uidx`; the loser re-reads the winner and gets the
 * same decision. Side effects (Sheets row, lead, audit, customer email,
 * owner alert, Sheets sync) run only for the request whose insert landed.
 * Without a key the legacy path is unchanged (older cached clients).
 */
import { audit, callerProfile, contactHash, db, dbInsert, dbRpc, dbSelect, handleError, json, preflight } from "../_shared/helpers.ts";
import { deliverStatusEmail } from "../_shared/customer-notifications.ts";
import { sendOwnerOrderNotification, shouldSendOwnerNotification, type OwnerNotificationResult } from "../_shared/owner-notification.ts";
import { toCustomerOrderData } from "../_shared/customer-order.ts";
import { decideReplay, isIdempotencyUniqueViolation, parseIdempotencyKey, requestHashInput } from "../_shared/order-idempotency.ts";
import { orderProductIds, postgrestInList, validateAndPriceOrder, validateOrderRequest, type BadgeRow, type OrderRequestBody, type ProductRow, type PromotionConfig, type StoreSettingsData, type ZoneRow } from "../_shared/order-pricing.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = (await req.json()) as unknown;

    /* basic validation — no database read for an obviously bad request */
    const early = validateOrderRequest(body);
    if (early) return json({ ok: false, error: early.error }, early.status);
    const request = body as OrderRequestBody;

    /* idempotency — checked before any pricing read or side effect */
    const idem = parseIdempotencyKey((body as { idempotencyKey?: unknown }).idempotencyKey);
    if (!idem.ok) return json({ ok: false, error: "invalid_idempotency_key" }, 400);
    let idemRequestHash = "";
    let idemContactHash = "";
    if (idem.key) {
      idemRequestHash = await sha256Hex(requestHashInput(body));
      // validateOrderRequest passed, so the (trimmed) email is valid.
      idemContactHash = await contactHash(String(request.customer.email).trim());
      const existing = await findOrderByIdempotencyKey(idem.key);
      const decision = decideReplay({ existing: existing && idempotencyRecord(existing), requestHash: idemRequestHash, contactHash: idemContactHash });
      if (decision === "replay") return replayResponse(existing!);
      if (decision === "conflict") return json({ ok: false, error: "idempotency_conflict" }, 409);
    }

    // ONE clock reading for the whole request: sale windows, supplier
    // confirmation freshness, promotion windows and the stored timestamps.
    const nowMs = Date.now();

    /* database reads — every price and rule comes from these rows */
    const settingsRows = await dbSelect<{ data: StoreSettingsData }>("store_settings?select=data&id=eq.main");
    const settings = settingsRows[0]?.data;
    const zones =
      typeof request.zoneId === "string"
        ? await dbSelect<ZoneRow>(`shipping_zones?select=id,active,data&id=eq.${encodeURIComponent(request.zoneId)}`)
        : [];
    // Badge catalog, read with the service role so the internal supplier
    // reference is available for the order snapshot (it is stripped again
    // before anything customer-facing — see track-order).
    const badgeRows = await dbSelect<BadgeRow>("patches?select=id,active,data,supplier_ref");
    // Every referenced product in ONE query; a missing id simply is not in
    // the map and the core refuses that line as `product_unavailable`.
    const productIds = orderProductIds(body);
    const productRows = productIds.length
      ? await dbSelect<ProductRow>(`products?select=id,status,data&id=in.(${postgrestInList(productIds)})`)
      : [];
    const promoRows = await dbSelect<{ id: string; data: PromotionConfig }>("promotions?select=id,data,sort_order&order=sort_order");

    /* validation + pricing: supabase/functions/_shared/order-pricing.ts */
    const priced = validateAndPriceOrder({
      body,
      settings,
      zone: zones[0],
      products: new Map(productRows.map((p) => [p.id, p])),
      badges: badgeRows,
      promotions: promoRows.map((r) => r.data),
      nowMs,
    });
    if (!priced.ok) return json({ ok: false, error: priced.error }, priced.status);

    /* order number via DB function (unique, unguessable) */
    const numRes = await db("rpc/generate_order_number", { method: "POST", body: "{}" });
    if (!numRes.ok) return json({ ok: false, error: "order_number_failed" }, 500);
    const orderNumber = (await numRes.json()) as string;

    const caller = await callerProfile(req);
    const c = priced.customer; // allowlisted + trimmed by the core
    const isBank = priced.paymentMethod === "bank_transfer";
    const now = new Date(nowMs).toISOString();
    const hash = await contactHash(c.email);

    const orderData = {
      id: crypto.randomUUID(),
      orderNumber,
      createdAt: now,
      locale: priced.locale,
      customer: { ...c, customerId: caller?.id },
      items: priced.items,
      subtotalIls: priced.subtotalIls,
      // A separate, visible line — never folded into the subtotal.
      ...(priced.promotion ? { promotion: priced.promotion, promotionDiscountIls: priced.promotionDiscountIls } : {}),
      deliveryIls: priced.deliveryIls,
      freeDelivery: priced.freeDelivery,
      totalIls: priced.totalIls,
      zoneId: priced.zoneId,
      paymentMethod: priced.paymentMethod,
      paymentStatus: priced.initialPaymentStatus,
      // Unconfirmed supplier availability holds the order: nothing is
      // reserved, ordered from the supplier or produced in this state.
      fulfillmentStatus: priced.initialFulfillmentStatus,
      tracking: priced.tracking,
      ...(priced.supplierConfirmation ? { supplierConfirmation: priced.supplierConfirmation } : {}),
      sheetsSync: { status: "pending" },
      // Owner alert has not been attempted yet. If this function dies
      // between the insert and the attempt below, the order honestly reads
      // "pending" rather than claiming a notification that never happened.
      notification: { status: "pending" } as OwnerNotificationResult,
      // Customer status-email ledger. Filled by the confirmation send below
      // and by every later Admin status change; the key is the milestone, so
      // a milestone can only ever be emailed once.
      customerEmails: {} as Record<string, unknown>,
      // Owner/internal only — stripped by toCustomerOrderData.
      ...(idem.key ? { idempotency: { key: idem.key, requestHash: idemRequestHash } } : {}),
      isDemo: false,
    };

    try {
      await dbInsert("orders", {
        id: orderData.id,
        order_number: orderNumber,
        customer_id: caller?.id ?? null,
        contact_hash: hash,
        payment_status: orderData.paymentStatus,
        fulfillment_status: orderData.fulfillmentStatus,
        total_ils: priced.totalIls,
        locale: priced.locale,
        data: orderData,
        created_at: now,
        ...(idem.key ? { idempotency_key: idem.key } : {}),
      });
    } catch (e) {
      if (!idem.key || !isIdempotencyUniqueViolation(e)) throw e;
      // A concurrent request with the same key inserted first. Its order is
      // the one; this request re-reads it and gets the same decision a
      // later retry would. No side effect below runs for this request.
      const winner = await findOrderByIdempotencyKey(idem.key);
      if (!winner) throw e;
      const decision = decideReplay({ existing: idempotencyRecord(winner), requestHash: idemRequestHash, contactHash: idemContactHash });
      if (decision === "replay") return replayResponse(winner);
      return json({ ok: false, error: "idempotency_conflict" }, 409);
    }

    await dbInsert("sheets_sync_log", { order_number: orderNumber, status: "pending" });
    if (request.marketingConsent) {
      await dbInsert("leads", { kind: "email", value: c.email, consent: true, consent_source: "checkout" });
    }
    await audit("storefront", "order_created", orderNumber, `total=${priced.totalIls}`);

    /* confirmation email — best effort, never blocks the order.
       Recorded in the order's own email ledger, so Admin can see whether it
       arrived and re-send it, and so no later trigger ever sends the
       "order received" mail a second time. */
    // An order HELD for a supplier check gets the "awaiting supplier
    // confirmation" variant with NO bank instructions (A2-B5); they are sent
    // by admin-actions once the supplier confirms (`supplier_confirmed`).
    const heldForSupplier = priced.initialFulfillmentStatus === "awaiting_supplier_confirmation";
    try {
      const received = await deliverStatusEmail(orderData as unknown as Record<string, unknown>, "order_received", undefined, {
        ...(isBank && !heldForSupplier && settings?.bankTransferInstructions?.[priced.locale]
          ? { bankInstructions: settings.bankTransferInstructions[priced.locale] }
          : {}),
      });
      // Persist ONLY this milestone's ledger entry, server-side (0008): a
      // concurrent Admin change since the insert is never reverted.
      if (received) {
        await dbRpc("record_order_customer_email", { p_order_number: orderNumber, p_event: "order_received", p_record: received });
      }
    } catch (e) {
      console.error("[place-order] confirmation email failed:", e);
    }

    /* ── owner order alert ──────────────────────────────────────────────
       Strictly after the order is committed, and strictly best-effort: the
       sender never throws, and a failure is recorded on the order instead
       of propagating. `shouldSendOwnerNotification` is the duplicate guard —
       an order that already carries a result is never re-sent, and no other
       function in this project calls the sender at all.

       The result is MERGED into the stored order (`patch_order_data`, top-level
       key `notification` only) — never a whole-`data` write from this
       request's in-memory copy, which would revert anything an Admin change
       (or sheets-sync, which itself writes only `sheetsSync`) stored since
       the insert. */
    if (shouldSendOwnerNotification(orderData)) {
      const result = await sendOwnerOrderNotification(orderData);
      orderData.notification = result;
      try {
        await dbRpc("patch_order_data", { p_order_number: orderNumber, p_patch: { notification: result }, p_payment_status: null, p_fulfillment_status: null });
      } catch (e) {
        // The alert status could not be persisted. The ORDER is already
        // safe; only the bookkeeping is lost, so it stays "pending" in Admin.
        console.error("[place-order] notification status write failed:", e);
      }
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

    // The stored row is written for the owner — it carries the badge
    // supplier references and the owner-alert bookkeeping. The copy returned
    // at checkout goes through the same sanitizer as guest tracking.
    return json({ ok: true, orderNumber, trackingContact: c.email, order: toCustomerOrderData(orderData) });
  } catch (err) {
    return handleError(err);
  }
});

/* ── idempotency helpers (declared after the handler on purpose: the
   handler's own success response stays the first one in this file) ── */

interface StoredOrderRow {
  order_number: string;
  contact_hash: string | null;
  data: Record<string, unknown> | null;
}

async function findOrderByIdempotencyKey(key: string): Promise<StoredOrderRow | null> {
  const rows = await dbSelect<StoredOrderRow>(
    `orders?select=order_number,contact_hash,data&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  return rows[0] ?? null;
}

function idempotencyRecord(row: StoredOrderRow): { requestHash: unknown; contactHash: unknown } {
  const stored = (row.data?.idempotency ?? null) as { requestHash?: unknown } | null;
  return { requestHash: stored?.requestHash, contactHash: row.contact_hash };
}

/** The stored order, through the same sanitizer as a fresh checkout
 * response. Only reached after decideReplay confirmed the same request from
 * the same contact, so nothing here belongs to anyone else. */
function replayResponse(row: StoredOrderRow): Response {
  const data = row.data ?? {};
  const customer = (data.customer ?? {}) as { email?: string };
  return json({
    ok: true,
    orderNumber: row.order_number,
    trackingContact: customer.email ?? "",
    order: toCustomerOrderData(data),
    duplicate: true,
  });
}

async function sha256Hex(text: string): Promise<string> {
  // globalThis: the Web Crypto API (Deno, and Node for the test harness).
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
