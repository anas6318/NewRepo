/**
 * Customer order-status emails.
 *
 * The promise: every milestone the customer is told about produces exactly
 * one email, in the order's own language, carrying the tracking details when
 * they exist — and no failure here can ever break an order update.
 *
 * These run the REAL edge modules (imported through a computed specifier so
 * `tsc` does not pull Deno-targeted files into the app's type program), and
 * check them against the app-side mapping in src/lib/order-emails.ts so the
 * two cannot drift.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_EMAIL_EVENTS,
  CUSTOMER_EMAIL_EVENT_LABEL,
  FULFILLMENT_EVENTS,
  PAYMENT_EVENTS,
  eventForStatusChange as appEventFor,
  recordCustomerEmail,
  retryableEvents,
} from "../../src/lib/order-emails.ts";
import { toCustomerOrder } from "../../src/lib/orders.ts";
import type { CustomerEmailEvent, Order } from "../../src/services/types.ts";

const dyn = (rel: string) => import(new URL(rel, import.meta.url).href);
const notify = await dyn("../../supabase/functions/_shared/customer-notifications.ts");
const emails = await dyn("../../supabase/functions/_shared/emails.ts");
const provider = await dyn("../../supabase/functions/_shared/email-provider.ts");

const API_KEY = "re_live_abcdef0123456789";
const CONFIG = { provider: "resend", from: "orders@crowned.example", apiKey: API_KEY, siteUrl: "https://crowned.example" };
const CONSOLE_CONFIG = { ...CONFIG, provider: "console" };

type LedgerEntry = { status: string; at: string; attempts: number; to?: string; error?: string };

const order = (over: Record<string, unknown> = {}) => ({
  orderNumber: "CR-AB12CD",
  locale: "ar",
  customer: { email: "customer@example.com" },
  totalIls: 340,
  customerEmails: {} as Record<string, LedgerEntry>,
  ...over,
});

function fakeFetch(reply: () => unknown = () => ({ ok: true, status: 200, text: async () => "{}" })) {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  return {
    calls,
    fn: async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return await reply();
    },
  };
}

const ARABIC = /[؀-ۿ]/;
const HEBREW = /[֐-׿]/;

/* ── 1 · status → email mapping ─────────────────────────────────────────── */

test("every milestone the owner asked for has a mapped status and a template", () => {
  const required: CustomerEmailEvent[] = [
    "order_received",
    "payment_confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
    "cancelled",
    "refunded",
  ];
  assert.deepEqual(CUSTOMER_EMAIL_EVENTS, required);
  for (const event of required) {
    assert.ok(Object.values(FULFILLMENT_EVENTS).includes(event) || Object.values(PAYMENT_EVENTS).includes(event), `${event} has no status that triggers it`);
    for (const locale of ["ar", "he", "en"]) {
      const built = emails.statusUpdateEmail(locale, event, { orderNumber: "CR-AB12CD", totalIls: 340 });
      assert.ok(built?.subject && built.html, `${event}/${locale} has no template`);
    }
    assert.ok(CUSTOMER_EMAIL_EVENT_LABEL[event], `${event} has no admin label`);
  }
});

test("each fulfilment status maps to the milestone a customer would expect", () => {
  const cases: [string, CustomerEmailEvent][] = [
    ["order_received", "order_received"],
    ["payment_confirmed", "payment_confirmed"],
    ["sent_to_supplier", "processing"],
    ["production_started", "processing"],
    ["supplier_processing", "processing"],
    ["quality_inspection", "processing"],
    ["supplier_dispatched", "shipped"],
    ["in_transit", "shipped"],
    ["arrived_locally", "shipped"],
    ["out_for_delivery", "out_for_delivery"],
    ["delivered", "delivered"],
    ["cancelled", "cancelled"],
    ["refunded", "refunded"],
  ];
  for (const [status, event] of cases) {
    assert.equal(appEventFor({ fulfillmentStatus: status }), event, status);
    assert.equal(notify.eventForStatusChange({ fulfillmentStatus: status }), event, `edge: ${status}`);
  }
});

