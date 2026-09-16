/**
 * Password recovery, end to end in the browser: route availability in all
 * three locales, the localized copy, the request behaviour, the two password
 * validation failures, the success path, and — the one that matters most —
 * that the request form's response is byte-identical whatever address is
 * entered, so it cannot be used to discover which emails have accounts.
 */
import assert from "node:assert/strict";

const LOCALES = ["ar", "he", "en"];
const DIR = { ar: "rtl", he: "rtl", en: "ltr" };

/* ── 1 · route availability ─────────────────────────────────────────────── */

export async function forgot_and_reset_routes_exist_in_every_locale({ page, BASE }) {
  for (const locale of LOCALES) {
    for (const path of ["forgot-password", "reset-password"]) {
      await page.goto(`${BASE}/${locale}/${path}`, { waitUntil: "networkidle" });
      const text = await page.locator("main").innerText();
      assert.ok(!text.includes("404"), `/${locale}/${path} is a real route, not a 404`);
      assert.equal(await page.evaluate(() => document.documentElement.lang), locale, `/${locale}/${path} lang`);
      assert.equal(await page.evaluate(() => document.documentElement.dir), DIR[locale], `/${locale}/${path} direction`);
    }
  }
}

export async function login_page_links_to_forgot_password_in_every_locale({ page, BASE }) {
  for (const locale of LOCALES) {
    await page.goto(`${BASE}/${locale}/login`, { waitUntil: "networkidle" });
    const link = page.locator(`a[href="/${locale}/forgot-password"]`);
    assert.equal(await link.count(), 1, `${locale} login page has exactly one forgot-password link`);
    assert.ok((await link.innerText()).trim().length > 0, `${locale} forgot link has visible text`);
    await link.click();
    await page.waitForURL(`**/${locale}/forgot-password`, { timeout: 5000 });
    assert.equal(await page.locator('main input[type="email"]').count(), 1, `${locale} forgot page has an email field`);
  }
}

/* ── 2 · localized copy (no mixed-language pages) ───────────────────────── */

const SCRIPT = { ar: /[؀-ۿ]/, he: /[֐-׿]/, en: /[A-Za-z]/ };

export async function forgot_and_reset_copy_is_localized({ page, BASE }) {
  for (const locale of LOCALES) {
    for (const path of ["forgot-password", "reset-password"]) {
      await page.goto(`${BASE}/${locale}/${path}`, { waitUntil: "networkidle" });
      const heading = (await page.locator("main h1").innerText()).trim();
      assert.ok(SCRIPT[locale].test(heading), `/${locale}/${path} heading is in the ${locale} script: "${heading}"`);
      if (locale !== "en") {
        assert.ok(!/[A-Za-z]{4,}/.test(heading), `/${locale}/${path} heading has no English words: "${heading}"`);
      }
    }
  }
}

export async function the_three_locales_show_three_different_headings({ page, BASE }) {
  const headings = [];
  for (const locale of LOCALES) {
    await page.goto(`${BASE}/${locale}/forgot-password`, { waitUntil: "networkidle" });
    headings.push((await page.locator("main h1").innerText()).trim());
  }
  assert.equal(new Set(headings).size, 3, `ar/he/en headings are distinct: ${JSON.stringify(headings)}`);
}

/* ── 3 · reset request behaviour ────────────────────────────────────────── */

export async function an_invalid_email_is_rejected_client_side_without_a_request({ page, BASE }) {
  await page.goto(`${BASE}/en/forgot-password`, { waitUntil: "networkidle" });
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.fill('main input[type="email"]', "not-an-email");
  await page.click('main button[type="submit"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('main [role="alert"]').count(), 1, "a validation error is shown");
  assert.equal(await page.locator('[data-testid="forgot-sent"]').count(), 0, "the success panel is NOT shown");
  assert.ok(!requests.some((u) => /recover|auth\/v1/.test(u)), "no auth request was made for a malformed address");
}

export async function a_valid_email_shows_the_generic_success_panel({ page, BASE }) {
  await page.goto(`${BASE}/en/forgot-password`, { waitUntil: "networkidle" });
  await page.fill('main input[type="email"]', "someone@example.com");
  await page.click('main button[type="submit"]');
  await page.waitForSelector('[data-testid="forgot-sent"]', { timeout: 5000 });
  const text = await page.locator('[data-testid="forgot-sent"]').innerText();
  assert.ok(/if an account exists/i.test(text), `the message is conditional, not a confirmation: "${text}"`);
  assert.equal(await page.locator('[data-testid="forgot-sent"] a[href="/en/login"]').count(), 1, "a way back to login is offered");
}

/* ── 4 · no account-existence disclosure ────────────────────────────────── */

export async function the_response_is_identical_for_known_and_unknown_addresses({ page, BASE }) {
  // customer@crowned.example is a seeded demo account; the other is not.
  const seen = [];
  for (const email of ["customer@crowned.example", "definitely-not-a-user-9f3a@example.com"]) {
    await page.goto(`${BASE}/en/forgot-password`, { waitUntil: "networkidle" });
    await page.fill('main input[type="email"]', email);
    const started = Date.now();
    await page.click('main button[type="submit"]');
    await page.waitForSelector('[data-testid="forgot-sent"]', { timeout: 5000 });
    seen.push({
      text: (await page.locator("main").innerText()).trim(),
      url: new URL(page.url()).pathname,
      ms: Date.now() - started,
    });
  }
  const [known, unknown] = seen;
  assert.equal(known.text, unknown.text, "the page text is identical for a seeded account and an unknown address");
  assert.equal(known.url, unknown.url, "the resulting URL is identical");
  // A large, consistent timing gap would itself be an oracle.
  assert.ok(Math.abs(known.ms - unknown.ms) < 1500, `response timing is comparable (${known.ms}ms vs ${unknown.ms}ms)`);
}

export async function no_page_text_ever_names_an_account_as_found_or_missing({ page, BASE }) {
  for (const email of ["customer@crowned.example", "nobody-here@example.com"]) {
    await page.goto(`${BASE}/en/forgot-password`, { waitUntil: "networkidle" });
    await page.fill('main input[type="email"]', email);
    await page.click('main button[type="submit"]');
    await page.waitForSelector('[data-testid="forgot-sent"]', { timeout: 5000 });
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const leak of ["no account", "not found", "doesn't exist", "does not exist", "unknown email", "no user"]) {
      assert.ok(!text.includes(leak), `"${leak}" must never appear (tried ${email})`);
    }
  }
}

