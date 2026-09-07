/**
 * Buy-2 cart promotion end to end: pairing, display, order snapshot,
 * server-side recalculation and admin control.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";
const DAY = 24 * 60 * 60 * 1000;
const offset = (ms) => new Date(Date.now() + ms).toISOString();

async function ensureDemoDbPersisted(page, BASE) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  if (await page.evaluate((k) => window.localStorage.getItem(k) !== null, LS_KEY)) return;
  await page.fill("#footer-email", `seed-${Date.now()}@example.com`);
  await page.locator(".site-footer__form button[type=submit]").click();
  await page.waitForFunction((k) => window.localStorage.getItem(k) !== null, LS_KEY, { timeout: 5000 });
}

/** Replaces the stored campaign list, then reloads so the store re-reads it. */
async function setPromotion(page, BASE, patch) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key, p]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      db.promotions = p === null ? [] : [{ ...(db.promotions?.[0] ?? {}), ...p }];
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, patch],
  );
}

/** The default running Buy-2 campaign used by most specs. */
const RUNNING = { enabled: true, startsAt: offset(-DAY), endsAt: offset(7 * DAY) };

/** Turns every product's sale off so merchandise prices are the base prices,
 * keeping the arithmetic in these specs easy to follow. */
async function clearSales(page, BASE) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      for (const p of db.products) p.sale = { enabled: false, type: "none" };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY],
  );
}

