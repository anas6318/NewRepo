/**
 * Desktop gallery sizing, measured from the real DOM rectangles.
 *
 * The earlier fix capped `.gallery` only, which does not reach the track or
 * the slide: the slide is `flex: 0 0 100%` with `aspect-ratio: 4 / 5`, so its
 * height was still derived from the 7fr column's width — 658px wide became an
 * 823px-tall image whose bottom sat at y=903 in a 768px viewport. The page
 * had to be zoomed to ~50% to see the shirt.
 *
 * These tests assert the constraint reaches the ACTUAL rendered boxes, at
 * standard Playwright scale (no browser zoom involved).
 */
import assert from "node:assert/strict";

const DUAL = "crimson-2005";
const LAPTOPS = [
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
const PHONE = { width: 390, height: 844 };

async function geometry(page) {
  return await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const img = document.querySelector(".gallery__track .media-stack__img.is-on, .gallery__slide img");
    const ir = img?.getBoundingClientRect();
    return {
      vh: window.innerHeight,
      vw: window.innerWidth,
      dpr: window.devicePixelRatio,
      gallery: box(".gallery"),
      stage: box(".gallery__stage"),
      track: box(".gallery__track"),
      slide: box(".gallery__slide"),
      toggle: box(".media-toggle--page"),
      image: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), bottom: Math.round(ir.bottom) } : null,
      objectFit: img ? window.getComputedStyle(img).objectFit : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/** Settles the sticky gallery at its pinned position, as a reader would. */
async function settle(page) {
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await page.waitForTimeout(300);
}

export async function the_whole_media_area_fits_the_laptop_viewport({ newPage, BASE }) {
  for (const vp of LAPTOPS) {
    const { page, context } = await newPage(vp);
    try {
      for (const locale of ["en", "ar"]) {
        await page.goto(`${BASE}/${locale}/product/${DUAL}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
        await settle(page);
        const g = await geometry(page);
        const at = `${vp.width}x${vp.height} ${locale}`;

        assert.equal(g.dpr, 1, `${at}: measured at 100% scale`);
        // The bug, stated as an assertion: the RENDERED boxes, not just the
        // outer wrapper, must stay inside the viewport.
        assert.ok(g.slide.bottom <= g.vh, `${at}: slide bottom ${g.slide.bottom} must be within ${g.vh} (was 903)`);
        assert.ok(g.track.bottom <= g.vh, `${at}: track bottom ${g.track.bottom} within ${g.vh}`);
        assert.ok(g.stage.bottom <= g.vh, `${at}: stage bottom ${g.stage.bottom} within ${g.vh}`);
        assert.ok(g.gallery.bottom <= g.vh, `${at}: gallery bottom ${g.gallery.bottom} within ${g.vh}`);
        assert.ok(g.toggle.bottom <= g.vh && g.toggle.top >= 0, `${at}: media controls on screen (${g.toggle.top}–${g.toggle.bottom})`);
        assert.ok(g.image.bottom <= g.vh, `${at}: the image itself ends at ${g.image.bottom}, within ${g.vh}`);
        assert.ok(g.image.h <= g.stage.h + 1, `${at}: image height ${g.image.h} does not exceed the stage's ${g.stage.h}`);
        assert.equal(g.overflow <= 2, true, `${at}: no horizontal overflow (${g.overflow}px)`);
      }
    } finally {
      await context.close();
    }
  }
}

export async function the_media_frame_keeps_its_four_by_five_proportions({ newPage, BASE }) {
  for (const vp of LAPTOPS) {
    const { page, context } = await newPage(vp);
    try {
      await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
      await settle(page);
      const g = await geometry(page);
      const ratio = g.slide.w / g.slide.h;
      assert.ok(Math.abs(ratio - 0.8) < 0.02, `${vp.width}x${vp.height}: the frame is still 4:5 (got ${ratio.toFixed(3)}) — height is bounded by shrinking width, not by squashing`);
      // "Prefer showing the complete product rather than cropping it."
      assert.equal(g.objectFit, "contain", "the hero shows the whole shirt rather than cropping it");
    } finally {
      await context.close();
    }
  }
}

export async function the_image_is_large_enough_to_be_worth_looking_at({ newPage, BASE }) {
  // The fix must not over-correct into a postage stamp.
  for (const vp of LAPTOPS) {
    const { page, context } = await newPage(vp);
    try {
      await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
      await settle(page);
      const g = await geometry(page);
      assert.ok(g.slide.h >= g.vh * 0.55, `${vp.width}x${vp.height}: the image still fills most of the viewport height (${g.slide.h} of ${g.vh})`);
      assert.ok(g.slide.w >= 380, `${vp.width}x${vp.height}: and is a usable width (${g.slide.w}px)`);
    } finally {
      await context.close();
    }
  }
}

export async function the_gallery_stays_sticky_on_desktop({ newPage, BASE }) {
  const { page, context } = await newPage({ width: 1440, height: 900 });
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await settle(page);
    const pos = await page.evaluate(() => window.getComputedStyle(document.querySelector(".gallery")).position);
    assert.equal(pos, "sticky", "sticky is kept — it now fits, so it can be");
    const pinned = await page.evaluate(() => Math.round(document.querySelector(".gallery").getBoundingClientRect().top));
    assert.ok(pinned <= 100, `and it really pins near the top (top=${pinned})`);
  } finally {
    await context.close();
  }
}

export async function mobile_sizing_is_unchanged({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const g = await geometry(page);
    const pos = await page.evaluate(() => window.getComputedStyle(document.querySelector(".gallery")).position);
    assert.equal(pos, "static", "the gallery is not sticky on a phone");
    const ratio = g.slide.w / g.slide.h;
    assert.ok(Math.abs(ratio - 0.8) < 0.02, `phone keeps the 4:5 slide (got ${ratio.toFixed(3)})`);
    assert.ok(g.slide.w >= PHONE.width - 40, `and the image still spans the screen (${g.slide.w}px)`);
    assert.equal(g.overflow <= 2, true, `no overflow (${g.overflow}px)`);
  } finally {
    await context.close();
  }
}

/* ── the flow, with a real image and with a broken one ──────────────────── */

export async function styled_and_real_switch_both_ways_with_a_working_image({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage({ width: 1366, height: 768 });
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
    await settle(page);
    const heroSrc = () => page.evaluate(() => document.querySelector(".gallery__track .media-stack__img.is-on")?.getAttribute("src") ?? null);

    const styled = await heroSrc();
    assert.ok(styled && !styled.includes("-real"), `starts styled — ${styled}`);

    await page.locator('.media-toggle--page button[data-view="real"]').click();
    await page.waitForFunction(() => document.querySelector(".gallery__track .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"), { timeout: 8000 });
    assert.equal(await page.locator(".media-stack__note").count(), 0, "no 'image unavailable' message with a valid object");

    await page.locator('.media-toggle--page button[data-view="styled"]').click();
    await page.waitForFunction(() => !document.querySelector(".gallery__track .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"), { timeout: 8000 });
    assert.equal(await heroSrc(), styled, "and back again");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function zoom_still_opens_and_closes_at_the_new_size({ newPage, BASE }) {
  const { page, context } = await newPage({ width: 1366, height: 768 });
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await settle(page);
    const point = await page.evaluate(() => {
      const r = document.querySelector(".gallery__slide").getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.25) };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForSelector('.dialog-backdrop[role="dialog"]', { timeout: 6000 });
    // The zoom view is allowed to be larger than the inline gallery.
    const zoomH = await page.evaluate(() => Math.round(document.querySelector(".dialog-backdrop img").getBoundingClientRect().height));
    assert.ok(zoomH > 0, "the zoomed image renders");
    await page.locator(".gallery__zoom-close").click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.dialog-backdrop[role="dialog"]').count(), 0, "and closes");
  } finally {
    await context.close();
  }
}
