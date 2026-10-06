/**
 * Cart/checkout client hardening (A1-B1..B6): re-add price refresh, the
 * shared quantity cap, malformed-storage recovery, double-submit
 * protection, stale-line flagging, Fan 4XL opt-in vs. Player never
 * offering it, and the Retro ₪169 → ₪149 sale display.
 */
import assert from "node:assert/strict";

const LS_KEY = "crowned_demo_db_v1";
const CART_KEY = "crowned_cart_v1";

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

async function addToCart(page, BASE, slug, { size = "L" } = {}) {
  await page.goto(`${BASE}/en/product/${slug}`, { waitUntil: "networkidle" });
  const sizeChip = page.locator(".chip", { hasText: new RegExp(`^${size}$`) }).first();
  if (await sizeChip.count()) await sizeChip.click();
  await page.getByText(/checked the size chart|size chart before/i).first().click();
  await page.getByRole("button", { name: /Add to Cart/i }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

async function fillCheckout(page, email) {
  await page.fill("#co-name", "Hardening Tester");
  await page.fill("#co-email", email);
  await page.fill("#co-phone", "0501234567");
  await page.selectOption("#co-zone", "center");
  await page.fill("#co-city", "Haifa");
  await page.fill("#co-address", "Test street 1");
  await page.locator(".pay-option input").first().check();
  await page.locator(".check", { hasText: /policy/i }).first().click();
}

/* ── A1-B1: re-add refreshes price ──────────────────────────────────────── */

export async function re_adding_an_identical_configuration_refreshes_the_price({ page, BASE }) {
  await addToCart(page, BASE, "crimson-2005");

  // A sale starts on crimson-2005 between the first and second add.
  await patchProduct(page, BASE, "crimson-2005", {
    sale: { enabled: true, type: "fixed_price", salePriceIls: 149, startsAt: new Date(Date.now() - 60_000).toISOString() },
  });

  await addToCart(page, BASE, "crimson-2005");

  const lines = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? "[]"), CART_KEY);
  assert.equal(lines.length, 1, "re-adding the identical configuration merges into one line, not two");
  assert.equal(lines[0].quantity, 2, "quantity is additive");
  assert.equal(lines[0].unitPriceIls, 149, "the price is refreshed from the second add, not left at the stale ₪169");
}

/* ── A1-B2/A1-B3: quantity cap + minus disabled at 1 ────────────────────── */

export async function cart_plus_button_stops_at_the_shared_max({ page, BASE }) {
  await addToCart(page, BASE, "royal-1998");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  const plus = page.locator(".qty button[aria-label='+']").first();
  for (let i = 0; i < 12; i++) {
    if (await plus.isDisabled()) break;
    await plus.click();
    await page.waitForTimeout(60);
  }
  const qty = await page.locator(".qty span").first().textContent();
  assert.equal(qty?.trim(), "10", "quantity stops at MAX_LINE_QUANTITY");
  assert.equal(await plus.isDisabled(), true, "+ is disabled at the cap");
}

export async function cart_minus_button_is_disabled_at_quantity_one({ page, BASE }) {
  await addToCart(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  const minus = page.locator(".qty button[aria-label='−']").first();
  assert.equal(await minus.isDisabled(), true, "− is disabled at quantity 1 — removal is only via the trash icon");
  assert.equal(await page.locator(".cart-line").count(), 1, "the line is still present");
  await page.locator(".cart-line__remove").first().click();
  assert.equal(await page.locator(".cart-line").count(), 0, "the explicit remove control still works");
}

/* ── A1-B4: malformed/stale localStorage recovery ───────────────────────── */

export async function malformed_cart_storage_drops_bad_lines_without_nan({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  await page.evaluate((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          key: "ok|||L||",
          productId: "demo-crimson-2005",
          slug: "crimson-2005",
          title: { ar: "أ", he: "א", en: "Demo — Crimson Home, 2005 Era" },
          image: "/demo/p-crimson-2005.webp",
          size: "L",
          quantity: 1,
          unitPriceIls: 169,
          qualifiesForFreeDelivery: true,
          isDemo: true,
        },
        { key: "missing-fields", productId: "demo-crimson-2005" },
        {
          key: "nan-price|||M||",
          productId: "demo-crimson-2005",
          slug: "crimson-2005",
          title: { ar: "أ", he: "א", en: "Bad" },
          image: "/demo/p-crimson-2005.webp",
          size: "M",
          quantity: 1,
          unitPriceIls: "not-a-number",
          qualifiesForFreeDelivery: true,
          isDemo: true,
        },
      ]),
    );
  }, CART_KEY);
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".cart-line").count(), 1, "only the well-formed line survives");
  const text = (await page.locator("main").textContent()) ?? "";
  assert.doesNotMatch(text, /NaN/, "never renders ₪NaN");
}

