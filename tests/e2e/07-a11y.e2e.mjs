/** Keyboard access + focus management basics (spec §33). */
import assert from "node:assert/strict";

export async function skip_link_appears_on_first_tab({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  assert.ok(focused.includes("skip-link"), `first tab lands on skip link, got: ${focused}`);
}

export async function cart_drawer_escapes_and_restores_focus({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  await page.locator('.site-header button[aria-label="Cart"]').click();
  await page.waitForSelector(".drawer");
  assert.equal(await page.locator(".drawer[role='dialog']").count(), 1, "drawer is a dialog");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".drawer").count(), 0, "esc closes drawer");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  assert.equal(focused, "Cart", "focus returns to the trigger");
}

export async function form_errors_are_announced({ page, BASE }) {
  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('[role="alert"]').count()) >= 1, "error uses role=alert");
}

export async function images_and_controls_have_accessible_names({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prod-card");
  const unnamedButtons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter((b) => !b.textContent?.trim() && !b.getAttribute("aria-label") && !b.querySelector("[aria-label]")).length,
  );
  assert.equal(unnamedButtons, 0, "every button has an accessible name");
  const unlabeledInputs = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")].filter((el) => {
      const id = el.getAttribute("id");
      const labelled = id ? document.querySelector(`label[for="${id}"]`) : null;
      return !labelled && !el.closest("label") && !el.getAttribute("aria-label");
    }).length,
  );
  assert.equal(unlabeledInputs, 0, "every field is labeled");
}

export async function html_lang_and_dir_track_locale({ page, BASE }) {
  for (const [path, lang, dir] of [
    ["/ar/shop", "ar", "rtl"],
    ["/he/shop", "he", "rtl"],
    ["/en/shop", "en", "ltr"],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
    assert.equal(await page.evaluate(() => document.documentElement.dir), dir);
  }
}