async function addToCart(page, BASE, slug, { badge, quantity = 1 } = {}) {
  await page.goto(`${BASE}/en/product/${slug}`, { waitUntil: "networkidle" });
  const versionFs = page.locator(".product-panel fieldset").first();
  const chip = versionFs.locator(".chip").first();
  if ((await page.locator("fieldset", { hasText: "Version" }).count()) > 0) await chip.click();
  await page.locator(".product-panel .chip", { hasText: /^L$/ }).first().click();
  if (badge) await page.getByRole("button", { name: badge }).first().click();
  for (let i = 1; i < quantity; i++) await page.locator(".qty button").nth(1).click();
  const boxes = page.locator(".product-panel .check input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
}

async function cartText(page, BASE, locale = "en") {
  await page.goto(`${BASE}/${locale}/cart`, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  return (await page.locator("main").textContent()) ?? "";
}

/* ── storefront behaviour ───────────────────────────────────────────────── */

export async function one_eligible_item_earns_no_discount({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005");
  const text = await cartText(page, BASE);
  assert.doesNotMatch(text, /Buy 2 promotion/, "no discount row on a single item");
  assert.match(text, /Add one more eligible item/, "but a truthful progress message");
  assert.match(text, /170/, "the full price stands");
}

export async function two_eligible_items_discount_the_cheaper_one({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  // ₪170 retro + ₪140 current-season → 15% of ₪140 = ₪21.
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const text = await cartText(page, BASE);
  assert.match(text, /Buy 2 promotion/, "the discount has its own row");
  assert.match(text, /21/, "15% of the cheaper ₪140");
  assert.match(text, /Second-item discount applied/);
}

export async function four_eligible_items_create_two_discounts({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  for (const slug of ["crimson-2005", "royal-1998", "onyx-home", "azure-national"]) {
    await addToCart(page, BASE, slug);
  }
  // 170,170,140,140 → pairs (170,170) and (140,140) → 15% of 170 + 15% of 140.
  const text = await cartText(page, BASE);
  assert.match(text, /Buy 2 promotion/, "a discount row is present");
  assert.match(text, /46\.5/, "₪25.50 + ₪21 = ₪46.50 across two discounted items");
}

export async function quantity_two_of_one_product_qualifies({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005", { quantity: 2 });
  const text = await cartText(page, BASE);
  assert.match(text, /Buy 2 promotion/, "units count, not lines");
  assert.match(text, /25\.5/, "15% of ₪170");
}

export async function the_badge_charge_is_never_discounted({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  // crimson-2005 ₪170 + Champions League badge ₪12 → merchandise stays ₪170.
  await addToCart(page, BASE, "crimson-2005", { badge: /^Champions League badge/ });
  await addToCart(page, BASE, "onyx-home");
  const text = await cartText(page, BASE);
  // Cheaper merchandise is onyx-home at ₪140 → ₪21, not 15% of ₪182.
  assert.match(text, /21/, "the discount is 15% of merchandise only");
  assert.doesNotMatch(text, /27\.3/, "never 15% of the badge-inclusive ₪182");
}

export async function excluded_products_do_not_count({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, { ...RUNNING, excludedProductIds: ["demo-onyx-home"] });
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const text = await cartText(page, BASE);
  assert.doesNotMatch(text, /Buy 2 promotion/, "only one eligible unit remains");
  assert.match(text, /Add one more eligible item/);
}

export async function a_product_on_sale_is_not_also_promoted_by_default({ page, BASE }) {
  await clearSales(page, BASE);
  // Put onyx-home (the cheaper unit) on its own sale.
  await page.evaluate(
    ([key]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const p = db.products.find((x) => x.slug === "onyx-home");
      p.sale = { enabled: true, type: "percentage", percentOff: 20, autoPercentLabel: true };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY],
  );
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const text = await cartText(page, BASE);
  // The sale item is skipped, so the promotion moves to the ₪170 shirt.
  assert.match(text, /25\.5/, "15% of ₪170 — the un-discounted unit");
  assert.doesNotMatch(text, /16\.8/, "never 15% of the already-reduced ₪112");
}

export async function stacking_can_be_enabled_deliberately({ page, BASE }) {
  await clearSales(page, BASE);
  await page.evaluate(
    ([key]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const p = db.products.find((x) => x.slug === "onyx-home");
      p.sale = { enabled: true, type: "percentage", percentOff: 20, autoPercentLabel: true };
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY],
  );
  await setPromotion(page, BASE, { ...RUNNING, stackWithProductSales: true });
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const text = await cartText(page, BASE);
  assert.match(text, /16\.8/, "15% of the already-reduced ₪112 when stacking is on");
}

export async function a_disabled_or_scheduled_campaign_shows_nothing({ page, BASE }) {
  await clearSales(page, BASE);
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");

  await setPromotion(page, BASE, { enabled: false });
  let text = await cartText(page, BASE);
  assert.doesNotMatch(text, /Buy 2 promotion|Add one more eligible/, "disabled → silent");

  await setPromotion(page, BASE, { enabled: true, startsAt: offset(DAY), endsAt: offset(5 * DAY) });
  text = await cartText(page, BASE);
  assert.doesNotMatch(text, /Buy 2 promotion/, "scheduled → not applied");

  await setPromotion(page, BASE, { enabled: true, startsAt: offset(-5 * DAY), endsAt: offset(-DAY) });
  text = await cartText(page, BASE);
  assert.doesNotMatch(text, /Buy 2 promotion/, "expired → not applied");
}

/* ── localization and layout ────────────────────────────────────────────── */

export async function promotion_labels_render_in_all_three_locales({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const expected = {
    en: /Buy 2 promotion/,
    ar: /عرض القطعتين/,
    he: /מבצע 2 פריטים/,
  };
  for (const [locale, pattern] of Object.entries(expected)) {
    const text = await cartText(page, BASE, locale);
    assert.match(text, pattern, `${locale}: promotion row`);
    if (locale !== "en") assert.doesNotMatch(text, /Buy 2 promotion/, `${locale}: no English label leaks`);
    if (locale !== "ar") assert.doesNotMatch(text, /عرض القطعتين/, `${locale}: no Arabic label leaks`);
    if (locale !== "he") assert.doesNotMatch(text, /מבצע 2 פריטים/, `${locale}: no Hebrew label leaks`);
  }
}

export async function the_product_page_never_claims_the_single_item_is_reduced({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.match(panel, /Buy 2, get 15% off the second item/, "the campaign is named");
  assert.equal(await page.locator(".product-price .price__compare").count(), 0, "no crossed-out price on a single item");
  assert.match((await page.locator("#buy-actions .price").first().textContent()) ?? "", /170/, "full price until the cart qualifies");
}

export async function promotion_rows_are_readable_at_every_width({ BASE, newPage }) {
  for (const width of [320, 390, 834, 1280]) {
    for (const locale of ["en", "ar", "he"]) {
      const { page, context } = await newPage({ width, height: 900 });
      try {
        await clearSales(page, BASE);
        await setPromotion(page, BASE, RUNNING);
        await addToCart(page, BASE, "crimson-2005");
        await addToCart(page, BASE, "onyx-home");
        await page.goto(`${BASE}/${locale}/cart`, { waitUntil: "networkidle" });
        await page.waitForTimeout(200);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `cart ${locale} @${width}px: horizontal overflow of ${overflow}px`);
        assert.equal(await page.locator(".promo-line").count() > 0, true, `${locale} @${width}px: the discount row renders`);

        await page.goto(`${BASE}/${locale}/checkout`, { waitUntil: "networkidle" });
        const coOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(coOverflow <= 1, `checkout ${locale} @${width}px: horizontal overflow of ${coOverflow}px`);
      } finally {
        await context.close();
      }
    }
  }
}

/* ── order creation ─────────────────────────────────────────────────────── */

async function placeOrder(page, BASE, email) {
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Promo Tester");
  await page.fill("#co-email", email);
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });
  return page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
}

const readOrder = (page, orderNumber) =>
  page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n),
    [LS_KEY, orderNumber],
  );

export async function the_order_stores_an_immutable_promotion_snapshot({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const orderNumber = await placeOrder(page, BASE, "promo@example.com");

  const order = await readOrder(page, orderNumber);
  const p = order.promotion;
  assert.ok(p, "the order carries a promotion snapshot");
  assert.equal(p.type, "second_item_percentage");
  assert.equal(p.discountPercent, 15);
  assert.equal(p.minimumQuantity, 2);
  assert.equal(p.repeatPerPair, true);
  assert.equal(p.stackWithProductSales, false);
  assert.equal(p.eligibleUnits, 2);
  assert.equal(p.discountedUnits, 1);
  assert.equal(p.discountIls, 21, "15% of the cheaper ₪140");
  assert.equal(p.originalMerchandiseIls, 310);
  assert.equal(p.finalMerchandiseIls, 289);
  assert.equal(p.labelText, "Buy 2, get 15% off the second item");
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].unitMerchandiseIls, 140, "the discounted unit is identified");
  assert.equal(order.promotionDiscountIls, 21);
  assert.equal(order.totalIls, order.subtotalIls - 21 + order.deliveryIls, "the discount reduces merchandise, not delivery");

  // The confirmation page shows the same figures.
  const confirmation = (await page.locator("main").textContent()) ?? "";
  assert.match(confirmation, /Buy 2, get 15% off the second item/);
  assert.match(confirmation, /21/);

  // The owner now deepens the campaign, then switches it off entirely.
  await setPromotion(page, BASE, { ...RUNNING, discountPercent: 50 });
  let after = await readOrder(page, orderNumber);
  assert.equal(after.promotion.discountIls, 21, "the placed order does not move");
  assert.equal(after.promotion.discountPercent, 15);

  await setPromotion(page, BASE, { enabled: false });
  after = await readOrder(page, orderNumber);
  assert.equal(after.promotion.discountIls, 21, "and it survives the campaign being disabled");
  assert.equal(after.totalIls, order.totalIls);
}

export async function order_creation_ignores_a_forged_browser_discount({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");

  // Forge everything a tampered browser could send about the promotion.
  await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("crowned_cart_v1") ?? "[]");
    for (const line of raw) {
      line.unitPriceIls = 1;
      line.promotionApplied = true;
      line.promotionDiscountIls = 999;
      line.promotionPercent = 90;
    }
    window.localStorage.setItem("crowned_cart_v1", JSON.stringify(raw));
  });

  const orderNumber = await placeOrder(page, BASE, "forge-promo@example.com");
  const order = await readOrder(page, orderNumber);
  assert.equal(order.promotion.discountPercent, 15, "the configured 15%, not the submitted 90%");
  assert.equal(order.promotion.discountIls, 21, "not the submitted ₪999");
  assert.equal(order.subtotalIls, 310, "line prices were recomputed too");
  assert.equal(order.totalIls, 310 - 21 + order.deliveryIls);
}

export async function a_disabled_campaign_produces_no_order_promotion({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, { enabled: false });
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const orderNumber = await placeOrder(page, BASE, "nopromo@example.com");
  const order = await readOrder(page, orderNumber);
  assert.equal(order.promotion, undefined, "no snapshot is fabricated");
  assert.equal(order.totalIls, order.subtotalIls + order.deliveryIls);
}

export async function a_promotion_does_not_confirm_supplier_availability({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await page.evaluate(
    ([key]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      for (const slug of ["crimson-2005", "onyx-home"]) {
        const p = db.products.find((x) => x.slug === slug);
        p.availability = { status: "confirmation_required" };
        p.versionAvailability = {};
        p.sizeAvailability = {};
      }
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY],
  );
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const orderNumber = await placeOrder(page, BASE, "promo-unconfirmed@example.com");
  const order = await readOrder(page, orderNumber);
  assert.ok(order.promotion, "the promotion still applies");
  assert.equal(order.fulfillmentStatus, "awaiting_supplier_confirmation", "and availability is still unconfirmed");
  assert.equal(order.supplierConfirmation.required, true);
}

/* ── admin ──────────────────────────────────────────────────────────────── */

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 6000 });
}

