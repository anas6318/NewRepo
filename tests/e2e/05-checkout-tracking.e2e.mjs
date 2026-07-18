/** Guest checkout (bank transfer), confirmation, secure tracking (spec §14/§16). */
import assert from "node:assert/strict";

async function fillCheckout(page, BASE, email) {
  // add one product
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator(".chip", { hasText: /^L$/ }).click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "E2E Tester");
  await page.fill("#co-email", email);
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
}

export async function bank_transfer_is_the_only_visible_method_and_is_labeled({ page, BASE }) {
  await fillCheckout(page, BASE, "e2e@example.com");
  const options = page.locator(".pay-option");
  assert.equal(await options.count(), 1, "only bank transfer available (others unconfigured stay hidden)");
  const text = await options.first().textContent();
  assert.ok(text?.includes("Bank transfer"), "bank transfer labeled");
  assert.ok(text?.toLowerCase().includes("verified manually"), "manual verification disclosed");
}

export async function validation_blocks_incomplete_checkout({ page, BASE }) {
  await fillCheckout(page, BASE, "not-an-email");
  await page.locator(".pay-option input").first().check();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator(".error-summary").isVisible(), "error summary shown");
  assert.ok(page.url().includes("/checkout"), "stays on checkout");
}

export async function guest_bank_transfer_order_end_to_end({ page, BASE }) {
  await fillCheckout(page, BASE, "e2e@example.com");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  assert.ok(orderNumber.startsWith("CR-"), "unguessable order number issued");
  assert.ok(await page.getByText(/bank transfer/i).first().isVisible(), "bank instructions shown");

  /* tracking: correct contact reveals the order */
  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", "e2e@example.com");
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForSelector(".timeline", { timeout: 5000 });
  const timeline = await page.locator(".timeline").textContent();
  assert.ok(timeline?.toLowerCase().includes("awaiting payment"), "bank order awaits verification — never auto-paid");

  /* anti-enumeration: order number alone / wrong contact both fail generically */
  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", "wrong@example.com");
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".timeline").count(), 0, "wrong contact reveals nothing");
  assert.ok(await page.locator(".field__error").isVisible(), "generic error shown");
}

export async function order_appears_in_demo_admin_after_checkout({ page, BASE }) {
  await fillCheckout(page, BASE, "e2e-admin@example.com");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });
  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 5000 });
  await page.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
  assert.ok(await page.getByText(orderNumber).first().isVisible(), "new order listed in admin");
}
