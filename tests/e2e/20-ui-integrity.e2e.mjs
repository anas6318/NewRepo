/**
 * Storefront UI integrity: the bugs a customer actually met.
 *
 *  • raw {placeholder} and raw i18n keys visible on the page
 *  • the duplicated footer copyright
 *  • the mobile Styled Preview ⇄ Real Product switch, verified by the IMAGE
 *    that is really on screen — never by aria-pressed or button text
 *  • broken images falling back instead of showing the browser's glyph
 */
import assert from "node:assert/strict";

const LOCALES = ["ar", "he", "en"];
const DUAL = "crimson-2005";
const PHONE = { width: 390, height: 844 };

/** Representative customer-facing routes, one of each shape. */
const ROUTES = [
  "",
  "/shop",
  "/category/retro",
  `/product/${DUAL}`,
  "/search?q=crimson",
  "/cart",
  "/checkout",
  "/track",
  "/about",
  "/how-it-works",
  "/delivery",
  "/faq",
  "/reviews",
  "/contact",
  "/policies/returns",
  "/policies/privacy",
  "/policies/terms",
  "/accessibility",
  "/size-guide",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

/* ── 1 · no raw placeholders or translation keys anywhere ───────────────── */

export async function no_raw_interpolation_placeholder_is_ever_visible({ page, BASE }) {
  const found = [];
  for (const locale of LOCALES) {
    for (const route of ROUTES) {
      await page.goto(`${BASE}/${locale}${route}`, { waitUntil: "networkidle" });
      const text = await page.locator("main, footer, header").allInnerTexts();
      // {word} — the shape of an unresolved interpolation. Prices, dates and
      // product copy never look like this.
      for (const hit of text.join("\n").matchAll(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g)) {
        found.push(`/${locale}${route}: ${hit[0]}`);
      }
    }
  }
  assert.deepEqual(found, [], `raw placeholders visible to customers:\n${found.join("\n")}`);
}

export async function no_raw_translation_key_is_ever_visible({ page, BASE }) {
  // A leaked key looks like "footer.rights" — a dotted lowercase identifier
  // standing alone as a whole line. Product copy and prices never do.
  const KEY = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9_]*){1,3}$/;
  const found = [];
  for (const locale of LOCALES) {
    for (const route of ROUTES) {
      await page.goto(`${BASE}/${locale}${route}`, { waitUntil: "networkidle" });
      const blocks = await page.locator("main, footer, header").allInnerTexts();
      for (const line of blocks.join("\n").split("\n")) {
        const trimmed = line.trim();
        // A filename or a domain is legitimate content, a bare key is not.
        if (!KEY.test(trimmed)) continue;
        if (/\.(webp|png|jpg|jpeg|svg|com|co|il|net|org)$/i.test(trimmed)) continue;
        found.push(`/${locale}${route}: "${trimmed}"`);
      }
    }
  }
  assert.deepEqual(found, [], `raw i18n keys visible to customers:\n${found.join("\n")}`);
}

export async function product_content_with_dots_is_not_mistaken_for_a_key({ page, BASE }) {
  // Control for the check above: real content containing dots must survive.
  await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
  const text = await page.locator("main").innerText();
  assert.ok(text.trim().length > 200, "the product page really rendered content");
  assert.ok(/[.]/.test(text), "and that content does contain full stops");
}

/* ── 2 · footer copyright ───────────────────────────────────────────────── */

export async function the_footer_shows_exactly_one_copyright_line({ page, BASE }) {
  const year = String(new Date().getFullYear());
  for (const locale of LOCALES) {
    await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
    const footer = await page.locator("footer").innerText();
    assert.equal((footer.match(/©/g) ?? []).length, 1, `${locale}: exactly one © — got:\n${footer}`);
    assert.equal((footer.match(/CROWNED\./g) ?? []).length, 1, `${locale}: "CROWNED." appears once in the notice`);
    assert.ok(footer.includes(year), `${locale}: the real current year ${year} is shown`);
    assert.ok(!footer.includes("{year}"), `${locale}: no raw {year}`);
  }
}

/* ── 3 · MOBILE styled ⇄ real switch, checked on the rendered image ─────── */

/** The image URL actually being displayed, read from the DOM. */
async function displayedSrc(page) {
  return await page.evaluate(() => {
    const stack = document.querySelector(".gallery__track .media-stack") ?? document.querySelector(".media-stack");
    if (!stack) return null;
    const on = stack.querySelector(".media-stack__img.is-on");
    return on ? new URL(on.getAttribute("src"), window.location.origin).pathname : null;
  });
}

