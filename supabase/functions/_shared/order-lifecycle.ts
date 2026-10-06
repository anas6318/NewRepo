/**
 * Order lifecycle — the ONE place that decides whether a staff change to an
 * order is allowed, what else it implies, and which customer email (if any)
 * it deserves. Used by admin-actions `update-order` (production) and by the
 * demo data service (so e2e and browser QA exercise the same rules).
 *
 * Pure: no Deno, no database, no clock (the caller passes `nowIso`). Safe to
 * import from `src/` (precedent: `_shared/zones.ts`) and from Node tests.
 *
 * ── Why this exists (A2-S4, A2-B3, A2-B13, audit §9) ──────────────────────
 * Before this module, any staff role could mass-assign any key onto an order
 * (`Object.assign(order, patch)`), set any status string, mark an order paid
 * with no check, and confirming supplier availability on an UNPAID non-bank
 * order moved it to `payment_confirmed` — emailing "your payment is
 * confirmed" without any payment.
 *
 * ── Roles ────────────────────────────────────────────────────────────────
 *   owner, admin, order_manager  → may update orders (incl. paid / refunds)
 *   content_manager, customer    → may NOT update orders at all (403)
 *   owner, admin                 → may save promotions and badge prices
 * Role names: supabase/migrations/0001_schema.sql:15, helpers.ts requireStaff.
 *
 * ── Patch allowlist ──────────────────────────────────────────────────────
 * Only UPDATE_ORDER_PATCH_KEYS may appear in a patch; anything else (totals,
 * items, customer, customerEmails, tracking, …) is refused with
 * `invalid_patch_key`. From `supplierConfirmation` only `status` and `note`
 * are read — the other fields the Admin UI echoes back are ignored, never
 * assigned. `decidedBy`/`decidedAt` are always set here from the caller.
 *
 * ── Fulfillment transition matrix (from → allowed to) ────────────────────
 *   order_received                 → awaiting_payment, payment_confirmed, PRODUCTION,
 *                                    supplier_unavailable, issue_reported, cancelled
 *   awaiting_supplier_confirmation → awaiting_payment, payment_confirmed, PRODUCTION,
 *                                    supplier_unavailable, issue_reported, cancelled
 *   awaiting_payment               → payment_confirmed, PRODUCTION,
 *                                    supplier_unavailable, issue_reported, cancelled
 *   payment_confirmed              → PRODUCTION, supplier_unavailable, issue_reported,
 *                                    cancelled, refunded
 *   PRODUCTION (sent_to_supplier, production_started, supplier_processing,
 *     quality_inspection)          → any PRODUCTION, any SHIPPING, supplier_unavailable,
 *                                    issue_reported, cancelled, refunded
 *   SHIPPING (supplier_dispatched < in_transit < arrived_locally <
 *     ready_for_pickup ≈ out_for_delivery)
 *                                  → a LATER shipping step, delivered, issue_reported, refunded
 *   delivered                      → issue_reported, refunded
 *   issue_reported                 → payment_confirmed, PRODUCTION, SHIPPING*, delivered*,
 *                                    cancelled, refunded   (*only if the order had
 *                                    already reached production / shipping)
 *   supplier_unavailable           → cancelled, refunded   (terminal-ish)
 *   cancelled                      → refunded
 *   refunded                       → (terminal)
 *   `awaiting_supplier_confirmation` and `order_received` are initial states
 *   only (set by place-order); nothing moves INTO them.
 *   Same-state writes are no-ops: no tracking entry, no email.
 *
 * Gates on the RESULTING state (applied on top of the matrix):
 *   • payment_confirmed / PRODUCTION / SHIPPING / delivered need payment
 *     `paid` (or `partially_refunded`) AND supplier confirmation `confirmed`
 *     when one is required. There is no pay-later method in this store
 *     (PaymentMethodId: bank_transfer, card, bit, paybox, paypal), so nothing
 *     is produced or shipped unpaid.
 *   • awaiting_payment needs supplier confirmation settled (confirmed / not
 *     required) and payment not already taken.
 *   • cancelled on a `paid`/`partially_refunded` order is refused: move the
 *     payment to `under_review` (refund pending) or `refunded` first — a paid
 *     order is never silently cancelled. Cancelling an unpaid order also
 *     cancels its payment (pending/awaiting_payment/authorized/failed).
 *   • refunded needs money to have been taken (payment is/was `paid`); a
 *     `paid`/`partially_refunded`/`under_review` payment moves to `refunded`
 *     with it.
 *
 * ── Payment transition matrix ────────────────────────────────────────────
 *   pending            → awaiting_payment, authorized, paid, failed, cancelled, under_review
 *   awaiting_payment   → authorized, paid, failed, cancelled, under_review
 *   authorized         → paid, failed, cancelled, under_review
 *   failed             → pending, awaiting_payment, authorized, paid, cancelled, under_review
 *   under_review       → awaiting_payment, paid, failed, cancelled, refunded†, partially_refunded†
 *   paid               → under_review, refunded, partially_refunded
 *   partially_refunded → refunded, under_review
 *   cancelled          → under_review   (a late transfer arrives; resolve it)
 *   refunded           → (terminal)
 *   † only when the order was actually paid at some point (refund before paid
 *     is refused). `paid` never goes back to failed/pending/cancelled.
 *
 * ── Implied changes and emails ───────────────────────────────────────────
 *   Supplier CONFIRMED (from pending): fulfillment → payment_confirmed if the
 *     order is already paid, otherwise → awaiting_payment for EVERY payment
 *     method (A2-B3), and the customer gets the `supplier_confirmed` email —
 *     which carries bank-transfer instructions for bank_transfer orders
 *     (A2-B5). Never "payment confirmed" unless payment is actually `paid`.
 *   Supplier REJECTED: fulfillment → supplier_unavailable (a person follows
 *     up; no automatic email).
 *   Payment → paid: an order waiting in order_received/awaiting_payment with
 *     a settled supplier check advances to payment_confirmed (one "payment
 *     confirmed" email). An order still HELD for the supplier records the
 *     payment only — fulfillment stays held and no "moving to preparation"
 *     email goes out (A2-B13).
 *   Every payment change appends `paymentHistory` {from,to,at,by} (internal:
 *   not in the customer allowlist) and is in the audit before/after.
 */

