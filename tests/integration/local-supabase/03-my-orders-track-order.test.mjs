/**
 * Customer-facing order reads against the LOCAL stack: `my-orders` (signed-in
 * account history) and `track-order` (guest tracking). Both must return only
 * the caller's own orders, through the allowlist sanitizer — even after staff
 * wrote internal notes, supplier references, carrier details and payment
 * history onto those orders.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { BADGE_ID, BADGE_SUPPLIER_REF, SENTINEL_PREFIX } from "../../../scripts/local-staging/fixtures.mjs";
import { allKeys, assertNoSupplierData, client, customer, line, orderBody, uniqueTag } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

/** Order-level keys a customer may receive (supabase/functions/_shared/customer-order.ts). */
const ALLOWED_ORDER_KEYS = new Set([
  "id", "orderNumber", "createdAt", "locale", "customer", "items", "subtotalIls", "promotion", "promotionDiscountIls",
  "deliveryIls", "freeDelivery", "totalIls", "zoneId", "paymentMethod", "paymentStatus", "fulfillmentStatus", "tracking",
  "estimatedDeliveryAt", "supplierConfirmation", "customerVisibleMessage", "sheetsSync", "isDemo",
]);
/** Keys that must never reach a customer, at any depth. */
const FORBIDDEN_KEYS = [
  "internalNotes", "supplierReference", "trackingNumber", "trackingUrl", "productionStartedAt", "supplierDispatchedAt",
  "notification", "customerEmails", "idempotency", "paymentHistory", "decidedBy", "decidedAt", "note", "lastAttemptAt", "error",
];

const TRACK_SENTINEL = "IT-CARRIER-TRACK-0001";
let A, B, OM;
const contact = {};
const orders = {};

async function place(token, cust, lines) {
  const r = await c.fn("place-order", orderBody(lines, { customer: cust }), token ? { token } : {});
  assert.equal(r.status, 200, `place-order: HTTP ${r.status} ${r.json?.error ?? ""}`);
  return r.json.orderNumber;
}

async function staffUpdate(orderNumber, patch) {
  const r = await c.fn("admin-actions", { orderNumber, patch }, { token: OM.token, query: "?action=update-order" });
  assert.equal(r.status, 200, `update-order ${JSON.stringify(patch)}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.order;
}

/** Internal state staff typically leave on an order. */
async function addInternalState(orderNumber, tag) {
  await staffUpdate(orderNumber, {
    internalNotes: `${SENTINEL_PREFIX}-STAFF-NOTE-${tag}`,
    supplierReference: `${SENTINEL_PREFIX}-ORDER-SUPPLIER-REF-${tag}`,
    trackingNumber: TRACK_SENTINEL,
    trackingUrl: "https://carrier.example.test/track/IT-CARRIER-TRACK-0001",
  });
  await staffUpdate(orderNumber, { paymentStatus: "paid" }); // writes paymentHistory {by: staff email}
}

before(async () => {
  A = await c.signIn("customerA");
  B = await c.signIn("customerB");
  OM = await c.signIn("orderManager");
  contact.A = { ...customer({ tag: uniqueTag("a") }), phone: "0500000011" };
  contact.B = { ...customer({ tag: uniqueTag("b") }), name: "IT Customer B", phone: "0500000012" };
  contact.G = { ...customer({ tag: uniqueTag("g") }), name: "IT Guest", phone: "0500000013" };

  orders.A1 = await place(A.token, contact.A, [line("it-retro-regular", { badgeId: BADGE_ID })]);
  orders.A2 = await place(A.token, contact.A, [line("it-hold")]);
  orders.B1 = await place(B.token, contact.B, [line("it-retro-regular", { badgeId: BADGE_ID })]);
  orders.G1 = await place(null, contact.G, [line("it-retro-regular", { badgeId: BADGE_ID })]);

  await addInternalState(orders.A1, "A1");
  await addInternalState(orders.B1, "B1");
  await addInternalState(orders.G1, "G1");
  // A held order whose supplier decision carries an internal note.
  await staffUpdate(orders.A2, { supplierConfirmation: { status: "confirmed", note: `${SENTINEL_PREFIX}-DECISION-NOTE-A2` } });

  // Control: the stored rows really carry the internal data the sanitizer must remove.
  for (const n of [orders.A1, orders.G1]) {
    const d = (await c.orderRow(n)).data;
    assert.ok(d.internalNotes?.startsWith(SENTINEL_PREFIX) && d.trackingNumber === TRACK_SENTINEL && d.paymentHistory?.length >= 1, `control ${n}`);
    assert.equal(d.items[0].badge.supplierReference, BADGE_SUPPLIER_REF, `control ${n}: badge snapshot keeps the supplier ref`);
    assert.ok(d.customerEmails && d.notification, `control ${n}: bookkeeping present`);
  }
  const a2 = (await c.orderRow(orders.A2)).data;
  assert.ok(a2.supplierConfirmation.note?.startsWith(SENTINEL_PREFIX) && a2.supplierConfirmation.decidedBy, "control A2 decision note");
});

function assertCustomerSafe(order, what, { otherContacts = [] } = {}) {
  for (const k of Object.keys(order)) assert.ok(ALLOWED_ORDER_KEYS.has(k), `${what}: non-allowlisted key "${k}"`);
  const keys = allKeys(order);
  for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `${what}: forbidden key "${k}"`);
  assertNoSupplierData(order, what);
  const text = JSON.stringify(order);
  assert.ok(!text.includes(TRACK_SENTINEL), `${what}: carrier tracking number leaked`);
  assert.ok(!text.includes("carrier.example.test"), `${what}: carrier URL leaked`);
  assert.ok(!text.includes(OM.email), `${what}: staff identity leaked`);
  for (const o of otherContacts) {
    assert.ok(!text.includes(o.email) && !text.includes(o.phone), `${what}: another customer's contact leaked`);
  }
  for (const item of order.items ?? []) {
    if (item.badge) assert.deepEqual(Object.keys(item.badge).sort(), ["badgeId", "code", "label", "name", "priceIls"].sort(), `${what}: badge keys`);
  }
  if (order.supplierConfirmation) {
    for (const k of Object.keys(order.supplierConfirmation)) assert.ok(["required", "status", "items"].includes(k), `${what}: supplierConfirmation.${k}`);
  }
  if (order.sheetsSync) assert.deepEqual(Object.keys(order.sheetsSync), ["status"], `${what}: sheetsSync keys`);
}

