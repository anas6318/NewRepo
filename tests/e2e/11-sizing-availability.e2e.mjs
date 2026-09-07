/** Supplier-confirmed size charts + honest availability in the storefront. */
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

/** Applies availability/size overrides to one demo product, in the browser. */
async function patchProduct(page, BASE, slug, patch) {
  await ensureDemoDbPersisted(page, BASE);
  await page.evaluate(
    ([key, s, p]) => {
      const db = JSON.parse(window.localStorage.getItem(key));
      const product = db.products.find((x) => x.slug === s);
      Object.assign(product, p);
      window.localStorage.setItem(key, JSON.stringify(db));
    },
    [LS_KEY, slug, patch],
  );
}

async function readOrder(page, orderNumber) {
  return page.evaluate(
    ([key, n]) => JSON.parse(window.localStorage.getItem(key)).orders.find((o) => o.orderNumber === n),
    [LS_KEY, orderNumber],
  );
}

/* ── size guide ── */

export async function fan_chart_shows_confirmed_flat_width_and_no_4xl_row({ page, BASE }) {
  await page.goto(`${BASE}/en/size-guide`, { waitUntil: "networkidle" });
  const text = await page.locator(".size-chart").innerText();
  assert.ok(/Width laid flat/i.test(text), "width is labelled as laid flat");
  assert.ok(!/chest circumference/i.test(text), "flat width is never called a chest circumference");
  assert.ok(text.includes("53–55"), `Fan S flat width 53–55 shown: ${text.slice(0, 200)}`);

  const sizes = await page.locator(".size-chart__table tbody th").allInnerTexts();
  assert.deepEqual(sizes, ["S", "M", "L", "XL", "2XL", "3XL"], "confirmed rows stop at 3XL");
  assert.ok(!sizes.includes("4XL"), "no fabricated 4XL row");
  assert.ok(/4XL/.test(await page.locator(".size-chart__unconfirmed").innerText()), "4XL needs supplier confirmation");
}

export async function player_and_kids_charts_match_supplier_values({ page, BASE }) {
  await page.goto(`${BASE}/en/size-guide`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Player version/i }).click();
  await page.waitForTimeout(200);
  let sizes = await page.locator(".size-chart__table tbody th").allInnerTexts();
  assert.deepEqual(sizes, ["S", "M", "L", "XL", "2XL"], "Player stops at 2XL");
  assert.ok((await page.locator(".size-chart").innerText()).includes("49–51"), "Player S flat width 49–51");

  await page.getByRole("tab", { name: /Kids kit/i }).click();
  await page.waitForTimeout(200);
  sizes = await page.locator(".size-chart__table tbody th").allInnerTexts();
  assert.deepEqual(sizes, ["16", "18", "20", "22", "24", "26", "28"], "Kids 16–28");
  const kids = await page.locator(".size-chart").innerText();
  assert.ok(/Recommended age/i.test(kids), "age shown as guidance");
  assert.ok(kids.includes("43"), "size 16 shirt length 43 cm");
}

export async function preliminary_charts_are_labelled_not_presented_as_confirmed({ page, BASE }) {
  await page.goto(`${BASE}/en/size-guide`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /^Retro$/i }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator(".size-chart__notice").isVisible(), "retro chart flagged preliminary");
  const note = await page.locator(".size-chart__notice").innerText();
  assert.ok(/awaiting final supplier confirmation/i.test(note), `preliminary wording: ${note}`);
}

export async function unit_switch_converts_ranges_but_not_age({ page, BASE }) {
  await page.goto(`${BASE}/en/size-guide`, { waitUntil: "networkidle" });
  await page.getByRole("group", { name: /units/i }).locator(".chip").nth(1).click();
  await page.waitForTimeout(200);
  const text = await page.locator(".size-chart").innerText();
  assert.ok(text.includes("20.9–21.7"), `Fan S width converted to inches: ${text.slice(0, 200)}`);
  assert.ok(/\(in\)/i.test(text), "headers show the imperial unit");

  await page.getByRole("tab", { name: /Kids kit/i }).click();
  await page.waitForTimeout(200);
  const kids = await page.locator(".size-chart").innerText();
  assert.ok(kids.includes("2–3"), "age is never converted");
}

export async function size_chart_is_usable_on_mobile_in_all_locales({ BASE, newPage }) {
  for (const locale of ["en", "ar", "he"]) {
    const { page, context, pageErrors } = await newPage({ width: 390, height: 844 });
    await page.goto(`${BASE}/${locale}/size-guide`, { waitUntil: "networkidle" });
    await page.waitForSelector(".size-chart");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 2, `${locale} size guide has no horizontal overflow (got ${overflow})`);
    assert.ok(await page.locator(".size-chart__card").first().isVisible(), `${locale} uses stacked cards on mobile`);
    assert.equal(await page.locator(".size-chart__table").first().isVisible(), false, "wide table hidden on mobile");
    const dir = await page.evaluate(() => document.documentElement.dir);
    assert.equal(dir, locale === "en" ? "ltr" : "rtl", `${locale} direction`);
    assert.equal(pageErrors.length, 0, `${locale} console clean`);
    await context.close();
  }
}