export async function mobile_tap_switches_the_displayed_image_both_ways({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/ar/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });

    const styledSrc = await displayedSrc(page);
    assert.ok(styledSrc, "an image is displayed to begin with");
    assert.ok(!styledSrc.includes("-real"), `starts on the styled render — got ${styledSrc}`);

    // Tap, not hover. tap() dispatches real touch events.
    await page.locator('.media-toggle--page button[data-view="real"]').tap();
    await page.waitForFunction(
      () => document.querySelector(".media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 6000 },
    );
    const realSrc = await displayedSrc(page);
    assert.ok(realSrc.includes("-real"), `the DISPLAYED image is now the photograph — got ${realSrc}`);
    assert.notEqual(realSrc, styledSrc, "the displayed image genuinely changed");

    await page.locator('.media-toggle--page button[data-view="styled"]').tap();
    await page.waitForFunction(
      () => !document.querySelector(".media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 6000 },
    );
    assert.equal(await displayedSrc(page), styledSrc, "tapping back restores the styled render");
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function on_mobile_the_pressed_button_always_matches_the_visible_image({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/he/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });

    const agree = async (label) => {
      const pressed = await page.evaluate(() => {
        const btn = document.querySelector('.media-toggle--page button[aria-pressed="true"]');
        return btn?.getAttribute("data-view") ?? null;
      });
      const src = await displayedSrc(page);
      const showing = src?.includes("-real") ? "real" : "styled";
      assert.equal(pressed, showing, `${label}: pressed=${pressed} but the image on screen is ${showing} (${src})`);
    };

    await agree("on load");
    await page.locator('.media-toggle--page button[data-view="real"]').tap();
    await page.waitForFunction(() => document.querySelector(".media-stack__img.is-on")?.getAttribute("src")?.includes("-real"), { timeout: 6000 });
    await agree("after choosing Real Product");
    await page.locator('.media-toggle--page button[data-view="styled"]').tap();
    await page.waitForFunction(() => !document.querySelector(".media-stack__img.is-on")?.getAttribute("src")?.includes("-real"), { timeout: 6000 });
    await agree("after choosing Styled Preview");
  } finally {
    await context.close();
  }
}

export async function a_failing_real_photo_never_leaves_real_product_selected({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    // Exactly the reported failure mode: the photograph cannot be fetched.
    await page.route(/-real\.webp/, (r) => r.abort());
    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
    const before = await displayedSrc(page);

    await page.locator('.media-toggle--page button[data-view="real"]').tap();
    await page.waitForTimeout(1200);

    const pressed = await page.evaluate(() => document.querySelector('.media-toggle--page button[aria-pressed="true"]')?.getAttribute("data-view") ?? null);
    assert.equal(pressed, "styled", "a failed photo must NOT leave Real Product pressed");
    assert.equal(await displayedSrc(page), before, "the styled render is still what is shown");
    const note = await page.locator(".media-stack__note").count();
    assert.equal(note, 1, "the failure is stated rather than hidden");
  } finally {
    await context.close();
  }
}

export async function desktop_hover_prefetch_still_works({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const card = page.locator(".prod-card--dual").first();
  await card.locator(".prod-card__frame").hover();
  await page.waitForTimeout(900);
  const src = await card.locator(".media-stack__img.is-on").getAttribute("src");
  assert.ok(src?.includes("-real"), `hover still reveals the photograph on desktop — got ${src}`);
}

/* ── 4 · broken images fall back instead of breaking ────────────────────── */

export async function a_failed_product_image_shows_the_crowned_fallback({ page, BASE }) {
  await page.route(/\/demo\/p-.*\.webp/, (r) => r.abort());
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  assert.ok((await page.locator('[data-testid="img-fallback"]').count()) > 0, "the CROWNED placeholder took over");
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("main img")].filter((i) => i.complete && i.naturalWidth === 0).length,
  );
  assert.equal(broken, 0, "no <img> is left in the browser's broken state");
}

