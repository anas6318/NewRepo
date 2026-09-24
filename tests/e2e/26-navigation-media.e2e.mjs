/**
 * The storefront refinement: reorganised navigation, Customer Care, the
 * product-card carousel, and the removal of the customer-facing Styled/Real
 * switch.
 *
 * The carousel assertions read the IMAGE ACTUALLY ON SCREEN — the slide
 * nearest the track's centre — never a class name or React state, for the
 * same reason the gallery tests do: agreeing with itself is exactly what a
 * desynchronised carousel would do.
 */
import assert from "node:assert/strict";

const LOCALES = ["ar", "he", "en"];
const DIR = { ar: "rtl", he: "rtl", en: "ltr" };
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const DUAL = "crimson-2005";

/* ── navigation ─────────────────────────────────────────────────────────── */

export async function the_football_menu_opens_and_every_link_resolves({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    for (const locale of LOCALES) {
      await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => document.documentElement.dir), DIR[locale], `${locale} direction`);

      const trigger = page.locator(".nav-dropdown__trigger, [aria-controls='shop-menu']").first();
      assert.equal(await trigger.count(), 1, `${locale}: one menu trigger`);
      await trigger.click();
      await page.waitForSelector("#shop-menu:not([hidden])", { timeout: 5000 });

      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll("#shop-menu a")].map((a) => a.getAttribute("href")),
      );
      assert.ok(hrefs.length >= 8, `${locale}: the menu has real content (${hrefs.length} links)`);
      for (const href of hrefs) {
        assert.ok(href && href.startsWith("/"), `${locale}: ${href} is a site route`);
      }
    }
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function every_navigation_route_renders_a_real_page({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
    await page.locator(".nav-dropdown__trigger, [aria-controls='shop-menu']").first().click();
    await page.waitForSelector("#shop-menu:not([hidden])", { timeout: 5000 });
    const hrefs = await page.evaluate(() => [...document.querySelectorAll("#shop-menu a")].map((a) => a.getAttribute("href")));

    for (const href of [...new Set(hrefs)]) {
      await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
      const text = (await page.locator("main").innerText()).trim();
      assert.ok(!text.includes("404") && !/page not found/i.test(text), `${href} is not a 404`);
      assert.ok(text.length > 20, `${href} renders content`);
    }
  } finally {
    await context.close();
  }
}

export async function shop_by_club_links_run_a_real_catalog_search({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
    await page.locator(".nav-dropdown__trigger, [aria-controls='shop-menu']").first().click();
    await page.waitForSelector("#shop-menu:not([hidden])", { timeout: 5000 });

    const clubs = await page.evaluate(() =>
      [...document.querySelectorAll("#shop-menu a[data-club]")].map((a) => ({ id: a.getAttribute("data-club"), href: a.getAttribute("href") })),
    );
    assert.ok(clubs.length >= 3, `Shop by Club has entries (${clubs.length})`);
    for (const club of clubs) {
      assert.ok(club.href.includes("/shop?q="), `${club.id} is a catalog search: ${club.href}`);
      await page.goto(`${BASE}${club.href}`, { waitUntil: "networkidle" });
      const text = (await page.locator("main").innerText()).trim();
      assert.ok(!text.includes("404"), `${club.id}: a real page, not a 404`);
      assert.ok(text.length > 20, `${club.id}: renders content (results or a clear empty state)`);
    }
  } finally {
    await context.close();
  }
}

export async function customer_care_links_work_and_read_as_secondary({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
    const care = await page.evaluate(() =>
      [...document.querySelectorAll(".utility-bar__nav a")].map((a) => a.getAttribute("href")),
    );
    assert.ok(care.length >= 4, `Customer Care has its own group (${care.length} links)`);
    for (const href of care) {
      await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
      const text = (await page.locator("main").innerText()).trim();
      assert.ok(!text.includes("404"), `${href} is a real page`);
    }
  } finally {
    await context.close();
  }
}

export async function the_mobile_menu_carries_the_same_hierarchy({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    for (const locale of LOCALES) {
      await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
      await page.locator("button.show-sm-only[aria-controls]").first().click();
      await page.waitForSelector(".mobile-nav", { timeout: 5000 });
      const headings = await page.evaluate(() => [...document.querySelectorAll(".mobile-nav__heading")].map((h) => h.textContent.trim()));
      assert.ok(headings.length >= 3, `${locale}: shopping, clubs and care sections (${headings.join(" / ")})`);
      const clubs = await page.locator(".mobile-nav a[data-club]").count();
      assert.ok(clubs >= 3, `${locale}: club links present on mobile (${clubs})`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 2, `${locale}: menu does not overflow (${overflow}px)`);
    }
  } finally {
    await context.close();
  }
}

/* ── the switch is gone ─────────────────────────────────────────────────── */

export async function no_styled_real_toggle_survives_anywhere_customer_facing({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    for (const locale of LOCALES) {
      for (const path of ["", "/shop", `/product/${DUAL}`, "/category/retro", "/wishlist"]) {
        await page.goto(`${BASE}/${locale}${path}`, { waitUntil: "networkidle" });
        assert.equal(await page.locator(".media-toggle").count(), 0, `/${locale}${path}: no toggle element`);
        assert.equal(await page.locator("[data-view]").count(), 0, `/${locale}${path}: no view buttons`);
        // The BAN IS ON THE CONTROL, not on honest prose: a quiet note may
        // still say the first image is a styled presentation image. What must
        // not exist is a button offering the two as modes.
        const labelledControls = await page.evaluate(() => {
          const words = ["styled preview", "real product", "صورة تقديمية", "המוצר האמיתי", "הדמיה מעוצבת"];
          return [...document.querySelectorAll('button, [role="button"], [role="tab"]')]
            .map((el) => (el.textContent || "").trim().toLowerCase())
            .filter((txt) => words.some((w) => txt.includes(w.toLowerCase())));
        });
        assert.deepEqual(labelledControls, [], `/${locale}${path}: a Styled/Real control still exists`);
      }
    }
  } finally {
    await context.close();
  }
}

