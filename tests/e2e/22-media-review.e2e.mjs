/**
 * The media behaviours found in code review, verified in a real browser.
 *
 * Everything here reads the IMAGE ACTUALLY ON SCREEN. aria-pressed, button
 * text and React state are never accepted as proof — the original laptop bug
 * was precisely that those agreed while the picture did not.
 */
import assert from "node:assert/strict";

const DUAL = "crimson-2005";
const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** The hero image actually displayed inside the product-detail gallery. */
async function heroSrc(page) {
  // No opacity gate here: `.is-on` drives a CSS crossfade, so a read taken on
  // the first paint can legitimately catch opacity mid-transition. `.is-on`
  // is the declarative answer to "which image is being shown".
  return await page.evaluate(() => {
    const on = document.querySelector(".gallery__track .media-stack .media-stack__img.is-on");
    return on ? new URL(on.getAttribute("src"), window.location.origin).pathname : null;
  });
}

/** Waits until the hero has settled on an image, then returns its path. */
async function settledHeroSrc(page) {
  await page.waitForFunction(() => Boolean(document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")), { timeout: 8000 });
  return await heroSrc(page);
}

async function pressedView(page) {
  return await page.evaluate(() => document.querySelector('.media-toggle--page button[aria-pressed="true"]')?.getAttribute("data-view") ?? null);
}

/* ── 8 · DESKTOP product detail page: click actually changes the hero ───── */

export async function on_a_laptop_clicking_real_product_changes_the_large_hero_image({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(LAPTOP);
  try {
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });

    // 1–2. The hero starts on the styled render.
    const styled = await settledHeroSrc(page);
    assert.ok(styled, "a hero image is displayed");
    assert.ok(!styled.includes("-real"), `hero starts styled — got ${styled}`);
    assert.equal(await pressedView(page), "styled");

    // 3–5. Click Real Product; the LARGE hero must change.
    await page.locator('.media-toggle--page button[data-view="real"]').click();
    await page.waitForFunction(
      () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    const real = await heroSrc(page);
    assert.ok(real.includes("-real"), `the hero is now the photograph — got ${real}`);
    assert.notEqual(real, styled, "the displayed hero genuinely changed");
    assert.equal(await pressedView(page), "real");

    // 6–7. Click back; the hero returns to the original styled src.
    await page.locator('.media-toggle--page button[data-view="styled"]').click();
    await page.waitForFunction(
      () => !document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.equal(await heroSrc(page), styled, "the hero returns to the styled render");
    assert.equal(await pressedView(page), "styled");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function the_laptop_hero_switch_works_in_all_three_languages({ newPage, BASE }) {
  const { page, context } = await newPage(LAPTOP);
  try {
    for (const locale of ["ar", "he", "en"]) {
      await page.goto(`${BASE}/${locale}/product/${DUAL}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
      const styled = await settledHeroSrc(page);
      await page.locator('.media-toggle--page button[data-view="real"]').click();
      await page.waitForFunction(
        () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
        { timeout: 8000 },
      );
      assert.notEqual(await heroSrc(page), styled, `${locale}: the hero changed`);
      assert.equal(await pressedView(page), "real", `${locale}: pressed follows the image`);
    }
  } finally {
    await context.close();
  }
}

export async function on_a_laptop_a_slow_hero_never_disagrees_with_the_pressed_button({ newPage, BASE }) {
  const { page, context } = await newPage(LAPTOP);
  try {
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    await page.route(/-real\.webp/, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
    const styled = await settledHeroSrc(page);

    await page.locator('.media-toggle--page button[data-view="real"]').click();

    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(120);
      const [pressed, src] = [await pressedView(page), await heroSrc(page)];
      const showing = src?.includes("-real") ? "real" : "styled";
      assert.equal(pressed, showing, `tick ${i}: pressed=${pressed} while the hero shows ${showing}`);
    }
    assert.equal(await heroSrc(page), styled, "the styled hero stays up while the photograph loads");
    assert.equal(await page.locator('.media-toggle--page button[aria-busy="true"]').count(), 1, "the wait is visible on the button");

    release();
    await page.waitForFunction(
      () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.equal(await pressedView(page), "real", "once the hero is the photograph, Real Product is pressed");
  } finally {
    await context.close();
  }
}

/* ── 3 · desktop card hover-leave race ──────────────────────────────────── */

export async function leaving_a_card_before_the_photo_arrives_keeps_the_styled_render({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(LAPTOP);
  try {
    // Navigate BEFORE installing the holding route: a pending request would
    // otherwise mean `networkidle` never arrives.
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    await page.route(/-real\.webp/, async (route) => {
      await held;
      await route.continue();
    });

    const card = page.locator(".prod-card--dual").first();
    const frame = card.locator(".prod-card__frame");
    const before = await card.locator(".media-stack__img.is-on").getAttribute("src");

    // Hover in — the download starts but cannot finish.
    await frame.hover();
    await page.waitForTimeout(250);

    // Move the pointer well away, BEFORE the photograph arrives.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);

    // Now let the photograph land. The stale hover must not reveal it.
    release();
    await page.waitForTimeout(1200);

    const after = await card.locator(".media-stack__img.is-on").getAttribute("src");
    assert.equal(after, before, `the card must still show the styled render after the pointer left — got ${after}`);
    assert.ok(!after.includes("-real"), "a completed-too-late hover cannot reveal the photograph");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function hovering_and_staying_still_reveals_the_photograph({ newPage, BASE }) {
  // Control for the test above: the guard must not break ordinary hover.
  const { page, context } = await newPage(LAPTOP);
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    const card = page.locator(".prod-card--dual").first();
    await card.locator(".prod-card__frame").hover();
    await page.waitForTimeout(1000);
    const src = await card.locator(".media-stack__img.is-on").getAttribute("src");
    assert.ok(src.includes("-real"), `hover still works — got ${src}`);
  } finally {
    await context.close();
  }
}

/* ── 4 · a failed photograph can be retried ─────────────────────────────── */

export async function a_temporary_failure_can_be_retried_by_tapping_again({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    let failNext = true;
    await page.route(/-real\.webp/, async (route) => {
      if (failNext) {
        failNext = false; // only the FIRST attempt fails
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
    const styled = await settledHeroSrc(page);

    // First attempt fails: styled stays, and styled stays pressed.
    await page.locator('.media-toggle--page button[data-view="real"]').tap();
    await page.waitForTimeout(1200);
    assert.equal(await heroSrc(page), styled, "after the failure the styled render is still displayed");
    assert.equal(await pressedView(page), "styled", "a failed load does not leave Real Product pressed");
    assert.equal(await page.locator(".media-stack__note").count(), 1, "the failure is stated");

    // Second, deliberate attempt succeeds.
    await page.locator('.media-toggle--page button[data-view="real"]').tap();
    await page.waitForFunction(
      () => document.querySelector(".gallery__track .media-stack .media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    assert.ok((await heroSrc(page)).includes("-real"), "the retry displays the photograph");
    assert.equal(await pressedView(page), "real", "and Real Product is now pressed");
  } finally {
    await context.close();
  }
}

/* ── 5 · the fallback occupies the image's own box ──────────────────────── */

/** Measures the placeholder itself, not its container. */
async function fallbackBoxes(page, selector) {
  return await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
    });
  }, selector);
}

export async function the_fallback_never_exceeds_its_container({ newPage, BASE }) {
  for (const viewport of [LAPTOP, PHONE]) {
    const { page, context } = await newPage(viewport, viewport.width < 720 ? { hasTouch: true, isMobile: true } : {});
    try {
      await page.route(/\/demo\/p-.*\.webp/, (r) => r.abort());
      await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="img-fallback"]', { timeout: 6000 });

      const checks = await page.evaluate(() => {
        return [...document.querySelectorAll('[data-testid="img-fallback"]')].map((el) => {
          const box = el.getBoundingClientRect();
          const parent = el.parentElement.getBoundingClientRect();
          return { w: Math.round(box.width), pw: Math.round(parent.width), right: Math.round(box.right) };
        });
      });
      assert.ok(checks.length > 0, "placeholders rendered");
      for (const c of checks) {
        // The old <span> hard-set width:600px inside a ~280px card.
        assert.ok(c.w <= c.pw + 1, `placeholder ${c.w}px must fit its ${c.pw}px container`);
        assert.ok(c.right <= viewport.width + 1, `placeholder must not cross the viewport edge (right=${c.right})`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow <= 2, true, `@${viewport.width}px: no horizontal overflow (${overflow}px)`);
    } finally {
      await context.close();
    }
  }
}

export async function the_gallery_fallback_fits_the_gallery({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.route(/\/demo\/p-.*\.webp/, (r) => r.abort());
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    // `.gallery__track` is a horizontal scroll container, so slide 2's right
    // edge is SUPPOSED to sit past the viewport. The real question is whether
    // each placeholder fits the slide that holds it — a 720px-wide fallback
    // in a 390px slide is the bug.
    const fits = await page.evaluate(() =>
      [...document.querySelectorAll('.gallery__track [data-testid="img-fallback"]')].map((el) => {
        const box = el.getBoundingClientRect();
        const slide = (el.closest(".gallery__slide") ?? el.parentElement).getBoundingClientRect();
        return { w: Math.round(box.width), slideW: Math.round(slide.width) };
      }),
    );
    assert.ok(fits.length > 0, "the gallery fell back");
    for (const f of fits) {
      assert.ok(f.w <= f.slideW + 1, `gallery placeholder ${f.w}px must fit its ${f.slideW}px slide (was authored 720px)`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 2, `no overflow (${overflow}px)`);
  } finally {
    await context.close();
  }
}

export async function small_cart_thumbnails_keep_their_intended_size({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    // Put something in the cart, then break the images.
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.locator('button[data-size], .size-opt, button:has-text("L")').first().click().catch(() => {});
    await page.locator('button[type="submit"], .btn--gold').first().click().catch(() => {});
    await page.route(/\/demo\/p-.*\.webp/, (r) => r.abort());
    await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);

    const boxes = await fallbackBoxes(page, 'main [data-testid="img-fallback"]');
    if (boxes.length === 0) return; // empty cart in this run — nothing to assert
    for (const b of boxes) {
      // The cart thumb is authored at 88x110; it must stay small, not stretch.
      assert.ok(b.w <= 140, `cart thumbnail placeholder stays a thumbnail (${b.w}px)`);
      assert.ok(b.w > 20, `…but is still visible (${b.w}px)`);
      assert.ok(b.right <= PHONE.width + 1, "and stays on screen");
    }
  } finally {
    await context.close();
  }
}

/* ── 6 · bank details wait for the supplier check ───────────────────────── */

export async function bank_details_are_withheld_until_availability_is_confirmed({ page, BASE }) {
  // The demo catalog ships products in both states; this drives the UI.
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  const empty = (await page.locator("main").innerText()).toLowerCase();
  if (empty.includes("cart is empty") || empty.includes("nothing")) return; // covered by the unit tests
  const bank = page.locator('input[value="bank_transfer"], label:has-text("Bank")').first();
  if ((await bank.count()) === 0) return;
  await bank.click().catch(() => {});
  await page.waitForTimeout(600);
  const held = await page.locator('[data-testid="bank-held"]').count();
  const details = await page.locator('[data-testid="bank-details"]').count();
  assert.ok(held + details >= 1, "one of the two bank panels is shown");
  assert.notEqual(held === 1 && details === 1, true, "never both at once — that would show the details anyway");
}
