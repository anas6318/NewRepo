/**
 * Product-detail gallery: the media toggle must be REACHABLE BY A POINTER.
 *
 * The bug this guards against was not a stacking-order problem — nothing ever
 * intercepted the click. `.gallery` is `position: sticky`, and it was TALLER
 * than the laptop viewport. A sticky box taller than its scrollport pins at
 * its `inset-block-start` and never brings its own bottom edge into view, so
 * the controls anchored to that bottom edge sat permanently below the fold at
 * EVERY scroll position: present in the DOM, display:flex, visible, non-zero
 * size, and impossible to click.
 *
 * WHY THESE TESTS LOOK THE WAY THEY DO: Playwright's `locator.click()` scrolls
 * the target into view first, which is exactly what hid this bug from the
 * earlier suite — the click passed while a real user could never perform it.
 * So every test here first asserts, via `document.elementFromPoint` at the
 * button's own centre and with only ORDINARY page scrolling, that the button
 * genuinely owns that pixel. Only then does it click. `force` is never used.
 */
import assert from "node:assert/strict";

const DUAL = "crimson-2005";
const LAPTOP = { width: 1440, height: 900 };
const SMALL_LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const TOGGLE = ".media-toggle--page";
const ZOOM = '.dialog-backdrop[role="dialog"]';

/** The hero image actually displayed in the product-detail gallery. */
async function heroSrc(page) {
  return await page.evaluate(() => {
    const on = document.querySelector(".gallery__track .media-stack .media-stack__img.is-on");
    return on ? new URL(on.getAttribute("src"), window.location.origin).pathname : null;
  });
}

async function pressedView(page) {
  return await page.evaluate((sel) => document.querySelector(`${sel} button[aria-pressed="true"]`)?.getAttribute("data-view") ?? null, TOGGLE);
}

/**
 * Scrolls the way a PERSON does — the window, not the element — until the
 * toggle owns the pixel at its own centre. Returns the hit-test result rather
 * than throwing, so callers can assert on it.
 *
 * Deliberately never calls scrollIntoView on the button: that is the
 * masking behaviour this whole spec exists to avoid.
 */
async function scrollUntilHitTestable(page, view) {
  return await page.evaluate(
    async ({ sel, v }) => {
      const btn = document.querySelector(`${sel} button[data-view="${v}"]`);
      if (!btn) return { found: false };
      const probe = () => {
        const r = btn.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const inViewport = cy >= 0 && cy <= window.innerHeight && cx >= 0 && cx <= window.innerWidth;
        const hit = inViewport ? document.elementFromPoint(cx, cy) : null;
        return {
          found: true,
          inViewport,
          size: { w: Math.round(r.width), h: Math.round(r.height) },
          owns: Boolean(hit && (hit === btn || btn.contains(hit))),
          blocker: hit && !(hit === btn || btn.contains(hit)) ? `${hit.tagName.toLowerCase()}.${(hit.className || "").toString().slice(0, 50)}` : null,
        };
      };
      const max = document.documentElement.scrollHeight - window.innerHeight;
      for (let y = 0; y <= max; y += 40) {
        // `behavior: "instant"` is required: the site sets
        // `scroll-behavior: smooth`, so a plain scrollTo animates and every
        // measurement below would race the animation.
        window.scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => window.requestAnimationFrame(r));
        const p = probe();
        if (p.owns) return { ...p, scrollY: y };
      }
      return { ...probe(), scrollY: null };
    },
    { sel: TOGGLE, v: view },
  );
}

/* ── the reachability guard itself ──────────────────────────────────────── */