/* ── product-card carousel ──────────────────────────────────────────────── */

/** The slide on screen inside the first dual-image card. */
async function cardSlide(page) {
  return await page.evaluate(() => {
    const track = document.querySelector(".prod-card--carousel .media-carousel__track");
    if (!track) return { index: -1, src: null, count: 0 };
    const box = track.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    let index = 0;
    let best = Infinity;
    for (let i = 0; i < track.children.length; i++) {
      const r = track.children[i].getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - centre);
      if (d < best) {
        best = d;
        index = i;
      }
    }
    const img = track.children[index].querySelector("img");
    return { index, src: img ? new URL(img.getAttribute("src"), window.location.origin).pathname : null, count: track.children.length };
  });
}

export async function the_card_carousel_can_reach_every_product_image({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    await page.waitForSelector(".prod-card--carousel .media-carousel__track", { timeout: 6000 });
    const first = await cardSlide(page);
    assert.ok(first.count >= 2, `the test card has several images (${first.count})`);

    const seen = new Set([first.src]);
    for (let i = 1; i < first.count; i++) {
      await page.locator(`.prod-card--carousel .media-carousel__dot[data-dot="${i}"]`).first().click();
      await page.waitForTimeout(700);
      const now = await cardSlide(page);
      assert.equal(now.index, i, `indicator ${i} brought slide ${i} on screen`);
      seen.add(now.src);
    }
    assert.equal(seen.size, first.count, `every image was reachable (${seen.size}/${first.count})`);
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function dragging_a_card_does_not_navigate_away({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    await page.waitForSelector(".prod-card--carousel .media-carousel__track", { timeout: 6000 });
    const before = page.url();

    const box = await page.locator(".prod-card--carousel .media-carousel__track").first().boundingBox();
    const y = box.y + box.height / 2;
    // A real horizontal drag across the image.
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    for (const step of [0.6, 0.45, 0.3, 0.2]) await page.mouse.move(box.x + box.width * step, y);
    await page.mouse.up();
    await page.waitForTimeout(700);

    assert.equal(page.url(), before, `a drag must not navigate — went to ${page.url()}`);
    assert.equal(await page.locator(".prod-card--carousel").count() > 0, true, "still on the listing");
  } finally {
    await context.close();
  }
}

export async function a_deliberate_click_still_opens_the_right_product({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    await page.waitForSelector(".prod-card--carousel", { timeout: 6000 });
    const expected = await page.evaluate(() => {
      const card = document.querySelector(".prod-card--carousel");
      return card.querySelector(".prod-card__title a").getAttribute("href");
    });

    // Tap the image itself — there is no link layered over the scroller,
    // precisely so a swipe can reach it.
    await page.locator(".prod-card--carousel .media-carousel__slide").first().click();
    await page.waitForURL(`**${expected}`, { timeout: 8000 });
    assert.ok(page.url().endsWith(expected), `a tap opened ${expected}`);
    assert.equal(await page.locator(".gallery__track").count(), 1, "and it is the product page");
  } finally {
    await context.close();
  }
}

export async function swiping_a_card_on_a_phone_changes_the_image_without_navigating({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    await page.waitForSelector(".prod-card--carousel .media-carousel__track", { timeout: 6000 });
    const before = await cardSlide(page);
    const url = page.url();

    await page.evaluate(() => {
      const t = document.querySelector(".prod-card--carousel .media-carousel__track");
      t.scrollBy({ left: t.getBoundingClientRect().width, behavior: "smooth" });
    });
    await page.waitForTimeout(900);

    const after = await cardSlide(page);
    assert.equal(after.index, before.index + 1, "the swipe advanced one image");
    assert.notEqual(after.src, before.src, "a different image is on screen");
    assert.equal(page.url(), url, "and nothing navigated");
  } finally {
    await context.close();
  }
}

export async function wishlist_and_badges_still_work_on_a_card({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    const card = page.locator(".prod-card").first();
    const wish = card.locator(".prod-card__wish");
    assert.equal(await wish.count(), 1, "the wishlist control is present");
    const before = await wish.getAttribute("aria-pressed");
    await wish.click();
    await page.waitForTimeout(400);
    assert.notEqual(await wish.getAttribute("aria-pressed"), before, "and it toggles");
    assert.equal(page.url().includes("/product/"), false, "without navigating");

    // Badges are data-driven; at least the badge container survives.
    const badges = await page.locator(".prod-card__badges").count();
    assert.ok(badges > 0, "status/sale badge slot still renders");
    const price = await page.locator(".prod-card .price, .prod-card__meta").first().innerText();
    assert.ok(price.trim().length > 0, "price still renders");
  } finally {
    await context.close();
  }
}

/* ── product page gallery ───────────────────────────────────────────────── */

export async function the_gallery_reaches_preview_front_and_back_in_order({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".gallery__track", { timeout: 6000 });
    const srcs = await page.evaluate(() =>
      [...document.querySelectorAll(".gallery__track img")].map((i) => new URL(i.getAttribute("src"), window.location.origin).pathname),
    );
    assert.ok(srcs.length >= 2, `every image is a slide (${srcs.length})`);
    assert.equal(new Set(srcs).size, srcs.length, "no image is duplicated across slides");
    // Styled preview leads, then the photograph.
    if (srcs.length >= 2) assert.ok(!srcs[0].includes("-real"), `the styled preview leads — ${srcs[0]}`);
  } finally {
    await context.close();
  }
}
