/**
 * Duplicate-order protection (A2-S3, F6) in demo mode: the checkout's
 * per-attempt idempotency key + the service's replay rule. Complements the
 * F5 re-entrancy guard (28-cart-checkout-hardening) — here the key is what
 * guarantees one order even when the same attempt reaches the service
 * twice.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";
const CART_KEY = "crowned_cart_v1";
const IDEM_KEY = "crowned_checkout_idem_v1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function ensureDemoDbPersisted(page, BASE) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  if (await page.evaluate((k) => window.localStorage.getItem(k) !== null, LS_KEY)) return;
  await page.fill("#footer-email", `seed-${Date.now()}@example.com`);
  await page.locator(".site-footer__form button[type=submit]").click();
  await page.waitForFunction((k) => window.localStorage.getItem(k) !== null, LS_KEY, { timeout: 5000 });
}

async function patchProduct(page, BASE, slug, patch) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key, s, p]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      Object.assign(
        db.products.find((x) => x.slug === s),
        p,
      );
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, slug, patch],
  );
}

async function addToCart(page, BASE, slug, { size = "L" } = {}) {
  await page.goto(`${BASE}/en/product/${slug}`, { waitUntil: "networkidle" });
  const sizeChip = page.locator(".chip", { hasText: new RegExp(`^${size}$`) }).first();
  if (await sizeChip.count()) await sizeChip.click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

async function fillCheckout(page, email) {
  await page.fill("#co-name", "Idempotency Tester");
  await page.fill("#co-email", email);
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
}

const ordersFor = (page, email) =>
  page.evaluate(([key, e]) => JSON.parse(window.localStorage.getItem(key)).orders.filter((o) => o.customer.email === e), [LS_KEY, email]);

const storedAttempt = (page) => page.evaluate((k) => JSON.parse(window.sessionStorage.getItem(k) ?? "null"), IDEM_KEY);

/* ── rapid double click: one order, one customer-email ledger entry ─────── */

export async function double_click_with_a_key_creates_one_order_and_one_email({ page, BASE }) {
  await addToCart(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  const email = `idem-double-${Date.now()}@example.com`;
  await fillCheckout(page, email);
  await page.evaluate(() => {
    const btn = document.querySelector("form button[type=submit]");
    btn.click();
    btn.click();
  });
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orders = await ordersFor(page, email);
  assert.equal(orders.length, 1, "exactly one order");
  assert.equal(Object.keys(orders[0].customerEmails ?? {}).length, 1, "exactly one customer-email ledger entry");
  assert.match(orders[0].idempotency?.key ?? "", UUID_V4, "the order carries the attempt's UUID v4 key");
  assert.equal(await storedAttempt(page), null, "the key is cleared after a successful order");
}

/* ── the response is lost, the same attempt is sent again ───────────────── */

export async function resubmitting_the_same_attempt_after_a_lost_response_returns_the_same_order({ page, BASE }) {
  // Record every key the checkout persists (sessionStorage survives the
  // SPA navigation but is cleared by the success path; this copy is not).
  await page.addInitScript((k) => {
    const orig = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function (key, value) {
      if (this === window.sessionStorage && key === k) orig.call(window.localStorage, "__e2e_idem", value);
      return orig.call(this, key, value);
    };
  }, IDEM_KEY);

  const email = `idem-lost-${Date.now()}@example.com`;
  await addToCart(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await fillCheckout(page, email);
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });
  const firstNumber = page.url().match(/confirmation\/(CR-[A-Z0-9]+)/)[1];
  const attempt = await page.evaluate(() => window.localStorage.getItem("__e2e_idem"));
  assert.ok(attempt, "the attempt's key was persisted before the request");

  // Simulate the lost response: put the browser back exactly where it was
  // before the answer arrived — same cart, same form, same stored attempt.
  await addToCart(page, BASE, "crimson-2005");
  await page.evaluate(([k, v]) => window.sessionStorage.setItem(k, v), [IDEM_KEY, attempt]);
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await fillCheckout(page, email);
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  assert.equal(page.url().match(/confirmation\/(CR-[A-Z0-9]+)/)[1], firstNumber, "the retry lands on the SAME order's confirmation");
  const orders = await ordersFor(page, email);
  assert.equal(orders.length, 1, "no second order");
  assert.equal(Object.keys(orders[0].customerEmails ?? {}).length, 1, "no second customer email");
  const audits = await page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).audit.filter((a) => a.action === "order_created" && a.target === n).length,
    [LS_KEY, firstNumber],
  );
  assert.equal(audits, 1, "no second order_created audit row");
  assert.equal(await storedAttempt(page), null, "cleared again after the replayed success");
}

/* ── a failed attempt keeps its key; a changed cart gets a new one ──────── */

export async function a_changed_cart_after_a_failed_attempt_uses_a_new_key({ page, BASE }) {
  // A personalized crimson line, then the product stops offering
  // personalization: the service refuses the order (the client's stale-line
  // check is about product/size/version, so the request is really sent).
  await patchProduct(page, BASE, "crimson-2005", { personalizable: false });
  await page.evaluate(
    ([key]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify([
          {
            key: "idem|||L|DANA|",
            productId: "demo-crimson-2005",
            slug: "crimson-2005",
            title: { ar: "أ", he: "א", en: "Demo — Crimson Home, 2005 Era" },
            image: "/demo/p-crimson-2005.webp",
            size: "L",
            personalization: { name: "DANA" },
            quantity: 1,
            unitPriceIls: 169,
            qualifiesForFreeDelivery: true,
            isDemo: true,
          },
        ]),
      );
    },
    [CART_KEY],
  );
  const email = `idem-changed-${Date.now()}@example.com`;
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await fillCheckout(page, email);
  const submit = page.getByRole("button", { name: /Place order/i });
  await submit.click();
  await page.locator(".error-summary[role=alert]").first().waitFor({ timeout: 5000 });
  assert.ok(page.url().includes("/checkout"), "the failed attempt stays on checkout");
  const first = await storedAttempt(page);
  assert.match(first?.key ?? "", UUID_V4, "the failed attempt's key is kept for a retry");

  // Retrying the unchanged attempt reuses its key.
  await submit.click();
  await page.waitForTimeout(400);
  assert.equal((await storedAttempt(page))?.key, first.key, "same attempt → same key");

  // The customer changes the cart: a new attempt, a new key.
  await addToCart(page, BASE, "royal-1998");
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await fillCheckout(page, email);
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.locator(".error-summary[role=alert]").first().waitFor({ timeout: 5000 });
  const second = await storedAttempt(page);
  assert.match(second?.key ?? "", UUID_V4);
  assert.notEqual(second.key, first.key, "a changed cart starts a fresh key");
  assert.notEqual(second.fp, first.fp);
  assert.equal((await ordersFor(page, email)).length, 0, "no order from the refused attempts");
}
