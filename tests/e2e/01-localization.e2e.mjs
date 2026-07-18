/** Language separation, RTL/LTR, switcher page preservation (spec §4). */
import assert from "node:assert/strict";

export async function language_gate_lists_three_languages({ page, BASE }) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  for (const name of ["العربية", "עברית", "English"]) {
    assert.ok(await page.getByText(name).first().isVisible(), `${name} option visible`);
  }
}

export async function arabic_is_rtl_and_fully_arabic({ page, BASE }) {
  await page.goto(`${BASE}/ar`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ar");
  const nav = await page.locator(".site-header__nav").textContent();
  assert.ok(nav?.includes("المتجر"), "nav is Arabic");
}

export async function hebrew_is_rtl_english_is_ltr({ page, BASE }) {
  await page.goto(`${BASE}/he`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.dir), "ltr");
}

export async function switcher_preserves_equivalent_page({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator(".lang-switch button").first().click();
  await page.getByRole("option", { name: "עברית" }).click();
  await page.waitForTimeout(400);
  assert.ok(page.url().includes("/he/product/crimson-2005"), `URL preserved: ${page.url()}`);
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
}

export async function remembered_language_redirects_from_root({ page, BASE }) {
  await page.goto(`${BASE}/he`, { waitUntil: "networkidle" });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  assert.ok(page.url().endsWith("/he"), `redirected to remembered locale: ${page.url()}`);
}

export async function no_missing_translation_keys_leak({ page, BASE }) {
  for (const path of ["/ar", "/he", "/en", "/ar/shop", "/he/checkout", "/en/faq", "/ar/track"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const text = (await page.locator("body").innerText()).split("\n");
    const leaks = text.filter((line) => /^[a-z]+\.[a-zA-Z][a-zA-Z0-9_.]+$/.test(line.trim()));
    assert.equal(leaks.length, 0, `${path} leaked keys: ${leaks.join(", ")}`);
  }
}
