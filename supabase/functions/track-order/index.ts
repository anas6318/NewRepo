/**
 * track-order — guest tracking with anti-enumeration (spec §16).
 * Requires order number + matching email/phone (constant-time hash compare).
 * Every failure returns the same generic null result.
 */
import { contactHash, constantTimeEqual, dbSelect, handleError, json, preflight } from "../_shared/helpers.ts";
import { toCustomerOrderData } from "../_shared/customer-order.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const { orderNumber, contact } = (await req.json()) as { orderNumber?: string; contact?: string };
    if (!orderNumber?.trim() || !contact || contact.trim().length < 4) return json({ order: null }, 404);

    const rows = await dbSelect<{ contact_hash: string; data: { customer: { phone: string } } }>(
      `orders?select=contact_hash,data&order_number=eq.${encodeURIComponent(orderNumber.trim().toUpperCase())}`,
    );
    const row = rows[0];
    if (!row) return json({ order: null }, 404);

    const emailHash = await contactHash(contact);
    const phoneHash = await contactHash(row.data.customer.phone ?? "");
    const contactAsPhoneHash = await contactHash(contact);

    const matches = constantTimeEqual(emailHash, row.contact_hash) || constantTimeEqual(contactAsPhoneHash, phoneHash);
    if (!matches) return json({ order: null }, 404);

    // One shared rule for every customer-facing order response: supplier
    // references, carrier details, staff decisions and ops bookkeeping are
    // removed; the clean CROWNED timeline and the customer's own order data
    // stay. Same helper as the checkout response in place-order.
    return json({ order: toCustomerOrderData(row.data as Record<string, unknown>) });
  } catch (err) {
    console.error("[track-order]", err);
    return handleError(new Error("not_found"));
  }
});
