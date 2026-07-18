/**
 * payments-webhook — provider-agnostic webhook receiver.
 * Route: /functions/v1/payments-webhook?provider=israeli-gateway|paypal|bit|paybox
 *
 * Guarantees (spec §14):
 *  - signature verified BEFORE any database write (per-provider verifier)
 *  - idempotent on (provider, provider_event_id) — duplicates no-op
 *  - simulated/unsigned events can never mark an order as genuinely paid
 *
 * Each provider block is a template with the exact wiring point marked;
 * fill in the provider's real signature scheme + event shape when
 * credentials exist (docs/payment-setup.md). Until then the endpoint
 * rejects everything — it never fakes success.
 */
import { audit, db, dbInsert, dbSelect, dbUpdate, handleError, json } from "../_shared/helpers.ts";
import { paymentConfirmedEmail } from "../_shared/emails.ts";

interface NormalizedEvent {
  providerEventId: string;
  orderNumber: string;
  outcome: "paid" | "failed" | "refunded";
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyAndNormalize(provider: string, req: Request, rawBody: string): Promise<NormalizedEvent | null> {
  switch (provider) {
    case "israeli-gateway": {
      // TEMPLATE: adjust header name + scheme to the chosen gateway's docs.
      const secret = Deno.env.get("ISRAELI_GATEWAY_WEBHOOK_SECRET");
      if (!secret) return null;
      const signature = req.headers.get("x-signature") ?? "";
      const expected = await hmacSha256Hex(secret, rawBody);
      if (signature !== expected) return null;
      const evt = JSON.parse(rawBody) as { event_id: string; order_reference: string; status: string };
      return {
        providerEventId: evt.event_id,
        orderNumber: evt.order_reference,
        outcome: evt.status === "approved" ? "paid" : evt.status === "refunded" ? "refunded" : "failed",
      };
    }
    case "paypal": {
      // TEMPLATE: PayPal verification uses their /v1/notifications/verify-webhook-signature API.
      const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
      const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
      const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
      if (!webhookId || !clientId || !clientSecret) return null;
      const tokenRes = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      if (!tokenRes.ok) return null;
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const verifyRes = await fetch("https://api-m.paypal.com/v1/notifications/verify-webhook-signature", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "content-type": "application/json" },
        body: JSON.stringify({
          auth_algo: req.headers.get("paypal-auth-algo"),
          cert_url: req.headers.get("paypal-cert-url"),
          transmission_id: req.headers.get("paypal-transmission-id"),
          transmission_sig: req.headers.get("paypal-transmission-sig"),
          transmission_time: req.headers.get("paypal-transmission-time"),
          webhook_id: webhookId,
          webhook_event: JSON.parse(rawBody),
        }),
      });
      const verify = (await verifyRes.json()) as { verification_status?: string };
      if (verify.verification_status !== "SUCCESS") return null;
      const evt = JSON.parse(rawBody) as { id: string; event_type: string; resource?: { custom_id?: string } };
      const orderNumber = evt.resource?.custom_id ?? "";
      if (!orderNumber) return null;
      return {
        providerEventId: evt.id,
        orderNumber,
        outcome: evt.event_type === "PAYMENT.CAPTURE.COMPLETED" ? "paid" : evt.event_type === "PAYMENT.CAPTURE.REFUNDED" ? "refunded" : "failed",
      };
    }
    case "bit":
    case "paybox": {
      // Only with a REAL business integration (spec §14) — template mirrors
      // the israeli-gateway HMAC pattern.
      const secret = Deno.env.get(provider === "bit" ? "BIT_BUSINESS_API_KEY" : "PAYBOX_BUSINESS_API_KEY");
      if (!secret) return null;
      const signature = req.headers.get("x-signature") ?? "";
      const expected = await hmacSha256Hex(secret, rawBody);
      if (signature !== expected) return null;
      const evt = JSON.parse(rawBody) as { event_id: string; order_reference: string; status: string };
      return { providerEventId: evt.event_id, orderNumber: evt.order_reference, outcome: evt.status === "paid" ? "paid" : "failed" };
    }
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const provider = new URL(req.url).searchParams.get("provider") ?? "";
    const rawBody = await req.text();

    const event = await verifyAndNormalize(provider, req, rawBody);
    if (!event) {
      await audit("webhook", "payment_webhook_rejected", provider, "signature/config verification failed");
      return json({ error: "verification_failed" }, 401);
    }

    /* idempotency: unique (provider, provider_event_id) */
    const insertRes = await db("payment_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ provider, provider_event_id: event.providerEventId, order_number: event.orderNumber, payload: JSON.parse(rawBody) }),
    });
    if (insertRes.status === 409) return json({ ok: true, duplicate: true });
    if (!insertRes.ok) throw new Error(`payment_events insert: ${insertRes.status}`);

    const rows = await dbSelect<{ data: Record<string, unknown> }>(`orders?select=data&order_number=eq.${encodeURIComponent(event.orderNumber)}`);
    const order = rows[0]?.data as { paymentStatus: string; fulfillmentStatus: string; tracking: unknown[]; locale: "ar" | "he" | "en"; customer: { email: string } } | undefined;
    if (!order) return json({ error: "order_not_found" }, 404);

    const now = new Date().toISOString();
    if (event.outcome === "paid" && order.paymentStatus !== "paid") {
      order.paymentStatus = "paid";
      order.fulfillmentStatus = "payment_confirmed";
      order.tracking.push({ status: "payment_confirmed", at: now });
      const email = paymentConfirmedEmail(order.locale, event.orderNumber);
      const { sendEmail } = await import("../_shared/helpers.ts");
      await sendEmail(order.customer.email, email.subject, email.html).catch(() => undefined);
    } else if (event.outcome === "failed") {
      order.paymentStatus = "failed";
    } else if (event.outcome === "refunded") {
      order.paymentStatus = "refunded";
      order.fulfillmentStatus = "refunded";
      order.tracking.push({ status: "refunded", at: now });
    }

    await dbUpdate(`orders?order_number=eq.${encodeURIComponent(event.orderNumber)}`, {
      payment_status: order.paymentStatus,
      fulfillment_status: order.fulfillmentStatus,
      data: order,
    });
    await dbInsert("sheets_sync_log", { order_number: event.orderNumber, status: "pending" });
    await audit("webhook", `payment_${event.outcome}`, event.orderNumber, provider);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
});