export async function the_campaign_ships_disabled_and_admin_can_enable_it({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/promotions`, { waitUntil: "networkidle" });
  assert.match((await page.locator("h1").first().textContent()) ?? "", /Promotions/);

  const section = page.locator("section[aria-label^='Promotion']").first();
  assert.match((await section.textContent()) ?? "", /Disabled/, "it ships switched off");
  assert.match((await section.textContent()) ?? "", /Behaviour preview/, "with a worked preview");
  assert.match((await section.textContent()) ?? "", /2 items discounted/, "showing two discounts on a four-item basket");

  await section.getByLabel("Enabled", { exact: true }).check();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(500);

  const stored = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k)).promotions, LS_KEY);
  assert.equal(stored[0].enabled, true, "the owner's decision is stored");
  assert.equal(stored[0].discountPercent, 15);
  assert.equal(stored[0].stackWithProductSales, false, "stacking stays off by default");
}

export async function admin_rejects_an_impossible_campaign({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/promotions`, { waitUntil: "networkidle" });
  const section = page.locator("section[aria-label^='Promotion']").first();
  if (!(await section.getByLabel("Enabled").isChecked())) await section.getByLabel("Enabled", { exact: true }).check();
  await section.locator("label", { hasText: /^Discount percentage/ }).locator("input").fill("150");
  await page.waitForTimeout(200);
  const text = (await section.textContent()) ?? "";
  assert.match(text, /cannot be more than 100/, "the error is explained");
  assert.match(text, /Invalid/, "and the status says so");
}

export async function admin_order_detail_shows_the_discounted_item({ page, BASE }) {
  await clearSales(page, BASE);
  await setPromotion(page, BASE, RUNNING);
  await addToCart(page, BASE, "crimson-2005");
  await addToCart(page, BASE, "onyx-home");
  const orderNumber = await placeOrder(page, BASE, "admin-promo@example.com");

  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const text = (await page.locator("main").textContent()) ?? "";
  assert.match(text, /Buy 2, get 15% off the second item/, "the campaign is named");
  assert.match(text, /Discounted:/, "the exact item is identified");
  assert.match(text, /15% off the cheaper item of every 2/, "the rule is spelled out");
  assert.match(text, /not stacked with product sales/, "stacking state is recorded");
}
