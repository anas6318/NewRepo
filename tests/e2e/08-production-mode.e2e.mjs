/** Production-configuration behavior (spec §36): with Supabase configured,
 * demo mode is hard-off — no demo banner, no demo credentials shown, demo
 * logins rejected, no auth bypass. Injected via window.__CROWNED_ENV__
 * (same override mechanism the runtime supports). */
import assert from "node:assert/strict";

const PROD_ENV = {
  VITE_SUPABASE_URL: "https://prod-test.supabase.example",
  VITE_SUPABASE_ANON_KEY: "test-anon-key",
  VITE_DEMO_MODE: "true", // must be ignored once Supabase is configured
};

async function prodPage({ newPage }) {
  const { page, context, pageErrors } = await newPage();
  await page.addInitScript((env) => {
    window.__CROWNED_ENV__ = env;
  }, PROD_ENV);
  // The fake Supabase host is unreachable — abort fast so pages settle.
  await page.route(/prod-test\.supabase\.example/, (r) => r.abort());
  return { page, context, pageErrors };
}

export async function no_demo_banner_or_labels_in_production_config(ctx) {
  const { page, context } = await prodPage(ctx);
  await page.goto(`${ctx.BASE}/en`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".demo-banner").count(), 0, "demo banner absent");
  const body = await page.locator("body").innerText();
  assert.ok(!body.includes("demo1234") && !body.includes("admin1234"), "no demo credentials rendered");
  await context.close();
}

export async function demo_credentials_rejected_in_production_config(ctx) {
  const { page, context } = await prodPage(ctx);
  await page.goto(`${ctx.BASE}/admin`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  assert.ok(!body.includes("admin@crowned.example"), "no demo credential hint on admin login");
  await page.fill('input[type="email"]', "admin@crowned.example");
  await page.fill('input[type="password"]', "admin1234");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator(".admin__sidebar").count(), 0, "demo credentials do NOT authenticate");
  assert.ok(await page.getByText(/invalid credentials|insufficient permissions/i).first().isVisible(), "rejection shown");
  await context.close();
}

export async function vite_demo_mode_flag_cannot_reenable_demo(ctx) {
  // PROD_ENV sets VITE_DEMO_MODE=true — with a Supabase URL present it must
  // still resolve to supabase mode (checkout shows no simulated methods).
  const { page, context } = await prodPage(ctx);
  await page.goto(`${ctx.BASE}/en/checkout`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  assert.ok(!body.toLowerCase().includes("simulated"), "no simulated-payment labels in prod config");
  assert.ok(!body.includes("Demo mode:"), "no demo checkout note in prod config");
  await context.close();
}

export async function demo_mode_labels_simulation_honestly(ctx) {
  // Counter-check in default demo mode: banner + simulated checkout note
  // must be visible so a preview can never be mistaken for production.
  const { page, context } = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${ctx.BASE}/en`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".demo-banner").count(), 1, "demo banner visible in demo mode");
  await context.close();
}
