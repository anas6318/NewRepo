/** Cart persistence + the 3-item free-delivery rule end to end (spec §12/§15). */
import assert from "node:assert/strict";

async function addProduct(page, BASE, slug, { size = "L" } = {}) {
  await page.goto(`${BASE}/en/product/${slug}`, { waitUntil: "networkidle" });
  const sizeChip = page.locator(".chip", { hasText: new RegExp(`^${size}$`) }).first();
  if (await sizeChip.count()) await sizeChip.click();
  const versionField = page.locator("fieldset", { hasText: "Version" });
  if (await versionField.count()) await versionField.getByRole("button").first().click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(350);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

export async function free_delivery_unlocks_at_exactly_three_items({ page, BASE }) {
  await addProduct(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  let progress = await page.locator(".fd-progress").textContent();
  assert.ok(progress?.includes("2 more"), `1 item → "add 2 more": ${progress}`);

  await addProduct(page, BASE, "royal-1998");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  progress = await page.locator(".fd-progress").textContent();
  assert.ok(progress?.includes("1 more"), `2 items → "add 1 more": ${progress}`);

  await addProduct(page, BASE, "stealth-hoodie", { size: "M" }); // qualifying hoodie — spec example
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  progress = await page.locator(".fd-progress").textContent();
  assert.ok(progress?.toLowerCase().includes("unlocked"), `3 items → unlocked: ${progress}`);
}

export async function three_units_of_one_product_also_unlock({ page, BASE }) {
  await addProduct(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  await page.locator(".qty button").nth(1).click();
  await page.locator(".qty button").nth(1).click();
  await page.waitForTimeout(300);
  const progress = await page.locator(".fd-progress").textContent();
  assert.ok(progress?.toLowerCase().includes("unlocked"), `qty 3 unlocks: ${progress}`);
}

export async function cart_persists_across_reload({ page, BASE }) {
  await addProduct(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".cart-line").count(), 1);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".cart-line").count(), 1, "cart survives reload");
}

export async function checkout_charges_delivery_under_threshold({ page, BASE }) {
  await addProduct(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.selectOption("#co-zone", "center");
  await page.waitForTimeout(300);
  const summary = await page.locator(".checkout-summary").textContent();
  assert.ok(summary?.includes("₪35"), `zone fee ₪35 shown: ${summary?.slice(0, 200)}`);
  assert.ok(summary?.includes("₪205"), "total = 170 + 35");
}

export async function checkout_free_delivery_at_threshold({ page, BASE }) {
  await addProduct(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  await page.locator(".qty button").nth(1).click();
  await page.locator(".qty button").nth(1).click();
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.selectOption("#co-zone", "center");
  await page.waitForTimeout(300);
  const summary = await page.locator(".checkout-summary").textContent();
  assert.ok(summary?.includes("Free"), "delivery shows Free");
  assert.ok(summary?.includes("₪510"), "total = 3×170 + 0");
}
