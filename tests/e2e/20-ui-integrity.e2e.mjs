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

      const dots = page.locator(".media-carousel__dots").first();
      if (await dots.count()) {
        const box = await dots.boundingBox();
        assert.ok(box && box.x >= -1 && box.x + box.width <= PHONE.width + 1, `${locale}: the carousel indicators are not clipped (${JSON.stringify(box)})`);
      }

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