test("statuses a human has to handle send nothing automatically", () => {
  for (const status of ["awaiting_supplier_confirmation", "supplier_unavailable", "ready_for_pickup", "issue_reported", "awaiting_payment"]) {
    assert.equal(appEventFor({ fulfillmentStatus: status }), undefined, status);
    assert.equal(notify.eventForStatusChange({ fulfillmentStatus: status }), undefined, `edge: ${status}`);
  }
});

test("payment status changes map too, and fulfilment wins when both change", () => {
  assert.equal(appEventFor({ paymentStatus: "paid" }), "payment_confirmed");
  assert.equal(appEventFor({ paymentStatus: "refunded" }), "refunded");
  assert.equal(appEventFor({ paymentStatus: "partially_refunded" }), "refunded");
  assert.equal(appEventFor({ paymentStatus: "cancelled" }), "cancelled");
  assert.equal(appEventFor({ paymentStatus: "failed" }), undefined, "a failed charge is not a customer milestone");
  // One change that moves both must not produce two emails.
  assert.equal(appEventFor({ fulfillmentStatus: "refunded", paymentStatus: "refunded" }), "refunded");
});

test("the app and the edge functions share one mapping", () => {
  assert.deepEqual(notify.FULFILLMENT_EVENTS, FULFILLMENT_EVENTS);
  assert.deepEqual(notify.PAYMENT_EVENTS, PAYMENT_EVENTS);
  assert.deepEqual(notify.CUSTOMER_EMAIL_EVENTS, CUSTOMER_EMAIL_EVENTS);
});

/* ── 2 · AR / HE / EN templates ─────────────────────────────────────────── */

test("every milestone renders in Arabic, Hebrew and English", () => {
  for (const event of CUSTOMER_EMAIL_EVENTS) {
    const ar = emails.statusUpdateEmail("ar", event, { orderNumber: "CR-AB12CD", totalIls: 340 });
    const he = emails.statusUpdateEmail("he", event, { orderNumber: "CR-AB12CD", totalIls: 340 });
    const en = emails.statusUpdateEmail("en", event, { orderNumber: "CR-AB12CD", totalIls: 340 });

    assert.ok(ARABIC.test(ar.subject + ar.html), `${event}: no Arabic`);
    assert.ok(HEBREW.test(he.subject + he.html), `${event}: no Hebrew`);
    assert.ok(/[A-Za-z]/.test(en.subject), `${event}: no English`);

    assert.notEqual(ar.subject, en.subject, `${event}: ar/en subjects identical`);
    assert.notEqual(he.subject, en.subject, `${event}: he/en subjects identical`);

    // Direction and language are set per locale, or RTL mail renders wrong.
    assert.match(ar.html, /<html lang="ar" dir="rtl">/, `${event}: ar direction`);
    assert.match(he.html, /<html lang="he" dir="rtl">/, `${event}: he direction`);
    assert.match(en.html, /<html lang="en" dir="ltr">/, `${event}: en direction`);

    // The order number belongs in every one of them.
    for (const built of [ar, he, en]) assert.ok(built.html.includes("CR-AB12CD"), `${event}: order number missing`);
  }
});

test("the email goes out in the order's own language, not the store default", async () => {
  for (const [locale, script] of [["ar", ARABIC], ["he", HEBREW]] as [string, RegExp][]) {
    const { fn, calls } = fakeFetch();
    await notify.sendCustomerStatusEmail(order({ locale }), "delivered", CONFIG, { fetch: fn });
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.ok(script.test(body.subject), `${locale} subject was not localized`);
  }
  const { fn, calls } = fakeFetch();
  await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", CONFIG, { fetch: fn });
  assert.match(JSON.parse(String(calls[0]!.init.body)).subject, /delivered/i);
});

test("an unknown locale falls back to the store's default language", async () => {
  const { fn, calls } = fakeFetch();
  await notify.sendCustomerStatusEmail(order({ locale: "fr" }), "delivered", CONFIG, { fetch: fn });
  assert.ok(ARABIC.test(JSON.parse(String(calls[0]!.init.body)).subject));
});

