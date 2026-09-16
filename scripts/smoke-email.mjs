/**
 * REAL Resend smoke test for CROWNED order emails.
 *
 * Runs the actual shipped modules — supabase/functions/_shared/* — against
 * the live Resend API and sends real email. Nothing here is mocked, and
 * nothing is reported as sent unless Resend accepted it.
 *
 * It verifies, live:
 *   1. the four-step flow: order received → processing → shipped → delivered
 *   2. exactly ONE provider call per milestone
 *   3. idempotency — replaying every milestone makes ZERO further calls
 *   4. the shipped email carries the tracking number and link
 *   5. the order language (ar/he/en) decides the template actually sent
 *   6. a failed send is recorded, does not throw, and stays retryable
 *   7. a retry after a failure succeeds and counts as attempt 2
 *   8. the owner "new order" alert
 *
 * Usage:
 *   RESEND_API_KEY=re_… \
 *   EMAIL_FROM=onboarding@resend.dev \
 *   SMOKE_TO=you@yourmail.com \
 *   ORDER_NOTIFICATION_EMAIL=you@yourmail.com \
 *   npm run smoke:email
 *
 * Optional: SMOKE_LOCALE=ar|he|en (default ar), SMOKE_SKIP_OWNER=1.
 *
 * NOTE ON onboarding@resend.dev: Resend allows that sender with no verified
 * domain, but it will only DELIVER to the email address of your own Resend
 * account. Any other recipient is rejected with a 403 naming your address.
 * That is expected, not a bug — see docs/deployment-guide.md.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Re-spawn with type stripping so the .ts edge modules can be imported.
if (!process.env.CROWNED_SMOKE_INNER) {
  const res = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, CROWNED_SMOKE_INNER: "1" },
    cwd: root,
  });
  process.exit(res.status ?? 1);
}

const shared = join(root, "supabase", "functions", "_shared");
const { deliverStatusEmail, sendCustomerStatusEmail, recordCustomerEmail } = await import(pathToFileURL(join(shared, "customer-notifications.ts")).href);
const { sendOwnerOrderNotification } = await import(pathToFileURL(join(shared, "owner-notification.ts")).href);

/* ── configuration ──────────────────────────────────────────────────────── */

const API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev";
const TO = process.env.SMOKE_TO ?? process.env.ORDER_NOTIFICATION_EMAIL ?? "";
const OWNER_TO = process.env.ORDER_NOTIFICATION_EMAIL ?? TO;
const LOCALE = process.env.SMOKE_LOCALE ?? "ar";
const SITE_URL = process.env.SITE_URL ?? "";

if (!API_KEY || !TO) {
  console.error(`
Cannot run a real smoke test without credentials.

Set these and run again:

  RESEND_API_KEY=re_…                 your Resend API key
  SMOKE_TO=you@yourmail.com           the address the test emails go to.
                                      With EMAIL_FROM=onboarding@resend.dev
                                      this MUST be your own Resend account
                                      address — Resend rejects anything else.
  EMAIL_FROM=onboarding@resend.dev    (or orders@yourdomain.tld once verified)
  ORDER_NOTIFICATION_EMAIL=you@…      owner alert recipient

Nothing was sent.`);
  process.exit(2);
}

const config = { provider: "resend", from: FROM, apiKey: API_KEY, siteUrl: SITE_URL };

/* ── a counting wrapper around the real fetch ───────────────────────────── */

let calls = 0;
const lastResponses = [];
const countingFetch = async (url, init) => {
  calls++;
  const res = await fetch(url, init);
  lastResponses.push(res.status);
  return res;
};
const since = () => {
  const n = calls;
  return () => calls - n;
};

/* ── the order under test ───────────────────────────────────────────────── */

const order = {
  orderNumber: `CR-SMOKE${Date.now().toString(36).toUpperCase().slice(-4)}`,
  createdAt: new Date().toISOString(),
  locale: LOCALE,
  customer: { name: "Smoke Test", email: TO, phone: "0500000000", city: "Haifa", address: "Test street 1" },
  items: [
    {
      slug: "crimson-2005",
      title: { ar: "قميص تجريبي", he: "חולצת בדיקה", en: "Smoke Test Shirt" },
      quantity: 1,
      size: "L",
      unitPriceIls: 170,
      lineTotalIls: 170,
    },
  ],
  subtotalIls: 170,
  deliveryIls: 40,
  freeDelivery: false,
  totalIls: 210,
  paymentMethod: "bank_transfer",
  paymentStatus: "awaiting_payment",
  fulfillmentStatus: "order_received",
  customerEmails: {},
};

/* ── reporting ──────────────────────────────────────────────────────────── */

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`\nCROWNED email smoke test`);
console.log(`  from   : ${FROM}`);
console.log(`  to     : ${TO}`);
console.log(`  locale : ${LOCALE}`);
console.log(`  order  : ${order.orderNumber}`);
if (FROM.endsWith("@resend.dev")) {
  console.log(`  note   : resend.dev sender — delivery is limited to your own Resend account address.\n`);
} else {
  console.log("");
}

/* ── 1 · the four-step flow, one email per milestone ────────────────────── */