export async function garbage_json_cart_storage_is_treated_as_an_empty_cart({ page, BASE }) {
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  await page.evaluate((key) => window.localStorage.setItem(key, "not json at all{"), CART_KEY);
  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".empty-state").count(), 1, "garbage JSON degrades to an empty cart, not a crash");
}

/* ── A1-B5: double-submit protection ─────────────────────────────────────── */

export async function rapid_double_click_creates_exactly_one_order({ page, BASE }) {
  await addToCart(page, BASE, "crimson-2005");
  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  const email = `double-click-${Date.now()}@example.com`;
  await fillCheckout(page, email);

  // Two synchronous native clicks in the same tick — the closest a script
  // can get to a real rapid double-click/double-Enter.
  await page.evaluate(() => {
    const btn = document.querySelector("form button[type=submit]");
    btn.click();
    btn.click();
  });
  await page.waitForURL(/confirmation\/CR-/, { timeout: 8000 });

  const orders = await page.evaluate(
    ([key, e]) => JSON.parse(window.localStorage.getItem(key)).orders.filter((o) => o.customer.email === e),
    [LS_KEY, email],
  );
  assert.equal(orders.length, 1, "exactly one order was created from the double-click");
}

/* ── A1-B6: stale cart line flagged and blocks submit ────────────────────── */

export async function a_removed_product_flags_its_cart_line_and_blocks_checkout({ page, BASE }) {
  await addToCart(page, BASE, "crimson-2005");
  // The product is discontinued after being added to the cart.
  await patchProduct(page, BASE, "crimson-2005", { status: "archived" });

  await page.goto(`${BASE}/en/cart`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  assert.ok(await page.getByText(/changed since you added it/i).first().isVisible(), "the cart flags the stale line");

  await page.goto(`${BASE}/en/checkout`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await fillCheckout(page, `stale-${Date.now()}@example.com`);
  await page.getByRole("button", { name: /Place order/i }).click();
  await page.waitForTimeout(400);
  assert.ok(page.url().includes("/checkout"), "submission is blocked — never reaches confirmation");
  assert.ok(await page.locator(".error-summary").isVisible(), "a clear localized error is shown");
}

/* ── Fan 4XL opt-in vs. Player never offering it ─────────────────────────── */

export async function fan_offers_4xl_and_player_never_does({ page, BASE }) {
  await page.goto(`${BASE}/en/product/classic-white-fan`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".chip", { hasText: /^4XL$/ }).count(), 1, "4XL is opted in on this Fan product");

  await page.goto(`${BASE}/en/product/graphite-player`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".chip", { hasText: /^4XL$/ }).count(), 0, "Player never offers 4XL");
  assert.equal(await page.locator(".chip", { hasText: /^2XL$/ }).count(), 1, "Player still stops at 2XL");
}

/* ── Retro ₪169 regular, ₪149 active retro-only sale ─────────────────────── */

export async function retro_169_sale_shows_the_149_retro_sale({ page, BASE }) {
  await page.goto(`${BASE}/en/product/royal-1998`, { waitUntil: "networkidle" });
  const price = (await page.locator(".product-price").first().textContent()) ?? "";
  assert.match(price, /149/, "the active retro sale price");
  assert.match(price, /169/, "beside the real regular price");
  const panel = (await page.locator(".product-panel").textContent()) ?? "";
  assert.match(panel, /Retro sale/i, "the retro-only sale is named");
}
