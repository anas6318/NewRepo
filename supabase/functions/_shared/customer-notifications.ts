/**
 * Customer order-status emails.
 *
 * One order milestone → at most one email, ever. The decision of WHICH email
 * a status change deserves, and whether it has already gone out, lives here
 * so every trigger (checkout, admin status change, payment webhook) behaves
 * identically.
 *
 * Three promises this module keeps:
 *
 *  1. Idempotent. Delivery is recorded per event on the order itself
 *     (`order.customerEmails`), and an event already marked `sent` is never
 *     sent again — however many times the status is re-saved, and whichever
 *     trigger fires. Several fulfilment statuses can map to the same
 *     customer milestone (`production_started` and `supplier_processing` are
 *     both "processing"); the first one emails, the rest are no-ops.
 *
 *  2. Never breaks the order. Sending happens AFTER the status change is
 *     decided, never throws, and a failure is recorded rather than raised.
 *
 *  3. Retryable and debuggable. Every attempt records status, timestamp,
 *     attempt count, the recipient and the provider's own error text, so a
 *     failure can be understood and re-sent from Admin.
 *
 * Runtime: Deno-targeted but Deno-agnostic (no top-level Deno access,
 * injectable fetch), so tests/unit/customer-notifications.test.ts exercises
 * this exact module under Node.
 */
import { deliverEmail, isSendableAddress, readEmailProviderConfig, readSiteBaseUrl, redactError, type EmailProviderConfig } from "./email-provider.ts";
import { statusUpdateEmail, type CustomerEmailEvent } from "./emails.ts";

export type { CustomerEmailEvent };

/** Every milestone the customer is told about, in lifecycle order. */
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
 * Fulfilment status → customer milestone.
 *
 * Several internal steps deliberately share one customer-facing milestone:
 * the owner may move an order straight from "sent to supplier" to
 * "dispatched", and the customer should get one clear email either way.
 * Statuses absent from this map send NOTHING — `awaiting_supplier_confirmation`,
 * `supplier_unavailable`, `ready_for_pickup` and `issue_reported` are handled
 * by a person, not by an automatic email.
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

/** Payment status → customer milestone, for changes that never touch
 * fulfilment (a refund issued on an already-delivered order, say). */
export const PAYMENT_EVENTS: Record<string, CustomerEmailEvent> = {
  paid: "payment_confirmed",
  cancelled: "cancelled",
  refunded: "refunded",
  partially_refunded: "refunded",
};

export type CustomerEmailStatus = "sent" | "failed" | "disabled";

export interface CustomerEmailRecord {
  status: CustomerEmailStatus;
  /** ISO timestamp of the most recent attempt. */
  at: string;
  /** How many times this event has been attempted, including this one. */
  attempts: number;
  /** Where it was sent — so a wrong address is debuggable from Admin. */
  to?: string;
  /** Provider error, redacted. Present only on `failed`/`disabled`. */
  error?: string;
}

/** Per-order delivery ledger, keyed by milestone. */
export type CustomerEmailLog = Partial<Record<CustomerEmailEvent, CustomerEmailRecord>>;

type Bag = Record<string, unknown>;

export interface CustomerOrderView {
  orderNumber?: string;
  locale?: string;
  customer?: { email?: string };
  totalIls?: number;
  trackingNumber?: string;
  trackingUrl?: string;
  customerEmails?: CustomerEmailLog;
}

export interface CustomerEmailConfig extends EmailProviderConfig {
  /** Storefront base URL for the "track your order" link. May be empty. */
  siteUrl: string;
}

export function readCustomerEmailConfig(): CustomerEmailConfig {
  return { ...readEmailProviderConfig(), siteUrl: readSiteBaseUrl() };
}

/* ── Which email does this change deserve? ─────────────────────────────── */

/**
 * The milestone a status change maps to, or undefined when the change is not
 * one the customer is emailed about. Fulfilment wins over payment: an order
 * moving to `refunded` in both should produce exactly one refund email.
 */
export function eventForStatusChange(change: { fulfillmentStatus?: string; paymentStatus?: string }): CustomerEmailEvent | undefined {
  if (change.fulfillmentStatus && FULFILLMENT_EVENTS[change.fulfillmentStatus]) return FULFILLMENT_EVENTS[change.fulfillmentStatus];
  if (change.paymentStatus && PAYMENT_EVENTS[change.paymentStatus]) return PAYMENT_EVENTS[change.paymentStatus];
  return undefined;
}

/* ── Idempotency ───────────────────────────────────────────────────────── */

/** True once this milestone has been delivered. Failures stay retryable. */
export function alreadySent(order: CustomerOrderView, event: CustomerEmailEvent): boolean {
  return order.customerEmails?.[event]?.status === "sent";
}

