/** Direct navigation to every route class (deep links, SPA fallback) and
 * every admin route; desktop + mobile layouts for /ar /he /en. */
import assert from "node:assert/strict";

const STOREFRONT_PATHS = [
  "", "/shop", "/category/retro", "/product/crimson-2005", "/search", "/wishlist", "/cart",
  "/checkout", "/track", "/login", "/register", "/size-guide", "/about", "/how-it-works",
  "/delivery", "/faq", "/reviews", "/contact", "/policies/returns", "/policies/privacy",
  "/policies/terms", "/accessibility", "/maintenance",
];

export async function every_localized_route_loads_by_direct_navigation({ page, BASE }) {
  for (const locale of ["ar", "he", "en"]) {
    for (const path of STOREFRONT_PATHS) {
      await page.goto(`${BASE}/${locale}${path}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("main").count(), 1, `${locale}${path} renders <main>`);
      assert.equal(await page.evaluate(() => document.documentElement.lang), locale, `${locale}${path} lang`);
    }
  }
}

export async function unknown_routes_render_localized_404({ page, BASE }) {
  await page.goto(`${BASE}/he/no-such-page`, { waitUntil: "networkidle" });
  assert.ok((await page.locator("body").innerText()).includes("404"), "404 rendered");
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl", "404 stays localized");
}

export async function mobile_and_desktop_layouts_render_all_locales({ BASE, newPage }) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { page, context, pageErrors } = await newPage(viewport);
    for (const locale of ["ar", "he", "en"]) {
      await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 2, `${locale} @${viewport.width}px overflow=${overflow}`);
      if (viewport.width < 720) {
        assert.ok(await page.locator(".site-header .show-sm-only").first().isVisible(), `${locale} mobile menu button visible`);
      }
    }
    assert.equal(pageErrors.length, 0, `no page errors @${viewport.width}px`);
    await context.close();
  }
}

const ADMIN_PATHS = ["", "/products", "/products/new", "/imports", "/orders", "/orders/CR-DEMO01", "/customers", "/reviews", "/shipping", "/payments", "/translations", "/settings", "/audit"];

export async function every_admin_route_loads({ page, BASE }) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 6000 });
  for (const path of ADMIN_PATHS) {
    await page.goto(`${BASE}/admin${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const text = await page.locator("main").innerText();
    assert.ok(text.trim().length > 20, `/admin${path} renders content`);
    assert.ok(!text.includes("Page not found"), `/admin${path} is a real route`);
  }
}