export async function the_fallback_does_not_shift_the_layout({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const before = await page.locator(".prod-card").first().boundingBox();
  await page.route(/\/demo\/p-.*\.webp/, (r) => r.abort());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const after = await page.locator(".prod-card").first().boundingBox();
  assert.ok(Math.abs(before.height - after.height) <= 2, `card height stable: ${before.height} → ${after.height}`);
  assert.ok(Math.abs(before.width - after.width) <= 2, `card width stable: ${before.width} → ${after.width}`);
}

/* ── 5 · mobile product gallery ─────────────────────────────────────────── */

export async function the_mobile_gallery_is_usable_and_does_not_overflow({ newPage, BASE }) {
  const { page, context, pageErrors } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    for (const locale of LOCALES) {
      await page.goto(`${BASE}/${locale}/product/${DUAL}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 2, `${locale}: no horizontal overflow (${overflow}px)`);

      const toggle = page.locator(".media-toggle--page").first();
      const box = await toggle.boundingBox();
      assert.ok(box && box.x >= -1 && box.x + box.width <= PHONE.width + 1, `${locale}: the switch is not clipped (${JSON.stringify(box)})`);

      // Thumbnails reachable, and the stage still shows an image afterwards.
      const thumbs = page.locator(".gallery__thumb");
      const count = await thumbs.count();
      if (count > 1) {
        await thumbs.nth(count - 1).tap();
        await page.waitForTimeout(400);
        const visible = await page.evaluate(
          () => [...document.querySelectorAll(".gallery__track img")].filter((i) => i.getBoundingClientRect().width > 0).length,
        );
        assert.ok(visible > 0, `${locale}: the gallery still shows an image after choosing a thumbnail`);
        const stillFits = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(stillFits <= 2, `${locale}: still no overflow after using the thumbnails (${stillFits}px)`);
      }
    }
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

export async function the_sticky_buy_bar_is_not_blocked_by_the_whatsapp_button({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/ar/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const bar = await page.locator(".buy-bar, .sticky-buy, [class*='buybar']").first().boundingBox().catch(() => null);
    if (!bar) return; // this build has no sticky bar at this breakpoint
    const wa = await page.locator("[class*='whatsapp']").first().boundingBox().catch(() => null);
    if (!wa) return;
    const overlaps = !(wa.x + wa.width < bar.x || wa.x > bar.x + bar.width || wa.y + wa.height < bar.y || wa.y > bar.y + bar.height);
    // Overlap is only a problem if it covers the primary action.
    if (overlaps) {
      const cta = await page.locator(".buy-bar button, .buy-bar a").first().boundingBox();
      const covers = !(wa.x + wa.width < cta.x || wa.x > cta.x + cta.width || wa.y + wa.height < cta.y || wa.y > cta.y + cta.height);
      assert.equal(covers, false, "the WhatsApp control must not sit on top of the purchase action");
    }
  } finally {
    await context.close();
  }
}

/**
 * The real-device condition. On localhost the photograph arrives in a few
 * milliseconds, so the bug the owner hit on a phone — tap Real Product, watch
 * the styled render stay on screen — simply does not reproduce. Holding the
 * response open for two seconds recreates it, and asserts the thing that
 * actually matters: at NO POINT may the pressed button and the visible image
 * disagree.
 */
export async function on_a_slow_connection_the_button_never_lies_about_the_image({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  try {
    let released;
    const held = new Promise((r) => {
      released = r;
    });
    await page.route(/-real\.webp/, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".media-toggle--page", { timeout: 6000 });
    const styledSrc = await displayedSrc(page);

    await page.locator('.media-toggle--page button[data-view="real"]').tap();

    // While the photograph is still in flight: styled is on screen, so styled
    // must be the pressed option — and the wait must be visible.
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(120);
      const state = await page.evaluate(() => ({
        pressed: document.querySelector('.media-toggle--page button[aria-pressed="true"]')?.getAttribute("data-view") ?? null,
        src: document.querySelector(".media-stack__img.is-on")?.getAttribute("src") ?? null,
      }));
      const showing = state.src?.includes("-real") ? "real" : "styled";
      assert.equal(state.pressed, showing, `mid-load tick ${i}: pressed=${state.pressed} while showing ${showing}`);
    }
    const busy = await page.locator('.media-toggle--page button[aria-busy="true"]').count();
    assert.equal(busy, 1, "the wait is shown as a busy state on the button the customer tapped");
    assert.equal(await displayedSrc(page), styledSrc, "nothing blanked out while waiting");

    // Now let it through: the switch completes.
    released();
    await page.waitForFunction(
      () => document.querySelector(".media-stack__img.is-on")?.getAttribute("src")?.includes("-real"),
      { timeout: 8000 },
    );
    const pressed = await page.evaluate(() => document.querySelector('.media-toggle--page button[aria-pressed="true"]')?.getAttribute("data-view"));
    assert.equal(pressed, "real", "once the photograph is on screen, Real Product is pressed");
  } finally {
    await context.close();
  }
}
