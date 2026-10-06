/**
 * my-orders — a signed-in customer's own order history, sanitized on the
 * server (A2-S1).
 *
 * Migration 0007 removes the customer arm of the `orders` read policy, so a
 * browser can no longer fetch raw `orders.data` (internal notes, supplier
 * references, carrier details, provider errors …) over PostgREST. This
 * function is the replacement: it resolves the caller from their JWT, reads
 * ONLY that user's rows with the service role, and returns each one through
 * the same allowlist sanitizer as checkout and guest tracking.
 *
 * The customer id is never taken from the request body — only from the
 * verified session — so one customer cannot ask for another's orders.
 */
import { callerProfile, dbSelect, handleError, HttpError, json, preflight } from "../_shared/helpers.ts";
import { toCustomerOrderData } from "../_shared/customer-order.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    // Anonymous / invalid / expired tokens resolve to null.
    const profile = await callerProfile(req);
    if (!profile) throw new HttpError(401, "unauthorized");

    const rows = await dbSelect<{ data: Record<string, unknown> }>(
      `orders?select=data&customer_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc`,
    );

    return json({ orders: rows.map((row) => toCustomerOrderData(row.data)) });
  } catch (err) {
    return handleError(err);
  }
});
