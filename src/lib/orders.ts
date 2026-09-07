/**
 * Customer-facing order sanitization.
 *
 * ONE place decides what a customer may see of their own order, so the
 * account order history, the guest tracker and the checkout response cannot
 * drift apart — which is exactly how the internal fields ended up visible in
 * `listCustomerOrders` while `trackOrder` stripped them.
 *
 * The rule: an order row is written for the OWNER. It carries supplier
 * references, carrier details, staff decisions and ops bookkeeping alongside
 * the things the customer is entitled to. Everything in the first group is
 * removed here; everything the customer needs to understand and follow their
 * own order stays.
 *
 * The edge functions cannot import from `src/`, so
 * `supabase/functions/_shared/customer-order.ts` mirrors this file and
 * tests/unit/customer-order.test.ts pins the two to the same behaviour.
 */
import { toPublicBadgeSnapshot } from "./badges.ts";
import type { Order } from "../services/types.ts";

/**
 * Order-level fields removed from every customer-facing response.
 * Kept as data so the mirror in the edge functions can be checked against it.
 */
export const CUSTOMER_HIDDEN_ORDER_FIELDS = [
  /** Staff-only working notes. */
  "internalNotes",
  /** The owner's reference with the supplier. */
  "supplierReference",
  /** Carrier details: shown deliberately, by hand, never automatically. */
  "trackingNumber",
  "trackingUrl",
  /** Supplier workflow timestamps — the customer follows `tracking` instead. */
  "productionStartedAt",
  "supplierDispatchedAt",
  /** Owner "new order" email bookkeeping; can carry a provider error. */
  "notification",
] as const;

/**
 * The customer's view of their own order.
 *
 * Kept: order number, dates, status, timeline, items and their prices,
 * totals, delivery, promotion, estimated delivery and any message written
 * for them. Removed: everything in {@link CUSTOMER_HIDDEN_ORDER_FIELDS},
 * the badge snapshot's supplier reference, the staff identity and internal
 * note attached to a supplier decision, and the Sheets error text.
 */
export function toCustomerOrder<T extends Order>(order: T): T {
  const clone: T = { ...order };

  for (const field of CUSTOMER_HIDDEN_ORDER_FIELDS) delete clone[field];

  // Each badge snapshot keeps the owner's supplier reference so they can
  // re-order the patch. The customer sees only the name and what they paid.
  clone.items = order.items.map((item) => (item.badge ? { ...item, badge: toPublicBadgeSnapshot(item.badge) } : item));

  // The customer legitimately needs to know their order is held for a
  // supplier check and how that ended — not which member of staff decided
  // it, when, or what they wrote internally.
  if (order.supplierConfirmation) {
    clone.supplierConfirmation = {
      required: order.supplierConfirmation.required,
      status: order.supplierConfirmation.status,
      ...(order.supplierConfirmation.items ? { items: order.supplierConfirmation.items } : {}),
    };
  }

  // Ops bookkeeping. The state is harmless; `error` is a raw third-party
  // message and `lastAttemptAt` is internal timing, so only the state stays.
  clone.sheetsSync = { status: order.sheetsSync.status };

  return clone;
}