export async function the_media_toggle_is_reachable_by_a_pointer_on_laptop_viewports({ newPage, BASE }) {
  for (const vp of [LAPTOP, SMALL_LAPTOP, { width: 1366, height: 768 }]) {
    const { page, context } = await newPage(vp);
    try {
      for (const locale of ["en", "ar", "he"]) {
        await page.goto(`${BASE}/${locale}/product/${DUAL}`, { waitUntil: "networkidle" });
        await page.waitForSelector(TOGGLE, { timeout: 6000 });
        for (const view of ["styled", "real"]) {
          const probe = await scrollUntilHitTestable(page, view);
          assert.ok(probe.found, `${vp.width}x${vp.height} ${locale}: ${view} button exists`);
          assert.ok(probe.size.w > 0 && probe.size.h > 0, `${locale}: ${view} has size`);
          assert.ok(
            probe.owns,
            `${vp.width}x${vp.height} ${locale}: "${view}" is never reachable by a pointer at any scroll position` +
              (probe.blocker ? ` — blocked by ${probe.blocker}` : " — it stays outside the viewport (sticky taller than the scrollport)"),
          );
        }
      }
    } finally {
      await context.close();
    }
  }
}

export async function the_sticky_gallery_always_fits_the_viewport({ newPage, BASE }) {
  // The root cause, stated directly: a sticky element taller than the space
  // it can occupy can never show its own bottom edge — and the media controls
  // live on the bottom edge of the STAGE, which is what this measures. The
  // thumbnail strip below the stage is allowed to sit past the fold; it is
  // ordinary page content and scrolling reaches it.
  for (const vp of [LAPTOP, SMALL_LAPTOP, { width: 1440, height: 600 }]) {
    const { page, context } = await newPage(vp);
    try {
      await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
      // Measured as HEIGHT + sticky offset rather than a live bottom edge, so
      // the guarantee holds at every scroll position instead of only the one
      // the test happened to stop at.
      const m = await page.evaluate(() => {
        const g = document.querySelector(".gallery");
        const stage = document.querySelector(".gallery__stage");
        const cs = window.getComputedStyle(g);
        return {
          position: cs.position,
          stickyTop: parseFloat(cs.insetBlockStart) || 0,
          stageHeight: stage.getBoundingClientRect().height,
          vh: window.innerHeight,
        };
      });
      if (m.position !== "sticky") continue; // static below 900px — nothing to bound
      const pinnedBottom = Math.round(m.stickyTop + m.stageHeight);
      assert.ok(
        pinnedBottom <= m.vh + 1,
        `${vp.width}x${vp.height}: once pinned the media stage would end at ${pinnedBottom} in a ${m.vh}px viewport — its bottom edge, and the controls on it, could never be scrolled into view`,
      );
    } finally {
      await context.close();
    }
  }
}

/* ── the full interaction, desktop ──────────────────────────────────────── */