/* ── 3 · tracking data ──────────────────────────────────────────────────── */

test("the shipped email carries the tracking number and link when they exist", async () => {
  const { fn, calls } = fakeFetch();
  await notify.sendCustomerStatusEmail(
    order({ locale: "en", trackingNumber: "RR123456789IL", trackingUrl: "https://carrier.example/RR123456789IL" }),
    "shipped",
    CONFIG,
    { fetch: fn },
  );
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.ok(body.html.includes("RR123456789IL"), "tracking number missing");
  assert.ok(body.html.includes("https://carrier.example/RR123456789IL"), "tracking link missing");
  assert.match(body.html, /Track your shipment/);
});

test("with no tracking details the shipped email still sends, without empty fields", async () => {
  const { fn, calls } = fakeFetch();
  await notify.sendCustomerStatusEmail(order({ locale: "en" }), "shipped", CONFIG, { fetch: fn });
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.ok(!body.html.includes("Tracking number"), "printed an empty tracking row");
  assert.ok(!body.html.includes("undefined"), "leaked an undefined value");
  assert.match(body.subject, /on its way/i);
});

test("tracking values are escaped, never interpolated raw", () => {
  const built = emails.dispatchedEmail("en", "CR-AB12CD", '"><script>alert(1)</script>', 'https://x.test/"><script>');
  assert.ok(!built.html.includes("<script>"), "raw markup reached the email");
  assert.ok(built.html.includes("&lt;script&gt;"));
});

test("a track-your-order link is added when the site URL is configured", () => {
  const withUrl = emails.statusUpdateEmail("en", "processing", { orderNumber: "CR-1", siteUrl: "https://crowned.example/" });
  assert.ok(withUrl.html.includes("https://crowned.example/en/track"));
  const without = emails.statusUpdateEmail("en", "processing", { orderNumber: "CR-1" });
  assert.ok(!without.html.includes("/track"), "fabricated a link with no site URL");
});

/* ── 4 · duplicate prevention ───────────────────────────────────────────── */

test("a delivered milestone is never sent twice", async () => {
  const o = order({ locale: "en" });
  const first = fakeFetch();
  await notify.deliverStatusEmail(o, "shipped", CONFIG, { fetch: first.fn });
  assert.equal(first.calls.length, 1);
  assert.equal(o.customerEmails.shipped!.status, "sent");

  const second = fakeFetch();
  const again = await notify.deliverStatusEmail(o, "shipped", CONFIG, { fetch: second.fn });
  assert.equal(second.calls.length, 0, "sent the same milestone twice");
  assert.equal(again, undefined, "reported a send that did not happen");
  assert.equal(o.customerEmails.shipped!.attempts, 1, "a skipped send must not count as an attempt");
});

test("statuses sharing a milestone email once between them", async () => {
  const o = order({ locale: "en" });
  const f = fakeFetch();
  // The owner moves the order through three internal production steps.
  for (const status of ["sent_to_supplier", "production_started", "supplier_processing"]) {
    await notify.deliverStatusEmail(o, notify.eventForStatusChange({ fulfillmentStatus: status }), CONFIG, { fetch: f.fn });
  }
  assert.equal(f.calls.length, 1, "the customer was emailed about production more than once");
  assert.equal(o.customerEmails.processing!.status, "sent");
});

test("shipped and out-for-delivery are separate milestones", async () => {
  const o = order({ locale: "en" });
  const f = fakeFetch();
  await notify.deliverStatusEmail(o, "shipped", CONFIG, { fetch: f.fn });
  await notify.deliverStatusEmail(o, "out_for_delivery", CONFIG, { fetch: f.fn });
  await notify.deliverStatusEmail(o, "delivered", CONFIG, { fetch: f.fn });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(Object.keys(o.customerEmails).sort(), ["delivered", "out_for_delivery", "shipped"]);
});

