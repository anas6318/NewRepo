/**
 * Order lifecycle (F3): transition matrix, patch allowlist, role gates,
 * supplier-confirmation outcomes, email selection, atomic writes.
 *
 * Findings covered: A2-S4 (mass assignment / role gates), A2-B3 (confirming
 * the supplier on an unpaid order emailed "payment confirmed"), A2-B5 (held
 * orders were sent bank instructions), A2-B6 (whole-`data` write-back),
 * A2-B7 (unchecked Google responses), A2-B13 (paid while held), A2-S9.
 *
 * The pure module is imported directly (the demo data service imports it the
 * same way). The Deno-targeted email modules are imported through a computed
 * specifier so `tsc` does not pull them into the app's type program.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canManagePricing,
  canSetPaymentStatus,
  canTransitionFulfillment,
  canTransitionPayment,
  canUpdateOrders,
  FULFILLMENT_STATUSES,
  PAYMENT_STATUSES,
  planOrderUpdate,
  UPDATE_ORDER_PATCH_KEYS,
  type LifecycleOrder,
  type UpdateOrderPlan,
} from "../../supabase/functions/_shared/order-lifecycle.ts";
import { eventForStatusChange as appEventFor } from "../../src/lib/order-emails.ts";
import type { FulfillmentStatus, PaymentStatus } from "../../src/services/types.ts";

const dyn = (rel: string) => import(new URL(rel, import.meta.url).href);
const notify = await dyn("../../supabase/functions/_shared/customer-notifications.ts");
const emails = await dyn("../../supabase/functions/_shared/emails.ts");

const NOW = "2026-09-29T10:00:00.000Z";
const OWNER = { email: "owner@crowned.example", role: "owner" };
const ORDER_MANAGER = { email: "ops@crowned.example", role: "order_manager" };
const CONTENT = { email: "content@crowned.example", role: "content_manager" };
const BANK_TEXT = "IBAN IL00-BANK-SENTINEL";

function order(over: Partial<LifecycleOrder> = {}): LifecycleOrder {
  return {
    orderNumber: "CR-LIFE01",
    locale: "en",
    customer: { email: "c@example.com" },
    totalIls: 340,
    paymentMethod: "bank_transfer",
    paymentStatus: "awaiting_payment",
    fulfillmentStatus: "awaiting_payment",
    tracking: [
      { status: "order_received", at: "2026-09-01T00:00:00Z" },
      { status: "awaiting_payment", at: "2026-09-01T00:00:01Z" },
    ],
    ...over,
  };
}

function held(over: Partial<LifecycleOrder> = {}): LifecycleOrder {
  return order({
    fulfillmentStatus: "awaiting_supplier_confirmation",
    tracking: [
      { status: "order_received", at: "2026-09-01T00:00:00Z" },
      { status: "awaiting_supplier_confirmation", at: "2026-09-01T00:00:01Z" },
    ],
    supplierConfirmation: { required: true, status: "pending", items: [{ slug: "onyx-home", size: "L" }] },
    ...over,
  });
}

const paidInProduction = (over: Partial<LifecycleOrder> = {}) =>
  order({
    paymentStatus: "paid",
    fulfillmentStatus: "production_started",
    tracking: [
      { status: "order_received", at: "t0" },
      { status: "payment_confirmed", at: "t1" },
      { status: "sent_to_supplier", at: "t2" },
      { status: "production_started", at: "t3" },
    ],
    ...over,
  });

function ok(result: ReturnType<typeof planOrderUpdate>): UpdateOrderPlan {
  assert.ok(result.ok, `expected an allowed update, got ${JSON.stringify(result)}`);
  return result as UpdateOrderPlan;
}

function refused(result: ReturnType<typeof planOrderUpdate>, error: string, status = 400) {
  assert.equal(result.ok, false, `expected refusal ${error}, got ${JSON.stringify(result)}`);
  if (!result.ok) {
    assert.equal(result.error, error);
    assert.equal(result.status, status);
  }
  return result;
}

/** The milestone an admin-actions update would email, exactly as the server decides it. */
const emailFor = (plan: UpdateOrderPlan) => plan.specialEmail ?? notify.eventForStatusChange(plan.emailChange);

/* ── enumerations stay in step with the app types ───────────────────────── */

