/**
 * What a customer may see of their own order.
 *
 * An order row is written for the OWNER: it carries supplier references,
 * carrier details, staff decisions and ops bookkeeping next to the things
 * the customer is entitled to. Every customer-facing response — checkout,
 * guest tracking, account order history — must go through one sanitizer, and
 * the two implementations of it (app + edge functions) must agree.
 *
 * The edge mirror is imported through a computed specifier so `tsc` does not
 * pull a Deno-targeted file into the app's type program.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CUSTOMER_HIDDEN_ORDER_FIELDS, toCustomerOrder } from "../../src/lib/orders.ts";
import type { Order } from "../../src/services/types.ts";

const edgeUrl = new URL("../../supabase/functions/_shared/customer-order.ts", import.meta.url).href;
const edge = await import(edgeUrl);

const L = (v: string) => ({ ar: v, he: v, en: v });

/** Every internal value below is a sentinel: if one shows up in a
 * customer-facing response, the assertion names it. */
const OWNER_ONLY = [
  "STAFF-ONLY-NOTE",
  "SUP-REF-9",
  "TRACK-123",
  "https://carrier.example/TRACK-123",
  "SUP-BDG-UCL-01",
  "staff@crowned.example",
  "supplier said maybe",
  "google sheets 403 denied",
];

const ORDER = {
  id: "ord-1",
  orderNumber: "CR-AB12CD",
  createdAt: "2026-09-07T09:30:00.000Z",
  locale: "en",
  customer: { name: "Anas", email: "c@example.com", phone: "0521234567", city: "Haifa", address: "12 Example St", customerId: "cust-1" },
  items: [
    {
      productId: "demo-crimson-2005",
      slug: "crimson-2005",
      title: L("Crimson Home 2005"),
      image: "/demo/p-crimson-2005.webp",
      size: "L",
      version: "player",
      personalization: { name: "RONALDO", number: "7" },
      badge: { badgeId: "ucl", code: "ucl", name: L("Champions League badge"), label: "Champions League badge", priceIls: 12, supplierReference: "SUP-BDG-UCL-01" },
      price: { regularBasePriceIls: 170, versionAdjustmentIls: 20, optionAdjustmentsIls: 0, badgeAdjustmentIls: 12, regularUnitPriceIls: 202, saleDiscountIls: 20, finalUnitPriceIls: 182 },
      unitPriceIls: 182,
      quantity: 2,
      lineTotalIls: 364,
    },
  ],
  subtotalIls: 364,
  promotion: { promotionId: "second-item-15", labelText: "Buy 2, get 15% off the second item", discountIls: 25.5 },
  promotionDiscountIls: 25.5,
  deliveryIls: 0,
  freeDelivery: true,
  totalIls: 338.5,
  zoneId: "center",
  paymentMethod: "bank_transfer",
  paymentStatus: "awaiting_payment",
  fulfillmentStatus: "awaiting_supplier_confirmation",
  tracking: [{ status: "order_received", at: "2026-09-07T09:30:00.000Z" }],
  estimatedDeliveryAt: "2026-09-21T00:00:00.000Z",
  customerVisibleMessage: L("We will confirm your size with the supplier."),
  // ── everything below belongs to the owner ──
  internalNotes: "STAFF-ONLY-NOTE",
  supplierReference: "SUP-REF-9",
  trackingNumber: "TRACK-123",
  trackingUrl: "https://carrier.example/TRACK-123",
  productionStartedAt: "2026-09-08T00:00:00.000Z",
  supplierDispatchedAt: "2026-09-09T00:00:00.000Z",
  supplierConfirmation: {
    required: true,
    status: "confirmed",
    items: [{ slug: "crimson-2005", version: "player", size: "L" }],
    decidedBy: "staff@crowned.example",
    decidedAt: "2026-09-08T00:00:00.000Z",
    note: "supplier said maybe",
  },
  sheetsSync: { status: "failed", lastAttemptAt: "2026-09-07T09:31:00.000Z", error: "google sheets 403 denied" },
  notification: { status: "failed", lastAttemptAt: "2026-09-07T09:30:05.000Z", error: "resend 401 invalid key" },
  isDemo: false,
} as unknown as Order;

/* ── nothing owner-only survives ────────────────────────────────────────── */

test("no owner-only value survives into a customer's view of their order", () => {
  const json = JSON.stringify(toCustomerOrder(ORDER));
  for (const secret of [...OWNER_ONLY, "resend 401 invalid key"]) {
    assert.ok(!json.includes(secret), `${secret} reached the customer`);
  }
});

test("each listed internal field is removed by name", () => {
  const view = toCustomerOrder(ORDER) as unknown as Record<string, unknown>;
  for (const field of ["internalNotes", "supplierReference", "trackingNumber", "trackingUrl", "productionStartedAt", "supplierDispatchedAt", "notification"]) {
    assert.ok(!(field in view), `${field} is still present`);
  }
  assert.deepEqual([...CUSTOMER_HIDDEN_ORDER_FIELDS].sort(), [
    "internalNotes",
    "notification",
    "productionStartedAt",
    "supplierDispatchedAt",
    "supplierReference",
    "trackingNumber",
    "trackingUrl",
  ]);
});

test("the badge snapshot loses the owner's supplier reference but keeps name and price", () => {
  const item = toCustomerOrder(ORDER).items[0]!;
  assert.equal(item.badge?.supplierReference, undefined);
  assert.equal(item.badge?.label, "Champions League badge");
  assert.equal(item.badge?.priceIls, 12);
});