/* ── product page availability ── */

export async function unavailable_size_is_disabled_and_others_stay_selectable({ page, BASE }) {
  await patchProduct(page, BASE, "onyx-home", {
    sizes: ["S", "M", "L", "XL", "2XL"],
    availability: { status: "available" },
    sizeAvailability: { "*:M": { status: "unavailable" } },
  });
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  const m = page.locator("fieldset .chip", { hasText: /^M$/ }).first();
  assert.equal(await m.isDisabled(), true, "supplier-unavailable size is disabled");
  const l = page.locator("fieldset .chip", { hasText: /^L$/ }).first();
  assert.equal(await l.isDisabled(), false, "other sizes stay selectable");
  await l.click();
  assert.equal(await l.getAttribute("aria-pressed"), "true");
}

export async function confirmation_required_shows_request_cta_not_stock_claim({ page, BASE }) {
  await patchProduct(page, BASE, "onyx-home", {
    availability: { status: "confirmation_required" },
    sizeAvailability: {},
  });
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.waitForTimeout(200);

  const panel = await page.locator(".product-panel").innerText();
  assert.ok(/Request this jersey/i.test(panel), "primary action becomes a request");
  assert.ok(/Awaiting supplier confirmation/i.test(panel), "state is disclosed");
  assert.ok(/confirmed with our supplier/i.test(panel), "confirmation is explained near the size selector");
  assert.ok(!/\bin stock\b/i.test(panel), "never claims live inventory");
  assert.equal(await page.locator(".product-panel .badge--ok").count(), 0, "no green in-stock style badge");
}

export async function fan_4xl_shows_supplier_confirmation_message({ page, BASE }) {
  await patchProduct(page, BASE, "onyx-home", {
    sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    availability: { status: "available" },
    sizeAvailability: { "*:4XL": { status: "confirmation_required" } },
  });
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  await page.locator("fieldset .chip", { hasText: /^4XL$/ }).first().click();
  await page.waitForTimeout(200);
  const panel = await page.locator(".product-panel").innerText();
  assert.ok(/4XL availability and exact measurements require supplier confirmation/i.test(panel), `honest 4XL message: ${panel.slice(0, 300)}`);

  // and the chart inside the dialog still shows no invented 4XL row
  await page.getByRole("button", { name: /size guide/i }).first().click();
  await page.waitForSelector(".dialog .size-chart");
  const rows = await page.locator(".dialog .size-chart__table tbody th").allInnerTexts();
  assert.ok(!rows.includes("4XL"), "no fabricated 4XL measurements in the dialog");
}

export async function unconfirmed_catalog_product_asks_for_a_request_not_a_purchase({ page, BASE }) {
  // royal-1998 carries no dated supplier confirmation in the demo catalog:
  // it is published, which is NOT the same as available.
  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.waitForTimeout(200);
  const panel = await page.locator(".product-panel").innerText();
  assert.ok(/Request this jersey/i.test(panel), "published-but-unconfirmed asks for a request");
  assert.ok(/Awaiting supplier confirmation/i.test(panel), "state disclosed without any owner action");
  assert.ok(!/\bin stock\b/i.test(panel), "no stock claim");

  // a product the owner actually checked keeps the normal order flow
  await page.goto(`${BASE}/en/product/crimson-2005`, { waitUntil: "networkidle" });
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.waitForTimeout(200);
  const confirmed = await page.locator(".product-panel").innerText();
  assert.ok(!/Request this jersey/i.test(confirmed), "a dated confirmation restores the normal flow");
  assert.ok(!/\bin stock\b/i.test(confirmed), "still never claims stock");
}

