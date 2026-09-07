/**
 * Configurable badge / patch options end to end: per-product prices,
 * overrides, disabled options, order snapshots and admin management.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";

/** The demo DB only reaches localStorage after a real mutation; the footer
 * signup is the cheapest genuine one. */
async function ensureDemoDbPersisted(page, BASE) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  if (await page.evaluate((k) => window.localStorage.getItem(k) !== null, LS_KEY)) return;
  await page.fill("#footer-email", `seed-${Date.now()}@example.com`);
  await page.locator(".site-footer__form button[type=submit]").click();
  await page.waitForFunction((k) => window.localStorage.getItem(k) !== null, LS_KEY, { timeout: 5000 });
}

async function patchProduct(page, BASE, slug, patch) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key, s, p]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      Object.assign(
        db.products.find((x) => x.slug === s),
        p,
      );
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, slug, patch],
  );
}

async function patchBadges(page, BASE, mutate) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key, fnBody]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      db.badges = new Function("badges", fnBody)(db.badges);
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, mutate],
  );
}

async function totalText(page) {
  return (await page.locator("#buy-actions .price").first().textContent()) ?? "";
}

/* ── storefront pricing ─────────────────────────────────────────────── */

export async function each_badge_shows_its_own_configured_price({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  const group = page.locator("fieldset", { hasText: /Badge \/ patch/i }).first();
  const text = (await group.textContent()) ?? "";

  // Prices differ per option — nothing is a fixed +₪5 any more.
  assert.match(text, /League badge\s*\+₪5/, "migrated legacy option still ₪5");
  assert.match(text, /Champions League badge\s*\+₪12/, "product override wins over the global ₪10");
  assert.match(text, /National tournament badge\s*\+₪7/, "global price for an option with no override");
  assert.doesNotMatch(text, /Retired competition badge/, "a globally disabled option is never offered");
  assert.doesNotMatch(text, /Club World Cup/, "an option this product disables is never offered");
}

export async function selecting_a_badge_updates_the_total_immediately({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  assert.ok((await totalText(page)).includes("170"), "base ₪170");

  await page.getByRole("button", { name: /Champions League badge/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("182"), "override ₪12 → ₪182");

  await page.getByRole("button", { name: /^League badge/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("175"), "legacy ₪5 → ₪175");

  await page.getByRole("button", { name: /No badge/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("170"), "no badge restores ₪170");
}

export async function quantity_multiplies_the_badge_adjustment({ page, BASE }) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Champions League badge/ }).click();
  await page.locator(".qty button").nth(1).click(); // +
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("364"), "(170 + 12) × 2");
}

export async function a_product_with_no_enabled_badges_hides_the_selector({ page, BASE }) {
  await patchProduct(page, BASE, "onyx-home", { badges: [], patchIds: [] });
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("fieldset", { hasText: /Badge \/ patch/i }).count(), 0, "no badge fieldset at all");
}

export async function a_legacy_product_still_offers_its_old_options({ page, BASE }) {
  // royal-1998 is seeded on the pre-0004 `patchIds` shape with no `badges`.
  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  const text = (await page.locator("fieldset", { hasText: /Badge \/ patch/i }).first().textContent()) ?? "";
  assert.match(text, /League badge\s*\+₪5/);
  assert.match(text, /Cup badge\s*\+₪5/);
  assert.doesNotMatch(text, /Champions League badge/, "only the options it actually had");
}

export async function disabling_a_badge_globally_removes_it_everywhere({ page, BASE }) {
  await patchBadges(page, BASE, "return badges.map((b) => (b.id === 'league-patch' ? { ...b, active: false } : b));");
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  const group = page.locator("fieldset", { hasText: /Badge \/ patch/i }).first();
  // Anchored so "Champions League badge" is not mistaken for "League badge".
  assert.equal(await group.getByRole("button", { name: /^League badge/ }).count(), 0, "disabled globally → not selectable");
  assert.equal(await group.getByRole("button", { name: /^Champions League badge/ }).count(), 1, "other options are unaffected");
}

export async function changing_a_global_price_changes_what_customers_pay({ page, BASE }) {
  await patchBadges(page, BASE, "return badges.map((b) => (b.id === 'national-tournament-badge' ? { ...b, priceIls: 21 } : b));");
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /National tournament badge/ }).click();
  await page.waitForTimeout(200);
  assert.ok((await totalText(page)).includes("191"), "170 + the new ₪21");
}

/* ── localization ───────────────────────────────────────────────────── */