test("lifecycle enumerations match the app's PaymentStatus / FulfillmentStatus", () => {
  const types = readFileSync("src/services/types.ts", "utf8");
  const union = (name: string) => {
    const block = types.slice(types.indexOf(`export type ${name} =`), types.indexOf(";", types.indexOf(`export type ${name} =`)));
    return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual([...PAYMENT_STATUSES].sort(), union("PaymentStatus"));
  assert.deepEqual([...FULFILLMENT_STATUSES].sort(), union("FulfillmentStatus"));
  // compile-time: every lifecycle literal is an app literal
  const p: PaymentStatus[] = [...PAYMENT_STATUSES];
  const f: FulfillmentStatus[] = [...FULFILLMENT_STATUSES];
  assert.ok(p.length && f.length);
});

/* ── payment transition matrix ──────────────────────────────────────────── */

test("payment matrix: allowed moves", () => {
  for (const [from, to] of [
    ["pending", "awaiting_payment"],
    ["pending", "paid"],
    ["awaiting_payment", "paid"],
    ["awaiting_payment", "cancelled"],
    ["authorized", "paid"],
    ["failed", "awaiting_payment"],
    ["paid", "refunded"],
    ["paid", "partially_refunded"],
    ["paid", "under_review"],
    ["partially_refunded", "refunded"],
    ["cancelled", "under_review"],
  ]) {
    const r = canTransitionPayment(from!, to!);
    assert.ok(r.ok && !r.noop, `${from} → ${to} should be allowed`);
  }
});

test("payment matrix: refused moves (refund before paid, paid never downgraded, refunded final)", () => {
  for (const [from, to, reason] of [
    ["awaiting_payment", "refunded", "payment_transition_not_allowed"],
    ["pending", "partially_refunded", "payment_transition_not_allowed"],
    ["under_review", "refunded", "refund_requires_payment"],
    ["paid", "failed", "payment_transition_not_allowed"],
    ["paid", "pending", "payment_transition_not_allowed"],
    ["paid", "cancelled", "payment_transition_not_allowed"],
    ["refunded", "paid", "payment_refunded_is_final"],
    ["cancelled", "paid", "payment_transition_not_allowed"],
  ]) {
    const r = canTransitionPayment(from!, to!);
    assert.equal(r.ok, false, `${from} → ${to} should be refused`);
    if (!r.ok) assert.equal(r.reason, reason, `${from} → ${to}`);
  }
  // under_review → refunded is fine once the order was actually paid
  assert.ok(canTransitionPayment("under_review", "refunded", { everPaid: true }).ok);
  assert.equal(canTransitionPayment("awaiting_payment", "bogus").ok, false);
});

test("same-state payment writes are no-ops", () => {
  for (const s of PAYMENT_STATUSES) assert.deepEqual(canTransitionPayment(s, s), { ok: true, noop: true });
});

/* ── fulfillment transition matrix ──────────────────────────────────────── */

const PAID_OK = { paymentStatus: "paid", supplier: undefined };

test("fulfillment matrix: the happy path is allowed step by step", () => {
  const path = [
    "awaiting_payment",
    "payment_confirmed",
    "sent_to_supplier",
    "production_started",
    "supplier_processing",
    "quality_inspection",
    "supplier_dispatched",
    "in_transit",
    "arrived_locally",
    "out_for_delivery",
    "delivered",
  ];
  for (let i = 1; i < path.length; i++) {
    const r = canTransitionFulfillment(path[i - 1]!, path[i]!, PAID_OK);
    assert.ok(r.ok, `${path[i - 1]} → ${path[i]}: ${JSON.stringify(r)}`);
  }
});

test("fulfillment matrix: delivered / in_transit / dispatch before production are refused", () => {
  for (const from of ["order_received", "awaiting_payment", "payment_confirmed", "awaiting_supplier_confirmation"]) {
    for (const to of ["supplier_dispatched", "in_transit", "out_for_delivery", "delivered"]) {
      assert.equal(canTransitionFulfillment(from, to, PAID_OK).ok, false, `${from} → ${to} must be refused`);
    }
  }
  // delivered straight from production (never shipped) is refused
  assert.equal(canTransitionFulfillment("production_started", "delivered", PAID_OK).ok, false);
  // shipping never goes backwards
  assert.equal(canTransitionFulfillment("in_transit", "supplier_dispatched", PAID_OK).ok, false);
  assert.equal(canTransitionFulfillment("delivered", "in_transit", PAID_OK).ok, false);
});

test("fulfillment matrix: production needs payment AND a settled supplier check", () => {
  const unpaid = canTransitionFulfillment("awaiting_payment", "sent_to_supplier", { paymentStatus: "awaiting_payment" });
  assert.deepEqual(unpaid, { ok: false, reason: "payment_not_confirmed" });
  const pendingSupplier = canTransitionFulfillment("awaiting_supplier_confirmation", "sent_to_supplier", {
    paymentStatus: "paid",
    supplier: { required: true, status: "pending" },
  });
  assert.deepEqual(pendingSupplier, { ok: false, reason: "supplier_not_confirmed" });
  const rejected = canTransitionFulfillment("awaiting_supplier_confirmation", "payment_confirmed", {
    paymentStatus: "paid",
    supplier: { required: true, status: "rejected" },
  });
  assert.equal(rejected.ok, false);
  assert.equal(canTransitionFulfillment("awaiting_payment", "payment_confirmed", { paymentStatus: "pending" }).ok, false, "payment_confirmed without payment");
});

test("fulfillment matrix: terminal and initial states", () => {
  assert.equal(canTransitionFulfillment("refunded", "delivered", PAID_OK).ok, false);
  assert.equal(canTransitionFulfillment("cancelled", "sent_to_supplier", PAID_OK).ok, false);
  assert.equal(canTransitionFulfillment("supplier_unavailable", "sent_to_supplier", PAID_OK).ok, false);
  assert.equal(canTransitionFulfillment("supplier_unavailable", "awaiting_payment", { paymentStatus: "awaiting_payment" }).ok, false);
  assert.ok(canTransitionFulfillment("supplier_unavailable", "cancelled", { paymentStatus: "awaiting_payment" }).ok);
  assert.equal(canTransitionFulfillment("payment_confirmed", "order_received", PAID_OK).ok, false);
  assert.equal(canTransitionFulfillment("awaiting_payment", "awaiting_supplier_confirmation", { paymentStatus: "awaiting_payment" }).ok, false);
});

test("fulfillment matrix: cancel/refund consistency", () => {
  assert.deepEqual(canTransitionFulfillment("payment_confirmed", "cancelled", { paymentStatus: "paid" }), {
    ok: false,
    reason: "cancel_paid_requires_refund_state",
  });
  assert.ok(canTransitionFulfillment("payment_confirmed", "cancelled", { paymentStatus: "under_review" }).ok);
  assert.deepEqual(canTransitionFulfillment("cancelled", "refunded", { paymentStatus: "cancelled" }), { ok: false, reason: "refund_requires_payment" });
  assert.ok(canTransitionFulfillment("cancelled", "refunded", { paymentStatus: "refunded", everPaid: true }).ok);
  // issue_reported can only return to shipping steps the order really reached
  assert.equal(canTransitionFulfillment("issue_reported", "delivered", { ...PAID_OK, reached: ["order_received", "payment_confirmed"] }).ok, false);
  assert.ok(canTransitionFulfillment("issue_reported", "delivered", { ...PAID_OK, reached: ["supplier_dispatched"] }).ok);
});

test("duplicate fulfillment action is a no-op (no tracking entry, no email)", () => {
  assert.deepEqual(canTransitionFulfillment("in_transit", "in_transit", PAID_OK), { ok: true, noop: true });
  const o = paidInProduction();
  const plan = ok(planOrderUpdate(o, { fulfillmentStatus: "production_started" }, OWNER, NOW));
  assert.equal(plan.noop, true);
  assert.deepEqual(plan.dataPatch, {});
  assert.equal(emailFor(plan), undefined);
  const same = ok(planOrderUpdate(o, { paymentStatus: "paid", trackingNumber: "" }, OWNER, NOW));
  assert.equal(same.noop, true);
});

/* ── planner: transitions through the real update path ──────────────────── */

test("planOrderUpdate refuses delivered-before-shipped with invalid_transition from/to", () => {
  const r = refused(planOrderUpdate(order({ paymentStatus: "paid", fulfillmentStatus: "payment_confirmed" }), { fulfillmentStatus: "delivered" }, OWNER, NOW), "invalid_transition");
  if (!r.ok) assert.match(r.detail ?? "", /fulfillment: payment_confirmed → delivered/);
});

test("planOrderUpdate: production on an unpaid order is refused", () => {
  const r = refused(planOrderUpdate(order(), { fulfillmentStatus: "sent_to_supplier" }, OWNER, NOW), "invalid_transition");
  if (!r.ok) assert.match(r.detail ?? "", /payment_not_confirmed/);
});

test("planOrderUpdate: payment_confirmed fulfillment without payment is refused", () => {
  refused(planOrderUpdate(order(), { fulfillmentStatus: "payment_confirmed" }, OWNER, NOW), "invalid_transition");
});

test("planOrderUpdate: refund before paid is refused", () => {
  refused(planOrderUpdate(order(), { paymentStatus: "refunded" }, OWNER, NOW), "invalid_transition");
  refused(planOrderUpdate(order({ fulfillmentStatus: "cancelled", paymentStatus: "cancelled" }), { fulfillmentStatus: "refunded" }, OWNER, NOW), "invalid_transition");
});

test("planOrderUpdate: cancelling an unpaid order cancels its payment too (one email)", () => {
  const plan = ok(planOrderUpdate(order(), { fulfillmentStatus: "cancelled" }, OWNER, NOW));
  assert.equal(plan.fulfillmentStatus, "cancelled");
  assert.equal(plan.paymentStatus, "cancelled");
  assert.equal(emailFor(plan), "cancelled");
});

test("planOrderUpdate: a paid order is never silently cancelled; under_review then cancel then refund works", () => {
  const paid = order({ paymentStatus: "paid", fulfillmentStatus: "payment_confirmed" });
  refused(planOrderUpdate(paid, { fulfillmentStatus: "cancelled" }, OWNER, NOW), "invalid_transition");
  const review = ok(planOrderUpdate(paid, { paymentStatus: "under_review" }, OWNER, NOW));
  const afterReview = { ...paid, ...review.dataPatch } as LifecycleOrder;
  const cancel = ok(planOrderUpdate(afterReview, { fulfillmentStatus: "cancelled" }, OWNER, NOW));
  assert.equal(cancel.paymentStatus, undefined, "an under_review payment is left for the refund step");
  const afterCancel = { ...afterReview, ...cancel.dataPatch } as LifecycleOrder;
  const refund = ok(planOrderUpdate(afterCancel, { fulfillmentStatus: "refunded" }, OWNER, NOW));
  assert.equal(refund.paymentStatus, "refunded", "the payment follows the refund");
  assert.equal(emailFor(refund), "refunded");
});

test("planOrderUpdate: tracking entry + timestamps only on a real change", () => {
  const plan = ok(planOrderUpdate(paidInProduction(), { fulfillmentStatus: "supplier_dispatched" }, OWNER, NOW));
  const tracking = plan.dataPatch.tracking as { status: string; at: string }[];
  assert.equal(tracking.length, 5);
  assert.deepEqual(tracking.at(-1), { status: "supplier_dispatched", at: NOW });
  assert.equal(plan.dataPatch.supplierDispatchedAt, NOW);
  assert.equal(plan.dataPatch.fulfillmentStatus, "supplier_dispatched", "data and column stay in step");
  assert.equal(plan.fulfillmentStatus, "supplier_dispatched");
  assert.equal(emailFor(plan), "shipped");
});

/* ── patch allowlist (A2-S4 mass assignment) ────────────────────────────── */

test("patch allowlist is exactly what Admin sends plus customerVisibleMessage", () => {
  assert.deepEqual([...UPDATE_ORDER_PATCH_KEYS].sort(), [
    "customerVisibleMessage",
    "estimatedDeliveryAt",
    "fulfillmentStatus",
    "internalNotes",
    "paymentStatus",
    "supplierConfirmation",
    "supplierReference",
    "trackingNumber",
    "trackingUrl",
  ]);
  // Every key the DataService contract lets Admin send is allowlisted.
  const contract = readFileSync("src/services/DataService.ts", "utf8");
  const block = contract.slice(contract.indexOf("adminUpdateOrder("), contract.indexOf("adminResyncOrder("));
  for (const key of [...block.matchAll(/^\s+(\w+): /gm)].map((m) => m[1]!).filter((k) => k !== "orderNumber" && k !== "patch")) {
    assert.ok((UPDATE_ORDER_PATCH_KEYS as readonly string[]).includes(key), `Admin sends ${key} but the server refuses it`);
  }
});

test("mass assignment of totals, items, customer, ledger or tracking is refused", () => {
  for (const key of ["totalIls", "items", "customer", "customerEmails", "tracking", "subtotalIls", "notification", "paymentHistory", "__proto__", "isDemo"]) {
    const patch = JSON.parse(`{"${key}": 1}`);
    const r = refused(planOrderUpdate(order(), patch, OWNER, NOW), "invalid_patch_key");
    if (!r.ok) assert.equal(r.detail, key);
  }
});

test("allowlisted fields are validated, and only changed keys are written", () => {
  refused(planOrderUpdate(order(), { paymentStatus: "free" }, OWNER, NOW), "invalid_payment_status");
  refused(planOrderUpdate(order(), { fulfillmentStatus: "teleported" }, OWNER, NOW), "invalid_fulfillment_status");
  refused(planOrderUpdate(order(), { trackingUrl: "javascript:alert(1)" }, OWNER, NOW), "invalid_patch_value");
  refused(planOrderUpdate(order(), { trackingNumber: 42 }, OWNER, NOW), "invalid_patch_value");
  refused(planOrderUpdate(order(), { estimatedDeliveryAt: "someday" }, OWNER, NOW), "invalid_patch_value");
  refused(planOrderUpdate(order(), { customerVisibleMessage: { fr: "x" } }, OWNER, NOW), "invalid_patch_value");
  refused(planOrderUpdate(order(), "paid", OWNER, NOW), "invalid_patch");
  const plan = ok(planOrderUpdate(order({ internalNotes: "old" }), { internalNotes: "new", trackingNumber: "RR1IL", supplierReference: "" }, OWNER, NOW));
  assert.deepEqual(Object.keys(plan.dataPatch).sort(), ["internalNotes", "trackingNumber"]);
  assert.deepEqual(
    plan.changes.find((c) => c.key === "internalNotes"),
    { key: "internalNotes", before: "old", after: "new" },
    "audit carries before/after",
  );
});

test("supplierConfirmation: only status and note are read — echoed fields are never assigned", () => {
  const plan = ok(
    planOrderUpdate(
      held({ paymentStatus: "paid" }),
      { supplierConfirmation: { required: false, status: "confirmed", items: [], decidedBy: "attacker", decidedAt: "1999", note: "ok" } },
      ORDER_MANAGER,
      NOW,
    ),
  );
  const sc = plan.dataPatch.supplierConfirmation as Record<string, unknown>;
  assert.equal(sc.required, true, "required cannot be switched off from a patch");
  assert.deepEqual(sc.items, [{ slug: "onyx-home", size: "L" }]);
  assert.equal(sc.decidedBy, ORDER_MANAGER.email);
  assert.equal(sc.decidedAt, NOW);
  assert.equal(sc.note, "ok");
});

/* ── role gates ─────────────────────────────────────────────────────────── */

test("roles: content_manager cannot update orders at all", () => {
  assert.equal(canUpdateOrders("content_manager"), false);
  assert.equal(canUpdateOrders("customer"), false);
  assert.equal(canUpdateOrders(undefined), false);
  refused(planOrderUpdate(order(), { internalNotes: "x" }, CONTENT, NOW), "forbidden", 403);
  refused(planOrderUpdate(order(), { paymentStatus: "paid" }, CONTENT, NOW), "forbidden", 403);
});

test("roles: order_manager, admin and owner can mark paid and refund", () => {
  for (const role of ["owner", "admin", "order_manager"]) {
    assert.ok(canSetPaymentStatus(role, "paid"));
    assert.ok(canSetPaymentStatus(role, "refunded"));
    assert.ok(canSetPaymentStatus(role, "partially_refunded"));
  }
  assert.equal(canSetPaymentStatus("content_manager", "paid"), false);
  const plan = ok(planOrderUpdate(order(), { paymentStatus: "paid" }, ORDER_MANAGER, NOW));
  assert.equal(plan.paymentStatus, "paid");
});

test("roles: only owner/admin save promotions and badge prices", () => {
  assert.ok(canManagePricing("owner"));
  assert.ok(canManagePricing("admin"));
  assert.equal(canManagePricing("order_manager"), false);
  assert.equal(canManagePricing("content_manager"), false);
  const src = readFileSync("supabase/functions/admin-actions/index.ts", "utf8");
  for (const name of ["savePromotions", "saveBadges"]) {
    const fn = src.slice(src.indexOf(`async function ${name}`), src.indexOf("async function ", src.indexOf(`async function ${name}`) + 10));
    assert.match(fn, /if \(!canManagePricing\(staff\.role\)\) throw new HttpError\(403, "forbidden"\)/, `${name} is not pricing-gated`);
  }
  for (const name of ["updateOrder", "resendCustomerEmail"]) {
    const fn = src.slice(src.indexOf(`async function ${name}`), src.indexOf("async function ", src.indexOf(`async function ${name}`) + 10));
    assert.match(fn, /if \(!canUpdateOrders\(staff\.role\)\) throw new HttpError\(403, "forbidden"\)/, `${name} is not order-role gated`);
  }
});

/* ── A2-B3: supplier confirmation outcomes ──────────────────────────────── */

test("B3: confirming the supplier on an UNPAID held order → awaiting_payment for every payment method, never payment_confirmed", () => {
  for (const method of ["bank_transfer", "card", "bit", "paybox", "paypal"]) {
    for (const payment of ["awaiting_payment", "pending", "authorized", "failed"]) {
      const plan = ok(planOrderUpdate(held({ paymentMethod: method, paymentStatus: payment }), { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW));
      assert.equal(plan.fulfillmentStatus, "awaiting_payment", `${method}/${payment}`);
      assert.equal(plan.paymentStatus, undefined, `${method}/${payment}: payment untouched`);
      assert.equal(plan.supplierDecision, "confirmed");
      assert.equal(emailFor(plan), "supplier_confirmed", `${method}/${payment}`);
      assert.notEqual(emailFor(plan), "payment_confirmed");
    }
  }
});

test("B3: confirming the supplier on a PAID held order → payment_confirmed (the payment really happened)", () => {
  const plan = ok(planOrderUpdate(held({ paymentStatus: "paid" }), { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW));
  assert.equal(plan.fulfillmentStatus, "payment_confirmed");
  assert.equal(emailFor(plan), "payment_confirmed");
});

test("B3: rejecting → supplier_unavailable, no automatic email; a decision is final", () => {
  const plan = ok(planOrderUpdate(held(), { supplierConfirmation: { status: "rejected", note: "sold out" } }, OWNER, NOW));
  assert.equal(plan.fulfillmentStatus, "supplier_unavailable");
  assert.equal(emailFor(plan), undefined);
  const decided = { ...held(), ...plan.dataPatch } as LifecycleOrder;
  refused(planOrderUpdate(decided, { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW), "invalid_transition");
  refused(planOrderUpdate(order(), { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW), "supplier_confirmation_not_required");
});

test("held orders cannot be pushed past the supplier check by a direct status change", () => {
  refused(planOrderUpdate(held(), { fulfillmentStatus: "awaiting_payment" }, OWNER, NOW), "invalid_transition");
  refused(planOrderUpdate(held({ paymentStatus: "paid" }), { fulfillmentStatus: "sent_to_supplier" }, OWNER, NOW), "invalid_transition");
  // moving a pending order to supplier_unavailable records the rejection
  const plan = ok(planOrderUpdate(held(), { fulfillmentStatus: "supplier_unavailable" }, OWNER, NOW));
  assert.equal((plan.dataPatch.supplierConfirmation as { status: string }).status, "rejected");
});

/* ── A2-B13: paid while still held ──────────────────────────────────────── */

test("B13: marking paid while supplier confirmation is pending records the payment, keeps the hold, sends no 'moving to preparation' email", () => {
  const plan = ok(planOrderUpdate(held(), { paymentStatus: "paid" }, ORDER_MANAGER, NOW));
  assert.equal(plan.paymentStatus, "paid");
  assert.equal(plan.fulfillmentStatus, undefined, "fulfillment stays held");
  assert.equal(emailFor(plan), undefined, "no payment-confirmed email while held");
  assert.equal(appEventFor(plan.emailChange), undefined, "the app mapping agrees");
  assert.deepEqual(plan.dataPatch.paymentHistory, [{ from: "awaiting_payment", to: "paid", at: NOW, by: ORDER_MANAGER.email }]);
  assert.equal(plan.dataPatch.tracking, undefined, "the customer timeline gains no step");
  // …and the later supplier confirmation is what moves it (one email then).
  const confirmed = ok(planOrderUpdate({ ...held(), ...plan.dataPatch } as LifecycleOrder, { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW));
  assert.equal(confirmed.fulfillmentStatus, "payment_confirmed");
  assert.equal(emailFor(confirmed), "payment_confirmed");
});

test("marking a non-held bank order paid advances it to payment_confirmed with one email", () => {
  const plan = ok(planOrderUpdate(order(), { paymentStatus: "paid" }, OWNER, NOW));
  assert.equal(plan.fulfillmentStatus, "payment_confirmed");
  assert.equal(emailFor(plan), "payment_confirmed");
  assert.equal((plan.dataPatch.paymentHistory as unknown[]).length, 1);
});

/* ── A2-B5: held-order email and bank-instruction timing ────────────────── */

function fakeFetch() {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  return {
    calls,
    fn: async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{}" };
    },
  };
}
const CONFIG = { provider: "resend", from: "orders@crowned.example", apiKey: "re_test_key_0123456789", siteUrl: "https://crowned.example" };
const sentHtml = (calls: { init: Record<string, unknown> }[]) => JSON.parse(String(calls[0]!.init.body)) as { subject: string; html: string };

test("B5: the held-order 'order received' email has no bank instructions and no stock claim, in all three languages", () => {
  for (const locale of ["ar", "he", "en"]) {
    const built = emails.statusUpdateEmail(locale, "order_received", { orderNumber: "CR-HELD01", totalIls: 340, bankInstructions: BANK_TEXT, awaitingSupplier: true });
    assert.ok(built.subject && built.html);
    assert.ok(!built.html.includes(BANK_TEXT), `${locale}: bank instructions leaked into the held email`);
    assert.ok(!/Bank transfer instructions|تعليمات التحويل البنكي|הוראות העברה בנקאית/.test(built.html), `${locale}: bank heading present`);
  }
  const en = emails.statusUpdateEmail("en", "order_received", { orderNumber: "CR-HELD01", totalIls: 340, awaitingSupplier: true });
  assert.match(en.subject, /awaiting supplier confirmation/i);
  assert.match(en.html, /No payment is needed yet/);
  assert.ok(!/in stock|available now/i.test(en.html));
});

test("B5: the sender withholds bank instructions from a held order even if a caller passes them", async () => {
  const f = fakeFetch();
  const record = await notify.sendCustomerStatusEmail(
    held({ locale: "en" }),
    "order_received",
    CONFIG,
    { fetch: f.fn, bankInstructions: BANK_TEXT },
  );
  assert.equal(record.status, "sent");
  const mail = sentHtml(f.calls);
  assert.ok(!mail.html.includes(BANK_TEXT));
  assert.match(mail.subject, /awaiting supplier confirmation/i);
});

test("B5: a non-held bank-transfer order keeps today's confirmation with instructions", async () => {
  const f = fakeFetch();
  await notify.sendCustomerStatusEmail(order({ locale: "en" }), "order_received", CONFIG, { fetch: f.fn, bankInstructions: BANK_TEXT });
  const mail = sentHtml(f.calls);
  assert.ok(mail.html.includes(BANK_TEXT));
  assert.match(mail.subject, /your order has been received/i);
});

test("B5: bank instructions go out with the supplier_confirmed email after confirmation", async () => {
  const plan = ok(planOrderUpdate(held({ locale: "en" }), { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW));
  const after = { ...held({ locale: "en" }), ...plan.dataPatch };
  assert.equal(emailFor(plan), "supplier_confirmed");
  assert.equal(notify.bankInstructionsDue(after, "supplier_confirmed"), true);
  assert.equal(notify.bankInstructionsDue(held(), "order_received"), false, "never while held");
  assert.equal(notify.bankInstructionsDue({ ...after, paymentMethod: "card" }, "supplier_confirmed"), false, "only for bank transfer");
  assert.equal(notify.bankInstructionsDue({ ...after, paymentStatus: "paid" }, "supplier_confirmed"), false, "never once paid");
  const f = fakeFetch();
  await notify.sendCustomerStatusEmail(after, "supplier_confirmed", CONFIG, { fetch: f.fn, bankInstructions: BANK_TEXT });
  const mail = sentHtml(f.calls);
  assert.ok(mail.html.includes(BANK_TEXT), "instructions missing from the confirmation email");
  assert.match(mail.subject, /availability is confirmed/i);
  assert.ok(!/payment (is )?confirmed/i.test(mail.subject), "must not claim payment");
  for (const locale of ["ar", "he", "en"]) {
    const built = emails.statusUpdateEmail(locale, "supplier_confirmed", { orderNumber: "CR-HELD01", totalIls: 340 });
    assert.ok(built?.subject && built.html, `${locale} supplier_confirmed template`);
  }
});

test("B5/B3: confirming an unpaid order never produces a payment-confirmed email in the ledger", async () => {
  const o = held({ locale: "en", customerEmails: {} });
  const plan = ok(planOrderUpdate(o, { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW));
  const after = { ...o, ...plan.dataPatch } as Record<string, unknown>;
  const f = fakeFetch();
  await notify.deliverStatusEmail(after, emailFor(plan), CONFIG, { fetch: f.fn, bankInstructions: BANK_TEXT });
  const ledger = after.customerEmails as Record<string, unknown>;
  assert.ok(ledger.supplier_confirmed, "supplier_confirmed not recorded");
  assert.equal(ledger.payment_confirmed, undefined);
  // idempotent: re-sending the same decision is a no-op (no write, no email)…
  const again = ok(planOrderUpdate(after as LifecycleOrder, { supplierConfirmation: { status: "confirmed" } }, OWNER, NOW));
  assert.equal(again.noop, true);
  assert.equal(emailFor(again), undefined);
  // …and reversing it is refused: a decision is final.
  refused(planOrderUpdate(after as LifecycleOrder, { supplierConfirmation: { status: "rejected" } }, OWNER, NOW), "invalid_transition");
});

test("place-order selects the held variant: no bank instructions for an order held for the supplier", () => {
  const src = readFileSync("supabase/functions/place-order/index.ts", "utf8");
  assert.match(src, /const heldForSupplier = priced\.initialFulfillmentStatus === "awaiting_supplier_confirmation";/);
  assert.match(src, /isBank && !heldForSupplier && settings\?\.bankTransferInstructions/);
});

/* ── A2-B6: atomic writes only ──────────────────────────────────────────── */

const slice = (src: string, start: string, end?: string) => src.slice(src.indexOf(start), end ? src.indexOf(end, src.indexOf(start) + start.length) : undefined);

test("B6 / 0008: updateOrder writes only the changed keys by compare-and-set (transition_order_data), never whole data", () => {
  const src = readFileSync("supabase/functions/admin-actions/index.ts", "utf8");
  const fn = slice(src, "async function updateOrder", "async function resendCustomerEmail");
  assert.ok(fn.includes("await transitionOrder(body.orderNumber, current.version, planned.dataPatch, statuses)"));
  assert.ok(fn.includes('throw new HttpError(409, "concurrent_update")'), "bounded retry must end in 409");
  assert.ok(fn.includes("alreadyApplied: true"), "a no-op / lost race must report alreadyApplied");
  assert.ok(!/data: order\b/.test(fn), "whole-data write-back is back");
  assert.ok(!fn.includes("Object.assign(order"), "mass assignment is back");
  assert.ok(!fn.includes("dbUpdate(`orders"), "a direct orders PATCH is back");
  assert.ok(src.includes('dbRpc<TransitionResult>("transition_order_data"'));
  assert.ok(src.includes('dbRpc<Record<string, unknown> | null>("record_order_customer_email"'));
  // Every order write in admin-actions is either compare-and-set or a single
  // ledger entry: no unconditional merge, no whole-ledger write remains.
  assert.ok(!src.includes('"patch_order_data"'), "an unconditional order merge is back in admin-actions");
  assert.ok(!/customerEmails:\s*\w+\.customerEmails/.test(src), "a whole-customerEmails write is back");
  const resend = slice(src, "async function resendCustomerEmail", "async function saveZones");
  const claim = resend.indexOf("await transitionOrder(body.orderNumber, current.version, { customerEmailResends");
  assert.ok(claim > -1, "the resend is not claimed atomically");
  assert.ok(claim < resend.indexOf("await sendCustomerStatusEmail("), "the resend sends before claiming");
  assert.ok(resend.indexOf("await sendCustomerStatusEmail(") < resend.indexOf("await recordOrderCustomerEmail(body.orderNumber, event, record)"));
  assert.ok(!/data: order\b/.test(resend));
});

test("B6: sheets-sync writes back ONLY sheetsSync via patch_order_data", () => {
  const src = readFileSync("supabase/functions/sheets-sync/index.ts", "utf8");
  assert.ok(src.includes('dbRpc("patch_order_data", { p_order_number: orderNumber, p_patch: { sheetsSync }'));
  assert.ok(!/data: order\b/.test(src), "whole-data write-back is back");
  assert.ok(!src.includes("dbUpdate(`orders"), "a direct orders PATCH is back");
  assert.ok(src.includes('recordSheetsSync(orderNumber, { status: "failed"'), "a failure is recorded on the order");
});

test("dbRpc posts to /rest/v1/rpc/<fn> and throws on a non-2xx", () => {
  const helpers = readFileSync("supabase/functions/_shared/helpers.ts", "utf8");
  const fn = slice(helpers, "export async function dbRpc", "export async function callerProfile");
  assert.ok(fn.includes('db(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) })'));
  assert.ok(fn.includes("if (!res.ok) throw new Error"));
});

/* ── A2-B7 / A2-S9: sheets-sync responses and service auth ──────────────── */

test("B7: every Google API call is checked with res.ok before recording synced", () => {
  const src = readFileSync("supabase/functions/sheets-sync/index.ts", "utf8");
  const sync = slice(src, "async function syncOne", "Deno.serve");
  const googleCalls = sync.match(/await fetch\(`https:\/\/sheets\.googleapis\.com/g) ?? [];
  const checked = sync.match(/await googleOk\(\s*await fetch\(`https:\/\/sheets\.googleapis\.com/g) ?? [];
  assert.ok(googleCalls.length >= 4);
  assert.equal(checked.length, googleCalls.length, "a Google call is not checked");
  assert.match(src, /async function googleOk\(res: Response, what: string\)[\s\S]{0,80}if \(!res\.ok\) throw/);
  assert.ok(sync.indexOf("googleOk(") < sync.indexOf('status: "synced"'), "synced is recorded before the calls are checked");
});

test("S9: service-call detection needs a non-empty key and a constant-time compare", async () => {
  const src = readFileSync("supabase/functions/sheets-sync/index.ts", "utf8");
  assert.ok(src.includes("const isServiceCall = isServiceBearer(auth, SERVICE_ROLE_KEY);"));
  assert.ok(!src.includes("auth === `Bearer ${SERVICE_ROLE_KEY}`"));
  // Execute the real function body (it only needs constantTimeEqual).
  const body = slice(src, "export function isServiceBearer", "/** Every Google API response");
  const helpers = readFileSync("supabase/functions/_shared/helpers.ts", "utf8");
  const cte = slice(helpers, "export function constantTimeEqual", "/** Email dispatch");
  const strip = (s: string) => s.replace(/^export /, "").replace(/\(([^)]*)\): boolean/, (_m, args: string) => `(${args.replace(/: string/g, "")})`);
  const make = new Function(`${strip(cte)}\n${strip(body)}\nreturn isServiceBearer;`);
  const isServiceBearer = make() as (a: string, k: string) => boolean;
  assert.equal(isServiceBearer("Bearer ", ""), false, "an empty key must never match");
  assert.equal(isServiceBearer("Bearer secret-key", "secret-key"), true);
  assert.equal(isServiceBearer("Bearer secret-kez", "secret-key"), false);
  assert.equal(isServiceBearer("", "secret-key"), false);
});
