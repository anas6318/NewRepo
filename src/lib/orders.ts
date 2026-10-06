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
import type { Order } from "../services/types.ts";
import { FULFILLMENT_FLOW, type FulfillmentStatus, type JerseyVersion, type Product } from "../services/types.ts";
import { requiresSupplierConfirmation, resolveAvailability } from "../services/sizing.ts";

/**
 * ALLOWLIST: the only order-level keys a customer ever receives. Anything
 * else stored on an order — the internal fields below, and any key added
 * later by an admin patch, idempotency bookkeeping or a provider
 * integration — is dropped by default instead of leaking by default.
 * Mirrored in supabase/functions/_shared/customer-order.ts.
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
 * Order-level fields known to be internal. The allowlist above is what
 * enforces privacy; this list documents the known internal fields and is
 * pinned by tests so none of them can ever be added to the allowlist.
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
  /** Customer email ledger: provider errors and attempt counts are ops data,
   * and the customer already has the emails themselves. */
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
 * The customer's view of their own order.
 *
 * Kept (allowlist): order number, dates, status, timeline, items and their
 * prices, totals, delivery, promotion, estimated delivery and any message
 * written for them. Everything else is removed — including everything in
 * {@link CUSTOMER_HIDDEN_ORDER_FIELDS}, the badge snapshot's supplier
 * reference, the staff identity and internal note attached to a supplier
 * decision, and the Sheets error text.
 */
export function toCustomerOrder<T extends Order>(order: T): T {
  const clone = pick(order as unknown as Bag, CUSTOMER_ORDER_KEYS);

  if (isBag(clone.customer)) clone.customer = pick(clone.customer, CUSTOMER_CONTACT_KEYS);

  // Each line keeps the customer's own purchase record. The badge snapshot
  // keeps the owner's supplier reference so they can re-order the patch; the
  // customer sees only the name and what they paid.
  if (Array.isArray(clone.items)) {
    clone.items = (clone.items as unknown[]).map((raw) => {
      if (!isBag(raw)) return raw;
      const item = pick(raw, CUSTOMER_ORDER_ITEM_KEYS);
      if (isBag(item.badge)) item.badge = pick(item.badge, CUSTOMER_BADGE_KEYS);
      return item;
    });
  }

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
  if (order.sheetsSync) clone.sheetsSync = { status: order.sheetsSync.status };

  return clone as unknown as T;
}

/* ── Customer-facing tracking timeline ──────────────────────────────────── */

/**
 * The steps a customer is shown for one order, in the order they really
 * happen.
 *
 * Two optional steps get woven into {@link FULFILLMENT_FLOW}:
 *
 *  • `awaiting_supplier_confirmation` — only when the order is held for a
 *    supplier check.
 *  • `awaiting_payment` — only for bank transfer, where the customer has to
 *    go and do something.
 *
 * When BOTH apply, the supplier check must come FIRST. CROWNED does not ask
 * anyone to transfer money for a shirt whose availability is still unknown,
 * and the timeline has to say so. The previous implementation spliced each
 * step in at index 1 independently, so whichever was inserted last ended up
 * first and bank-transfer orders showed "Awaiting payment" ahead of
 * "Awaiting supplier confirmation" — the opposite of the real process.
 *
 * Orders that need neither are unaffected: the result is FULFILLMENT_FLOW.
 */
export function customerTimeline(order: {
  paymentMethod?: string;
  supplierConfirmation?: { required?: boolean } | undefined;
}): FulfillmentStatus[] {
  const [first, ...rest] = FULFILLMENT_FLOW;
  const middle: FulfillmentStatus[] = [];
  if (order.supplierConfirmation?.required) middle.push("awaiting_supplier_confirmation");
  if (order.paymentMethod === "bank_transfer") middle.push("awaiting_payment");
  return [first!, ...middle, ...rest];
}

/* ── Supplier confirmation, for the cart ────────────────────────────────── */

/**
 * Whether any line in this cart will make the order wait for a supplier
 * check — the SAME question `place-order` answers server-side when it decides
 * to set `supplierConfirmation.required`.
 *
 * Resolved live from the products' own availability records through the
 * existing {@link resolveAvailability} / {@link requiresSupplierConfirmation}
 * rules, rather than from a flag snapshotted into the cart line. A snapshot
 * would go stale the moment the owner confirms availability, and the customer
 * would be told the wrong thing at the worst possible moment — the payment
 * step.
 *
 * Checkout uses this to decide whether bank-transfer INSTRUCTIONS may be
 * shown. CROWNED's flow is: order received → supplier confirms → customer
 * pays. Printing account details before the shirt is known to be obtainable
 * invites someone to transfer money for something that may not exist.
 */
export function cartNeedsSupplierConfirmation(
  lines: readonly { slug: string; version?: JerseyVersion; size: string }[],
  products: readonly Product[],
): boolean {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  return lines.some((line) => {
    const product = bySlug.get(line.slug);
    // An unknown product is not evidence of availability. Withholding payment
    // details is the safe direction to fail in.
    if (!product) return true;
    return requiresSupplierConfirmation(resolveAvailability(product, line.version, line.size || undefined).status);
  });
}
