/**
 * The gallery's `active` state and the slide actually ON SCREEN must agree.
 *
 * They used to be independent: `.gallery__track` is a horizontally scrolling,
 * scroll-snapped carousel, while `active` was plain React state that only the
 * thumbnails wrote to. So a thumbnail could mark slide 2 selected while slide
 * 1 was still visible — and, worse, the Styled/Real controls belong to the
 * hero, so they stayed on screen over a different gallery image and appeared
 * to do nothing when pressed (they were switching the hero, out of sight).
 *
 * Every assertion here derives the VISIBLE slide from layout — the child of
 * the track nearest the track's centre — never from React state or a class
 * name, because agreeing with itself is exactly what the broken version did.
 */
import assert from "node:assert/strict";

const DUAL = "crimson-2005";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Which slide is actually on screen, measured from the rendered boxes. */
async function visibleSlide(page) {
  return await page.evaluate(() => {
    const track = document.querySelector(".gallery__track");
    if (!track) return -1;
    const box = track.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    let nearest = -1;
    let best = Infinity;
    for (let i = 0; i < track.children.length; i++) {
      const r = track.children[i].getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - centre);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    return nearest;
  });
}

/** Which slide the UI CLAIMS is selected. */
async function selectedSlide(page) {
  return await page.evaluate(() => {
    const t = document.querySelector('.gallery__thumb[aria-selected="true"]');
    return t ? Number(t.getAttribute("data-slide")) : -1;
  });
}

async function assertAgreement(page, label) {
  const [visible, selected] = [await visibleSlide(page), await selectedSlide(page)];
  assert.equal(selected, visible, `${label}: the thumbnail says slide ${selected} but slide ${visible} is on screen`);
  return visible;
}