/* ── enumerations (mirror src/services/types.ts PaymentStatus / FulfillmentStatus) ── */

export const PAYMENT_STATUSES = [
  "pending",
  "awaiting_payment",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
  "under_review",
] as const;
export type LifecyclePaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  "order_received",
  "awaiting_supplier_confirmation",
  "supplier_unavailable",
  "awaiting_payment",
  "payment_confirmed",
  "sent_to_supplier",
  "production_started",
  "supplier_processing",
  "quality_inspection",
  "supplier_dispatched",
  "in_transit",
  "arrived_locally",
  "ready_for_pickup",
  "out_for_delivery",
  "delivered",
  "issue_reported",
  "cancelled",
  "refunded",
] as const;
export type LifecycleFulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const SUPPLIER_DECISIONS = ["confirmed", "rejected"] as const;

const PRE_PAYMENT: readonly string[] = ["order_received", "awaiting_supplier_confirmation", "awaiting_payment"];
export const PRODUCTION_STATUSES: readonly string[] = ["sent_to_supplier", "production_started", "supplier_processing", "quality_inspection"];
export const SHIPPING_STATUSES: readonly string[] = ["supplier_dispatched", "in_transit", "arrived_locally", "ready_for_pickup", "out_for_delivery"];
const SHIPPING_RANK: Record<string, number> = {
  supplier_dispatched: 1,
  in_transit: 2,
  arrived_locally: 3,
  ready_for_pickup: 4,
  out_for_delivery: 4,
};
/** Money has been taken and not (fully) returned. */
const PAID_LIKE: readonly string[] = ["paid", "partially_refunded"];
/** Unpaid payment states that simply end when the order is cancelled. */
const UNPAID_CANCELLABLE: readonly string[] = ["pending", "awaiting_payment", "authorized", "failed"];

export const isPaymentStatus = (v: unknown): v is LifecyclePaymentStatus => typeof v === "string" && (PAYMENT_STATUSES as readonly string[]).includes(v);
export const isFulfillmentStatus = (v: unknown): v is LifecycleFulfillmentStatus =>
  typeof v === "string" && (FULFILLMENT_STATUSES as readonly string[]).includes(v);

