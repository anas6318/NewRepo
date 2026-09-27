/** CROWNED Studio: the owner marks products "Show in CROWNED Studio" in the
 * Admin product editor and up to 4 of them appear, as ordinary product
 * cards, below the CTA of the homepage Studio banner. With none marked the
 * banner is exactly the original one. Each test runs in a fresh context, so
 * a fresh demo DB. */
import assert from "node:assert/strict";

const SLUGS = ["crimson-2005", "royal-1998", "emerald-2007", "amber-2001", "onyx-home"];

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 6000 });
}

/** Opens a product in the Admin editor, applies `edit`, saves. */
async function editProduct(page, BASE, slug, edit) {
  await page.goto(`${BASE}/admin/products`, { waitUntil: "networkidle" });
  await page.locator("tbody tr", { hasText: slug }).first().getByRole("link", { name: "Edit" }).click();
  const box = page.getByLabel("Show in CROWNED Studio");
  await box.waitFor();
  await edit(page, box);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/admin\/products$/, { timeout: 15000 });
}

const markStudio = (page, BASE, slug, on) =>
  editProduct(page, BASE, slug, async (_p, box) => {
    await box.setChecked(on);
    assert.equal(await box.isChecked(), on);
  });

async function studioSlugs(page, BASE, locale = "en") {
  await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
  await page.locator(".custom-hero").waitFor();
  // Wait for product data (Curated cards) instead of a fixed delay; Studio
  // cards come from the same single catalog load.
  await page.locator("section:not(.custom-hero) .prod-grid .prod-card").first().waitFor({ state: "visible", timeout: 10000 });
  return page.evaluate(() =>
    [...document.querySelectorAll(".custom-hero .prod-card .prod-card__title a")].map((a) => a.getAttribute("href")?.split("/product/")[1]),
  );
}

export async function no_studio_products_leaves_the_banner_unchanged({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  // Product data must have loaded (Curated cards rendered) before asserting
  // the Studio section is empty, so this cannot pass vacuously.
  await page.locator("section:not(.custom-hero) .prod-grid .prod-card").first().waitFor({ state: "visible", timeout: 10000 });
  const hero = page.locator("section.custom-hero");
  await hero.waitFor();
  assert.equal(await hero.getAttribute("class"), "custom-hero theme-dark", "no modifier class");
  assert.deepEqual(
    await hero.evaluate((s) => [...s.children].map((c) => c.className)),
    ["custom-hero__bg", "container custom-hero__content"],
    "only the original image and copy block",
  );
  for (const sel of [".custom-hero__eyebrow", ".custom-hero__title", ".custom-hero__sub", ".btn--gold"]) {
    assert.ok(await hero.locator(sel).first().isVisible(), `${sel} visible`);
  }
  assert.equal(await hero.locator(".prod-grid, .prod-card, .custom-hero__products").count(), 0, "no grid, no cards");
}

export async function five_marked_products_show_exactly_four_real_cards({ page, BASE }) {
  await adminLogin(page, BASE);
  for (const slug of SLUGS) await markStudio(page, BASE, slug, true);

  const slugs = await studioSlugs(page, BASE);
  assert.equal(slugs.length, 4, `exactly 4 cards: ${slugs}`);
  for (const s of slugs) assert.ok(SLUGS.includes(s), `${s} is a marked product`);

  const cards = page.locator(".custom-hero .prod-card");
  for (let i = 0; i < 4; i++) {
    const card = cards.nth(i);
    assert.equal(await card.locator(".prod-card__wish").count(), 1, "wishlist control");
    assert.equal(await card.locator(".media-carousel__track").count(), 1, "card media carousel");
    if ((await card.getAttribute("class"))?.includes("prod-card--carousel")) {
      assert.equal(await card.locator(".media-carousel__nav").count(), 2, "carousel arrows");
      assert.ok((await card.locator(".media-carousel__dot").count()) > 1, "carousel dots");
    }
  }
  // Cards sit below the CTA, inside the Studio section.
  const cta = await page.locator(".custom-hero__content .btn--gold").boundingBox();
  const grid = await page.locator(".custom-hero__products .prod-grid").boundingBox();
  assert.ok(cta && grid && grid.y >= cta.y + cta.height, "grid below the CTA");

  await cards.first().locator(".prod-card__title a").click();
  await page.waitForURL(new RegExp(`/en/product/${slugs[0]}$`));
}

export async function unchecking_removes_a_product_from_studio({ page, BASE }) {
  await adminLogin(page, BASE);
  await markStudio(page, BASE, SLUGS[0], true);
  await markStudio(page, BASE, SLUGS[1], true);
  assert.deepEqual([...(await studioSlugs(page, BASE))].sort(), [SLUGS[0], SLUGS[1]].sort());

  await markStudio(page, BASE, SLUGS[1], false);
  assert.deepEqual(await studioSlugs(page, BASE), [SLUGS[0]]);
}

export async function a_marked_draft_never_appears({ page, BASE }) {
  await adminLogin(page, BASE);
  await markStudio(page, BASE, SLUGS[0], true);
  await markStudio(page, BASE, SLUGS[1], true);
  await editProduct(page, BASE, SLUGS[0], async (p, box) => {
    assert.equal(await box.isChecked(), true, "still marked");
    await p.locator("label", { has: p.locator("span", { hasText: /^Status$/ }) }).locator("select").selectOption("draft");
  });
  assert.deepEqual(await studioSlugs(page, BASE), [SLUGS[1]]);
}

export async function internal_tag_is_never_shown_and_rtl_phone_layout_holds({ page, BASE }) {
  await adminLogin(page, BASE);
  for (const slug of SLUGS) await markStudio(page, BASE, slug, true);

  for (const locale of ["en", "ar", "he"]) {
    assert.equal((await studioSlugs(page, BASE, locale)).length, 4, `${locale}: 4 cards`);
    const text = await page.locator("body").innerText();
    assert.ok(!/crowned-studio/i.test(text), `${locale}: raw tag never visible`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of ["he", "ar"]) {
    await studioSlugs(page, BASE, locale);
    assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${locale}: no horizontal overflow (${overflow}px)`);
    const grid = page.locator(".custom-hero__products .prod-grid");
    await grid.scrollIntoViewIfNeeded();
    assert.equal(await grid.locator(".prod-card").count(), 4);
    for (const card of await grid.locator(".prod-card").all()) {
      const b = await card.boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= 390 + 0.5 && b.width > 100, `${locale}: card inside the viewport`);
    }
    // Phone layout stays compact: two cards per row, section well under 1700px.
    const tops = new Set(await grid.locator(".prod-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))));
    assert.equal(tops.size, 2, `${locale}: 4 cards in 2 rows`);
    const height = await page.locator("section.custom-hero").evaluate((s) => s.getBoundingClientRect().height);
    assert.ok(height < 1700, `${locale}: Studio section height ${height}px`);
  }
}