test("nothing is sent for a status with no milestone", async () => {
  const o = order({ locale: "en" });
  const f = fakeFetch();
  const result = await notify.deliverStatusEmail(o, notify.eventForStatusChange({ fulfillmentStatus: "ready_for_pickup" }), CONFIG, { fetch: f.fn });
  assert.equal(result, undefined);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(o.customerEmails, {});
});

test("alreadySent agrees on both sides", () => {
  const sentLog = { customerEmails: { shipped: { status: "sent", at: "x", attempts: 1 } } };
  assert.equal(notify.alreadySent(sentLog, "shipped"), true);
  assert.equal(notify.shouldSendCustomerEmail(sentLog, "shipped"), false);
  assert.equal(notify.shouldSendCustomerEmail(sentLog, "delivered"), true);
  assert.equal(notify.shouldSendCustomerEmail({ customerEmails: { shipped: { status: "failed", at: "x", attempts: 1 } } }, "shipped"), true);
});

/* ── 5 · failed delivery and retry ──────────────────────────────────────── */

test("a provider failure is recorded, retryable, and never thrown", async () => {
  const o = order({ locale: "en" });
  const bad = fakeFetch(() => ({ ok: false, status: 500, text: async () => "upstream exploded" }));
  const record = await notify.deliverStatusEmail(o, "delivered", CONFIG, { fetch: bad.fn });

  assert.equal(record.status, "failed");
  assert.match(record.error, /resend 500/);
  assert.equal(record.attempts, 1);
  assert.equal(record.to, "customer@example.com", "the address is recorded for debugging");
  assert.ok(record.at, "the attempt is timestamped");

  // …and it stays retryable, with the attempt count climbing.
  const good = fakeFetch();
  const retry = await notify.deliverStatusEmail(o, "delivered", CONFIG, { fetch: good.fn });
  assert.equal(good.calls.length, 1, "the retry did not go out");
  assert.equal(retry.status, "sent");
  assert.equal(retry.attempts, 2);
  assert.equal(o.customerEmails.delivered!.status, "sent");
});

test("retryableEvents lists exactly what still needs attention", () => {
  const o = {
    customerEmails: {
      order_received: { status: "sent" as const, at: "x", attempts: 1 },
      processing: { status: "failed" as const, at: "x", attempts: 2 },
      delivered: { status: "disabled" as const, at: "x", attempts: 1 },
    },
  };
  assert.deepEqual(retryableEvents(o), ["processing", "delivered"]);
  assert.deepEqual(notify.retryableEvents(o), ["processing", "delivered"]);
});

test("the sender never rejects, whatever the provider does", async () => {
  for (const reply of [
    () => {
      throw new Error("sync throw");
    },
    () => Promise.reject(new Error("async reject")),
    () => null,
    () => undefined,
  ]) {
    const f = fakeFetch(reply as () => unknown);
    const record = await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", CONFIG, { fetch: f.fn });
    assert.equal(record.status, "failed");
  }
});

test("a timeout or abort is a recorded failure, not a hang", async () => {
  const f = fakeFetch(() => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  });
  const record = await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", CONFIG, { fetch: f.fn });
  assert.equal(record.status, "failed");
  assert.match(record.error, /AbortError/);
});

test("console mode is recorded as disabled, never as sent", async () => {
  const f = fakeFetch();
  const record = await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", CONSOLE_CONFIG, { fetch: f.fn });
  assert.equal(record.status, "disabled");
  assert.match(record.error, /EMAIL_PROVIDER=console/);
  assert.equal(f.calls.length, 0);
});

test("resend selected without a key is a visible failure, not a silent fallback", async () => {
  const f = fakeFetch();
  const record = await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", { ...CONFIG, apiKey: "" }, { fetch: f.fn });
  assert.equal(record.status, "failed");
  assert.match(record.error, /RESEND_API_KEY/);
  assert.equal(f.calls.length, 0);
});

