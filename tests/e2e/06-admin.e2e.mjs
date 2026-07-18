/** Admin flows: roles, order management, review moderation, import,
 * rights-gated publishing (spec §22/§25/§26/§30). */
import assert from "node:assert/strict";

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 6000 });
}

export async function customer_account_cannot_enter_admin({ page, BASE }) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "demo@crowned.example");
  await page.fill('input[type="password"]', "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);
  assert.ok(await page.getByText(/insufficient permissions|invalid credentials/i).first().isVisible(), "customer rejected");
  assert.equal(await page.locator(".admin__sidebar").count(), 0, "no admin shell rendered");
}

export async function order_status_update_extends_timeline({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders/CR-DEMO02`, { waitUntil: "networkidle" });
  await page.waitForSelector(".timeline li");
  const before = await page.locator(".timeline li").count();
  await page.locator("select").nth(1).selectOption("arrived_locally");
  await page.waitForTimeout(500);
  const after = await page.locator(".timeline li").count();
  assert.equal(after, before + 1, "timeline gained the new status event");
}

export async function bank_transfer_verification_flow({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders/CR-DEMO03`, { waitUntil: "networkidle" });
  await page.waitForSelector("select");
  await page.locator("select").first().selectOption("paid");
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: "CR-DEMO03" });
  assert.ok((await row.textContent())?.includes("paid"), "order now paid after manual verification");
}

export async function review_moderation_approve_and_hide({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/reviews`, { waitUntil: "networkidle" });
  await page.waitForSelector("article.card");
  const pendingCard = page.locator("article.card", { hasText: "pending" }).first();
  assert.ok(await pendingCard.count(), "a pending review exists");
  await pendingCard.getByRole("button", { name: "Approve" }).click();
  await page.waitForTimeout(400);
  assert.ok(await page.locator("article.card", { hasText: "Player fit is real" }).first().textContent().then((t) => t?.includes("approved")), "review approved");
}

export async function supplier_import_creates_drafts_only({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/imports`, { waitUntil: "networkidle" });
  const csv = `slug,name_en,category,price_ils,supplier_sku,supplier_cost_usd\ne2e-import-shirt,E2E Import Shirt,retro,170,SKU-1,19\ncrimson-2005,Duplicate Slug,retro,170,SKU-2,19\nbad-row,,retro,abc,SKU-3,19`;
  await page.fill("textarea", csv);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Import .* drafts/ }).click();
  await page.waitForTimeout(500);
  const results = await page.locator(".stack--sm").last().textContent();
  assert.ok(results?.includes('created draft "e2e-import-shirt"'), "valid row imported as draft");
  assert.ok(results?.includes("duplicate slug"), "duplicate detected");
  assert.ok(results?.includes("invalid price_ils") || results?.includes("missing name_en"), "bad row rejected");
  // Draft never appears on the storefront (spec §25). The search page shows
  // featured fallbacks on zero results, so assert by content, not count.
  await page.goto(`${BASE}/en/search?q=E2E Import`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".prod-card", { hasText: "E2E Import" }).count(), 0, "draft import invisible to customers");
}

export async function rights_gate_blocks_publishing_until_cleared({ page, BASE }) {
  // Each e2e test runs in a fresh context (fresh demo DB) — create the
  // draft product in this context first.
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/imports`, { waitUntil: "networkidle" });
  await page.fill("textarea", "slug,name_en,category,price_ils\ne2e-import-shirt,E2E Import Shirt,retro,170");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Import .* drafts/ }).click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/admin/products`, { waitUntil: "networkidle" });
  await page.waitForSelector("tbody tr");
  const row = page.locator("tbody tr", { hasText: "e2e-import-shirt" }).first();
  await row.getByRole("link", { name: "Edit" }).click();
  await page.waitForSelector("select");
  // Try to publish while rights are pending_review → blocked.
  await page.locator("label", { has: page.locator("span", { hasText: /^Status$/ }) }).locator("select").selectOption("made_to_order");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(400);
  assert.ok(await page.getByText(/rights must be cleared/i).first().isVisible(), "publish blocked");
  // Clear rights → publish succeeds.
  await page.locator("label", { has: page.locator("span", { hasText: /^Rights status$/ }) }).locator("select").selectOption("cleared");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok(page.url().endsWith("/admin/products"), "saved after rights cleared");
}

export async function sheets_resync_reports_honestly_in_demo({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders/CR-DEMO01`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Resync/ }).click();
  await page.waitForSelector(".toast");
  const toast = await page.locator(".toast").textContent();
  assert.ok(toast?.toLowerCase().includes("no external sync"), `demo resync is honest: ${toast}`);
}