export async function badge_labels_render_naturally_in_all_three_locales({ page, BASE }) {
  const expected = {
    en: { legend: /Badge \/ patch/, none: /No badge/, named: /Champions League badge/ },
    ar: { legend: /الشارة/, none: /بدون شارة/, named: /شارة دوري الأبطال/ },
    he: { legend: /פאץ׳/, none: /ללא פאץ׳/, named: /פאץ' ליגת האלופות/ },
  };
  for (const [locale, exp] of Object.entries(expected)) {
    await page.goto(`${BASE}/${locale}/product/crimson-2005`, { waitUntil: "networkidle" });
    const group = page.locator("fieldset").filter({ has: page.locator(".chip") }).last();
    const text = (await page.locator(".product-panel").textContent()) ?? "";
    assert.match(text, exp.legend, `${locale}: legend`);
    assert.match(text, exp.none, `${locale}: no-badge option`);
    assert.match(text, exp.named, `${locale}: named option`);
    // No language bleed-through into the other two dictionaries.
    if (locale !== "en") assert.doesNotMatch(text, /No badge/, `${locale}: no English label leaks`);
    if (locale !== "ar") assert.doesNotMatch(text, /بدون شارة/, `${locale}: no Arabic label leaks`);
    if (locale !== "he") assert.doesNotMatch(text, /ללא פאץ׳/, `${locale}: no Hebrew label leaks`);
    assert.ok((await group.count()) > 0);
  }
}

export async function badge_price_reads_left_to_right_in_rtl({ page, BASE }) {
  await page.goto(`${BASE}/ar/product/crimson-2005`, { waitUntil: "networkidle" });
  const chip = page.getByRole("button", { name: /شارة دوري الأبطال/ }).first();
  const meta = chip.locator("bdi");
  assert.equal(await meta.count(), 1, "the adjustment is isolated with <bdi>");
  assert.equal((await meta.getAttribute("dir")) ?? "", "ltr");
  assert.equal((await meta.textContent())?.trim(), "+₪12");
}

export async function badge_options_stay_readable_at_320px({ BASE, newPage }) {
  for (const width of [320, 390, 768]) {
    for (const locale of ["en", "ar", "he"]) {
      const { page, context } = await newPage({ width, height: 800 });
      try {
        await page.goto(`${BASE}/${locale}/product/crimson-2005`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `${locale} @${width}px: horizontal overflow of ${overflow}px`);
        const box = await page.getByRole("button", { name: /دوري الأبطال|ליגת האלופות|Champions League badge/ }).first().boundingBox();
        assert.ok(box && box.width > 40 && box.height >= 28, `${locale} @${width}px: badge chip is not a usable size`);
      } finally {
        await context.close();
      }
    }
  }
}

/* ── cart → checkout → order ────────────────────────────────────────── */

async function addToCartWithBadge(page, BASE, badgeName) {
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator(".chip", { hasText: /^L$/ }).click();
  await page.getByRole("button", { name: badgeName }).click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
}

async function fillCheckoutFields(page, email) {
  await page.fill("#co-name", "Badge Tester");
  await page.fill("#co-email", email);
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
}

export async function the_badge_survives_cart_and_checkout({ page, BASE }) {
  await addToCartWithBadge(page, BASE, /Champions League badge/);

  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  const cartText = (await page.locator("main").textContent()) ?? "";
  assert.match(cartText, /Champions League badge/, "cart shows the badge");
  assert.match(cartText, /\+₪12/, "cart shows the price actually charged");
  assert.match(cartText, /182/, "unit price includes the badge");

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  const checkoutText = (await page.locator("main").textContent()) ?? "";
  assert.match(checkoutText, /Champions League badge/, "checkout shows the badge");
  assert.match(checkoutText, /\+₪12/);
}

export async function the_order_stores_an_immutable_priced_snapshot({ page, BASE }) {
  await addToCartWithBadge(page, BASE, /^League badge/);
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await fillCheckoutFields(page, "badge@example.com");
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  const item = await page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n).items[0],
    [LS_KEY, orderNumber],
  );
  assert.equal(item.badge.badgeId, "league-patch");
  assert.equal(item.badge.code, "league");
  assert.equal(item.badge.priceIls, 5, "the price charged is frozen into the order");
  assert.equal(item.badge.label, "League badge", "customer-facing name in the order locale");
  assert.equal(item.unitPriceIls, 175);

  // The owner now triples the price. The placed order must not move.
  await patchBadges(page, BASE, "return badges.map((b) => (b.id === 'league-patch' ? { ...b, priceIls: 15, name: { ...b.name, en: 'Renamed badge' } } : b));");
  const after = await page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n).items[0],
    [LS_KEY, orderNumber],
  );
  assert.equal(after.badge.priceIls, 5, "an existing order snapshot never changes");
  assert.equal(after.badge.name.en, "League badge");
  assert.equal(after.unitPriceIls, 175);

  // And the customer's tracking view shows it without the internal reference.
  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", "badge@example.com");
  await page.getByRole("button", { name: /Track|Submit/i }).first().click();
  await page.waitForTimeout(500);
  const tracked = (await page.locator("main").textContent()) ?? "";
  assert.match(tracked, /League badge/, "tracking shows what was ordered");
  assert.doesNotMatch(tracked, /SUP-BDG/, "no internal supplier reference reaches the customer");
}