export async function an_expired_confirmation_reverts_to_a_request({ page, BASE }) {
  const DAY = 24 * 60 * 60 * 1000;
  // graphite-player ships with a deliberately aged demo confirmation.
  await page.goto(`${BASE}/en/product/graphite-player`, { waitUntil: "networkidle" });
  const versionChips = page.locator("fieldset", { hasText: /version/i }).first().locator(".chip");
  if (await versionChips.count()) await versionChips.first().click();
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.waitForTimeout(200);
  const expired = await page.locator(".product-panel").innerText();
  assert.ok(/Request this jersey/i.test(expired), "a confirmation older than 7 days stops confirming");
  assert.ok(/Awaiting supplier confirmation/i.test(expired), "the expired state is disclosed");

  // reconfirming (what the admin action does) restores the normal flow
  await patchProduct(page, BASE, "graphite-player", {
    availability: { status: "available", lastCheckedAt: new Date(Date.now() - DAY).toISOString() },
  });
  await page.goto(`${BASE}/en/product/graphite-player`, { waitUntil: "networkidle" });
  if (await versionChips.count()) await versionChips.first().click();
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.waitForTimeout(200);
  const reconfirmed = await page.locator(".product-panel").innerText();
  assert.ok(!/Request this jersey/i.test(reconfirmed), "a fresh check restores the normal order flow");

  // and a stale check must not resurrect an unavailable size
  await patchProduct(page, BASE, "graphite-player", {
    availability: { status: "available", lastCheckedAt: new Date(Date.now() - DAY).toISOString() },
    sizeAvailability: { "*:L": { status: "unavailable" } },
  });
  await page.goto(`${BASE}/en/product/graphite-player`, { waitUntil: "networkidle" });
  const l = page.locator("fieldset .chip", { hasText: /^L$/ }).first();
  assert.equal(await l.isDisabled(), true, "an unavailable size stays unavailable regardless of freshness");
}

export async function catalog_presence_never_reads_as_live_inventory({ page, BASE }) {
  await patchProduct(page, BASE, "onyx-home", { availability: { status: "confirmation_required" }, sizeAvailability: {} });
  for (const path of ["/en/shop", "/en/product/onyx-home"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const body = await page.locator("main").innerText();
    assert.ok(!/\bin stock\b/i.test(body), `${path} makes no stock claim`);
  }
}

/* ── order workflow ── */

export async function order_creation_rejects_a_stale_confirmation_as_confirmed({ page, BASE }) {
  const DAY = 24 * 60 * 60 * 1000;
  // The owner confirmed this 30 days ago — the record is intact, but the
  // order path must not treat it as a live confirmation.
  await patchProduct(page, BASE, "onyx-home", {
    availability: { status: "available", lastCheckedAt: new Date(Date.now() - 30 * DAY).toISOString() },
    sizeAvailability: {},
  });
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  const versionChips = page.locator("fieldset", { hasText: /version/i }).first().locator(".chip");
  if (await versionChips.count()) await versionChips.first().click();
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Stale Tester");
  await page.fill("#co-email", "stale@example.com");
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  const order = await readOrder(page, orderNumber);
  assert.equal(order.fulfillmentStatus, "awaiting_supplier_confirmation", "a stale confirmation still holds the order");
  assert.equal(order.supplierConfirmation.required, true);

  // the owner's original decision is untouched in storage
  const stored = await page.evaluate(
    ([key]) => JSON.parse(window.localStorage.getItem(key)).products.find((p) => p.slug === "onyx-home").availability,
    [LS_KEY],
  );
  assert.equal(stored.status, "available", "stored decision preserved");
  assert.ok(stored.lastCheckedAt, "original lastCheckedAt preserved");
}

export async function confirmation_required_order_awaits_supplier_confirmation({ page, BASE }) {
  await patchProduct(page, BASE, "onyx-home", {
    availability: { status: "confirmation_required" },
    sizeAvailability: {},
  });
  await page.goto(`${BASE}/en/product/onyx-home`, { waitUntil: "networkidle" });
  const versionChips = page.locator("fieldset", { hasText: /version/i }).first().locator(".chip");
  if (await versionChips.count()) await versionChips.first().click();
  await page.locator("fieldset .chip", { hasText: /^L$/ }).first().click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.fill("#co-name", "Availability Tester");
  await page.fill("#co-email", "avail@example.com");
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  const order = await readOrder(page, orderNumber);
  assert.equal(order.fulfillmentStatus, "awaiting_supplier_confirmation", "order is held for a supplier check");
  assert.equal(order.supplierConfirmation.required, true);
  assert.equal(order.supplierConfirmation.status, "pending");
  assert.ok(order.supplierConfirmation.items.some((i) => i.slug === "onyx-home" && i.size === "L"));
  assert.ok(!["sent_to_supplier", "production_started", "supplier_dispatched"].includes(order.fulfillmentStatus), "nothing is produced yet");

  const confirmation = await page.locator("main").innerText();
  assert.ok(/confirm availability with the supplier before production/i.test(confirmation), "customer told what happens next");

  // tracking shows the hold state, with no supplier identity leaked
  await page.goto(`${BASE}/en/track`, { waitUntil: "networkidle" });
  await page.fill("#tr-number", orderNumber);
  await page.fill("#tr-contact", "avail@example.com");
  await page.getByRole("button", { name: /track/i }).click();
  await page.waitForSelector(".timeline", { timeout: 5000 });
  const tracking = await page.locator("main").innerText();
  assert.ok(/Awaiting supplier confirmation/i.test(tracking), "hold state is visible to the customer");
  assert.ok(!/yunexpress/i.test(tracking) && !/supplier reference/i.test(tracking), "no supplier internals leaked");
}
