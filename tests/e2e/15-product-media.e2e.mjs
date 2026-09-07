/**
 * Styled Preview ⇄ Real Product, end to end.
 *
 * Covers the promise the feature makes to the customer: the presentation
 * image is always named as one, the real photograph is always one action
 * away, neither is ever mislabelled, switching moves nothing on the page,
 * and none of it touches what anything costs.
 */
import assert from "node:assert/strict";

const STYLED_EN = "Styled Preview";
const REAL_EN = "Real Product";
const STYLED_AR = "صورة تقديمية";
const REAL_AR = "صورة المنتج الحقيقية";
const STYLED_HE = "הדמיה מעוצבת";
const REAL_HE = "המוצר האמיתי";

/** Both images live on the same product; these are the demo fixtures. */
const DUAL = "crimson-2005";
const STYLED_ONLY = "ivory-away";
const REAL_ONLY = "scarlet-national";
const UNTAGGED = "cream-hoodie";

const card = (page, slug) => page.locator(`.prod-card:has(a[href$="/product/${slug}"])`).first();
const shownSrc = (scope) =>
  scope.evaluate((el) => {
    const on = el.querySelector(".media-stack__img.is-on") ?? el.querySelector("img");
    return on ? on.getAttribute("src") : null;
  });

/* ── 1 · both images are exposed, each under its own name ───────────────── */