async function openProduct(page, BASE, locale = "en") {
  await page.goto(`${BASE}/${locale}/product/${DUAL}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".gallery__thumbs", { timeout: 6000 });
  await page.waitForTimeout(250);
}

/* ── 1–2 · a thumbnail moves the gallery, and the two stay in step ──────── */

export async function clicking_a_thumbnail_moves_the_visible_slide({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    assert.equal(await visibleSlide(page), 0, "starts on the hero");
    await assertAgreement(page, "on load");

    await page.locator('.gallery__thumb[data-slide="1"]').click();
    await page.waitForFunction(() => {
      const t = document.querySelector(".gallery__track");
      const box = t.getBoundingClientRect();
      const r = t.children[1].getBoundingClientRect();
      return Math.abs(r.left + r.width / 2 - (box.left + box.width / 2)) < 4;
    }, { timeout: 6000 });

    assert.equal(await visibleSlide(page), 1, "the SECOND slide is now the one on screen");
    await assertAgreement(page, "after choosing thumbnail 2");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function state_and_screen_agree_after_every_thumbnail_in_turn({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    const count = await page.locator(".gallery__thumb").count();
    assert.ok(count >= 2, `the test product has at least two slides (${count})`);
    for (let i = count - 1; i >= 0; i--) {
      await page.locator(`.gallery__thumb[data-slide="${i}"]`).click();
      await page.waitForTimeout(800);
      assert.equal(await visibleSlide(page), i, `thumbnail ${i} put slide ${i} on screen`);
      await assertAgreement(page, `thumbnail ${i}`);
    }
  } finally {
    await context.close();
  }
}

/* ── 3–4 · the hero controls belong to the hero ─────────────────────────── */


/* ── 5 · the switch still works after a round trip ──────────────────────── */



/* ── 6 · a swipe updates the state ──────────────────────────────────────── */

export async function swiping_the_track_updates_the_selected_slide({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await openProduct(page, BASE);
    assert.equal(await selectedSlide(page), 0, "starts on the hero");

    // Drive the track the way a swipe does — a real scroll on the element,
    // which is what the component listens to. Nothing here touches `active`
    // directly, so a broken sync would leave the thumbnail behind.
    await page.evaluate(() => {
      const track = document.querySelector(".gallery__track");
      track.scrollBy({ left: track.getBoundingClientRect().width, behavior: "smooth" });
    });
    await page.waitForFunction(() => {
      const t = document.querySelector('.gallery__thumb[aria-selected="true"]');
      return t && t.getAttribute("data-slide") === "1";
    }, { timeout: 6000 });

    assert.equal(await visibleSlide(page), 1, "the swipe moved the gallery");
    await assertAgreement(page, "after a swipe");
    assert.equal(await selectedSlide(page), 1, "and the thumbnail followed the swipe");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

/* ── 7 · RTL ────────────────────────────────────────────────────────────── */

export async function thumbnail_navigation_works_right_to_left({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    for (const locale of ["ar", "he"]) {
      await openProduct(page, BASE, locale);
      assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl", `${locale} is RTL`);
      await assertAgreement(page, `${locale} on load`);

      await page.locator('.gallery__thumb[data-slide="1"]').click();
      await page.waitForTimeout(900);
      assert.equal(await visibleSlide(page), 1, `${locale}: the second slide is on screen`);
      await assertAgreement(page, `${locale} after thumbnail 2`);
      assert.equal(await selectedSlide(page), 1, `${locale}: the thumbnail followed`);

      await page.locator('.gallery__thumb[data-slide="0"]').click();
      await page.waitForTimeout(900);
      assert.equal(await visibleSlide(page), 0, `${locale}: back on the hero`);
      assert.equal(await selectedSlide(page), 0, `${locale}: the thumbnail followed back`);
    }
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

/* ── 8–9 · zoom follows the visible slide ───────────────────────────────── */

export async function zoom_shows_the_slide_that_is_actually_on_screen({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    await page.locator('.gallery__thumb[data-slide="1"]').click();
    await page.waitForTimeout(800);
    const onScreen = await page.evaluate(() => {
      const t = document.querySelector(".gallery__track");
      const img = t.children[1].querySelector("img");
      return img ? new URL(img.getAttribute("src"), window.location.origin).pathname : null;
    });

    await page.locator(".gallery__slide.is-active").click();
    await page.waitForSelector('.dialog-backdrop[role="dialog"]', { timeout: 6000 });
    const zoomed = await page.evaluate(() => {
      const img = document.querySelector(".dialog-backdrop img");
      return img ? new URL(img.getAttribute("src"), window.location.origin).pathname : null;
    });
    assert.equal(zoomed, onScreen, "the zoom shows the slide that was on screen, not the hero");
    await page.locator(".gallery__zoom-close").click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.dialog-backdrop[role="dialog"]').count(), 0, "and closes");
  } finally {
    await context.close();
  }
}

/* ── 10 · product cards are untouched ───────────────────────────────────── */

export async function product_cards_are_unaffected({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    const card = page.locator(".prod-card--carousel").first();
    assert.equal(await card.locator(".gallery__track").count(), 0, "cards have no gallery track");
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    assert.equal(await card.locator(".media-carousel").count(), 1, "cards use the carousel");
    assert.equal(await card.locator(".media-toggle--card").count(), 0, "and carry no Styled/Real toggle");
  } finally {
    await context.close();
  }
}

/*
 * RETIRED WITH THE STYLED/REAL SWITCH
 * ───────────────────────────────────
 * The tests removed from this file asserted the behaviour of the binary
 * customer-facing Styled Preview ⇄ Real Product control: that it was
 * hit-testable, that its pressed state never disagreed with the displayed
 * image, that a failed photograph did not leave it selected, and that hover
 * prefetch still revealed the photograph on desktop.
 *
 * That control no longer exists — every product image is an ordinary
 * carousel slide now — so those behaviours are not expressible. They are NOT
 * silently dropped: the guarantees that survived the change (slide/state
 * synchronisation, swipe handling, RTL, zoom, layout) are asserted in
 * 25-gallery-sync.e2e.mjs and 26-navigation-media.e2e.mjs, and the absence of
 * any remaining toggle is asserted there too.
 */

/* ── Previous / Next arrows on the product-page gallery ─────────────────────
 *
 * The arrows own no navigation state of their own: both call the same
 * `goToSlide` the thumbnails and the scroll listener use. These tests check
 * that by reading the IMAGE ON SCREEN after each press, the same way every
 * other assertion in this file does.
 */

const PREV = '[data-arrow="prev"]';
const NEXT = '[data-arrow="next"]';

async function arrowState(page) {
  return await page.evaluate(
    ([p, n]) => ({
      prevDisabled: document.querySelector(p)?.disabled ?? null,
      nextDisabled: document.querySelector(n)?.disabled ?? null,
    }),
    ['[data-arrow="prev"]', '[data-arrow="next"]'],
  );
}

export async function the_next_arrow_moves_the_visible_slide_forward({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    const count = await page.locator(".gallery__thumb").count();
    assert.ok(count >= 2, `the test product has several slides (${count})`);

    for (let i = 1; i < count; i++) {
      const before = await visibleSlide(page);
      await page.locator(NEXT).click();
      await page.waitForTimeout(800);
      const after = await visibleSlide(page);
      assert.equal(after, before + 1, `Next moved exactly one slide forward (${before} → ${after})`);
      await assertAgreement(page, `after Next to ${after}`);
    }
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function the_previous_arrow_moves_the_visible_slide_backward({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    const count = await page.locator(".gallery__thumb").count();
    await page.locator(`.gallery__thumb[data-slide="${count - 1}"]`).click();
    await page.waitForTimeout(800);

    for (let i = count - 1; i > 0; i--) {
      const before = await visibleSlide(page);
      await page.locator(PREV).click();
      await page.waitForTimeout(800);
      const after = await visibleSlide(page);
      assert.equal(after, before - 1, `Previous moved exactly one slide back (${before} → ${after})`);
      await assertAgreement(page, `after Previous to ${after}`);
    }
  } finally {
    await context.close();
  }
}

export async function the_arrows_disable_at_the_ends_and_never_loop({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    const count = await page.locator(".gallery__thumb").count();

    let state = await arrowState(page);
    assert.equal(state.prevDisabled, true, "Previous is disabled on the first slide");
    assert.equal(state.nextDisabled, false, "Next is available there");

    for (let i = 1; i < count; i++) {
      await page.locator(NEXT).click();
      await page.waitForTimeout(800);
    }
    assert.equal(await visibleSlide(page), count - 1, "we reached the last slide");
    state = await arrowState(page);
    assert.equal(state.nextDisabled, true, "Next is disabled on the last slide — no looping");
    assert.equal(state.prevDisabled, false, "Previous is available there");
  } finally {
    await context.close();
  }
}

export async function zoom_opens_the_image_the_arrows_left_on_screen({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    await page.locator(NEXT).click();
    await page.waitForTimeout(800);
    const index = await visibleSlide(page);
    assert.equal(index, 1, "the arrow moved us to the second slide");

    const onScreen = await page.evaluate((i) => {
      const img = document.querySelector(".gallery__track").children[i].querySelector("img");
      return img ? new URL(img.getAttribute("src"), window.location.origin).pathname : null;
    }, index);

    await page.locator(".gallery__slide.is-active").click();
    await page.waitForSelector('.dialog-backdrop[role="dialog"]', { timeout: 6000 });
    const zoomed = await page.evaluate(() => {
      const img = document.querySelector(".dialog-backdrop img");
      return img ? new URL(img.getAttribute("src"), window.location.origin).pathname : null;
    });
    assert.equal(zoomed, onScreen, "zoom shows the image the arrows left on screen");
    await page.locator(".gallery__zoom-close").click();
    await page.waitForTimeout(300);
  } finally {
    await context.close();
  }
}

export async function the_arrows_follow_sequence_not_direction_in_rtl({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    for (const locale of ["ar", "he", "en"]) {
      await openProduct(page, BASE, locale);
      const dir = await page.evaluate(() => document.documentElement.dir);

      // Next ADVANCES the sequence in every direction — the buttons swap
      // sides in RTL, the meaning does not.
      await page.locator(NEXT).click();
      await page.waitForTimeout(800);
      assert.equal(await visibleSlide(page), 1, `${locale} (${dir}): Next advanced to slide 1`);
      await assertAgreement(page, `${locale} after Next`);

      await page.locator(PREV).click();
      await page.waitForTimeout(800);
      assert.equal(await visibleSlide(page), 0, `${locale} (${dir}): Previous went back to slide 0`);
      await assertAgreement(page, `${locale} after Previous`);

      // And in RTL "previous" really is the one nearer the right edge.
      const sides = await page.evaluate(() => {
        const p = document.querySelector('[data-arrow="prev"]').getBoundingClientRect();
        const n = document.querySelector('[data-arrow="next"]').getBoundingClientRect();
        return { prevX: p.x, nextX: n.x };
      });
      if (dir === "rtl") assert.ok(sides.prevX > sides.nextX, `${locale}: Previous sits on the right in RTL`);
      else assert.ok(sides.prevX < sides.nextX, `${locale}: Previous sits on the left in LTR`);
    }
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function the_arrows_do_not_replace_swipe_or_thumbnails({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await openProduct(page, BASE);
    assert.ok(await page.locator(PREV).count(), "the arrows are present on a phone too");

    // Swipe still works alongside them.
    await page.evaluate(() => {
      const t = document.querySelector(".gallery__track");
      t.scrollBy({ left: t.getBoundingClientRect().width, behavior: "smooth" });
    });
    await page.waitForTimeout(900);
    assert.equal(await visibleSlide(page), 1, "a swipe still moves the gallery");
    await assertAgreement(page, "after a swipe");

    // And so do the thumbnails.
    await page.locator('.gallery__thumb[data-slide="0"]').click();
    await page.waitForTimeout(800);
    assert.equal(await visibleSlide(page), 0, "thumbnails still work");
    await assertAgreement(page, "after a thumbnail");
  } finally {
    await context.close();
  }
}
