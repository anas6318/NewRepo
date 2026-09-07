/**
 * Configurable product sales end to end: display, scheduling, add-on
 * separation, admin control, order snapshots and RTL readability.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";

async function ensureDemoDbPersisted(page, BASE) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  if (await page.evaluate((k) => window.localStorage.getItem(k) !== null, LS_KEY)) return;
  await page.fill("#footer-email", `seed-${Date.now()}@example.com`);
  await page.locator(".site-footer__form button[type=submit]").click();
  await page.waitForFunction((k) => window.localStorage.getItem(k) !== null, LS_KEY, { timeout: 5000 });
}

async function setSale(page, BASE, slug, sale) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key, s, cfg]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const product = db.products.find((x) => x.slug === s);
      if (cfg === null) delete product.sale;
      else product.sale = cfg;
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, slug, sale],
  );
}

const DAY = 24 * 60 * 60 * 1000;
const offset = (ms) => new Date(Date.now() + ms).toISOString();

async function totalText(page) {
  return (await page.locator("#buy-actions .price").first().textContent()) ?? "";
}

async function headlinePrice(page) {
  return (await page.locator(".product-price").first().textContent()) ?? "";
}

/* ── storefront display ─────────────────────────────────────────────── */

export async function active_sale_shows_struck_regular_price_and_label({ page, BASE }) {
  // onyx-home is seeded with an active 20% sale on a ₪140 regular price.
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  const price = await headlinePrice(page);
  assert.match(price, /112/, "sale price shown prominently");
  assert.match(price, /140/, "regular price shown alongside");

  const compare = page.locator(".product-price .price__compare").first();
  assert.equal(await compare.count(), 1, "the regular price is struck through");
  assert.match((await compare.textContent()) ?? "", /140/, "and it is the real configured regular price");

  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.match(panel, /20% off/, "the configured sale label is shown");
  // A truthful end date is fine; a ticking countdown is not. The panel text
  // must be byte-identical a couple of seconds later.
  await page.waitForTimeout(2200);
  const later = (await page.locator(".product-panel").textContent()) ?? "";
  assert.equal(later, panel, "nothing in the sale display counts down");
}

export async function sale_price_updates_with_version_and_badge({ page, BASE }) {
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  assert.match(await totalText(page), /112/, "fan: 20% off ₪140");

  await page.locator("fieldset", { hasText: "Version" }).getByRole("button", { name: /Player/ }).click();
  await page.waitForTimeout(200);
  // player = 140 + 20; 20% of 160 = 32 → 128
  assert.match(await totalText(page), /128/, "the version adjustment is inside the sale");

  const badge = page.getByRole("button", { name: /^Champions League badge/ });
  if (await badge.count()) {
    await badge.first().click();
    await page.waitForTimeout(200);
    // + ₪10 badge, undiscounted → 138
    assert.match(await totalText(page), /138/, "the badge is added after the discount, not discounted");
  }
}

export async function badge_is_not_discounted_by_the_sale({ page, BASE }) {
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  const badge = page.getByRole("button", { name: /^Champions League badge/ }).first();
  await badge.click();
  await page.waitForTimeout(200);
  // 140 − 28 + 10 = 122 — the worked example from the brief.
  assert.match(await totalText(page), /122/, "₪140 → ₪112 + ₪10 badge = ₪122");
}

export async function quantity_multiplies_the_sale_price({ page, BASE }) {
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  await page.locator(".qty button").nth(1).click(); // +
  await page.waitForTimeout(200);
  assert.match(await totalText(page), /224/, "112 × 2");
}

export async function expired_sale_shows_the_regular_price_only({ page, BASE }) {
  // amber-2001 is seeded with a sale that ended two days ago.
  await page.goto(`${BASE}/en/product/amber-2001`, { waitUntil: "networkidle" });
  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.doesNotMatch(panel, /% off|Sale|Limited-time/, "an expired sale is not advertised");
  assert.equal(await page.locator(".product-price .price__compare").count(), 0, "no crossed-out price");
  assert.match(await totalText(page), /170/, "the regular price is back on its own");
}

export async function scheduled_sale_is_announced_without_a_discounted_price({ page, BASE }) {
  // emerald-2007 starts in a week and the owner opted to announce it.
  await page.goto(`${BASE}/en/product/emerald-2007`, { waitUntil: "networkidle" });
  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.match(panel, /Limited-time offer/, "the upcoming sale is named");
  assert.match(panel, /Sale starts/, "with a truthful start date");
  assert.equal(await page.locator(".product-price .price__compare").count(), 0, "no crossed-out price before it starts");
  assert.match(await totalText(page), /170/, "the regular price is charged until it opens");
}