test("my-orders: 401 for anonymous callers (anon key or no session)", async () => {
  const r = await c.fn("my-orders", {}, { token: stack.anonKey });
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { error: "unauthorized" });
  const bogus = await c.fn("my-orders", {}, { token: "not-a-jwt" });
  assert.equal(bogus.status, 401, "an invalid bearer must not reach any order data");
  assert.ok(!JSON.stringify(bogus.json ?? {}).includes("orderNumber"));
});

test("my-orders: customer A sees exactly A's orders and never B's or a guest's", async () => {
  const r = await c.fn("my-orders", {}, { token: A.token });
  assert.equal(r.status, 200);
  const numbers = r.json.orders.map((o) => o.orderNumber);
  assert.ok(numbers.includes(orders.A1) && numbers.includes(orders.A2), "A's orders missing");
  assert.ok(!numbers.includes(orders.B1) && !numbers.includes(orders.G1), "foreign order returned");
  // Exactly the rows stored under A's id, nothing else.
  const own = await c.svc(`orders?select=order_number&customer_id=eq.${A.id}`);
  assert.deepEqual([...numbers].sort(), own.json.map((o) => o.order_number).sort());
  for (const o of r.json.orders) assert.equal(o.customer.customerId, A.id);

  const rb = await c.fn("my-orders", {}, { token: B.token });
  const nb = rb.json.orders.map((o) => o.orderNumber);
  assert.ok(nb.includes(orders.B1) && !nb.includes(orders.A1) && !nb.includes(orders.A2));
  // The body cannot redirect the lookup to someone else.
  const spoof = await c.fn("my-orders", { customerId: B.id, userId: B.id }, { token: A.token });
  assert.deepEqual(spoof.json.orders.map((o) => o.orderNumber).sort(), [...numbers].sort());
});

test("my-orders: payload is allowlisted — no internal/supplier/staff-note/history/contact-of-others keys", async () => {
  const r = await c.fn("my-orders", {}, { token: A.token });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ["orders"]);
  for (const o of r.json.orders) assertCustomerSafe(o, `my-orders ${o.orderNumber}`, { otherContacts: [contact.B, contact.G] });
  const a2 = r.json.orders.find((o) => o.orderNumber === orders.A2);
  assert.deepEqual(a2.supplierConfirmation.status, "confirmed", "the customer still sees the decision itself");
  const a1 = r.json.orders.find((o) => o.orderNumber === orders.A1);
  assert.equal(a1.paymentStatus, "paid");
  assert.equal(a1.items[0].badge.badgeId, BADGE_ID);
});

test("track-order: guest tracking with order number + email (or phone) works and is sanitized", async () => {
  const byEmail = await c.fn("track-order", { orderNumber: orders.G1, contact: contact.G.email });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.json.order.orderNumber, orders.G1);
  assertCustomerSafe(byEmail.json.order, "track-order (email)", { otherContacts: [contact.A, contact.B] });

  const normalized = await c.fn("track-order", { orderNumber: ` ${orders.G1.toLowerCase()} `, contact: `  ${contact.G.email.toUpperCase()} ` });
  assert.equal(normalized.status, 200, "order number / email normalization");
  assert.equal(normalized.json.order.orderNumber, orders.G1);

  const byPhone = await c.fn("track-order", { orderNumber: orders.G1, contact: "050-000-0013" });
  assert.equal(byPhone.status, 200, "phone contact (normalized) must match");
  assertCustomerSafe(byPhone.json.order, "track-order (phone)");
});

test("track-order: wrong contact, another customer's contact, unknown number and short input all get the same 404", async () => {
  const cases = [
    { orderNumber: orders.G1, contact: "it-wrong@example.test" },
    { orderNumber: orders.G1, contact: contact.B.email },
    { orderNumber: orders.G1, contact: contact.B.phone },
    { orderNumber: orders.A1, contact: contact.G.email },
    { orderNumber: "CR-ZZZZZZ", contact: contact.G.email },
    { orderNumber: orders.G1, contact: "abc" },
    { orderNumber: "", contact: contact.G.email },
  ];
  for (const body of cases) {
    const r = await c.fn("track-order", body);
    assert.equal(r.status, 404, `${JSON.stringify(body)}: HTTP ${r.status}`);
    assert.deepEqual(r.json, { order: null }, "rejection must reveal nothing");
  }
});
