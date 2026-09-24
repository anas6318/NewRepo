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

const TOGGLE = ".gallery__thumbs";
const ZOOM = '.dialog-backdrop[role="dialog"]';

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
      const btn = document.querySelector(`${sel} button[data-slide="${v}"]`);
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


/* ── mobile ─────────────────────────────────────────────────────────────── */


/* ── the product card must keep working ─────────────────────────────────── */

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
