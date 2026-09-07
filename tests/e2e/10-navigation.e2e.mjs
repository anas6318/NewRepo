/** Redesigned header navigation: Shop dropdown, utility bar, mobile menu,
 * official logo → homepage. */
import assert from "node:assert/strict";

export async function logo_links_to_localized_homepage({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const logo = page.locator(".site-header__logo img");
  assert.ok(await logo.isVisible(), "official logo visible in header");
  assert.equal(await logo.getAttribute("alt"), "CROWNED", "logo has accessible alt text");
  assert.ok((await logo.getAttribute("src"))?.includes("crowned-logo"), "official logo asset used");
  await page.locator(".site-header__logo").click();
  await page.waitForTimeout(300);
  assert.ok(new URL(page.url()).pathname === "/en" || new URL(page.url()).pathname === "/en/", `logo returns home: ${page.url()}`);
}

export async function shop_dropdown_click_open_escape_close_restores_focus({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  const trigger = page.locator(".nav-dropdown__trigger");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false", "closed by default");
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true", "aria-expanded reflects open state");
  assert.ok(await page.locator("#shop-menu").isVisible(), "panel opens on click");
  assert.ok(await page.locator('#shop-menu a[href="/en/shop"]').isVisible(), "Shop All link present");
  assert.ok(await page.locator('#shop-menu a[href="/en/category/player-version"]').isVisible(), "jersey links present");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  assert.ok(!(await page.locator("#shop-menu").isVisible()), "Escape closes the panel");
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  assert.ok(focused.includes("nav-dropdown__trigger"), "focus returns to the trigger");
}

export async function shop_dropdown_links_navigate({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  await page.locator(".nav-dropdown__trigger").click();
  await page.locator('#shop-menu a[href="/en/category/retro"]').click();
  await page.waitForTimeout(300);
  assert.ok(page.url().includes("/en/category/retro"), `dropdown link navigates: ${page.url()}`);
  assert.ok(!(await page.locator("#shop-menu").isVisible()), "panel closes after navigation");
}

export async function track_order_lives_in_utility_bar_not_primary_nav({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  const primary = await page.locator(".site-header__nav").innerText();
  assert.ok(!primary.includes("Track Order"), "Track Order removed from primary nav");
  const utility = page.locator('.utility-bar a[href="/en/track"]');
  assert.ok(await utility.isVisible(), "Track Order visible in utility bar");
  await utility.click();
  await page.waitForTimeout(300);
  assert.ok(page.url().includes("/en/track"), "utility link navigates to tracking");
}

export async function mobile_menu_focus_escape_and_scroll_lock({ BASE, newPage }) {
  const { page, context } = await newPage({ width: 390, height: 844 });
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  const trigger = page.locator('.site-header button[aria-controls="mobile-menu"]');
  assert.equal(await trigger.getAttribute("aria-expanded"), "false", "trigger reports closed");
  await trigger.click();
  await page.waitForSelector("#mobile-menu");
  assert.equal(await trigger.getAttribute("aria-expanded"), "true", "trigger reports open");
  assert.equal(await page.locator("#mobile-menu[role='dialog']").count(), 1, "menu is a dialog");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "background scroll locked");
  assert.ok(await page.locator('#mobile-menu a[href="/en/track"]').isVisible(), "Track Order in mobile utility section");
  assert.ok(await page.locator('#mobile-menu a[href="/en/category/retro"]').isVisible(), "categories present");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#mobile-menu").count(), 0, "Escape closes the menu");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "scroll unlocked after close");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-controls") ?? "");
  assert.equal(focused, "mobile-menu", "focus returns to the menu trigger");
  await context.close();
}

export async function mobile_menu_rtl_and_ltr_render({ BASE, newPage }) {
  for (const [locale, dir] of [["ar", "rtl"], ["he", "rtl"], ["en", "ltr"]]) {
    const { page, context } = await newPage({ width: 390, height: 844 });
    await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.dir), dir, `${locale} dir`);
    await page.locator('.site-header button[aria-controls="mobile-menu"]').click();
    await page.waitForSelector("#mobile-menu");
    const headings = await page.locator(".mobile-nav__heading").count();
    assert.ok(headings >= 3, `${locale} menu shows section headings`);
    const box = await page.locator("#mobile-menu").boundingBox();
    assert.ok(box && (dir === "rtl" ? box.x + box.width >= 385 : box.x <= 5), `${locale} drawer opens from the ${dir === "rtl" ? "right" : "left"} (inline-start)`);
    await context.close();
  }
}

export async function hero_renders_content_and_ctas({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".hero h1").innerText(), "Wear Football History.", "headline from hero config");
  assert.ok(await page.locator(".hero .eyebrow").isVisible(), "eyebrow visible");
  const primary = page.locator('.hero__ctas a[href="/en/category/retro"]');
  assert.ok(await primary.isVisible(), "primary CTA targets retro");
  assert.ok(await page.locator('.hero__ctas a[href="/en/shop"]').isVisible(), "secondary CTA targets shop");
  const alt = await page.locator(".hero__bg").getAttribute("alt");
  assert.ok(alt && alt.length > 0, "hero image has accessible alt text");
}
