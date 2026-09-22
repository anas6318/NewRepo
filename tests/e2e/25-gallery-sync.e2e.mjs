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
const TOGGLE = ".media-toggle--page";

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

export async function the_styled_real_controls_only_exist_on_the_hero_slide({ newPage, BASE }) {
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    assert.equal(await page.locator(TOGGLE).count(), 1, "hero: the switch is present");
    assert.equal(await page.locator(".gallery__media-note").count(), 1, "hero: the caption is present");

    await page.locator('.gallery__thumb[data-slide="1"]').click();
    await page.waitForTimeout(800);
    assert.equal(await visibleSlide(page), 1, "we really are on the second slide");
    assert.equal(await page.locator(TOGGLE).count(), 0, "the Styled/Real switch is gone on a gallery slide");
    assert.equal(await page.locator(".gallery__media-note").count(), 0, "and so is its caption");

    await page.locator('.gallery__thumb[data-slide="0"]').click();
    await page.waitForTimeout(800);
    assert.equal(await visibleSlide(page), 0, "back on the hero");
    assert.equal(await page.locator(TOGGLE).count(), 1, "the switch is back");
    assert.equal(await page.locator(".gallery__media-note").count(), 1, "and the caption with it");
  } finally {
    await context.close();
  }
}

/* ── 5 · the switch still works after a round trip ──────────────────────── */

export async function styled_to_real_and_back_still_works_after_visiting_another_slide({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    const heroSrc = () => page.evaluate(() => document.querySelector(".gallery__track .media-stack__img.is-on")?.getAttribute("src") ?? null);
    const styled = await heroSrc();

    // Away to a gallery slide and back — the state the bug corrupted.
    await page.locator('.gallery__thumb[data-slide="1"]').click();
    await page.waitForTimeout(800);
    await page.locator('.gallery__thumb[data-slide="0"]').click();
    await page.waitForTimeout(800);
    await page.waitForSelector(TOGGLE, { timeout: 6000 });

    await page.locator(`${TOGGLE} button[data-view="real"]`).click();
    await page.waitForFunction(() => document.querySelector(".gallery__track .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"), { timeout: 8000 });
    assert.ok((await heroSrc()).includes("-real"), "Styled → Real still switches the visible hero");

    await page.locator(`${TOGGLE} button[data-view="styled"]`).click();
    await page.waitForFunction(() => !document.querySelector(".gallery__track .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"), { timeout: 8000 });
    assert.equal(await heroSrc(), styled, "Real → Styled too");
    assert.equal(await visibleSlide(page), 0, "and we never left the hero while doing it");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function the_switch_can_never_be_pressed_while_another_slide_is_shown({ newPage, BASE }) {
  // The precise shape of the reported symptom: controls visible over the
  // wrong image, so pressing them changed something the customer could not see.
  const { page, context } = await newPage(DESKTOP);
  try {
    await openProduct(page, BASE);
    const count = await page.locator(".gallery__thumb").count();
    for (let i = 0; i < count; i++) {
      await page.locator(`.gallery__thumb[data-slide="${i}"]`).click();
      await page.waitForTimeout(800);
      const visible = await visibleSlide(page);
      const toggles = await page.locator(TOGGLE).count();
      assert.equal(toggles, visible === 0 ? 1 : 0, `slide ${visible} on screen → ${visible === 0 ? "switch shown" : "switch hidden"} (found ${toggles})`);
    }
  } finally {
    await context.close();
  }
}

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
    assert.equal(await page.locator(TOGGLE).count(), 0, "and the hero switch went away with it");
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
      assert.equal(await page.locator(TOGGLE).count(), 0, `${locale}: hero switch hidden`);

      await page.locator('.gallery__thumb[data-slide="0"]').click();
      await page.waitForTimeout(900);
      assert.equal(await visibleSlide(page), 0, `${locale}: back on the hero`);
      assert.equal(await page.locator(TOGGLE).count(), 1, `${locale}: hero switch back`);
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
    const card = page.locator(".prod-card--dual").first();
    assert.equal(await card.locator(".gallery__track").count(), 0, "cards have no gallery track");
    const before = await card.locator(".media-stack__img.is-on").getAttribute("src");
    await card.locator('.media-toggle--card button[data-view="real"]').click();
    await page.waitForTimeout(900);
    const after = await card.locator(".media-stack__img.is-on").getAttribute("src");
    assert.ok(after.includes("-real"), `card switching still works — ${before} → ${after}`);
  } finally {
    await context.close();
  }
}
