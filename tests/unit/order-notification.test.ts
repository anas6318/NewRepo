/**
 * Owner order-alert notifications.
 *
 * These exercise the REAL edge-function module
 * (supabase/functions/_shared/owner-notification.ts) rather than a copy, so
 * the contract cannot drift. It is imported through a computed specifier so
 * `tsc` does not pull a Deno-targeted file into the app's type program.
 *
 * The promise under test: an owner alert never lies about delivery, never
 * throws, never carries supplier secrets or the API key, and can never be
 * the reason a customer's order fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toCustomerOrder } from "../../src/lib/orders.ts";

const edgeSanitizer = await import(new URL("../../supabase/functions/_shared/customer-order.ts", import.meta.url).href);
const helperUrl = new URL("../../supabase/functions/_shared/owner-notification.ts", import.meta.url).href;
const {
  adminOrderUrl,
  buildOwnerOrderEmail,
  escapeHtml,
  redactError,
  sendOwnerOrderNotification,
  shouldSendOwnerNotification,
} = await import(helperUrl);

const API_KEY = "re_live_abcdef0123456789";

const CONFIG = {
  provider: "resend",
  recipient: "owner@crowned.example",
  from: "orders@crowned.example",
  apiKey: API_KEY,
  adminBaseUrl: "https://crowned.example",
};

/** A realistic order as place-order builds it, including the internal bits
 * that must NOT travel: badge supplier reference and an internal note. */
const ORDER = {
  orderNumber: "CR-AB12CD",
  createdAt: "2026-09-07T09:30:00.000Z",
  locale: "ar",
  customer: {
    name: "Anas Test",
    email: "customer@example.com",
    phone: "0521234567",
    city: "Haifa",
    address: "12 Example St",
    notes: "Please call before delivery",
  },
  items: [
    {
      productId: "demo-crimson-2005",
      slug: "crimson-2005",
      title: { ar: "قميص", he: "חולצה", en: "Crimson Home 2005" },
      quantity: 2,
      size: "L",
      version: "player",
      sleeve: "long",
      personalization: { name: "RONALDO", number: "7" },
      badge: { badgeId: "ucl", name: { ar: "ش", he: "פ", en: "Champions League badge" }, priceIls: 12, supplierReference: "SUP-BDG-UCL-01" },
      unitPriceIls: 182,
      lineTotalIls: 364,
    },
    {
      slug: "royal-1998",
      title: { en: "Royal Away 1998" },
      quantity: 1,
      size: "M",
      unitPriceIls: 170,
      lineTotalIls: 170,
    },
  ],
  subtotalIls: 534,
  promotion: { labelText: "Buy 2, get 15% off the second item" },
  promotionDiscountIls: 25.5,
  deliveryIls: 0,
  freeDelivery: true,
  totalIls: 508.5,
  paymentMethod: "bank_transfer",
  paymentStatus: "awaiting_payment",
  fulfillmentStatus: "awaiting_supplier_confirmation",
  supplierConfirmation: { required: true, status: "pending", items: [{ slug: "crimson-2005", version: "player", size: "L" }] },
  internalNotes: "Check stock with supplier B",
  notification: { status: "pending" },
};

/** A fetch double that records calls and answers however the test wants. */
function fakeFetch(reply: () => Promise<unknown> | unknown) {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fn = async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    const value = await reply();
    return value;
  };
  return { fn, calls };
}

const ok = () => ({ ok: true, status: 200, text: async () => "{}" });

/* ── 1 · a successful order sends exactly one notification ──────────────── */

test("a configured provider sends exactly one owner email and reports sent", async () => {
  const { fn, calls } = fakeFetch(ok);
  const result = await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });

  assert.equal(result.status, "sent");
  assert.equal(result.error, undefined);
  assert.ok(result.lastAttemptAt, "records when the attempt happened");
  assert.equal(calls.length, 1, "exactly one provider call");
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");

  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.to, "owner@crowned.example");
  assert.equal(body.from, "orders@crowned.example");
  assert.match(body.subject, /CR-AB12CD/);
});

