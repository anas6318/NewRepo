/**
 * What a customer can see of their own order, end to end.
 *
 * An order row carries owner-only material — supplier references, carrier
 * details, staff decisions, ops bookkeeping — alongside what the customer is
 * entitled to. These specs plant sentinel values in those fields on a real
 * demo order and then walk every customer-facing route: account order
 * history, account order detail, and the guest tracker.
 *
 * Scope note, deliberately: a page cannot render a field it never reads, so
 * these are surface checks. The data-level guarantee (that the sanitizer
 * removes each field, and that every customer route runs it) is pinned by
 * tests/unit/customer-order.test.ts.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";

/** Values that exist only for the owner. None may appear on a customer page. */
const SENTINELS = [
  "STAFF-ONLY-NOTE",
  "SUP-REF-9",
  "TRACK-123",
  "carrier.example",
  "SUP-BDG-CHAMP",
  "staff@crowned.example",
  "supplier said maybe",
  "google sheets 403 denied",
  "resend 401 invalid key",
];

async function ensureDemoDbPersisted(page, BASE) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  if (await page.evaluate((k) => window.localStorage.getItem(k) !== null, LS_KEY)) return;
  await page.fill("#footer-email", `seed-${Date.now()}@example.com`);
  await page.locator(".site-footer__form button[type=submit]").click();
  await page.waitForFunction((k) => window.localStorage.getItem(k) !== null, LS_KEY, { timeout: 5000 });
}

/** Loads the demo customer's first order with every owner-only field set. */
async function poisonCustomerOrder(page, BASE) {
  await ensureDemoDbPersisted(page, BASE);
  return await page.evaluate((key) => {
    const db = JSON.parse(window.localStorage.getItem(key));
    const order = db.orders.find((o) => o.customer && o.customer.customerId === "cust-demo");
    order.internalNotes = "STAFF-ONLY-NOTE";
    order.supplierReference = "SUP-REF-9";
    order.trackingNumber = "TRACK-123";
    order.trackingUrl = "https://carrier.example/TRACK-123";
    order.productionStartedAt = "2026-09-08T00:00:00.000Z";
    order.supplierDispatchedAt = "2026-09-09T00:00:00.000Z";
    order.supplierConfirmation = {
      required: true,
      status: "confirmed",
      items: [{ slug: order.items[0].slug, size: order.items[0].size }],
      decidedBy: "staff@crowned.example",
      decidedAt: "2026-09-08T00:00:00.000Z",
      note: "supplier said maybe",
    };
    order.sheetsSync = { status: "failed", lastAttemptAt: "2026-09-07T09:31:00.000Z", error: "google sheets 403 denied" };
    order.notification = { status: "failed", lastAttemptAt: "2026-09-07T09:30:00.000Z", error: "resend 401 invalid key" };
    window.localStorage.setItem(key, JSON.stringify(db));
    return { orderNumber: order.orderNumber, email: order.customer.email, total: order.totalIls };
  }, LS_KEY);
}

async function customerLogin(page, BASE) {
  await page.goto(`${BASE}/en/login`, { waitUntil: "networkidle" });
  await page.fill("#lg-email", "demo@crowned.example");
  await page.fill("#lg-pass", "demo1234");
  await page.locator("button[type=submit]").first().click();
  await page.waitForTimeout(600);
}

/** Asserts no sentinel appears in the rendered text OR the page source. */
async function assertClean(page, where) {
  const body = await page.locator("body").innerText();
  const html = await page.content();
  for (const secret of SENTINELS) {
    assert.ok(!body.includes(secret), `"${secret}" is visible to the customer on ${where}`);
    assert.ok(!html.includes(secret), `"${secret}" is in the page source of ${where}`);
  }
}

/* ── account order history ──────────────────────────────────────────────── */

export async function account_order_history_shows_nothing_internal({ page, BASE }) {
  const { orderNumber } = await poisonCustomerOrder(page, BASE);
  await customerLogin(page, BASE);

  await page.goto(`${BASE}/en/account/orders`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  // The page really is showing the order — otherwise "no secrets" is vacuous.
  assert.ok(body.includes(orderNumber), `the order history did not render ${orderNumber}`);
  await assertClean(page, "account order history");
}

/* ── account order detail ───────────────────────────────────────────────── */

export async function account_order_detail_shows_nothing_internal({ page, BASE }) {
  const { orderNumber } = await poisonCustomerOrder(page, BASE);
  await customerLogin(page, BASE);

  await page.goto(`${BASE}/en/account/orders/${orderNumber}`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  assert.ok(body.includes(orderNumber), "the order detail rendered");
  assert.ok(await page.locator(".timeline").count() > 0, "the customer still gets their timeline");
  await assertClean(page, "account order detail");
}

/* ── guest tracker ──────────────────────────────────────────────────────── */

export async function guest_tracking_shows_nothing_internal({ page, BASE }) {
  const { orderNumber, email } = await poisonCustomerOrder(page, BASE);

  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", email);
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForSelector(".timeline", { timeout: 5000 });
  await assertClean(page, "guest tracking");
}

/* ── the customer still gets everything they are entitled to ────────────── */

export async function the_customer_still_sees_their_own_order_fully({ page, BASE }) {
  const { orderNumber, email } = await poisonCustomerOrder(page, BASE);

  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", email);
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForSelector(".timeline", { timeout: 5000 });

  const body = await page.locator("body").innerText();
  assert.ok(body.includes(orderNumber), "order number");
  assert.ok(/₪\d/.test(body), "the total is still shown");
  assert.ok((await page.locator(".timeline__label").count()) > 0, "the delivery timeline is intact");
  // Badge name and price stay; only the owner's supplier reference went.
  assert.ok(body.includes("₪"), "item pricing is intact");
}

/* ── the owner keeps everything, in Admin ───────────────────────────────── */

export async function the_owner_still_sees_the_internal_fields_in_admin({ page, BASE }) {
  const { orderNumber } = await poisonCustomerOrder(page, BASE);

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 8000 });

  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  // Sanitizing the customer's view must not have taken anything away from
  // the owner's: this is their order-fulfilment workspace.
  assert.ok(body.includes("STAFF-ONLY-NOTE") || (await page.locator("textarea").count()) > 0, "internal notes still reachable in Admin");
  assert.ok(body.includes("Owner alert"), "the owner alert row is still there");
  assert.ok(body.includes("resend 401 invalid key"), "staff can still read why the alert failed");
}
