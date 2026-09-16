/**
 * Which order milestones the customer is emailed about, and whether a given
 * milestone has already gone out.
 *
 * The mapping itself is the contract: several internal fulfilment statuses
 * deliberately collapse onto one customer-facing milestone, so an owner who
 * skips a step still produces exactly one clear email, and an owner who
 * re-saves a status produces none.
 *
 * Edge functions cannot import from `src/`, so
 * `supabase/functions/_shared/customer-notifications.ts` mirrors this map and
 * tests/unit/customer-notifications.test.ts requires the two to be identical.
 */
import type { CustomerEmailEvent, CustomerEmailLog, CustomerEmailRecord, Order } from "../services/types.ts";

/** Every milestone the customer hears about, in lifecycle order. */
export const CUSTOMER_EMAIL_EVENTS: CustomerEmailEvent[] = [
  "order_received",
  "payment_confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
];

/**
 * Fulfilment status → milestone.
 *
 * Statuses missing from this map send nothing on purpose:
 * `awaiting_supplier_confirmation`, `supplier_unavailable`,
 * `ready_for_pickup` and `issue_reported` are conversations a person has, not
 * an automatic email.
 */
export const FULFILLMENT_EVENTS: Record<string, CustomerEmailEvent> = {
  order_received: "order_received",
  payment_confirmed: "payment_confirmed",
  sent_to_supplier: "processing",
  production_started: "processing",
  supplier_processing: "processing",
  quality_inspection: "processing",
  supplier_dispatched: "shipped",
  in_transit: "shipped",
  arrived_locally: "shipped",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  cancelled: "cancelled",
  refunded: "refunded",
};

/** Payment status → milestone, for changes that never touch fulfilment. */
export const PAYMENT_EVENTS: Record<string, CustomerEmailEvent> = {
  paid: "payment_confirmed",
  cancelled: "cancelled",
  refunded: "refunded",
  partially_refunded: "refunded",
};

/** Admin-facing names. The admin surface of this store is English. */
export const CUSTOMER_EMAIL_EVENT_LABEL: Record<CustomerEmailEvent, string> = {
  order_received: "Order received",
  payment_confirmed: "Payment confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** The milestone a status change deserves, or undefined for none.
 * Fulfilment wins over payment so a change that moves both produces one
 * email, not two. */
export function eventForStatusChange(change: { fulfillmentStatus?: string; paymentStatus?: string }): CustomerEmailEvent | undefined {
  if (change.fulfillmentStatus && FULFILLMENT_EVENTS[change.fulfillmentStatus]) return FULFILLMENT_EVENTS[change.fulfillmentStatus];
  if (change.paymentStatus && PAYMENT_EVENTS[change.paymentStatus]) return PAYMENT_EVENTS[change.paymentStatus];
  return undefined;
}

/** Delivered milestones are final; failures stay retryable. */
export function alreadySent(order: Pick<Order, "customerEmails">, event: CustomerEmailEvent): boolean {
  return order.customerEmails?.[event]?.status === "sent";
}

export function shouldSendCustomerEmail(order: Pick<Order, "customerEmails">, event: CustomerEmailEvent): boolean {
  return !alreadySent(order, event);
}

/** Attempts recorded so far for a milestone, plus the one about to happen. */
export function nextAttempt(order: Pick<Order, "customerEmails">, event: CustomerEmailEvent): number {
  return (order.customerEmails?.[event]?.attempts ?? 0) + 1;
}

/** Writes one milestone's record, leaving the rest of the ledger alone. */
export function recordCustomerEmail(log: CustomerEmailLog | undefined, event: CustomerEmailEvent, record: CustomerEmailRecord): CustomerEmailLog {
  return { ...(log ?? {}), [event]: record };
}

/** Milestones attempted but not delivered — what Admin flags and what a
 * retry picks up. */
export function retryableEvents(order: Pick<Order, "customerEmails">): CustomerEmailEvent[] {
  const log = order.customerEmails ?? {};
  return CUSTOMER_EMAIL_EVENTS.filter((event) => {
    const status = log[event]?.status;
    return status === "failed" || status === "disabled";
  });
}