/* ── roles ─────────────────────────────────────────────────────────────── */

/** Roles that may change orders at all (status, tracking, notes, supplier). */
export const ORDER_ROLES = ["owner", "admin", "order_manager"] as const;
/** Payment states that move money; only these roles may set them. */
export const MONEY_PAYMENT_STATUSES = ["paid", "refunded", "partially_refunded"] as const;
export const MONEY_ROLES = ["owner", "admin", "order_manager"] as const;
/** Roles that may save promotions and badge prices (a 100% promotion is a pricing decision). */
export const PRICING_ROLES = ["owner", "admin"] as const;

export function canUpdateOrders(role: string | undefined): boolean {
  return (ORDER_ROLES as readonly string[]).includes(role ?? "");
}

export function canSetPaymentStatus(role: string | undefined, to: string): boolean {
  if (!canUpdateOrders(role)) return false;
  if ((MONEY_PAYMENT_STATUSES as readonly string[]).includes(to)) return (MONEY_ROLES as readonly string[]).includes(role ?? "");
  return true;
}

export function canManagePricing(role: string | undefined): boolean {
  return (PRICING_ROLES as readonly string[]).includes(role ?? "");
}

/* ── patch allowlist ───────────────────────────────────────────────────── */

/**
 * Keys a staff update may carry. Matches what src/pages/admin/AdminOrders.tsx
 * sends through DataService.adminUpdateOrder (paymentStatus, fulfillmentStatus,
 * supplierReference, trackingNumber, trackingUrl, estimatedDeliveryAt,
 * internalNotes, supplierConfirmation) plus customerVisibleMessage, which the
 * customer allowlist already exposes.
 */
export const UPDATE_ORDER_PATCH_KEYS = [
  "paymentStatus",
  "fulfillmentStatus",
  "trackingNumber",
  "trackingUrl",
  "internalNotes",
  "supplierReference",
  "estimatedDeliveryAt",
  "customerVisibleMessage",
  "supplierConfirmation",
] as const;

const TEXT_LIMITS: Record<string, number> = {
  trackingNumber: 100,
  trackingUrl: 500,
  internalNotes: 5000,
  supplierReference: 200,
  estimatedDeliveryAt: 40,
};
const MESSAGE_LIMIT = 1000;
const SUPPLIER_NOTE_LIMIT = 2000;

/* ── transition checks ─────────────────────────────────────────────────── */

export type TransitionResult = { ok: true; noop: boolean } | { ok: false; reason: string };

const PAYMENT_TRANSITIONS: Record<LifecyclePaymentStatus, readonly LifecyclePaymentStatus[]> = {
  pending: ["awaiting_payment", "authorized", "paid", "failed", "cancelled", "under_review"],
  awaiting_payment: ["authorized", "paid", "failed", "cancelled", "under_review"],
  authorized: ["paid", "failed", "cancelled", "under_review"],
  failed: ["pending", "awaiting_payment", "authorized", "paid", "cancelled", "under_review"],
  under_review: ["awaiting_payment", "paid", "failed", "cancelled", "refunded", "partially_refunded"],
  paid: ["under_review", "refunded", "partially_refunded"],
  partially_refunded: ["refunded", "under_review"],
  cancelled: ["under_review"],
  refunded: [],
};

export function canTransitionPayment(from: string, to: string, ctx: { everPaid?: boolean } = {}): TransitionResult {
  if (!isPaymentStatus(to)) return { ok: false, reason: "invalid_payment_status" };
  if (from === to) return { ok: true, noop: true };
  // An unknown legacy value may move to anything valid except a refund
  // (there is no evidence money was taken).
  const allowed = isPaymentStatus(from) ? PAYMENT_TRANSITIONS[from] : PAYMENT_STATUSES.filter((s) => s !== "refunded" && s !== "partially_refunded");
  if (!allowed.includes(to)) return { ok: false, reason: from === "refunded" ? "payment_refunded_is_final" : "payment_transition_not_allowed" };
  if ((to === "refunded" || to === "partially_refunded") && !PAID_LIKE.includes(from) && !ctx.everPaid) {
    return { ok: false, reason: "refund_requires_payment" };
  }
  return { ok: true, noop: false };
}