/* ── 2 · the email carries what the owner needs to act ──────────────────── */

test("the owner email contains every field needed to fulfil the order", async () => {
  const built = buildOwnerOrderEmail(ORDER, "https://crowned.example");
  const all = `${built.subject}\n${built.text}\n${built.html}`;

  for (const needle of [
    "CR-AB12CD", // order number
    "2026-09-07 09:30 UTC", // created time
    "Anas Test", // customer name
    "0521234567", // phone
    "customer@example.com", // email
    "Haifa", // city
    "12 Example St", // address
    "bank_transfer", // payment method
    "awaiting_payment", // payment status
    "awaiting_supplier_confirmation", // fulfillment status
    "₪534", // subtotal
    "free delivery applied", // free delivery flag
    "₪508.5", // total
    "Crimson Home 2005", // item name
    "×2", // quantity
    "size L", // size
    "version player", // version
    "long sleeve", // sleeve
    "RONALDO 7", // personalization
    "Champions League badge", // badge
    "₪182/unit", // unit price
    "₪364", // line total
    "Waiting for supplier confirmation", // supplier gate
    "Check stock with supplier B", // internal note
    "Please call before delivery", // customer note
    "https://crowned.example/admin/orders/CR-AB12CD", // direct admin link
  ]) {
    assert.ok(all.includes(needle), `missing from the owner email: ${needle}`);
  }
  // The promotion is shown as its own line, as it is everywhere else.
  assert.ok(all.includes("Buy 2, get 15% off the second item"));
  assert.ok(all.includes("−₪25.5"));
});

test("an item with no badge says so rather than going silent", () => {
  const built = buildOwnerOrderEmail(ORDER);
  assert.ok(built.text.includes("no badge"));
});

/* ── 3 · nothing private travels in the email ───────────────────────────── */

test("supplier secrets never reach the owner email", async () => {
  const { fn, calls } = fakeFetch(ok);
  await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });
  const payload = String(calls[0]!.init.body);
  const built = buildOwnerOrderEmail(ORDER, CONFIG.adminBaseUrl);

  for (const secret of ["SUP-BDG-UCL-01", "supplierReference", "costUsd", "supplier_ref"]) {
    assert.ok(!payload.includes(secret), `${secret} leaked into the email payload`);
    assert.ok(!built.html.includes(secret), `${secret} leaked into the email html`);
    assert.ok(!built.text.includes(secret), `${secret} leaked into the email text`);
  }
});

test("the API key is never echoed into anything that gets stored", async () => {
  const { fn } = fakeFetch(() => ({ ok: false, status: 401, text: async () => `{"message":"invalid key ${API_KEY}"}` }));
  const result = await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });
  assert.equal(result.status, "failed");
  assert.ok(!JSON.stringify(result).includes(API_KEY), "the key survived into the persisted result");
  assert.ok(result.error.includes("[redacted]"));
});

test("customer-supplied text cannot inject markup into the owner email", () => {
  const built = buildOwnerOrderEmail(
    { ...ORDER, customer: { ...ORDER.customer, name: '<img src=x onerror="alert(1)">' } },
    "",
  );
  assert.ok(!built.html.includes("<img src=x"), "raw markup reached the html body");
  assert.ok(built.html.includes("&lt;img"));
  assert.equal(escapeHtml("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("redactError strips key-shaped values and caps the length", () => {
  assert.ok(!redactError(`boom ${API_KEY}`).includes(API_KEY));
  assert.ok(!redactError("Authorization: Bearer abc.def-123").includes("abc.def-123"));
  assert.ok(redactError('{"api_key":"0123456789abcdef"}').includes("[redacted]"));
  assert.ok(redactError("x".repeat(1000)).length <= 300);
});

/* ── 4 · failure never becomes a checkout failure ───────────────────────── */

test("a provider error is reported, not thrown", async () => {
  const { fn } = fakeFetch(() => ({ ok: false, status: 500, text: async () => "upstream exploded" }));
  const result = await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });
  assert.equal(result.status, "failed");
  assert.match(result.error, /resend 500/);
  assert.ok(result.lastAttemptAt);
});