test("a supplier decision keeps its outcome and loses the staff identity and note", () => {
  const confirmation = toCustomerOrder(ORDER).supplierConfirmation!;
  assert.equal(confirmation.required, true);
  assert.equal(confirmation.status, "confirmed");
  assert.deepEqual(confirmation.items, [{ slug: "crimson-2005", version: "player", size: "L" }]);
  assert.equal(confirmation.decidedBy, undefined);
  assert.equal(confirmation.decidedAt, undefined);
  assert.equal(confirmation.note, undefined);
});

test("the Sheets record keeps only its state, never the provider error", () => {
  const sheets = toCustomerOrder(ORDER).sheetsSync;
  assert.equal(sheets.status, "failed");
  assert.equal(sheets.error, undefined);
  assert.equal(sheets.lastAttemptAt, undefined);
});

/* ── everything the customer needs is still there ───────────────────────── */

test("the customer keeps everything they need to follow their own order", () => {
  const view = toCustomerOrder(ORDER);
  assert.equal(view.orderNumber, "CR-AB12CD");
  assert.equal(view.createdAt, ORDER.createdAt);
  assert.equal(view.fulfillmentStatus, "awaiting_supplier_confirmation");
  assert.equal(view.paymentStatus, "awaiting_payment");
  assert.equal(view.paymentMethod, "bank_transfer");
  assert.deepEqual(view.tracking, ORDER.tracking);
  assert.equal(view.subtotalIls, 364);
  assert.equal(view.deliveryIls, 0);
  assert.equal(view.freeDelivery, true);
  assert.equal(view.totalIls, 338.5);
  assert.equal(view.promotionDiscountIls, 25.5);
  assert.equal(view.promotion?.labelText, "Buy 2, get 15% off the second item");
  assert.equal(view.estimatedDeliveryAt, ORDER.estimatedDeliveryAt);
  assert.deepEqual(view.customerVisibleMessage, ORDER.customerVisibleMessage);
  assert.deepEqual(view.customer, ORDER.customer);
  // Item data and its price breakdown are the customer's own record.
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0]!.quantity, 2);
  assert.equal(view.items[0]!.size, "L");
  assert.deepEqual(view.items[0]!.personalization, { name: "RONALDO", number: "7" });
  assert.equal(view.items[0]!.lineTotalIls, 364);
  assert.deepEqual(view.items[0]!.price, ORDER.items[0]!.price);
});

test("sanitizing never mutates the stored order the owner reads", () => {
  const before = JSON.stringify(ORDER);
  toCustomerOrder(ORDER);
  assert.equal(JSON.stringify(ORDER), before, "the owner's copy was modified in place");
});

/* ── the app and the edge functions agree, field for field ──────────────── */

test("the edge-function sanitizer produces exactly the same result", () => {
  assert.deepEqual(edge.toCustomerOrderData(JSON.parse(JSON.stringify(ORDER))), JSON.parse(JSON.stringify(toCustomerOrder(ORDER))));
});

test("both sanitizers hide the same named fields", () => {
  assert.deepEqual([...edge.CUSTOMER_HIDDEN_ORDER_FIELDS], [...CUSTOMER_HIDDEN_ORDER_FIELDS]);
});

test("the edge sanitizer survives orders that are missing pieces", () => {
  assert.deepEqual(edge.toCustomerOrderData({}), {});
  const partial = edge.toCustomerOrderData({ orderNumber: "CR-X", items: [{ slug: "a" }] });
  assert.equal(partial.orderNumber, "CR-X");
  assert.deepEqual(partial.items, [{ slug: "a" }]);
});

/* ── every customer-facing route actually uses it ───────────────────────── */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("every customer-facing order response goes through the sanitizer", () => {
  const demo = read("../../src/services/demo/DemoDataService.ts");
  // placeOrder result, guest tracking and account order history.
  assert.equal(demo.split("toCustomerOrder(").length - 1, 2, "demo: placeOrder + trackOrder");
  assert.ok(demo.includes(".map(toCustomerOrder)"), "demo: account order history");

  const supabase = read("../../src/services/supabase/SupabaseDataService.ts");
  assert.ok(supabase.includes("rows.map((r) => toCustomerOrder(r.data))"), "supabase: account order history");

  const placeOrder = read("../../supabase/functions/place-order/index.ts");
  assert.ok(placeOrder.includes("order: toCustomerOrderData(orderData)"), "place-order: checkout response");

  const trackOrder = read("../../supabase/functions/track-order/index.ts");
  assert.ok(trackOrder.includes("toCustomerOrderData(row.data"), "track-order: guest tracking");
});

test("no customer-facing path hand-rolls its own stripping any more", () => {
  for (const rel of [
    "../../src/services/demo/DemoDataService.ts",
    "../../src/services/supabase/SupabaseDataService.ts",
    "../../supabase/functions/track-order/index.ts",
    "../../supabase/functions/place-order/index.ts",
  ]) {
    const src = read(rel);
    for (const stale of ["delete sanitized.", "delete view.", "delete data.internalNotes", "delete customerOrder."]) {
      assert.ok(!src.includes(stale), `${rel} still strips fields by hand (${stale})`);
    }
  }
});

/* ── the duplicate declaration that shadowed the payment status is gone ─── */

test("admin-actions declares paymentStatus exactly once, and still requires it", () => {
  const src = read("../../supabase/functions/admin-actions/index.ts");
  const declarations = src.match(/^\s*paymentStatus\??: string;$/gm) ?? [];
  assert.equal(declarations.length, 1, `expected one declaration, found ${declarations.length}`);
  assert.match(declarations[0]!, /paymentStatus: string;/, "it must stay required — the column is NOT NULL");
  // The behaviour that reads it is untouched.
  assert.ok(src.includes('order.paymentMethod === "bank_transfer" && order.paymentStatus !== "paid"'));
  assert.ok(src.includes("payment_status: order.paymentStatus"));
});
