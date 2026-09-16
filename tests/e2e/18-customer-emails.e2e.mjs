/**
 * Customer status emails, end to end through the Admin surface.
 *
 * Changing a status in Admin is the trigger, so these specs drive the real
 * status selects and then read the order's own email ledger — the record
 * that decides whether a milestone has already gone out.
 *
 * Demo mode has no server and no email provider, so every entry honestly
 * records "disabled" rather than claiming a delivery. What is being tested
 * here is the part that is identical in production: WHICH milestone a status
 * change produces, that it is recorded exactly once, that a delivered
 * milestone is never retried, and that none of it reaches the customer.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 8000 });
}

async function placeOrder(page, BASE, email) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator(".chip", { hasText: /^L$/ }).click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Email Tester");
  await page.fill("#co-email", email);
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });
  return page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
}

const ledger = (page, orderNumber) =>
  page.evaluate(
    ([key, number]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      return order?.customerEmails ?? null;
    },
    [LS_KEY, orderNumber],
  );

async function setFulfillment(page, BASE, orderNumber, status) {
  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  await page.locator("label", { hasText: "Fulfillment status" }).locator("select").selectOption(status);
  await page.waitForTimeout(500);
}

/* ── checkout records the first milestone ───────────────────────────────── */

export async function checkout_records_the_order_received_email({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-1@example.com");
  const log = await ledger(page, orderNumber);
  assert.ok(log, "the order carries an email ledger");
  assert.ok(log.order_received, "no record for the confirmation email");
  assert.equal(log.order_received.attempts, 1);
  // No provider in demo mode — the only honest answer.
  assert.equal(log.order_received.status, "disabled");
  assert.notEqual(log.order_received.status, "sent");
  assert.equal(log.order_received.to, "emails-1@example.com", "the address is recorded for debugging");
}

/* ── an admin status change is the trigger ──────────────────────────────── */

export async function admin_status_changes_produce_the_right_milestones({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-2@example.com");
  await adminLogin(page, BASE);

  for (const [status, event] of [
    ["payment_confirmed", "payment_confirmed"],
    ["production_started", "processing"],
    ["supplier_dispatched", "shipped"],
    ["out_for_delivery", "out_for_delivery"],
    ["delivered", "delivered"],
  ]) {
    await setFulfillment(page, BASE, orderNumber, status);
    const log = await ledger(page, orderNumber);
    assert.ok(log[event], `moving to ${status} produced no "${event}" record`);
    assert.equal(log[event].attempts, 1, `${event} was attempted more than once`);
  }

  const log = await ledger(page, orderNumber);
  assert.deepEqual(
    Object.keys(log).sort(),
    ["delivered", "order_received", "out_for_delivery", "payment_confirmed", "processing", "shipped"].sort(),
  );
}

export async function cancelling_and_refunding_each_notify_once({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-cancel@example.com");
  await adminLogin(page, BASE);

  await setFulfillment(page, BASE, orderNumber, "cancelled");
  assert.ok((await ledger(page, orderNumber)).cancelled, "no cancellation email recorded");

  await setFulfillment(page, BASE, orderNumber, "refunded");
  const log = await ledger(page, orderNumber);
  assert.ok(log.refunded, "no refund email recorded");
  assert.equal(log.cancelled.attempts, 1, "the cancellation was re-notified");
}

/* ── several internal steps, one customer email ─────────────────────────── */

export async function production_steps_share_one_processing_email({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-3@example.com");
  await adminLogin(page, BASE);

  // All four internal production steps collapse onto ONE customer milestone.
  await setFulfillment(page, BASE, orderNumber, "sent_to_supplier");
  let log = await ledger(page, orderNumber);
  assert.ok(log.processing, "moving into production produced no processing record");
  assert.deepEqual(Object.keys(log).sort(), ["order_received", "processing"], "an extra milestone appeared");

  // Once the provider has actually delivered it — which is what production
  // records and demo mode cannot — the remaining steps must not touch it.
  await page.evaluate(
    ([key, number]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      order.customerEmails.processing = { status: "sent", at: "2026-09-14T09:00:00.000Z", attempts: 1, to: order.customer.email };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, orderNumber],
  );

  for (const status of ["production_started", "supplier_processing", "quality_inspection"]) {
    await setFulfillment(page, BASE, orderNumber, status);
  }
  log = await ledger(page, orderNumber);
  assert.equal(log.processing.status, "sent");
  assert.equal(log.processing.attempts, 1, "the customer was emailed about production more than once");
  assert.equal(log.processing.at, "2026-09-14T09:00:00.000Z", "a delivered milestone was rewritten");
}

/** Demo mode never reaches "sent", which is exactly the retry case: an
 * undelivered milestone keeps being re-attempted rather than being dropped. */
export async function an_undelivered_milestone_is_retried_not_dropped({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-retry@example.com");
  await adminLogin(page, BASE);

  await setFulfillment(page, BASE, orderNumber, "sent_to_supplier");
  assert.equal((await ledger(page, orderNumber)).processing.attempts, 1);
  await setFulfillment(page, BASE, orderNumber, "production_started");
  const log = await ledger(page, orderNumber);
  assert.equal(log.processing.attempts, 2, "an undelivered milestone was silently abandoned");
  assert.notEqual(log.processing.status, "sent");
}

export async function statuses_a_person_handles_send_nothing({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-4@example.com");
  await adminLogin(page, BASE);

  const before = Object.keys(await ledger(page, orderNumber)).sort();
  for (const status of ["awaiting_supplier_confirmation", "supplier_unavailable", "issue_reported", "ready_for_pickup"]) {
    await setFulfillment(page, BASE, orderNumber, status);
  }
  assert.deepEqual(Object.keys(await ledger(page, orderNumber)).sort(), before, "an automatic email was sent for a status a person handles");
}

/* ── the admin panel ────────────────────────────────────────────────────── */

export async function admin_shows_every_milestone_and_offers_a_retry({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-5@example.com");
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });

  const panel = page.locator("section", { hasText: "Customer emails" }).first();
  await panel.waitFor({ state: "visible", timeout: 5000 });
  const text = await panel.innerText();
  for (const label of ["Order received", "Payment confirmed", "Processing", "Shipped", "Out for delivery", "Delivered", "Cancelled", "Refunded"]) {
    assert.ok(text.includes(label), `the panel does not list "${label}"`);
  }
  // Milestones that have not happened are shown as such, with no retry.
  assert.ok(text.includes("not sent"), "milestones that never happened are not marked");
  // The one that was attempted offers a retry.
  const row = panel.locator("li", { hasText: "Order received" }).first();
  assert.equal(await row.getByRole("button", { name: /Retry/ }).count(), 1, "no retry for an undelivered email");
}

export async function a_delivered_milestone_offers_no_retry({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-6@example.com");
  await adminLogin(page, BASE);
  // Mark the confirmation as actually delivered, as production would.
  await page.evaluate(
    ([key, number]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      order.customerEmails.order_received = { status: "sent", at: "2026-09-14T09:00:00.000Z", attempts: 1, to: order.customer.email };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, orderNumber],
  );

  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  const row = page.locator("section", { hasText: "Customer emails" }).first().locator("li", { hasText: "Order received" }).first();
  assert.equal(await row.locator(".badge--ok").count(), 1, "a delivered email should read as delivered");
  assert.equal(await row.getByRole("button", { name: /Retry/ }).count(), 0, "a delivered email must never offer a re-send");
}

export async function retrying_a_failed_email_records_another_attempt({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-7@example.com");
  await adminLogin(page, BASE);
  await page.evaluate(
    ([key, number]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      order.customerEmails.order_received = { status: "failed", at: "2026-09-14T09:00:00.000Z", attempts: 1, to: order.customer.email, error: "resend 500 boom" };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, orderNumber],
  );

  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  const panel = page.locator("section", { hasText: "Customer emails" }).first();
  assert.match(await panel.innerText(), /resend 500 boom/, "staff cannot see why it failed");

  await panel.locator("li", { hasText: "Order received" }).first().getByRole("button", { name: /Retry/ }).click();
  await page.waitForTimeout(700);

  const log = await ledger(page, orderNumber);
  assert.equal(log.order_received.attempts, 2, "the retry did not count as an attempt");
  assert.notEqual(log.order_received.status, "sent", "demo mode must never claim a real delivery");
}

/* ── none of this reaches the customer ──────────────────────────────────── */

export async function the_email_ledger_never_reaches_the_customer({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "emails-8@example.com");
  await page.evaluate(
    ([key, number]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      order.customerEmails.delivered = { status: "failed", at: "2026-09-14T09:00:00.000Z", attempts: 3, to: order.customer.email, error: "LEDGER-SENTINEL-500" };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, orderNumber],
  );

  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", "emails-8@example.com");
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForSelector(".timeline", { timeout: 5000 });

  const body = await page.locator("body").innerText();
  const html = await page.content();
  for (const secret of ["LEDGER-SENTINEL-500", "Customer emails", "attempts"]) {
    assert.ok(!body.includes(secret), `"${secret}" is visible to the customer`);
    assert.ok(!html.includes(secret), `"${secret}" is in the customer page source`);
  }
}
