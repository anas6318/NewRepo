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
import {
  CUSTOMER_BADGE_KEYS,
  CUSTOMER_CONTACT_KEYS,
  CUSTOMER_HIDDEN_ORDER_FIELDS,
  CUSTOMER_ORDER_ITEM_KEYS,
  CUSTOMER_ORDER_KEYS,
  toCustomerOrder,
} from "../../src/lib/orders.ts";
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
  for (const field of [
    "internalNotes",
    "supplierReference",
    "trackingNumber",
    "trackingUrl",
    "productionStartedAt",
    "supplierDispatchedAt",
    "notification",
    "customerEmails",
  ]) {
    assert.ok(!(field in view), `${field} is still present`);
  }
  assert.deepEqual([...CUSTOMER_HIDDEN_ORDER_FIELDS].sort(), [
    "customerEmails",
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
  // The order shape now comes from the lifecycle module; the payment status
  // is still declared exactly once and still required there.
  assert.equal((src.match(/^\s*paymentStatus\??: string;$/gm) ?? []).length, 0, "admin-actions re-declares the order shape (it must use LifecycleOrder)");
  assert.ok(src.includes("as LifecycleOrder | undefined"), "admin-actions reads the order as LifecycleOrder");
  const lifecycle = read("../../supabase/functions/_shared/order-lifecycle.ts");
  const iface = lifecycle.slice(lifecycle.indexOf("export interface LifecycleOrder"), lifecycle.indexOf("export interface PaymentHistoryEntry"));
  const declarations = iface.match(/^\s*paymentStatus\??: string;$/gm) ?? [];
  assert.equal(declarations.length, 1, `expected one declaration, found ${declarations.length}`);
  assert.match(declarations[0]!, /paymentStatus: string;/, "it must stay required — the column is NOT NULL");
  // A2-B3 (deliberately fixed): confirming the supplier no longer derives
  // `payment_confirmed` from the payment METHOD — only from payment `paid`.
  assert.ok(!src.includes('order.paymentMethod === "bank_transfer" && order.paymentStatus !== "paid"'), "the method-based B3 branch is back");
  // Status columns are still written, now through the atomic RPC.
  assert.ok(src.includes("p_payment_status: statuses.paymentStatus ?? null"));
});

/* ── allowlist: unknown keys never pass, UI keys always do ──────────────── */

/** An order carrying internal keys nobody has thought of yet, at every level. */
const FUTURE_LEAKY = {
  ...JSON.parse(JSON.stringify(ORDER)),
  idempotency: { key: "IDEM-KEY-SECRET", requestHash: "HASH-SECRET" },
  adminAuditTrail: [{ by: "LEAK-STAFF", note: "LEAK-ORDER-NOTE" }],
  paymentProviderPayload: { raw: "LEAK-PROVIDER-RAW" },
  customer: { ...ORDER.customer, riskScore: "LEAK-RISK", ipAddress: "LEAK-IP" },
  items: [
    {
      ...JSON.parse(JSON.stringify(ORDER.items[0])),
      supplierSku: "LEAK-ITEM-SKU",
      costUsd: 9999,
      badge: { ...ORDER.items[0]!.badge, supplierCostUsd: "LEAK-BADGE-COST" },
    },
  ],
};
const FUTURE_SECRETS = [
  "IDEM-KEY-SECRET",
  "HASH-SECRET",
  "LEAK-STAFF",
  "LEAK-ORDER-NOTE",
  "LEAK-PROVIDER-RAW",
  "LEAK-RISK",
  "LEAK-IP",
  "LEAK-ITEM-SKU",
  "9999",
  "LEAK-BADGE-COST",
];

test("allowlist: unknown internal keys never reach the customer (app and edge)", () => {
  for (const [name, view] of [
    ["app", toCustomerOrder(FUTURE_LEAKY as unknown as Order)],
    ["edge", edge.toCustomerOrderData(JSON.parse(JSON.stringify(FUTURE_LEAKY)))],
  ] as const) {
    const json = JSON.stringify(view);
    for (const secret of [...FUTURE_SECRETS, ...OWNER_ONLY, "resend 401 invalid key"]) {
      assert.ok(!json.includes(secret), `${name}: ${secret} reached the customer`);
    }
    const v = view as Record<string, unknown>;
    for (const key of Object.keys(v)) assert.ok((CUSTOMER_ORDER_KEYS as readonly string[]).includes(key), `${name}: ${key} is not allowlisted`);
  }
});

