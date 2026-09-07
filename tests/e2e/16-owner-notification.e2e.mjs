/**
 * Owner order-alert notifications, end to end.
 *
 * The alert is secondary to the order by design, so these specs are mostly
 * about what must NOT happen: a checkout must never fail because of it, and
 * its bookkeeping — which can carry a provider error — must never reach a
 * customer. The admin side is checked for all four states.
 *
 * Demo mode has no server and no email provider, so a demo order honestly
 * records "disabled". The "sent"/"failed" states are written straight into
 * the demo database, exactly as the sales and promotion specs do.
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
  await page.fill("#co-name", "Alert Tester");
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

/** Rewrites one order's stored alert record, then reloads. */
async function setNotification(page, orderNumber, notification) {
  await page.evaluate(
    ([key, number, value]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      if (value === null) delete order.notification;
      else order.notification = value;
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, orderNumber, notification],
  );
}

/* ── a real order records an alert status, and still succeeds ───────────── */

export async function a_successful_order_records_one_notification_status({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "alert-1@example.com");
  assert.ok(orderNumber.startsWith("CR-"), "the order completed normally");

  const stored = await page.evaluate(
    ([key, number]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const order = db.orders.find((o) => o.orderNumber === number);
      return order ? order.notification : null;
    },
    [LS_KEY, orderNumber],
  );
  assert.ok(stored, "the order carries an owner-alert record");
  // No provider exists in demo mode, so the only honest answer is "disabled".
  assert.equal(stored.status, "disabled");
  assert.ok(stored.lastAttemptAt, "records when it was evaluated");
  assert.notEqual(stored.status, "sent", "never claims a delivery that did not happen");
}

/* ── an order the server rejects produces no alert at all ───────────────── */

export async function an_invalid_order_records_no_notification({ page, BASE }) {
  const before = await page.goto(`${BASE}/en`, { waitUntil: "networkidle" }).then(() =>
    page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw).orders.length : 0;
    }, LS_KEY),
  );

  // Invalid email — checkout refuses before any order exists.
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator(".chip", { hasText: /^L$/ }).click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Alert Tester");
  await page.fill("#co-email", "not-an-email");
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForTimeout(600);

  assert.ok(page.url().includes("/checkout"), "rejected checkout stays put");
  const after = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw).orders.length : 0;
  }, LS_KEY);
  assert.equal(after, before, "no order was created, so there is nothing to notify about");
}

/* ── admin shows each state ─────────────────────────────────────────────── */

export async function admin_order_detail_shows_a_sent_alert({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "alert-sent@example.com");
  await adminLogin(page, BASE);
  await setNotification(page, orderNumber, { status: "sent", lastAttemptAt: "2026-09-07T09:30:00.000Z" });

  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  const line = page.locator("p", { hasText: /Owner alert:/ }).first();
  const text = await line.innerText();
  assert.match(text, /Owner alert:\s*sent/);
  assert.ok(!/failed|disabled/.test(text), `unexpected state in: ${text}`);
  assert.equal(await line.locator(".badge--ok").count(), 1, "sent reads as a success badge");
}

export async function admin_order_detail_shows_a_failed_alert_with_the_reason({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "alert-failed@example.com");
  await adminLogin(page, BASE);
  await setNotification(page, orderNumber, {
    status: "failed",
    lastAttemptAt: "2026-09-07T09:30:00.000Z",
    error: "resend 401: invalid api key",
  });

  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  const line = page.locator("p", { hasText: /Owner alert:/ }).first();
  const text = await line.innerText();
  assert.match(text, /Owner alert:\s*failed/);
  assert.match(text, /resend 401: invalid api key/, "the internal reason is visible to staff");
  assert.equal(await line.locator(".badge--err").count(), 1, "failed reads as an error badge");
}

export async function admin_order_detail_shows_disabled_and_pending({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "alert-states@example.com");
  await adminLogin(page, BASE);

  for (const [status, expected] of [
    ["disabled", /Owner alert:\s*disabled/],
    ["pending", /Owner alert:\s*pending/],
  ]) {
    await setNotification(page, orderNumber, { status, lastAttemptAt: "2026-09-07T09:30:00.000Z" });
    await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
    assert.match(await page.locator("p", { hasText: /Owner alert:/ }).first().innerText(), expected);
  }

  // An order placed before this feature existed must not claim anything.
  await setNotification(page, orderNumber, null);
  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  assert.match(await page.locator("p", { hasText: /Owner alert:/ }).first().innerText(), /Owner alert:\s*unknown/);
}

export async function admin_orders_list_shows_the_alert_column({ page, BASE }) {
  const orderNumber = await placeOrder(page, BASE, "alert-list@example.com");
  await adminLogin(page, BASE);
  await setNotification(page, orderNumber, { status: "failed", lastAttemptAt: "2026-09-07T09:30:00.000Z", error: "resend 500" });

  await page.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("columnheader", { name: "Owner alert" }).count(), 1);
  const row = page.locator("tbody tr", { hasText: orderNumber }).first();
  assert.equal(await row.locator(".badge--err", { hasText: "failed" }).count(), 1, "the failing alert is visible at a glance");
}

/* ── nothing internal reaches the customer ──────────────────────────────── */

export async function the_customer_never_sees_the_alert_record({ page, BASE }) {
  const email = "alert-privacy@example.com";
  const orderNumber = await placeOrder(page, BASE, email);

  // 1 · the confirmation page (which re-reads the order through the same
  //     customer-facing path the tracker uses) says nothing about alerts.
  const confirmationBody = await page.locator("body").innerText();
  for (const secret of ["Owner alert", "notification"]) {
    assert.ok(!confirmationBody.includes(secret), `"${secret}" shown on the confirmation page`);
  }

  // 2 · give the stored order a failure with an internal reason…
  await adminLogin(page, BASE);
  await setNotification(page, orderNumber, {
    status: "failed",
    lastAttemptAt: "2026-09-07T09:30:00.000Z",
    error: "resend 401: invalid api key for owner@crowned.example",
  });

  // 3 · …and confirm the public tracker still shows nothing about it.
  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", email);
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForSelector(".timeline", { timeout: 5000 });
  const body = await page.locator("body").innerText();
  for (const secret of ["Owner alert", "resend 401", "invalid api key", "owner@crowned.example"]) {
    assert.ok(!body.includes(secret), `"${secret}" leaked to the customer tracker`);
  }
  const html = await page.content();
  assert.ok(!html.includes("invalid api key"), "the provider error leaked into the page source");
}

export async function no_notification_secret_names_reach_the_browser_bundle({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  const scripts = await page.locator("script[src]").evaluateAll((els) => els.map((e) => e.src));
  assert.ok(scripts.length > 0, "the app bundle is loaded");
  for (const src of scripts) {
    const body = await (await page.request.get(src)).text();
    for (const name of ["RESEND_API_KEY", "ORDER_NOTIFICATION_EMAIL", "api.resend.com"]) {
      assert.ok(!body.includes(name), `${name} was shipped to the browser in ${src}`);
    }
  }
}