/**
 * Whether an attempt should be made now.
 *
 * A `sent` event is final. A `failed` or `disabled` one may be retried — that
 * is the whole point of recording it — so re-saving a status the customer was
 * never actually emailed about will try again.
 */
export function shouldSendCustomerEmail(order: CustomerOrderView, event: CustomerEmailEvent): boolean {
  return !alreadySent(order, event);
}

/** Attempt counter for the next try at this milestone. */
function nextAttempt(order: CustomerOrderView, event: CustomerEmailEvent): number {
  return (order.customerEmails?.[event]?.attempts ?? 0) + 1;
}

/**
 * Writes a record into the order's ledger, creating it if needed. Returns the
 * same order object so callers can persist it in one write.
 */
export function recordCustomerEmail<T extends Bag>(order: T, event: CustomerEmailEvent, record: CustomerEmailRecord): T {
  const log = ((order as Bag).customerEmails as CustomerEmailLog | undefined) ?? {};
  (order as Bag).customerEmails = { ...log, [event]: record };
  return order;
}

/* ── Sending ───────────────────────────────────────────────────────────── */

function localeOf(order: CustomerOrderView): "ar" | "he" | "en" {
  return order.locale === "he" ? "he" : order.locale === "en" ? "en" : "ar";
}

/**
 * Sends one milestone email in the ORDER's own language and returns the
 * record to store. Never throws.
 *
 * Callers must check {@link shouldSendCustomerEmail} first; calling it on an
 * already-sent event is still safe (it short-circuits) but wastes a call.
 */
export async function sendCustomerStatusEmail(
  order: CustomerOrderView,
  event: CustomerEmailEvent,
  config: CustomerEmailConfig = readCustomerEmailConfig(),
  deps: { fetch?: typeof fetch; now?: () => Date; bankInstructions?: string } = {},
): Promise<CustomerEmailRecord> {
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const attempts = nextAttempt(order, event);
  const to = order.customer?.email ?? "";

  try {
    if (alreadySent(order, event)) {
      return order.customerEmails![event]!;
    }
    if (!isSendableAddress(to)) {
      // A guest can reach checkout with a typo'd address; the ORDER is still
      // valid, so this is recorded for staff rather than treated as fatal.
      return { status: "failed", at, attempts, ...(to ? { to } : {}), error: `no usable customer email address (${to ? "invalid" : "missing"})` };
    }

    const built = statusUpdateEmail(localeOf(order), event, {
      orderNumber: order.orderNumber ?? "",
      ...(typeof order.totalIls === "number" ? { totalIls: order.totalIls } : {}),
      ...(deps.bankInstructions ? { bankInstructions: deps.bankInstructions } : {}),
      // Carrier details only when the owner has actually entered them.
      ...(order.trackingNumber ? { trackingNumber: order.trackingNumber } : {}),
      ...(order.trackingUrl ? { trackingUrl: order.trackingUrl } : {}),
      ...(config.siteUrl ? { siteUrl: config.siteUrl } : {}),
    });
    if (!built) {
      return { status: "disabled", at, attempts, to, error: `no template for "${event}"` };
    }

    const outcome = await deliverEmail(
      { provider: config.provider, from: config.from, apiKey: config.apiKey },
      { to, subject: built.subject, html: built.html },
      { ...(deps.fetch ? { fetch: deps.fetch } : {}), label: `customer-email:${event}` },
    );
    return { status: outcome.status, at, attempts, to, ...(outcome.error ? { error: outcome.error } : {}) };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { status: "failed", at, attempts, ...(to ? { to } : {}), error: redactError(message) };
  }
}

/**
 * The whole flow for one order: decide, skip if already delivered, send,
 * record. Returns the record written, or undefined when nothing was due.
 *
 * The caller persists `order` afterwards — this never writes to the database
 * itself, so the status change and its email land in a single update.
 */
export async function deliverStatusEmail<T extends Bag & CustomerOrderView>(
  order: T,
  event: CustomerEmailEvent | undefined,
  config?: CustomerEmailConfig,
  deps: { fetch?: typeof fetch; now?: () => Date; bankInstructions?: string } = {},
): Promise<CustomerEmailRecord | undefined> {
  if (!event) return undefined;
  if (!shouldSendCustomerEmail(order, event)) return undefined;
  const record = await sendCustomerStatusEmail(order, event, config ?? readCustomerEmailConfig(), deps);
  recordCustomerEmail(order, event, record);
  return record;
}

/** Milestones recorded as attempted but not delivered — what a retry sweep
 * would pick up, and what Admin shows as needing attention. */
export function retryableEvents(order: CustomerOrderView): CustomerEmailEvent[] {
  const log = order.customerEmails ?? {};
  return CUSTOMER_EMAIL_EVENTS.filter((event) => {
    const status = log[event]?.status;
    return status === "failed" || status === "disabled";
  });
}