export interface FulfillmentContext {
  /** Payment status the order will have AFTER this update. */
  paymentStatus: string;
  /** Supplier confirmation the order will have AFTER this update. */
  supplier?: { required?: boolean; status?: string } | undefined;
  /** Whether payment was ever `paid` (history or current). */
  everPaid?: boolean;
  /** Fulfillment statuses already reached (from the tracking timeline). */
  reached?: readonly string[];
}

function supplierSettled(s: FulfillmentContext["supplier"]): boolean {
  return !s?.required || s.status === "confirmed";
}

function matrixAllows(from: string, to: string, reached: readonly string[]): boolean {
  const production = PRODUCTION_STATUSES.includes(to);
  const shipping = SHIPPING_STATUSES.includes(to);
  if (PRE_PAYMENT.includes(from)) {
    return ["awaiting_payment", "payment_confirmed", "supplier_unavailable", "issue_reported", "cancelled"].includes(to) || production;
  }
  if (from === "payment_confirmed") return production || ["supplier_unavailable", "issue_reported", "cancelled", "refunded"].includes(to);
  if (PRODUCTION_STATUSES.includes(from)) return production || shipping || ["supplier_unavailable", "issue_reported", "cancelled", "refunded"].includes(to);
  if (SHIPPING_STATUSES.includes(from)) {
    if (shipping) return (SHIPPING_RANK[to] ?? 0) > (SHIPPING_RANK[from] ?? 0) || (SHIPPING_RANK[to] === 4 && SHIPPING_RANK[from] === 4);
    return ["delivered", "issue_reported", "refunded"].includes(to);
  }
  if (from === "delivered") return ["issue_reported", "refunded"].includes(to);
  if (from === "issue_reported") {
    const wasProduced = reached.some((s) => PRODUCTION_STATUSES.includes(s) || SHIPPING_STATUSES.includes(s) || s === "delivered");
    const wasShipped = reached.some((s) => SHIPPING_STATUSES.includes(s) || s === "delivered");
    if (production || to === "payment_confirmed" || to === "cancelled" || to === "refunded") return true;
    if (shipping) return wasProduced;
    if (to === "delivered") return wasShipped;
    return false;
  }
  if (from === "supplier_unavailable") return to === "cancelled" || to === "refunded";
  if (from === "cancelled") return to === "refunded";
  if (from === "refunded") return false;
  // Unknown legacy value: allow only the exits.
  return ["issue_reported", "cancelled"].includes(to);
}

export function canTransitionFulfillment(from: string, to: string, ctx: FulfillmentContext): TransitionResult {
  if (!isFulfillmentStatus(to)) return { ok: false, reason: "invalid_fulfillment_status" };
  if (from === to) return { ok: true, noop: true };
  if (to === "order_received" || to === "awaiting_supplier_confirmation") return { ok: false, reason: "initial_state_only" };
  if (!matrixAllows(from, to, ctx.reached ?? [])) return { ok: false, reason: from === "refunded" ? "fulfillment_refunded_is_final" : "fulfillment_transition_not_allowed" };

  const advancing = to === "payment_confirmed" || PRODUCTION_STATUSES.includes(to) || SHIPPING_STATUSES.includes(to) || to === "delivered";
  if (advancing) {
    if (!supplierSettled(ctx.supplier)) return { ok: false, reason: "supplier_not_confirmed" };
    if (!PAID_LIKE.includes(ctx.paymentStatus)) return { ok: false, reason: "payment_not_confirmed" };
  }
  if (to === "awaiting_payment") {
    if (!supplierSettled(ctx.supplier)) return { ok: false, reason: "supplier_not_confirmed" };
    if ([...PAID_LIKE, "refunded", "cancelled"].includes(ctx.paymentStatus)) return { ok: false, reason: "payment_already_settled" };
  }
  if (to === "cancelled" && PAID_LIKE.includes(ctx.paymentStatus)) return { ok: false, reason: "cancel_paid_requires_refund_state" };
  if (to === "refunded" && !ctx.everPaid && !PAID_LIKE.includes(ctx.paymentStatus) && ctx.paymentStatus !== "refunded") {
    return { ok: false, reason: "refund_requires_payment" };
  }
  return { ok: true, noop: false };
}