export async function a_fabricated_badge_price_cannot_be_charged({ page, BASE }) {
  await ensureDemoDbPersisted(page, BASE);
  // Forge a cart line claiming a free badge and a ₪1 shirt, exactly as a
  // tampered browser would. Order creation recomputes from the catalog.
  await addToCartWithBadge(page, BASE, /Champions League badge/);
  await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("crowned_cart_v1") ?? "[]");
    for (const line of raw) {
      line.unitPriceIls = 1; // pretend the badge was free and the shirt ₪1
      if (line.badge) line.badge.priceIls = 0;
    }
    window.localStorage.setItem("crowned_cart_v1", JSON.stringify(raw));
  });

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await fillCheckoutFields(page, "tamper@example.com");
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  const item = await page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n).items[0],
    [LS_KEY, orderNumber],
  );
  assert.equal(item.badge.priceIls, 12, "the catalog/override price, not the submitted ₪0");
  assert.equal(item.unitPriceIls, 182, "the server recomputed the whole line");
}

/* ── admin ──────────────────────────────────────────────────────────── */

async function adminLogin(page, BASE) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".stat-tile", { timeout: 6000 });
}

export async function admin_can_create_edit_disable_and_reorder_options({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/badges`, { waitUntil: "networkidle" });
  assert.match((await page.locator("h1").first().textContent()) ?? "", /Badge \/ patch options/);

  // Create
  await page.getByRole("button", { name: /^Add option$/ }).click();
  const codeInputs = page.locator("section input[dir=ltr]");
  const lastSection = page.locator("section[aria-label]").last();
  await lastSection.locator("input").first().fill("supercup");
  await lastSection.getByLabel("Default price adjustment (₪)").fill("9");
  await lastSection.getByLabel(/Customer-facing name/).fill("Super Cup badge");
  void codeInputs;

  // Trilingual names are required before it can be saved.
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(300);
  for (const lang of ["AR", "HE"]) {
    await page.getByRole("button", { name: lang, exact: true }).click();
    await page.locator("section[aria-label]").last().getByLabel(/Customer-facing name/).fill(`Super Cup ${lang}`);
  }
  await page.getByRole("button", { name: "EN", exact: true }).click();

  // Enable globally, then save.
  await page.locator("section[aria-label]").last().getByLabel("Enabled globally").check();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(400);

  const saved = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k)).badges, LS_KEY);
  const created = saved.find((b) => b.code === "supercup");
  assert.ok(created, "the new option was stored");
  assert.equal(created.priceIls, 9);
  assert.equal(created.active, true);

  // Reorder: move it up one place and confirm sortOrder was rewritten.
  await page.reload({ waitUntil: "networkidle" });
  const sections = page.locator("section[aria-label]");
  const count = await sections.count();
  await sections.nth(count - 1).getByRole("button", { name: /Move .* up/ }).click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(400);
  const reordered = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k)).badges, LS_KEY);
  const idx = reordered.findIndex((b) => b.code === "supercup");
  assert.ok(idx < reordered.length - 1, "the option moved up");
  assert.ok(reordered.every((b, i) => (i === 0 ? true : b.sortOrder > reordered[i - 1].sortOrder)), "sortOrder is normalised and ascending");
}

export async function admin_can_override_a_price_for_one_product({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/products/demo-emerald-2007`, { waitUntil: "networkidle" });
  const section = page.locator("section[aria-label='Badge / patch options']");
  await section.scrollIntoViewIfNeeded();
  assert.match((await section.textContent()) ?? "", /Inherit global price/, "override controls are present");

  const uclRow = section.locator("li", { hasText: "Champions League badge" }).first();
  await uclRow.getByText(/Inherit global price/).locator("xpath=preceding-sibling::input").first().uncheck();
  await uclRow.getByLabel("Product price override (₪)").fill("25");
  assert.match((await uclRow.textContent()) ?? "", /\+₪25/, "the preview shows the resolved customer price");

  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(500);

  await page.goto(`${BASE}/en/product/emerald-2007`, { waitUntil: "networkidle" });
  const text = (await page.locator("fieldset", { hasText: /Badge \/ patch/i }).first().textContent()) ?? "";
  assert.match(text, /Champions League badge\s*\+₪25/, "the storefront uses the product override");
}

export async function admin_order_detail_shows_the_snapshot_with_supplier_reference({ page, BASE }) {
  await adminLogin(page, BASE);
  await page.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
  await page.locator("a[href*='/admin/orders/CR-']").first().click();
  await page.waitForTimeout(400);
  const items = (await page.locator("section[aria-label=Items]").textContent()) ?? "";
  assert.match(items, /Badge: Champions badge/, "the badge sold is named");
  assert.match(items, /supplier ref SUP-BDG-CHAMP/, "staff see the internal reference");
}