export async function a_sale_starting_in_the_future_is_hidden_by_default({ page, BASE }) {
  await setSale(page, BASE, "royal-1998", {
    enabled: true,
    type: "percentage",
    percentOff: 30,
    startsAt: offset(2 * DAY),
    endsAt: offset(9 * DAY),
  });
  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.doesNotMatch(panel, /30% off|Sale starts/, "nothing is shown without showBeforeStart");
  assert.match(await totalText(page), /170/);
}

export async function boundary_moments_flip_the_sale_exactly_once({ page, BASE }) {
  // A sale that ends shortly: active now, over afterwards — with no code
  // change, commit or redeploy in between. The wait is derived from the
  // stored end time rather than a fixed sleep, so the assertion cannot race
  // a slow page load.
  const endsAt = offset(25_000);
  await setSale(page, BASE, "royal-1998", { enabled: true, type: "fixed_amount", amountOffIls: 20, startsAt: offset(-DAY), endsAt });
  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  assert.ok(Date.now() < Date.parse(endsAt), "the window is still open when this is asserted");
  assert.match(await totalText(page), /150/, "active: ₪170 − ₪20");

  await page.waitForTimeout(Math.max(500, Date.parse(endsAt) - Date.now() + 500));
  await page.reload({ waitUntil: "networkidle" });
  assert.match(await totalText(page), /170/, "expired on its own schedule");
  assert.equal(await page.locator(".product-price .price__compare").count(), 0);
}

export async function invalid_sale_configuration_charges_the_regular_price({ page, BASE }) {
  await setSale(page, BASE, "royal-1998", { enabled: true, type: "percentage", percentOff: 150, startsAt: offset(-DAY), endsAt: offset(DAY) });
  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  assert.match(await totalText(page), /170/, "an impossible discount is never applied");
  assert.equal(await page.locator(".product-price .price__compare").count(), 0);
}

export async function fixed_price_sale_renders_correctly({ page, BASE }) {
  await page.goto(`${BASE}/en/product/midnight-longsleeve`, { waitUntil: "networkidle" });
  const price = await headlinePrice(page);
  assert.match(price, /149/, "the configured final price");
  assert.match(price, /175/, "beside the real regular price");
}

/* ── product cards ──────────────────────────────────────────────────── */

export async function product_cards_show_the_same_sale_as_the_product_page({ page, BASE }) {
  await page.goto(`${BASE}/en/shop`, { waitUntil: "networkidle" });
  const card = page.locator(".prod-card").filter({ hasText: "Onyx Home" }).first();
  const text = (await card.textContent()) ?? "";
  assert.match(text, /112/, "card shows the sale price");
  assert.match(text, /140/, "and the regular price");
  assert.match(text, /20% off/, "and the label");
  assert.equal(await card.locator(".price__compare").count(), 1);

  // The badge sits in the card's badge stack, not over the artwork.
  const badge = card.locator(".prod-card__badges .badge--sale");
  assert.equal(await badge.count(), 1, "the sale badge lives in the badge stack");

  const expired = page.locator(".prod-card").filter({ hasText: "Amber" }).first();
  if (await expired.count()) {
    assert.doesNotMatch((await expired.textContent()) ?? "", /% off/, "an expired sale is not shown on cards either");
  }
}

/* ── localization and layout ────────────────────────────────────────── */

export async function sale_labels_render_in_all_three_locales({ page, BASE }) {
  const expected = { en: /20% off/, ar: /خصم 20%/, he: /20% הנחה/ };
  for (const [locale, pattern] of Object.entries(expected)) {
    await page.goto(`${BASE}/${locale}/product/onyx-home`, { waitUntil: "networkidle" });
    const panel = (await page.locator(".product-panel").textContent()) ?? "";
    assert.match(panel, pattern, `${locale}: sale label`);
    if (locale !== "en") assert.doesNotMatch(panel, /20% off/, `${locale}: no English label leaks`);
    if (locale !== "ar") assert.doesNotMatch(panel, /خصم 20%/, `${locale}: no Arabic label leaks`);
    if (locale !== "he") assert.doesNotMatch(panel, /20% הנחה/, `${locale}: no Hebrew label leaks`);
  }
}