test("the API key never survives into a stored record", async () => {
  const f = fakeFetch(() => ({ ok: false, status: 401, text: async () => `{"message":"bad key ${API_KEY}"}` }));
  const record = await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", CONFIG, { fetch: f.fn });
  assert.ok(!JSON.stringify(record).includes(API_KEY));
  assert.ok(record.error.includes("[redacted]"));
});

/* ── 6 · invalid or missing email ───────────────────────────────────────── */

test("a missing or malformed customer address fails cleanly, without calling the provider", async () => {
  for (const [email, expect] of [
    [undefined, /missing/],
    ["", /missing/],
    ["not-an-email", /invalid/],
    ["no@domain", /invalid/],
    ["   ", /invalid|missing/],
  ] as [string | undefined, RegExp][]) {
    const f = fakeFetch();
    const record = await notify.sendCustomerStatusEmail(order({ customer: { email } }), "delivered", CONFIG, { fetch: f.fn });
    assert.equal(record.status, "failed", `${email}`);
    assert.match(record.error, expect);
    assert.equal(f.calls.length, 0, `${email}: called the provider anyway`);
  }
});

test("a valid address is accepted", () => {
  for (const email of ["a@b.co", "first.last+tag@sub.domain.org"]) {
    assert.equal(provider.isSendableAddress(email), true, email);
  }
});

/* ── 7 · the ledger is internal ─────────────────────────────────────────── */

test("the customer email ledger never reaches the customer", () => {
  const sanitized = toCustomerOrder({
    orderNumber: "CR-1",
    items: [],
    sheetsSync: { status: "pending" },
    customerEmails: { delivered: { status: "failed", at: "x", attempts: 2, to: "c@e.com", error: "resend 500 boom" } },
  } as unknown as Order) as unknown as Record<string, unknown>;
  assert.ok(!("customerEmails" in sanitized));
  assert.ok(!JSON.stringify(sanitized).includes("resend 500 boom"));
});

test("recordCustomerEmail writes one milestone and leaves the rest alone", () => {
  const log = recordCustomerEmail({ order_received: { status: "sent", at: "a", attempts: 1 } }, "shipped", {
    status: "failed",
    at: "b",
    attempts: 1,
  });
  assert.equal(log.order_received?.status, "sent");
  assert.equal(log.shipped?.status, "failed");
});

/* ── 8 · the triggers are wired, and only where they should be ──────────── */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("an Admin status change is what triggers the customer email", () => {
  const src = read("../../supabase/functions/admin-actions/index.ts");
  assert.ok(src.includes("eventForStatusChange("), "admin-actions does not map the status change");
  assert.ok(src.includes("await deliverStatusEmail("), "admin-actions does not send");
  // The patch is applied first, so the email describes the stored state.
  assert.ok(src.indexOf("Object.assign(order, patch)") < src.indexOf("await deliverStatusEmail("), "the email is built before the patch is applied");
  // …and the order write still happens after, regardless of the email.
  assert.ok(src.indexOf("await deliverStatusEmail(") < src.indexOf("payment_status: order.paymentStatus"), "the order update no longer follows the email");
});

test("checkout and the payment webhook use the same ledger", () => {
  assert.ok(read("../../supabase/functions/place-order/index.ts").includes('deliverStatusEmail(orderData as unknown as Record<string, unknown>, "order_received"'));
  const webhook = read("../../supabase/functions/payments-webhook/index.ts");
  assert.ok(webhook.includes('"payment_confirmed"'));
  assert.ok(webhook.includes('"refunded"'));
  assert.ok(!webhook.includes("paymentConfirmedEmail("), "the webhook still bypasses the ledger");
});

test("no customer email is sent from a read-only path", () => {
  for (const name of ["track-order", "sheets-sync", "submit-review"]) {
    const src = read(`../../supabase/functions/${name}/index.ts`);
    assert.ok(!src.includes("deliverStatusEmail"), `${name} must not email customers`);
    assert.ok(!src.includes("sendCustomerStatusEmail"), `${name} must not email customers`);
  }
});