test("a network failure is reported, not thrown", async () => {
  const fn = async () => {
    throw new TypeError("fetch failed");
  };
  const result = await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });
  assert.equal(result.status, "failed");
  assert.match(result.error, /fetch failed/);
});

test("an unreadable error body still produces a clean failed result", async () => {
  const { fn } = fakeFetch(() => ({
    ok: false,
    status: 502,
    text: async () => {
      throw new Error("stream already consumed");
    },
  }));
  const result = await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });
  assert.equal(result.status, "failed");
  assert.match(result.error, /resend 502/);
});

test("sendOwnerOrderNotification never rejects, whatever the provider does", async () => {
  for (const reply of [
    () => {
      throw new Error("sync throw");
    },
    () => Promise.reject(new Error("async reject")),
    () => null,
    () => undefined,
  ]) {
    const { fn } = fakeFetch(reply as () => unknown);
    const result = await sendOwnerOrderNotification(ORDER, CONFIG, { fetch: fn });
    assert.equal(result.status, "failed", "every provider misbehaviour resolves to a status");
  }
});

/* ── 5 · disabled configurations are honest and cost nothing ────────────── */

test("console mode is reported as disabled and contacts no provider", async () => {
  const { fn, calls } = fakeFetch(ok);
  const result = await sendOwnerOrderNotification(ORDER, { ...CONFIG, provider: "console" }, { fetch: fn });
  assert.equal(result.status, "disabled");
  assert.match(result.error, /EMAIL_PROVIDER=console/);
  assert.equal(calls.length, 0);
});

test("no recipient means disabled, not a failed send", async () => {
  const { fn, calls } = fakeFetch(ok);
  const result = await sendOwnerOrderNotification(ORDER, { ...CONFIG, recipient: "" }, { fetch: fn });
  assert.equal(result.status, "disabled");
  assert.match(result.error, /ORDER_NOTIFICATION_EMAIL/);
  assert.equal(calls.length, 0);
});

test("resend selected without a key is a visible failure, never a silent fallback", async () => {
  const { fn, calls } = fakeFetch(ok);
  const result = await sendOwnerOrderNotification(ORDER, { ...CONFIG, apiKey: "" }, { fetch: fn });
  assert.equal(result.status, "failed");
  assert.match(result.error, /RESEND_API_KEY/);
  assert.equal(calls.length, 0, "no pointless provider call");
});

test("a disabled or failed alert is never reported as sent", async () => {
  for (const config of [
    { ...CONFIG, provider: "console" },
    { ...CONFIG, recipient: "" },
    { ...CONFIG, apiKey: "" },
  ]) {
    const { fn } = fakeFetch(ok);
    const result = await sendOwnerOrderNotification(ORDER, config, { fetch: fn });
    assert.notEqual(result.status, "sent");
  }
});

/* ── 6 · duplicate protection ───────────────────────────────────────────── */

test("an order is eligible for exactly one owner alert", () => {
  assert.equal(shouldSendOwnerNotification({}), true, "an order with no record yet");
  assert.equal(shouldSendOwnerNotification({ notification: { status: "pending" } }), true);
  assert.equal(shouldSendOwnerNotification({ notification: { status: "sent" } }), false);
  assert.equal(shouldSendOwnerNotification({ notification: { status: "failed" } }), false);
  assert.equal(shouldSendOwnerNotification({ notification: { status: "disabled" } }), false);
});

/* ── 7 · the admin deep link is optional, never fabricated ──────────────── */