export async function sale_prices_are_readable_and_do_not_overlap({ BASE, newPage }) {
  for (const width of [320, 390, 834, 1280]) {
    for (const locale of ["en", "ar", "he"]) {
      const { page, context } = await newPage({ width, height: 900 });
      try {
        await page.goto(`${BASE}/${locale}/product/onyx-home`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `${locale} @${width}px: horizontal overflow of ${overflow}px`);

        const boxes = await page.evaluate(() => {
          const price = document.querySelector(".product-price");
          const amount = price?.querySelector(".price__amount")?.getBoundingClientRect();
          const compare = price?.querySelector(".price__compare")?.getBoundingClientRect();
          return amount && compare ? { amount: { l: amount.left, r: amount.right }, compare: { l: compare.left, r: compare.right } } : null;
        });
        assert.ok(boxes, `${locale} @${width}px: both prices render`);
        const gap = Math.max(boxes.compare.l - boxes.amount.r, boxes.amount.l - boxes.compare.r);
        assert.ok(gap > -1, `${locale} @${width}px: the two prices overlap`);

        // The shop grid too, where the badge sits over the image frame.
        await page.goto(`${BASE}/${locale}/shop`, { waitUntil: "networkidle" });
        const shopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(shopOverflow <= 1, `${locale} shop @${width}px: horizontal overflow of ${shopOverflow}px`);
      } finally {
        await context.close();
      }
    }
  }
}

/* ── cart, checkout, order ──────────────────────────────────────────── */

async function addOnSaleItemToCart(page, BASE) {
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  await page.locator("fieldset", { hasText: "Version" }).getByRole("button", { name: /Fan/ }).first().click();
  await page.locator(".chip", { hasText: /^L$/ }).first().click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
}

export async function the_sale_survives_cart_and_checkout({ page, BASE }) {
  await addOnSaleItemToCart(page, BASE);

  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  const cart = (await page.locator("main").textContent()) ?? "";
  assert.match(cart, /112/, "cart charges the sale price");
  assert.match(cart, /140/, "and still shows the regular price struck through");
  assert.equal(await page.locator("main .price__compare").count() > 0, true);

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  const checkout = (await page.locator("main").textContent()) ?? "";
  assert.match(checkout, /112/, "checkout agrees with the cart");
  assert.match(checkout, /140/);
}

export async function the_order_stores_an_immutable_price_snapshot({ page, BASE }) {
  await addOnSaleItemToCart(page, BASE);
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Sale Tester");
  await page.fill("#co-email", "sale@example.com");
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  const read = () =>
    page.evaluate(
      ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n).items[0],
      [LS_KEY, orderNumber],
    );

  const item = await read();
  assert.equal(item.price.regularBasePriceIls, 140, "the regular base price is recorded");
  assert.equal(item.price.regularUnitPriceIls, 140);
  assert.equal(item.price.saleType, "percentage");
  assert.equal(item.price.saleValue, 20);
  assert.equal(item.price.saleDiscountIls, 28);
  assert.equal(item.price.finalUnitPriceIls, 112);
  assert.equal(item.price.saleLabel, "20% off");
  assert.ok(item.price.saleEndsAt, "the sale window is recorded");
  assert.equal(item.unitPriceIls, 112);

  // The confirmation page shows the same figures.
  const confirmation = (await page.locator("main").textContent()) ?? "";
  assert.match(confirmation, /112/);
  assert.match(confirmation, /20% off/);

  // The owner now changes the sale and then ends it entirely.
  await setSale(page, BASE, "onyx-home", { enabled: true, type: "percentage", percentOff: 60, startsAt: offset(-DAY), endsAt: offset(DAY), autoPercentLabel: true });
  const afterEdit = await read();
  assert.equal(afterEdit.price.finalUnitPriceIls, 112, "the placed order does not move");
  assert.equal(afterEdit.price.saleValue, 20);

  await setSale(page, BASE, "onyx-home", { enabled: false, type: "none" });
  const afterEnd = await read();
  assert.equal(afterEnd.price.finalUnitPriceIls, 112, "and it survives the sale ending");
  assert.equal(afterEnd.unitPriceIls, 112);

  // Restore the seeded sale for the other specs.
  await setSale(page, BASE, "onyx-home", { enabled: true, type: "percentage", percentOff: 20, startsAt: offset(-3 * DAY), endsAt: offset(10 * DAY), autoPercentLabel: true });
}

export async function a_forged_cart_price_is_recomputed_by_the_server({ page, BASE }) {
  await addOnSaleItemToCart(page, BASE);
  await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("crowned_cart_v1") ?? "[]");
    for (const line of raw) {
      line.unitPriceIls = 1;
      if (line.price) {
        line.price.finalUnitPriceIls = 1;
        line.price.saleDiscountIls = 139;
        line.price.saleValue = 99;
      }
    }
    window.localStorage.setItem("crowned_cart_v1", JSON.stringify(raw));
  });

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Forge Tester");
  await page.fill("#co-email", "forge@example.com");
  await page.fill("#co-phone", "0501234599");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 2");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  const item = await page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n).items[0],
    [LS_KEY, orderNumber],
  );
  assert.equal(item.price.saleValue, 20, "the configured 20%, not the submitted 99%");
  assert.equal(item.price.finalUnitPriceIls, 112, "not the submitted ₪1");
  assert.equal(item.unitPriceIls, 112);
}