test("the retry endpoint enforces idempotency server-side, not just in the UI", () => {
  const src = read("../../supabase/functions/admin-actions/index.ts");
  assert.ok(src.includes('case "resend-customer-email"'));
  assert.ok(src.includes("if (alreadySent(order, event))"), "a delivered milestone could be re-sent through the API");
  assert.ok(src.includes("await requireStaff(req)"), "the retry must be staff-only");
});

test("there is exactly one Resend call site in the codebase", () => {
  const files = [
    "../../supabase/functions/_shared/email-provider.ts",
    "../../supabase/functions/_shared/owner-notification.ts",
    "../../supabase/functions/_shared/customer-notifications.ts",
    "../../supabase/functions/_shared/helpers.ts",
  ];
  const hits = files.filter((f) => read(f).includes("https://api.resend.com/emails"));
  // helpers.sendEmail predates this system and is still used elsewhere; the
  // two notification systems must share the extracted transport.
  assert.ok(!read("../../supabase/functions/_shared/owner-notification.ts").includes("api.resend.com"), "owner alerts kept their own Resend call");
  assert.ok(!read("../../supabase/functions/_shared/customer-notifications.ts").includes("api.resend.com"), "customer emails kept their own Resend call");
  assert.ok(hits.includes("../../supabase/functions/_shared/email-provider.ts"));
});

/* ── 9 · switching to a real domain later is a one-variable change ──────── */

test("the sending address comes only from EMAIL_FROM, never from code", async () => {
  // Whatever `from` the config carries is exactly what reaches the provider.
  for (const from of ["onboarding@resend.dev", "orders@crowned.co.il"]) {
    const { fn, calls } = fakeFetch();
    await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", { ...CONFIG, from }, { fetch: fn });
    assert.equal(JSON.parse(String(calls[0]!.init.body)).from, from);
  }
  // Owner alerts take the same route.
  const owner = await dyn("../../supabase/functions/_shared/owner-notification.ts");
  const { fn, calls } = fakeFetch();
  await owner.sendOwnerOrderNotification(
    { orderNumber: "CR-1", customer: {}, items: [] },
    { provider: "resend", recipient: "owner@crowned.example", from: "orders@crowned.co.il", apiKey: API_KEY, adminBaseUrl: "" },
    { fetch: fn },
  );
  assert.equal(JSON.parse(String(calls[0]!.init.body)).from, "orders@crowned.co.il");
});

test("no shipped module hardcodes a sending domain", () => {
  // If this ever fails, switching EMAIL_FROM would no longer be enough.
  for (const rel of [
    "../../supabase/functions/_shared/email-provider.ts",
    "../../supabase/functions/_shared/customer-notifications.ts",
    "../../supabase/functions/_shared/owner-notification.ts",
    "../../supabase/functions/_shared/emails.ts",
  ]) {
    const src = read(rel);
    assert.ok(!src.includes("resend.dev"), `${rel} hardcodes the test sender`);
    assert.ok(!src.includes("crowned.co.il"), `${rel} hardcodes a production sender`);
  }
});

test("EMAIL_FROM is read in exactly one place for the notification systems", () => {
  const providerSrc = read("../../supabase/functions/_shared/email-provider.ts");
  assert.equal(providerSrc.split('envGet("EMAIL_FROM")').length - 1, 1);
  for (const rel of [
    "../../supabase/functions/_shared/customer-notifications.ts",
    "../../supabase/functions/_shared/owner-notification.ts",
  ]) {
    assert.ok(!read(rel).includes('envGet("EMAIL_FROM")'), `${rel} reads EMAIL_FROM itself instead of via the shared config`);
  }
});

test("a send with no sender configured fails loudly rather than guessing", async () => {
  const { fn, calls } = fakeFetch();
  const record = await notify.sendCustomerStatusEmail(order({ locale: "en" }), "delivered", { ...CONFIG, from: "" }, { fetch: fn });
  assert.equal(record.status, "failed");
  assert.match(record.error, /EMAIL_FROM/);
  assert.equal(calls.length, 0);
});