/* ── the update planner ────────────────────────────────────────────────── */

export interface LifecycleOrder {
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentMethod?: string;
  tracking?: { status: string; at: string }[];
  supplierConfirmation?: { required?: boolean; status?: string; note?: string; [k: string]: unknown };
  paymentHistory?: PaymentHistoryEntry[];
  [k: string]: unknown;
}

export interface PaymentHistoryEntry {
  from: string;
  to: string;
  at: string;
  by: string;
}

export interface LifecycleActor {
  email: string;
  role: string;
}

export interface UpdateOrderError {
  ok: false;
  status: 400 | 403;
  error: string;
  detail?: string;
}

export interface UpdateOrderPlan {
  ok: true;
  /** Nothing changes: no write, no email, no tracking entry. */
  noop: boolean;
  /** ONLY the changed top-level `data` keys — what patch_order_data merges. */
  dataPatch: Record<string, unknown>;
  /** New status column values, when they change. */
  paymentStatus?: string;
  fulfillmentStatus?: string;
  /** Status change to map to a customer milestone (eventForStatusChange). */
  emailChange: { fulfillmentStatus?: string; paymentStatus?: string };
  /** A lifecycle-specific milestone that takes precedence over emailChange. */
  specialEmail?: "supplier_confirmed";
  supplierDecision?: "confirmed" | "rejected";
  /** Audit trail: before/after for every changed key. */
  changes: { key: string; before: unknown; after: unknown }[];
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function refuse(status: 400 | 403, error: string, detail?: string): UpdateOrderError {
  return { ok: false, status, error, ...(detail ? { detail } : {}) };
}

/** Whether this order has ever been paid (current state or history). */
export function orderEverPaid(order: Pick<LifecycleOrder, "paymentStatus" | "paymentHistory">): boolean {
  return (
    PAID_LIKE.includes(order.paymentStatus) ||
    order.paymentStatus === "refunded" ||
    (order.paymentHistory ?? []).some((e) => PAID_LIKE.includes(e.to) || PAID_LIKE.includes(e.from))
  );
}

/** Held for a supplier check that has not been answered yet. */
export function isHeldForSupplier(order: { fulfillmentStatus?: string; supplierConfirmation?: { required?: boolean; status?: string } | undefined }): boolean {
  return order.fulfillmentStatus === "awaiting_supplier_confirmation" || (order.supplierConfirmation?.required === true && order.supplierConfirmation.status === "pending");
}

/**
 * Validates a staff patch against the allowlist, role gates and transition
 * matrix, and returns exactly what to write and which email is due.
 */
export function planOrderUpdate(order: LifecycleOrder, rawPatch: unknown, actor: LifecycleActor, nowIso: string): UpdateOrderPlan | UpdateOrderError {
  if (!canUpdateOrders(actor.role)) return refuse(403, "forbidden");
  if (rawPatch === undefined || rawPatch === null) rawPatch = {};
  if (!isBag(rawPatch)) return refuse(400, "invalid_patch");
  const patch = rawPatch;

  for (const key of Object.keys(patch)) {
    if (!(UPDATE_ORDER_PATCH_KEYS as readonly string[]).includes(key)) return refuse(400, "invalid_patch_key", key);
  }

  const dataPatch: Record<string, unknown> = {};
  const changes: UpdateOrderPlan["changes"] = [];
  const set = (key: string, value: unknown) => {
    dataPatch[key] = value;
    changes.push({ key, before: order[key], after: value });
  };

  /* plain text fields */
  for (const key of ["trackingNumber", "trackingUrl", "internalNotes", "supplierReference", "estimatedDeliveryAt"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (typeof value !== "string" || value.length > (TEXT_LIMITS[key] ?? 0)) return refuse(400, "invalid_patch_value", key);
    if (key === "trackingUrl" && value !== "" && !/^https?:\/\/\S+$/i.test(value)) return refuse(400, "invalid_patch_value", key);
    if (key === "estimatedDeliveryAt" && value !== "" && Number.isNaN(Date.parse(value))) return refuse(400, "invalid_patch_value", key);
    if (value !== (order[key] ?? "")) set(key, value);
  }

  if ("customerVisibleMessage" in patch) {
    const m = patch.customerVisibleMessage;
    if (m !== null) {
      if (!isBag(m)) return refuse(400, "invalid_patch_value", "customerVisibleMessage");
      for (const k of Object.keys(m)) {
        if (!["ar", "he", "en"].includes(k) || typeof m[k] !== "string" || (m[k] as string).length > MESSAGE_LIMIT) {
          return refuse(400, "invalid_patch_value", "customerVisibleMessage");
        }
      }
    }
    if (JSON.stringify(m) !== JSON.stringify(order.customerVisibleMessage ?? null)) set("customerVisibleMessage", m);
  }

  /* statuses: shape first */
  if ("paymentStatus" in patch && !isPaymentStatus(patch.paymentStatus)) return refuse(400, "invalid_payment_status", String(patch.paymentStatus));
  if ("fulfillmentStatus" in patch && !isFulfillmentStatus(patch.fulfillmentStatus)) {
    return refuse(400, "invalid_fulfillment_status", String(patch.fulfillmentStatus));
  }

  const fromPayment = order.paymentStatus;
  const fromFulfillment = order.fulfillmentStatus;
  const everPaid = orderEverPaid(order);
  let nextPayment = (patch.paymentStatus as string | undefined) ?? fromPayment;
  let nextFulfillment = patch.fulfillmentStatus as string | undefined;
  const explicitFulfillment = nextFulfillment !== undefined;

  /* supplier decision */
  const currentSupplier = order.supplierConfirmation;
  let nextSupplier = currentSupplier;
  let supplierDecision: UpdateOrderPlan["supplierDecision"];
  if ("supplierConfirmation" in patch) {
    const d = patch.supplierConfirmation;
    if (!isBag(d)) return refuse(400, "invalid_patch_value", "supplierConfirmation");
    if (d.note !== undefined && (typeof d.note !== "string" || d.note.length > SUPPLIER_NOTE_LIMIT)) return refuse(400, "invalid_patch_value", "supplierConfirmation.note");
    if (!currentSupplier?.required) return refuse(400, "supplier_confirmation_not_required");
    const status = d.status ?? currentSupplier.status;
    if (status !== currentSupplier.status) {
      if (!(SUPPLIER_DECISIONS as readonly unknown[]).includes(status)) return refuse(400, "invalid_patch_value", "supplierConfirmation.status");
      if (currentSupplier.status !== "pending") {
        return refuse(400, "invalid_transition", `supplier: ${currentSupplier.status} → ${String(status)} (a decision is final)`);
      }
      if (["cancelled", "refunded", "supplier_unavailable"].includes(fromFulfillment)) {
        return refuse(400, "invalid_transition", `supplier: order is ${fromFulfillment}`);
      }
      supplierDecision = status as "confirmed" | "rejected";
      nextSupplier = {
        ...currentSupplier,
        status: supplierDecision,
        ...(typeof d.note === "string" && d.note ? { note: d.note } : {}),
        decidedBy: actor.email,
        decidedAt: nowIso,
      };
    } else if (typeof d.note === "string" && d.note !== (currentSupplier.note ?? "")) {
      nextSupplier = { ...currentSupplier, note: d.note };
    }
    if (nextSupplier !== currentSupplier) set("supplierConfirmation", nextSupplier);
  }

  /* payment transition (explicit) */
  if (nextPayment !== fromPayment) {
    if (!canSetPaymentStatus(actor.role, nextPayment)) return refuse(403, "forbidden_payment_status", nextPayment);
    const t = canTransitionPayment(fromPayment, nextPayment, { everPaid });
    if (!t.ok) return refuse(400, "invalid_transition", `payment: ${fromPayment} → ${nextPayment} (${t.reason})`);
  }

  /* implied fulfillment */
  if (!explicitFulfillment) {
    if (supplierDecision === "confirmed" && PRE_PAYMENT.includes(fromFulfillment)) {
      nextFulfillment = PAID_LIKE.includes(nextPayment) ? "payment_confirmed" : "awaiting_payment";
    } else if (supplierDecision === "rejected") {
      nextFulfillment = "supplier_unavailable";
    } else if (nextPayment === "paid" && fromPayment !== "paid" && ["order_received", "awaiting_payment"].includes(fromFulfillment) && supplierSettled(nextSupplier)) {
      nextFulfillment = "payment_confirmed";
    }
  }
  nextFulfillment = nextFulfillment ?? fromFulfillment;

  /* a direct move to supplier_unavailable while the check is pending records the rejection */
  if (nextFulfillment === "supplier_unavailable" && nextSupplier?.required && nextSupplier.status === "pending") {
    supplierDecision = "rejected";
    nextSupplier = { ...nextSupplier, status: "rejected", decidedBy: actor.email, decidedAt: nowIso };
    set("supplierConfirmation", nextSupplier);
  }

  /* implied payment for closing states */
  if (nextFulfillment !== fromFulfillment && nextPayment === fromPayment) {
    if (nextFulfillment === "cancelled" && UNPAID_CANCELLABLE.includes(fromPayment)) nextPayment = "cancelled";
    if (nextFulfillment === "refunded" && [...PAID_LIKE, "under_review"].includes(fromPayment) && everPaid) nextPayment = "refunded";
  }

  /* fulfillment transition */
  if (nextFulfillment !== fromFulfillment) {
    const t = canTransitionFulfillment(fromFulfillment, nextFulfillment, {
      paymentStatus: nextPayment,
      supplier: nextSupplier,
      everPaid: everPaid || nextPayment === "paid",
      reached: (order.tracking ?? []).map((e) => e.status),
    });
    if (!t.ok) return refuse(400, "invalid_transition", `fulfillment: ${fromFulfillment} → ${nextFulfillment} (${t.reason})`);
  }
  // An implied payment change must itself be a legal payment move.
  if (nextPayment !== fromPayment && nextPayment !== patch.paymentStatus) {
    const t = canTransitionPayment(fromPayment, nextPayment, { everPaid });
    if (!t.ok) return refuse(400, "invalid_transition", `payment: ${fromPayment} → ${nextPayment} (${t.reason})`);
  }

  /* write set */
  const paymentChanged = nextPayment !== fromPayment;
  const fulfillmentChanged = nextFulfillment !== fromFulfillment;
  if (paymentChanged) {
    set("paymentStatus", nextPayment);
    dataPatch.paymentHistory = [...(order.paymentHistory ?? []), { from: fromPayment, to: nextPayment, at: nowIso, by: actor.email }];
  }
  if (fulfillmentChanged) {
    set("fulfillmentStatus", nextFulfillment);
    dataPatch.tracking = [...(order.tracking ?? []), { status: nextFulfillment, at: nowIso }];
    if (nextFulfillment === "production_started") dataPatch.productionStartedAt = nowIso;
    if (nextFulfillment === "supplier_dispatched") dataPatch.supplierDispatchedAt = nowIso;
  }

  /* email */
  const emailChange: UpdateOrderPlan["emailChange"] = {};
  if (fulfillmentChanged) emailChange.fulfillmentStatus = nextFulfillment;
  if (paymentChanged) {
    // "Payment confirmed … moving to preparation" is only true when the order
    // is actually moving: never while held, unavailable or closed (A2-B13).
    const notMoving = [...PRE_PAYMENT, "supplier_unavailable", "cancelled", "refunded"].includes(nextFulfillment);
    if (!(nextPayment === "paid" && notMoving)) emailChange.paymentStatus = nextPayment;
  }
  const specialEmail = supplierDecision === "confirmed" && nextFulfillment === "awaiting_payment" ? ("supplier_confirmed" as const) : undefined;

  return {
    ok: true,
    noop: Object.keys(dataPatch).length === 0,
    dataPatch,
    ...(paymentChanged ? { paymentStatus: nextPayment } : {}),
    ...(fulfillmentChanged ? { fulfillmentStatus: nextFulfillment } : {}),
    emailChange,
    ...(specialEmail ? { specialEmail } : {}),
    ...(supplierDecision ? { supplierDecision } : {}),
    changes,
  };
}

/** Compact audit detail: changed keys with before → after, bounded length. */
export function auditDetail(changes: UpdateOrderPlan["changes"]): string {
  const short = (v: unknown) => {
    const s = v === undefined ? "∅" : typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  };
  return changes.map((c) => `${c.key}: ${short(c.before)} → ${short(c.after)}`).join("; ").slice(0, 2000);
}