export async function a_real_pointer_click_switches_the_hero_and_does_not_open_zoom({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(LAPTOP);
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(TOGGLE, { timeout: 6000 });

    const styled = await heroSrc(page);
    assert.ok(styled && !styled.includes("-real"), `hero starts on the styled render — got ${styled}`);

    // Reachable by a pointer BEFORE we click — no force, no element scroll.
    const probe = await scrollUntilHitTestable(page, "real");
    assert.ok(probe.owns, `"Real Product" owns its own centre pixel${probe.blocker ? ` (blocked by ${probe.blocker})` : ""}`);

    await page.locator(`${TOGGLE} button[data-view="real"]`).click(); // no force
    await page.waitForFunction(
      () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    const real = await heroSrc(page);
    assert.ok(real.includes("-real"), `the large hero became the photograph — got ${real}`);
    assert.notEqual(real, styled, "the displayed hero genuinely changed");
    assert.equal(await pressedView(page), "real");
    assert.equal(await page.locator(ZOOM).count(), 0, "clicking the control must NOT open the zoom dialog");

    // Back to styled, again with a real click.
    const back = await scrollUntilHitTestable(page, "styled");
    assert.ok(back.owns, "\"Styled Preview\" is reachable too");
    await page.locator(`${TOGGLE} button[data-view="styled"]`).click();
    await page.waitForFunction(
      () => !document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.equal(await heroSrc(page), styled, "the hero returns to the styled render");
    assert.equal(await pressedView(page), "styled");
    assert.equal(await page.locator(ZOOM).count(), 0, "still no zoom dialog");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function clicking_the_image_away_from_the_controls_still_opens_zoom({ newPage, BASE }) {
  const { page, context } = await newPage(LAPTOP);
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(TOGGLE, { timeout: 6000 });
    await scrollUntilHitTestable(page, "real");

    // Aim well above the controls — the upper third of the slide.
    const point = await page.evaluate(() => {
      const slide = document.querySelector(".gallery__slide");
      const r = slide.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.25) };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForSelector(ZOOM, { timeout: 6000 });
    assert.equal(await page.locator(ZOOM).count(), 1, "the rest of the image still opens zoom");

    // The Close button must itself be clickable — it sits top-right, exactly
    // where the site header is, and was painted under it.
    const closeOwns = await page.evaluate(() => {
      const c = document.querySelector(".gallery__zoom-close");
      const r = c.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { owns: Boolean(hit && (hit === c || c.contains(hit))), blocker: hit ? `${hit.tagName.toLowerCase()}.${(hit.className || "").toString().slice(0, 40)}` : null };
    });
    assert.ok(closeOwns.owns, `the zoom Close button is clickable (blocked by ${closeOwns.blocker})`);
    await page.locator(".gallery__zoom-close").click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator(ZOOM).count(), 0, "zoom closes");
  } finally {
    await context.close();
  }
}

export async function the_toggle_is_operable_by_keyboard({ newPage, BASE }) {
  const { page, context } = await newPage(LAPTOP);
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(TOGGLE, { timeout: 6000 });
    const styled = await heroSrc(page);

    await page.locator(`${TOGGLE} button[data-view="real"]`).focus();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-view"));
    assert.equal(focused, "real", "the control takes keyboard focus");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.notEqual(await heroSrc(page), styled, "Enter switches the hero");
    assert.equal(await page.locator(ZOOM).count(), 0, "keyboard activation does not open zoom either");
  } finally {
    await context.close();
  }
}

/* ── mobile ─────────────────────────────────────────────────────────────── */

export async function the_toggle_is_reachable_and_works_on_a_phone({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(TOGGLE, { timeout: 6000 });

    const probe = await scrollUntilHitTestable(page, "real");
    assert.ok(probe.owns, `phone: "Real Product" owns its own centre pixel${probe.blocker ? ` (blocked by ${probe.blocker})` : ""}`);

    const styled = await heroSrc(page);
    await page.locator(`${TOGGLE} button[data-view="real"]`).tap(); // real touch, no force
    await page.waitForFunction(
      () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.ok((await heroSrc(page)).includes("-real"), "the hero switched on touch");
    assert.equal(await page.locator(ZOOM).count(), 0, "tapping the control does not open zoom");

    await page.locator(`${TOGGLE} button[data-view="styled"]`).tap();
    await page.waitForFunction(
      () => !document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.equal(await heroSrc(page), styled, "and back again");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

/* ── the product card must keep working ─────────────────────────────────── */

export async function the_product_card_toggle_is_still_reachable_and_working({ newPage, BASE }) {
  const { page, context } = await newPage(LAPTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    const card = page.locator(".prod-card--dual").first();
    await card.scrollIntoViewIfNeeded();
    const before = await card.locator(".media-stack__img.is-on").getAttribute("src");
    const btn = card.locator('.media-toggle--card button[data-view="real"]');
    const owns = await page.evaluate(() => {
      const b = document.querySelector('.prod-card--dual .media-toggle--card button[data-view="real"]');
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && (hit === b || b.contains(hit)));
    });
    assert.ok(owns, "the card's control owns its own pixel");
    await btn.click();
    await page.waitForTimeout(900);
    const after = await card.locator(".media-stack__img.is-on").getAttribute("src");
    assert.ok(after.includes("-real"), `card switching still works — ${before} → ${after}`);
    assert.equal(await page.locator(ZOOM).count(), 0, "and does not navigate or zoom");
  } finally {
    await context.close();
  }
}