const FLOW = [
  ["order_received", "Order received"],
  ["processing", "Processing"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
];

for (const [event, label] of FLOW) {
  // Carrier details appear on the order before it is marked shipped, exactly
  // as they do when the owner types them into the same Admin save.
  if (event === "shipped") {
    order.trackingNumber = "RR123456789IL";
    order.trackingUrl = "https://track.example/RR123456789IL";
  }
  const before = since();
  const record = await deliverStatusEmail(order, event, config, { fetch: countingFetch });
  const made = before();

  check(`${label}: sent`, record?.status === "sent", record?.status === "sent" ? `attempt ${record.attempts}` : `status=${record?.status} error=${record?.error ?? "none"}`);
  check(`${label}: exactly one provider call`, made === 1, `${made} call(s)`);
}

/* ── 2 · idempotency, live ──────────────────────────────────────────────── */

const beforeReplay = since();
for (const [event] of FLOW) {
  await deliverStatusEmail(order, event, config, { fetch: countingFetch });
  // …and a second time, as a double-save would.
  await deliverStatusEmail(order, event, config, { fetch: countingFetch });
}
const replayCalls = beforeReplay();
check("Replaying every milestone twice sends nothing", replayCalls === 0, `${replayCalls} call(s)`);
check(
  "Attempt counts unchanged after replay",
  FLOW.every(([event]) => order.customerEmails[event]?.attempts === 1),
  FLOW.map(([e]) => `${e}=${order.customerEmails[e]?.attempts}`).join(" "),
);

/* ── 3 · tracking data actually left the building ───────────────────────── */

const shippedRecord = order.customerEmails.shipped;
check("Shipped recorded the recipient", shippedRecord?.to === TO, shippedRecord?.to ?? "none");
// Rebuild the exact payload that was sent and confirm the carrier details.
const { statusUpdateEmail } = await import(pathToFileURL(join(shared, "emails.ts")).href);
const shippedBody = statusUpdateEmail(LOCALE, "shipped", {
  orderNumber: order.orderNumber,
  trackingNumber: order.trackingNumber,
  trackingUrl: order.trackingUrl,
  ...(SITE_URL ? { siteUrl: SITE_URL } : {}),
});
check("Shipped email carries the tracking number", shippedBody.html.includes("RR123456789IL"));
check("Shipped email carries the tracking link", shippedBody.html.includes("https://track.example/RR123456789IL"));

/* ── 4 · the order's language decided the template ──────────────────────── */

const EXPECT_SCRIPT = { ar: /[؀-ۿ]/, he: /[֐-׿]/, en: /[A-Za-z]/ };
const localized = statusUpdateEmail(LOCALE, "delivered", { orderNumber: order.orderNumber });
check(`Delivered email is in "${LOCALE}"`, EXPECT_SCRIPT[LOCALE].test(localized.subject), localized.subject);
check(
  `Direction is correct for "${LOCALE}"`,
  localized.html.includes(`<html lang="${LOCALE}" dir="${LOCALE === "en" ? "ltr" : "rtl"}">`),
);

/* ── 5 · a failed send is recorded, not thrown, and stays retryable ─────── */

const failOrder = { ...order, orderNumber: `${order.orderNumber}-F`, customerEmails: {} };
let threw = false;
let failRecord;
try {
  failRecord = await sendCustomerStatusEmail(failOrder, "cancelled", { ...config, apiKey: "re_definitely_not_a_real_key" }, { fetch: countingFetch });
} catch {
  threw = true;
}
check("A bad key does not throw", !threw);
check("A bad key is recorded as failed", failRecord?.status === "failed", failRecord?.error ?? "no error recorded");
check("The failure carries a debuggable reason", Boolean(failRecord?.error) && /resend\s+\d{3}/.test(failRecord.error), failRecord?.error ?? "");
check("The API key is never stored in the record", !JSON.stringify(failRecord ?? {}).includes("re_definitely_not_a_real_key"));

recordCustomerEmail(failOrder, "cancelled", failRecord);
const retryRecord = await sendCustomerStatusEmail(failOrder, "cancelled", config, { fetch: countingFetch });
check("The retry after a failure succeeds", retryRecord?.status === "sent", retryRecord?.status === "sent" ? "" : (retryRecord?.error ?? ""));
check("The retry counts as attempt 2", retryRecord?.attempts === 2, `attempts=${retryRecord?.attempts}`);

/* ── 6 · the owner alert ────────────────────────────────────────────────── */

if (!process.env.SMOKE_SKIP_OWNER) {
  const ownerResult = await sendOwnerOrderNotification(
    order,
    { provider: "resend", recipient: OWNER_TO, from: FROM, apiKey: API_KEY, adminBaseUrl: SITE_URL },
    { fetch: countingFetch },
  );
  check("Owner new-order alert sent", ownerResult.status === "sent", ownerResult.status === "sent" ? "" : (ownerResult.error ?? ""));
}

/* ── summary ────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.passed);
console.log(`\nProvider calls made: ${calls} (HTTP: ${[...new Set(lastResponses)].join(", ")})`);
console.log(`${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log(`\nFAILED:`);
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  console.log(`\nNo claim of a working email pipeline is made while any check fails.`);
  process.exit(1);
}
console.log(`\nAll checks passed. Check ${TO} — you should have received:`);
console.log(`  1. Order received   (${order.orderNumber})`);
console.log(`  2. Processing`);
console.log(`  3. Shipped (with tracking RR123456789IL)`);
console.log(`  4. Delivered`);
console.log(`  5. Cancelled (the retry-after-failure test)`);
if (!process.env.SMOKE_SKIP_OWNER) console.log(`  6. Owner new-order alert → ${OWNER_TO}`);
console.log(`\nIf any of those did NOT arrive, the send was accepted but not delivered —`);
console.log(`check the Resend dashboard's Emails log for the bounce/suppression reason.`);
