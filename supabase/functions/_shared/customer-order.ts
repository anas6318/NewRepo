/**
 * Customer-facing order sanitization for the edge functions.
 *
 * Mirror of src/lib/orders.ts — edge functions cannot import from `src/`, so
 * the two are kept in step by tests/unit/customer-order.test.ts, which runs
 * BOTH over the same fixture and requires identical output. Change one, and
 * that test tells you to change the other.
 *
 * Used by place-order (the checkout response), track-order (guest tracking)
 * and my-orders (account history) so a customer meets the same rules on
 * every route.
 */

/**
 * ALLOWLIST: the only order-level keys a customer ever receives. Anything
 * else stored on an order (today's internal fields, and any key added later
 * by an admin patch, idempotency bookkeeping, a provider integration …) is
 * dropped by default. Keep in step with src/lib/orders.ts.
 */
export const CUSTOMER_ORDER_KEYS = [
  "id",
  "orderNumber",
  "createdAt",
  "locale",
  "customer",
  "items",
  "subtotalIls",
  "promotion",
  "promotionDiscountIls",
  "deliveryIls",
  "freeDelivery",
  "totalIls",
  "zoneId",
  "paymentMethod",
  "paymentStatus",
  "fulfillmentStatus",
  "tracking",
  "estimatedDeliveryAt",
  "supplierConfirmation",
  "customerVisibleMessage",
  "sheetsSync",
  "isDemo",
] as const;

/** Per-line keys the customer receives (their own purchase record). */
export const CUSTOMER_ORDER_ITEM_KEYS = [
  "productId",
  "slug",
  "categorySlug",
  "title",
  "image",
  "version",
  "sleeve",
  "size",
  "personalization",
  "badge",
  "price",
  "patchId",
  "patchName",
  "unitPriceIls",
  "quantity",
  "lineTotalIls",
] as const;

/** The customer's own contact block, as they entered it at checkout. */
export const CUSTOMER_CONTACT_KEYS = ["name", "email", "phone", "city", "address", "notes", "customerId"] as const;

/** Badge snapshot keys the customer sees: what it was and what they paid. */
export const CUSTOMER_BADGE_KEYS = ["badgeId", "code", "name", "label", "priceIls"] as const;

/**
 * Order-level fields known to be internal. No longer the mechanism (the
 * allowlist above is), but kept as documentation and as a test fixture: none
 * of these may ever appear in the allowlist.
 */
export const CUSTOMER_HIDDEN_ORDER_FIELDS = [
  "internalNotes",
  "supplierReference",
  "trackingNumber",
  "trackingUrl",
  "productionStartedAt",
  "supplierDispatchedAt",
  "notification",
  "customerEmails",
] as const;

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);

/** Copies only the listed keys that are actually present. */
function pick(source: Bag, keys: readonly string[]): Bag {
  const out: Bag = {};
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  return out;
}

/**
 * Returns a copy of the stored order data carrying only what the customer is
 * entitled to. Purely structural — it never assumes a field is present, so a
 * partially-shaped or legacy order still sanitizes cleanly.
 */
export function toCustomerOrderData(order: Bag): Bag {
  const clone = pick(order, CUSTOMER_ORDER_KEYS);

  if (isBag(clone.customer)) clone.customer = pick(clone.customer, CUSTOMER_CONTACT_KEYS);

  // Each line keeps the customer's own purchase record; the badge snapshot
  // loses the owner's supplier reference (and anything else internal).
  if (Array.isArray(clone.items)) {
    clone.items = (clone.items as unknown[]).map((raw) => {
      if (!isBag(raw)) return raw;
      const item = pick(raw, CUSTOMER_ORDER_ITEM_KEYS);
      if (isBag(item.badge)) item.badge = pick(item.badge, CUSTOMER_BADGE_KEYS);
      return item;
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
