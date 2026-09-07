/**
 * Customer-facing order sanitization for the edge functions.
 *
 * Mirror of src/lib/orders.ts — edge functions cannot import from `src/`, so
 * the two are kept in step by tests/unit/customer-order.test.ts, which runs
 * BOTH over the same fixture and requires identical output. Change one, and
 * that test tells you to change the other.
 *
 * Used by place-order (the checkout response) and track-order (guest
 * tracking) so a customer meets the same rules on every route.
 */

/** Order-level fields removed from every customer-facing response. */
export const CUSTOMER_HIDDEN_ORDER_FIELDS = [
  "internalNotes",
  "supplierReference",
  "trackingNumber",
  "trackingUrl",
  "productionStartedAt",
  "supplierDispatchedAt",
  "notification",
] as const;

type Bag = Record<string, unknown>;

/**
 * Returns a copy of the stored order data carrying only what the customer is
 * entitled to. Purely structural — it never assumes a field is present, so a
 * partially-shaped or legacy order still sanitizes cleanly.
 */
export function toCustomerOrderData(order: Bag): Bag {
  const clone: Bag = { ...order };

  for (const field of CUSTOMER_HIDDEN_ORDER_FIELDS) delete clone[field];

  // The badge snapshot keeps the owner's supplier reference for re-ordering;
  // the customer sees only the badge name and what they paid for it.
  if (Array.isArray(clone.items)) {
    clone.items = (clone.items as Bag[]).map((item) => {
      const badge = item.badge as Bag | undefined;
      if (!badge) return item;
      const publicBadge: Bag = { ...badge };
      delete publicBadge.supplierReference;
      return { ...item, badge: publicBadge };
    });
  }

  // That the order is held for a supplier check, and how that ended — never
  // who decided it, when, or the internal note they left.
  const confirmation = clone.supplierConfirmation as Bag | undefined;
  if (confirmation) {
    clone.supplierConfirmation = {
      required: confirmation.required,
      status: confirmation.status,
      ...(confirmation.items ? { items: confirmation.items } : {}),
    };
  }

  // Ops bookkeeping: keep the state, drop the raw provider error and the
  // internal attempt timing.
  const sheets = clone.sheetsSync as Bag | undefined;
  if (sheets) clone.sheetsSync = { status: sheets.status };

  return clone;
}