/* ── 5 · password validation ────────────────────────────────────────────── */

export async function mismatched_passwords_are_rejected({ page, BASE }) {
  await page.goto(`${BASE}/en/reset-password`, { waitUntil: "networkidle" });
  await page.fill("#rp-pass", "averysafepassword1");
  await page.fill("#rp-confirm", "averysafepassword2");
  await page.click('main button[type="submit"]');
  await page.waitForTimeout(300);
  const alert = await page.locator('main [role="alert"]').innerText();
  assert.ok(/do not match/i.test(alert), `mismatch is named explicitly: "${alert}"`);
  assert.equal(await page.locator('[data-testid="reset-success"]').count(), 0, "no success state on mismatch");
}

export async function a_too_short_password_is_rejected_with_the_registration_rule({ page, BASE }) {
  await page.goto(`${BASE}/en/reset-password`, { waitUntil: "networkidle" });
  await page.fill("#rp-pass", "short1");
  await page.fill("#rp-confirm", "short1");
  await page.click('main button[type="submit"]');
  await page.waitForTimeout(300);
  const alert = await page.locator('main [role="alert"]').innerText();
  assert.ok(/8 characters/i.test(alert), `the 8-character minimum is stated: "${alert}"`);
  assert.equal(await page.locator('[data-testid="reset-success"]').count(), 0, "no success state on a short password");
}

/* ── 6 · successful update path ─────────────────────────────────────────── */

export async function a_valid_new_password_reaches_the_success_state_and_offers_login({ page, BASE }) {
  await page.goto(`${BASE}/en/reset-password`, { waitUntil: "networkidle" });
  await page.fill("#rp-pass", "a-brand-new-password-1");
  await page.fill("#rp-confirm", "a-brand-new-password-1");
  await page.click('main button[type="submit"]');
  await page.waitForSelector('[data-testid="reset-success"]', { timeout: 5000 });
  const panel = page.locator('[data-testid="reset-success"]');
  assert.ok(/updated/i.test(await panel.innerText()), "success is stated clearly");
  const loginLink = panel.locator('a[href="/en/login"]');
  assert.equal(await loginLink.count(), 1, "the success state links to login");
  await loginLink.click();
  await page.waitForURL("**/en/login", { timeout: 5000 });
  assert.equal(await page.locator('main input[type="password"]').count(), 1, "we land on the real login form");
}

export async function the_success_state_hides_the_password_form({ page, BASE }) {
  await page.goto(`${BASE}/ar/reset-password`, { waitUntil: "networkidle" });
  await page.fill("#rp-pass", "a-brand-new-password-1");
  await page.fill("#rp-confirm", "a-brand-new-password-1");
  await page.click('main button[type="submit"]');
  await page.waitForSelector('[data-testid="reset-success"]', { timeout: 5000 });
  assert.equal(await page.locator("#rp-pass").count(), 0, "the password fields are gone once the reset succeeded");
}

/* ── 7 · the token never lingers in the URL ─────────────────────────────── */

export async function a_recovery_fragment_is_wiped_from_the_address_bar({ page, BASE }) {
  await page.goto(`${BASE}/en/reset-password#access_token=fake.fake.fake&refresh_token=fake&expires_in=3600&type=recovery`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(400);
  const hash = await page.evaluate(() => window.location.hash);
  assert.equal(hash, "", "the recovery tokens are removed from the URL after they are read");
  const html = await page.content();
  assert.ok(!html.includes("fake.fake.fake"), "the access token is not rendered anywhere on the page");
}