test("allowlist: every key the customer UI renders still passes", () => {
  // Order-level keys read by ConfirmationPage, TrackOrderPage, AccountPage
  // and customerTimeline (src/lib/orders.ts).
  const uiOrderKeys = [
    "orderNumber", "createdAt", "locale", "customer", "items", "subtotalIls", "promotion", "promotionDiscountIls",
    "deliveryIls", "freeDelivery", "totalIls", "paymentMethod", "paymentStatus", "fulfillmentStatus", "tracking",
    "estimatedDeliveryAt", "supplierConfirmation", "customerVisibleMessage", "sheetsSync", "isDemo", "id", "zoneId",
  ];
  const uiItemKeys = ["productId", "slug", "title", "image", "version", "size", "personalization", "badge", "price", "unitPriceIls", "quantity", "lineTotalIls"];
  const full = {
    ...JSON.parse(JSON.stringify(ORDER)),
    items: [{ ...JSON.parse(JSON.stringify(ORDER.items[0])), sleeve: "long", patchId: "ucl", patchName: L("UCL") }],
  };
  for (const [name, view] of [
    ["app", toCustomerOrder(full as unknown as Order) as unknown as Record<string, unknown>],
    ["edge", edge.toCustomerOrderData(JSON.parse(JSON.stringify(full))) as Record<string, unknown>],
  ] as const) {
    for (const key of uiOrderKeys) assert.ok(key in view, `${name}: order.${key} was dropped`);
    const item = (view.items as Record<string, unknown>[])[0]!;
    for (const key of [...uiItemKeys, "sleeve", "patchId", "patchName"]) assert.ok(key in item, `${name}: item.${key} was dropped`);
    const badge = item.badge as Record<string, unknown>;
    for (const key of ["badgeId", "code", "name", "label", "priceIls"]) assert.ok(key in badge, `${name}: badge.${key} was dropped`);
    assert.deepEqual(view.customer, ORDER.customer, `${name}: customer contact changed`);
    assert.deepEqual(item.price, ORDER.items[0]!.price, `${name}: price breakdown changed`);
  }
});

test("allowlists are identical in the app and the edge mirror", () => {
  assert.deepEqual([...edge.CUSTOMER_ORDER_KEYS], [...CUSTOMER_ORDER_KEYS]);
  assert.deepEqual([...edge.CUSTOMER_ORDER_ITEM_KEYS], [...CUSTOMER_ORDER_ITEM_KEYS]);
  assert.deepEqual([...edge.CUSTOMER_CONTACT_KEYS], [...CUSTOMER_CONTACT_KEYS]);
  assert.deepEqual([...edge.CUSTOMER_BADGE_KEYS], [...CUSTOMER_BADGE_KEYS]);
});

test("no known internal field can ever be allowlisted", () => {
  for (const field of CUSTOMER_HIDDEN_ORDER_FIELDS) {
    assert.ok(!(CUSTOMER_ORDER_KEYS as readonly string[]).includes(field), `${field} is allowlisted`);
  }
  assert.ok(!(CUSTOMER_BADGE_KEYS as readonly string[]).includes("supplierReference"));
  for (const key of ["idempotency", "idempotencyKey", "requestHash", "contactHash"]) {
    assert.ok(!(CUSTOMER_ORDER_KEYS as readonly string[]).includes(key), `${key} is allowlisted`);
  }
});

test("the edge sanitizer tolerates non-object items and a missing customer", () => {
  const out = edge.toCustomerOrderData({ orderNumber: "CR-Y", items: [null, "x", { slug: "b", secret: "LEAK" }] });
  assert.deepEqual(out, { orderNumber: "CR-Y", items: [null, "x", { slug: "b" }] });
});

test("my-orders serves account history through the shared sanitizer", () => {
  const src = read("../../supabase/functions/my-orders/index.ts");
  assert.ok(src.includes('from "../_shared/customer-order.ts"'));
  assert.ok(src.includes("rows.map((row) => toCustomerOrderData(row.data))"));
});
