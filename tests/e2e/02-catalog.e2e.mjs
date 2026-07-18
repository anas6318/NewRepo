/** Shop, filters (URL-synced), search with typo tolerance (spec §19). */
import assert from "node:assert/strict";

export async function shop_lists_catalog({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  const count = await page.locator(".prod-card").count();
  assert.ok(count >= 12, `expected 12+ products, got ${count}`);
}

export async function filters_narrow_and_sync_to_url({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /filters/i }).click();
  await page.locator(".filterbar__panel").getByRole("button", { name: "Player", exact: true }).click();
  await page.waitForTimeout(400);
  assert.ok(page.url().includes("version=player"), "filter in URL");
  const filtered = await page.locator(".prod-card").count();
  assert.ok(filtered >= 3 && filtered < 12, `player filter narrowed to ${filtered}`);
  // Shareable: reload keeps the filter (spec §19).
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  assert.equal(await page.locator(".prod-card").count(), filtered, "filter survives reload");
}

export async function category_pages_load_with_localized_header({ page, BASE }) {
  await page.goto(`${BASE}/ar/category/retro`, { waitUntil: "networkidle" });
  assert.ok((await page.locator("h1").first().textContent())?.includes("ريترو"));
  await page.waitForSelector(".prod-card");
  assert.ok((await page.locator(".prod-card").count()) >= 4);
}

export async function search_finds_and_tolerates_typos({ page, BASE }) {
  await page.goto(`${BASE}/en/search?q=crimson`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  assert.ok((await page.locator(".prod-card").count()) >= 1, "exact search works");
  await page.goto(`${BASE}/en/search?q=crimsn`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  assert.ok((await page.locator(".prod-card").count()) >= 1, "typo search works");
}

export async function search_suggestions_appear_while_typing({ page, BASE }) {
  await page.goto(`${BASE}/en/search`, { waitUntil: "networkidle" });
  await page.fill("#search-input", "hood");
  await page.waitForSelector(".search-box__suggestions", { timeout: 4000 });
  assert.ok((await page.locator(".search-sugg").count()) >= 1);
}

export async function wishlist_persists_across_reload({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card__wish");
  await page.locator(".prod-card__wish").first().click();
  await page.goto(`${BASE}/en/wishlist`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  assert.equal(await page.locator(".prod-card").count(), 1);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  assert.equal(await page.locator(".prod-card").count(), 1, "wishlist survives reload");
}