test("the admin link is omitted when no base URL is configured", () => {
  assert.equal(adminOrderUrl("", "CR-AB12CD"), "");
  assert.equal(adminOrderUrl("https://x.test/", "CR-AB12CD"), "https://x.test/admin/orders/CR-AB12CD");
  const built = buildOwnerOrderEmail(ORDER, "");
  assert.ok(!built.text.includes("Open in Admin"));
});

/* ── 8 · the order flow calls this in the right place, once ─────────────── */

const placeOrderSrc = readFileSync(
  fileURLToPath(new URL("../../supabase/functions/place-order/index.ts", import.meta.url)),
  "utf8",
);

test("the owner alert runs only after the order row is committed", () => {
  const insert = placeOrderSrc.indexOf('dbInsert("orders"');
  const send = placeOrderSrc.indexOf("await sendOwnerOrderNotification(");
  assert.ok(insert > 0, "place-order still inserts the order");
  assert.ok(send > 0, "place-order still sends the owner alert");
  assert.ok(send > insert, "the alert must not run before the order is persisted");
  assert.ok(placeOrderSrc.indexOf("return json({ ok: true") > send, "the success response comes after the alert");
});

test("the alert is attempted once, behind the duplicate guard", () => {
  assert.equal(placeOrderSrc.split("await sendOwnerOrderNotification(").length - 1, 1);
  assert.ok(placeOrderSrc.includes("if (shouldSendOwnerNotification(orderData))"));
});

test("the customer's copy of the order never carries the alert record", () => {
  // The checkout response goes through the shared customer-order sanitizer,
  // which drops `notification` along with every other owner-only field —
  // see tests/unit/customer-order.test.ts for the field-by-field proof.
  assert.ok(placeOrderSrc.includes("order: toCustomerOrderData(orderData)"));
  assert.ok(!placeOrderSrc.includes("order: orderData }"), "the raw order must not be returned to the browser");
});

test("no other edge function sends owner notifications", () => {
  const others = ["admin-actions", "payments-webhook", "sheets-sync", "submit-review", "track-order"];
  for (const name of others) {
    const src = readFileSync(fileURLToPath(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url)), "utf8");
    assert.ok(!src.includes("sendOwnerOrderNotification"), `${name} must not send owner alerts`);
  }
});

test("both customer-order sanitizers remove the alert record", () => {
  // Rendered-page checks cannot see a field the UI simply never prints, so
  // the data-level guarantee is pinned by running the real sanitizers. Which
  // routes use them is covered by tests/unit/customer-order.test.ts.
  const withAlert = {
    orderNumber: "CR-AB12CD",
    items: [],
    sheetsSync: { status: "pending" },
    notification: { status: "failed", error: "resend 401 invalid key" },
  };
  const app = toCustomerOrder(withAlert as never) as Record<string, unknown>;
  const edgeView = edgeSanitizer.toCustomerOrderData({ ...withAlert }) as Record<string, unknown>;
  for (const [label, view] of [["app", app], ["edge", edgeView]] as [string, Record<string, unknown>][]) {
    assert.ok(!("notification" in view), `${label} sanitizer kept the alert record`);
    assert.ok(!JSON.stringify(view).includes("resend 401"), `${label} sanitizer leaked the provider error`);
  }
});

test("no notification secret name appears anywhere in the frontend bundle sources", () => {
  // Server-side only: these must never become VITE_ variables or be read by src/.
  const names = ["RESEND_API_KEY", "ORDER_NOTIFICATION_EMAIL", "EMAIL_PROVIDER", "EMAIL_FROM"];
  const srcFiles = [
    "../../src/lib/env.ts",
    "../../src/services/store.tsx",
    "../../src/pages/admin/AdminOrders.tsx",
    "../../src/services/demo/DemoDataService.ts",
    "../../src/services/supabase/SupabaseDataService.ts",
  ];
  for (const rel of srcFiles) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    for (const name of names) assert.ok(!src.includes(name), `${name} referenced in ${rel}`);
  }
});