export async function bothImagesExposed({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
  const toggle = page.locator(".gallery .media-toggle");
  await assert.doesNotReject(toggle.waitFor({ state: "visible", timeout: 5000 }));
  await assert.equal(await toggle.getByRole("button", { name: STYLED_EN }).count(), 1);
  await assert.equal(await toggle.getByRole("button", { name: REAL_EN }).count(), 1);

  const srcs = await page.locator(".gallery .media-stack__img, .gallery__slide:first-child img").evaluateAll((els) =>
    els.map((e) => e.getAttribute("src")),
  );
  assert.ok(srcs.some((s) => s?.includes(`p-${DUAL}.webp`)), `styled image missing: ${srcs}`);
}

/* ── 2 · styled is the default view ─────────────────────────────────────── */

export async function styledIsDefault({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  const styledBtn = c.getByRole("button", { name: STYLED_EN });
  assert.equal(await styledBtn.getAttribute("aria-pressed"), "true");
  assert.equal(await c.getByRole("button", { name: REAL_EN }).getAttribute("aria-pressed"), "false");
  assert.match(await shownSrc(c), new RegExp(`p-${DUAL}\\.webp`));
}

/* ── 3 · desktop hover swaps to the real product ────────────────────────── */

export async function hoverShowsRealProduct({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  await c.locator(".prod-card__frame").hover();
  await page.waitForFunction(
    (slug) => {
      const el = document.querySelector(`.prod-card:has(a[href$="/product/${slug}"]) .media-stack__img.is-on`);
      return el && el.getAttribute("src").includes("-real.webp");
    },
    DUAL,
    { timeout: 5000 },
  );
  assert.equal(await c.getByRole("button", { name: REAL_EN }).getAttribute("aria-pressed"), "true");
}

/* ── 4 · pointer leave restores the styled preview ──────────────────────── */

export async function pointerLeaveRestoresStyled({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  await c.locator(".prod-card__frame").hover();
  await page.waitForFunction(
    (slug) => document.querySelector(`.prod-card:has(a[href$="/product/${slug}"]) .media-stack__img.is-on`)?.getAttribute("src").includes("-real.webp"),
    DUAL,
    { timeout: 5000 },
  );
  await page.mouse.move(2, 2);
  await page.waitForFunction(
    (slug) => {
      const el = document.querySelector(`.prod-card:has(a[href$="/product/${slug}"]) .media-stack__img.is-on`);
      return el && !el.getAttribute("src").includes("-real.webp");
    },
    DUAL,
    { timeout: 5000 },
  );
}

/* ── 5 + 6 · the switch works both ways without hover ───────────────────── */

export async function toggleSwitchesBothWaysOnTouch({ newPage, BASE }) {
  const { page, context } = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  try {
    await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
    // The device really has no hover: the switch, not hover, is the way in.
    assert.equal(await page.evaluate(() => window.matchMedia("(hover: none)").matches), true);

    const c = card(page, DUAL);
    await c.scrollIntoViewIfNeeded();
    await c.getByRole("button", { name: REAL_EN }).tap();
    await page.waitForFunction(
      (slug) => document.querySelector(`.prod-card:has(a[href$="/product/${slug}"]) .media-stack__img.is-on`)?.getAttribute("src").includes("-real.webp"),
      DUAL,
      { timeout: 5000 },
    );

    // It stays put — nothing switches back on a timer.
    await page.waitForTimeout(1500);
    assert.match(await shownSrc(c), /-real\.webp/);

    await c.getByRole("button", { name: STYLED_EN }).tap();
    await page.waitForFunction(
      (slug) => !document.querySelector(`.prod-card:has(a[href$="/product/${slug}"]) .media-stack__img.is-on`)?.getAttribute("src").includes("-real.webp"),
      DUAL,
      { timeout: 5000 },
    );
  } finally {
    await context.close();
  }
}

/* ── 7 · using the switch never opens the product ───────────────────────── */

export async function toggleDoesNotNavigate({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const before = page.url();
  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  await c.getByRole("button", { name: REAL_EN }).click();
  await page.waitForTimeout(400);
  assert.equal(page.url(), before);
  await c.getByRole("button", { name: STYLED_EN }).click();
  await page.waitForTimeout(400);
  assert.equal(page.url(), before);
  // …while the image itself still opens the product.
  await c.locator(".prod-card__cover").click();
  await page.waitForURL(`**/product/${DUAL}`, { timeout: 5000 });
}

/* ── 8 · styled-only: labelled, but no dead Real switch ─────────────────── */

export async function styledOnlyHasNoDeadToggle({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${STYLED_ONLY}`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".gallery .media-toggle").count(), 0);
  const label = page.locator(".gallery .media-label");
  assert.equal(await label.count(), 1);
  assert.match((await label.innerText()).trim(), new RegExp(STYLED_EN));
  // Scoped to the gallery: related-product cards further down the page are
  // dual and legitimately carry their own switch.
  assert.equal(await page.locator(".gallery").getByRole("button", { name: REAL_EN }).count(), 0);
}

/* ── 9 · real-only products display correctly ───────────────────────────── */

export async function realOnlyDisplaysCorrectly({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${REAL_ONLY}`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".gallery .media-toggle").count(), 0);
  const label = page.locator(".gallery .media-label");
  assert.match((await label.innerText()).trim(), new RegExp(REAL_EN));
  const src = await page.locator(".gallery__slide").first().locator("img").first().getAttribute("src");
  assert.match(src, /-real\.webp/);
}

/* ── 10 · products saved before this feature are untouched ──────────────── */

export async function untaggedLegacyProductStillWorks({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${UNTAGGED}`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".gallery .media-toggle").count(), 0);
  // No claim was made about these images, so none is printed on them.
  assert.equal(await page.locator(".gallery .media-label").count(), 0);
  const img = page.locator(".gallery__slide").first().locator("img").first();
  assert.ok(await img.isVisible());

  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const c = card(page, UNTAGGED);
  await c.scrollIntoViewIfNeeded();
  assert.equal(await c.locator(".media-toggle").count(), 0);
  assert.equal(await c.locator(".media-label").count(), 0);
  assert.ok(await c.locator("img").first().isVisible());
}

/* ── 11 · switching moves nothing ───────────────────────────────────────── */

export async function switchingCausesNoLayoutShift({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  const frame = c.locator(".prod-card__frame");
  const before = await c.boundingBox();
  const frameBefore = await frame.boundingBox();
  const neighbourBefore = await card(page, "royal-1998").boundingBox();

  await c.getByRole("button", { name: REAL_EN }).click();
  await page.waitForTimeout(500);

  const after = await c.boundingBox();
  const frameAfter = await frame.boundingBox();
  const neighbourAfter = await card(page, "royal-1998").boundingBox();
  for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(before[key] - after[key]) < 0.5, `card ${key} moved`);
    assert.ok(Math.abs(frameBefore[key] - frameAfter[key]) < 0.5, `frame ${key} moved`);
    assert.ok(Math.abs(neighbourBefore[key] - neighbourAfter[key]) < 0.5, `neighbour ${key} moved`);
  }
}

/* ── 12 + 13 · neither image is ever passed off as the other ────────────── */

export async function eachImageIsLabelledHonestly({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
  const toggle = page.locator(".gallery .media-toggle");
  const styledBtn = toggle.getByRole("button", { name: STYLED_EN });
  const realBtn = toggle.getByRole("button", { name: REAL_EN });

  assert.equal(await styledBtn.getAttribute("aria-pressed"), "true");
  const styledShown = await shownSrc(page.locator(".gallery__slide").first());
  assert.match(styledShown, new RegExp(`p-${DUAL}\\.webp`));

  await realBtn.click();
  await page.waitForFunction(
    () => document.querySelector(".gallery .media-stack__img.is-on")?.getAttribute("src").includes("-real.webp"),
    null,
    { timeout: 5000 },
  );
  assert.equal(await realBtn.getAttribute("aria-pressed"), "true");
  assert.equal(await styledBtn.getAttribute("aria-pressed"), "false");

  // No deceptive claims anywhere on the page.
  const text = await page.locator("body").innerText();
  for (const phrase of ["Official Photo", "Exact Photo", "In Stock Photo"]) {
    assert.ok(!text.includes(phrase), phrase);
  }
  assert.ok(text.includes("may be AI-generated") || (await page.locator(".gallery__media-note").count()) === 1);
}

/* ── 14 · the same system in all three languages ────────────────────────── */

export async function labelsRenderInAllThreeLanguages({ page, BASE }) {
  for (const [locale, styled, real] of [
    ["en", STYLED_EN, REAL_EN],
    ["ar", STYLED_AR, REAL_AR],
    ["he", STYLED_HE, REAL_HE],
  ]) {
    await page.goto(`${BASE}/${locale}/product/${DUAL}`, { waitUntil: "networkidle" });
    const toggle = page.locator(".gallery .media-toggle");
    assert.equal(await toggle.getByRole("button", { name: styled }).count(), 1, `${locale} styled`);
    assert.equal(await toggle.getByRole("button", { name: real }).count(), 1, `${locale} real`);
    const text = await toggle.innerText();
    // Internal enum values never surface.
    assert.ok(!/\b(styled|real)\b/.test(locale === "en" ? "" : text), `${locale} leaked a code`);
    const note = await page.locator(".gallery__media-note").innerText();
    assert.ok(note.trim().length > 0, `${locale} note`);
  }
}

/* ── 15 · RTL stays correct ─────────────────────────────────────────────── */

export async function rtlOrderAndDirection({ page, BASE }) {
  for (const locale of ["ar", "he"]) {
    await page.goto(`${BASE}/${locale}/shop`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
    const c = card(page, DUAL);
    await c.scrollIntoViewIfNeeded();
    const boxes = await c.locator(".media-toggle__opt").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    // First option renders to the RIGHT of the second one in RTL.
    assert.ok(boxes[0] > boxes[1], `${locale} toggle order is not RTL`);
    // …and the control never spills out of the card.
    const overflow = await c.evaluate((el) => {
      const frame = el.querySelector(".prod-card__frame").getBoundingClientRect();
      const t = el.querySelector(".media-toggle").getBoundingClientRect();
      return t.left < frame.left - 1 || t.right > frame.right + 1;
    });
    assert.equal(overflow, false, `${locale} toggle overflows the card`);
  }
}

/* ── 16 · keyboard users reach both images ──────────────────────────────── */

export async function keyboardReachesBothImages({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
  const realBtn = page.locator(".gallery .media-toggle").getByRole("button", { name: REAL_EN });
  await realBtn.focus();
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), REAL_EN);
  // A visible focus ring, not just a focusable node.
  const outline = await realBtn.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  assert.notEqual(outline, "none");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector(".gallery .media-stack__img.is-on")?.getAttribute("src").includes("-real.webp"),
    null,
    { timeout: 5000 },
  );

  const styledBtn = page.locator(".gallery .media-toggle").getByRole("button", { name: STYLED_EN });
  await styledBtn.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => !document.querySelector(".gallery .media-stack__img.is-on")?.getAttribute("src").includes("-real.webp"),
    null,
    { timeout: 5000 },
  );
}

export async function keyboardFocusOnACardShowsTheRealPhotograph({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  await c.locator(".prod-card__wish").focus();
  await page.waitForFunction(
    (slug) => document.querySelector(`.prod-card:has(a[href$="/product/${slug}"]) .media-stack__img.is-on`)?.getAttribute("src").includes("-real.webp"),
    DUAL,
    { timeout: 5000 },
  );
  // The decorative cover link is not a second tab stop for the same product.
  assert.equal(await c.locator(".prod-card__cover").getAttribute("tabindex"), "-1");
  assert.equal(await c.locator(".prod-card__cover").getAttribute("aria-hidden"), "true");
}

/* ── 17 · nothing private rides along with the media ────────────────────── */

export async function noPrivateSupplierDataInPublicPages({ page, BASE }) {
  for (const path of [`/en/product/${DUAL}`, "/en/shop"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const html = await page.content();
    for (const secret of ["SUP-BDG-", "supplierReference", "supplierNote", "costUsd"]) {
      assert.ok(!html.includes(secret), `${secret} leaked on ${path}`);
    }
  }
}

/* ── 23 · switching images changes no money ─────────────────────────────── */

export async function switchingImagesDoesNotAffectPricing({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
  const total = page.locator(".product-actions").getByText(/₪/).first();
  const before = (await total.innerText()).trim();

  await page.locator(".gallery .media-toggle").getByRole("button", { name: REAL_EN }).click();
  await page.waitForTimeout(400);
  assert.equal((await total.innerText()).trim(), before);

  await page.getByRole("button", { name: /^M$/ }).first().click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /Reserve Your Jersey|Add to Cart/i }).first().click();
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });

  const cartText = await page.locator(".cart-line").first().innerText();
  assert.match(cartText, /₪170/);
  // The cart line always carries the cover image, never whichever view the
  // customer happened to be looking at.
  const lineImg = await page.locator(".cart-line img").first().getAttribute("src");
  assert.ok(!lineImg.includes("-real.webp"), `cart used the switched view: ${lineImg}`);
}

/* ── the photograph is not fetched until it is wanted ───────────────────── */

export async function realPhotographIsNotLoadedUpFront({ page, BASE }) {
  const requested = [];
  page.on("request", (r) => {
    // Real-ONLY products legitimately load their photograph as the cover;
    // this is about the second image of a dual product.
    if (r.url().includes("-real.webp") && !r.url().includes(REAL_ONLY)) requested.push(r.url());
  });
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  assert.equal(requested.length, 0, `photographs fetched before any intent: ${requested.length}`);

  const c = card(page, DUAL);
  await c.scrollIntoViewIfNeeded();
  await c.locator(".prod-card__frame").hover();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(800);
  assert.ok(requested.some((u) => u.includes(DUAL)), "hover did not preload the photograph");
}

/* ── the photograph is never duplicated as an extra slide ───────────────── */

export async function photographIsReferencedNotDuplicated({ page, BASE }) {
  await page.goto(`${BASE}/en/product/${DUAL}`, { waitUntil: "networkidle" });
  await page.locator(".gallery .media-toggle").getByRole("button", { name: REAL_EN }).click();
  await page.waitForFunction(
    () => document.querySelector(".gallery .media-stack__img.is-on")?.getAttribute("src").includes("-real.webp"),
    null,
    { timeout: 5000 },
  );
  const srcs = await page.locator(".gallery__track img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  const realCount = srcs.filter((x) => x?.includes("-real.webp")).length;
  assert.equal(realCount, 1, `real photograph appears ${realCount} times in the track`);
  // The detail shot is still its own slide — the gallery is untouched.
  assert.ok(srcs.some((x) => x?.includes("-b.webp")), "gallery lost its detail slide");
}

/* ── the owner controls both images from Admin ──────────────────────────── */

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 8000 });
}

export async function adminManagesBothImages({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/products/demo-${DUAL}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".media-admin", { timeout: 8000 });

  const styledInput = page.locator("label", { hasText: "Styled Preview Image" }).locator("input").first();
  const realInput = page.locator("label", { hasText: "Real Product Image" }).locator("input").first();
  assert.match(await styledInput.inputValue(), new RegExp(`p-${DUAL}\\.webp`));
  assert.match(await realInput.inputValue(), /-real\.webp/);

  // Both are previewed, and the gallery is listed separately.
  assert.equal(await page.locator(".media-admin__preview img").count(), 2);
  assert.ok((await page.locator(".media-admin__row").count()) >= 1);

  // Clearing the photograph leaves the styled preview and the gallery alone.
  await realInput.fill("");
  await page.waitForTimeout(200);
  assert.match(await styledInput.inputValue(), new RegExp(`p-${DUAL}\\.webp`));
  assert.ok((await page.locator(".media-admin__row").count()) >= 1);
}