export async function a_sale_does_not_confirm_supplier_availability({ page, BASE }) {
  // onyx-home carries an active sale; make its availability unconfirmed.
  await page.evaluate(
    ([key]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const p = db.products.find((x) => x.slug === "onyx-home");
      p.availability = { status: "confirmation_required" };
      p.versionAvailability = {};
      p.sizeAvailability = {};
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY],
  ).catch(() => undefined);
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const p = db.products.find((x) => x.slug === "onyx-home");
      p.availability = { status: "confirmation_required" };
      p.versionAvailability = {};
      p.sizeAvailability = {};
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY],
  );

  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.match(panel, /20% off/, "the sale still shows");
  assert.match(panel, /confirm|confirmation/i, "and availability is still unconfirmed");
  assert.equal(await page.locator(".product-panel .badge--ok").count(), 0, "no availability claim beside the sale");
}

/* ── admin ──────────────────────────────────────────────────────────── */

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 6000 });
}

export async function admin_can_create_a_sale_and_the_storefront_follows({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/products/demo-royal-1998`, { waitUntil: "networkidle" });
  const section = page.locator("section[aria-label=Sale]");
  await section.scrollIntoViewIfNeeded();
  assert.match((await section.textContent()) ?? "", /never overwritten/, "the regular price is explained");

  await section.getByLabel("Sale enabled").check();
  await section.getByLabel("Sale type").selectOption("fixed_amount");
  await section.locator("label", { hasText: /^Amount off/ }).locator("input").fill("30");
  await section.getByLabel(/^Sale label \(EN\)/).fill("Owner special");
  await page.waitForTimeout(200);
  assert.match((await section.textContent()) ?? "", /Owner special/, "the preview shows the customer-facing label");
  assert.match((await section.textContent()) ?? "", /Active/, "the status reads active");

  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(600);

  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  const price = await headlinePrice(page);
  assert.match(price, /140/, "₪170 − ₪30");
  assert.match(price, /170/, "regular price still shown");
  assert.match((await page.locator(".product-panel").textContent()) ?? "", /Owner special/);
}

export async function admin_rejects_impossible_sale_values({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/products/demo-emerald-2007`, { waitUntil: "networkidle" });
  const section = page.locator("section[aria-label=Sale]");
  await section.scrollIntoViewIfNeeded();
  if (!(await section.getByLabel("Sale enabled").isChecked())) await section.getByLabel("Sale enabled").check();
  await section.getByLabel("Sale type").selectOption("fixed_price");
  await section.locator("label", { hasText: /^Final sale price/ }).locator("input").fill("999");
  await page.waitForTimeout(200);
  const text = (await section.textContent()) ?? "";
  assert.match(text, /must be below the regular/, "the error is explained in the editor");
  assert.match(text, /Invalid/, "and the status says so");
}

export async function admin_can_remove_a_sale_and_restore_the_regular_price({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/products/demo-royal-1998`, { waitUntil: "networkidle" });
  const section = page.locator("section[aria-label=Sale]");
  await section.scrollIntoViewIfNeeded();
  if (!(await section.getByLabel("Sale enabled").isChecked())) {
    await section.getByLabel("Sale enabled").check();
    await section.getByLabel("Sale type").selectOption("percentage");
    await section.locator("label", { hasText: /^Percentage off/ }).locator("input").fill("10");
  }
  await section.getByRole("button", { name: /Remove sale/ }).click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(600);

  const base = await page.evaluate(
    ([key]) => JSON.parse(window.localStorage.getItem(key)).products.find((p) => p.slug === "royal-1998").basePriceIls,
    [LS_KEY],
  );
  assert.equal(base, 170, "the regular price was never lost");

  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  assert.match(await totalText(page), /170/, "and it is charged again immediately");
  assert.equal(await page.locator(".product-price .price__compare").count(), 0);
}

export async function admin_order_detail_shows_the_frozen_sale({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
  const link = page.locator("a[href*='/admin/orders/CR-']").first();
  await link.click();
  await page.waitForTimeout(400);
  const items = (await page.locator("section[aria-label=Items]").textContent()) ?? "";
  // Seeded orders predate the sale system, so the assertion is that the view
  // renders them without inventing a sale.
  assert.doesNotMatch(items, /undefined/, "pre-sale orders render cleanly");
}
