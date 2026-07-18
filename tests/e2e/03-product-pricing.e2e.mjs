/** Product customization + dynamic pricing (spec §9/§10/§29). */
import assert from "node:assert/strict";

async function totalText(page) {
  return (await page.locator("#buy-actions .price").first().textContent()) ?? "";
}

export async function patch_adds_exactly_5_ils({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  assert.ok((await totalText(page)).includes("170"), "base ₪170");
  await page.getByRole("button", { name: /League Patch/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("175"), "patch → ₪175");
  await page.getByRole("button", { name: /No patch/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("170"), "removing patch restores ₪170");
}

export async function player_version_adjustment_applies({ page, BASE }) {
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  assert.ok((await totalText(page)).includes("140"), "fan base ₪140 shown initially");
  await page.locator("fieldset", { hasText: "Version" }).getByRole("button", { name: /Player/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("160"), "player → ₪160");
}

export async function quantity_multiplies_total({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator(".qty button").nth(1).click(); // +
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("340"), "qty 2 → ₪340");
}

export async function name_number_free_with_required_spelling_confirm({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.fill("#p-name", "AHMAD");
  await page.fill("#p-number", "7");
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("170"), "personalization stays free");
  assert.ok(await page.locator(".perso-preview").isVisible(), "preview renders");
  // Attempt to add without confirmations → blocked with errors.
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".site-header .count-dot").count(), 0, "not added without confirmation");
  await page.locator(".chip", { hasText: /^L$/ }).click();
  await page.getByText(/reviewed the spelling/i).click();
  await page.getByText(/checked the size chart|reviewed the correct size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(400);
  assert.ok(await page.locator(".drawer").isVisible(), "cart drawer opened after valid add");
}

export async function conditional_options_hidden_when_irrelevant({ page, BASE }) {
  // Hoodie: no version, no sleeve, no personalization (spec §10).
  await page.goto(`${BASE}/en/product/stealth-hoodie`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("fieldset", { hasText: "Version" }).count(), 0, "no version selector");
  assert.equal(await page.locator("#p-name").count(), 0, "no personalization");
  // Kids set: kids sizes only.
  await page.goto(`${BASE}/en/product/sunrise-kids`, { waitUntil: "networkidle" });
  assert.ok(await page.locator(".chip", { hasText: /^16$/ }).first().isVisible(), "kids sizes offered");
  assert.equal(await page.locator(".chip", { hasText: /^XL$/ }).count(), 0, "no adult sizes");
}

export async function unavailable_product_blocks_purchase({ page, BASE }) {
  await page.goto(`${BASE}/en/product/obsidian-2004`, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("button", { name: /Buy Now|Reserve/i }).count(), 0, "no buy actions");
  assert.ok(await page.getByText(/temporarily unavailable/i).first().isVisible());
}

export async function size_guide_dialog_opens_with_chart({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /size guide/i }).first().click();
  await page.waitForSelector(".dialog table");
  assert.ok((await page.locator(".dialog tbody tr").count()) >= 5, "chart rows render");
  assert.ok(await page.locator(".dialog .badge--warn").isVisible(), "placeholder chart is labeled");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".dialog").count(), 0, "esc closes dialog");
}
