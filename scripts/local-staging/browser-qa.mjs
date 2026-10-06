/**
 * Local browser QA — ONE scenario, ONE locale, ONE viewport, ONE chromium.
 *
 *   node scripts/local-staging/browser-qa.mjs <checkout|tracking|account|admin> <en|ar|he> <1440|390>
 *
 * Serves .claude/local-staging/dist (built by `npm run local:build`) on
 * http://127.0.0.1:4310 against the LOCAL Supabase stack only. Every browser
 * request is routed: a hostname other than 127.0.0.1/localhost is ABORTED and
 * recorded; a hosted-Supabase host (or a non-local host on /rest/v1,
 * /auth/v1, /functions/v1) fails the run. Results go to
 * test-results/local-qa/<scenario>-<locale>-<viewport>.{json,png}. Keys,
 * passwords and tokens are never written (output is scrubbed as well).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "../pw.mjs";
import { guardLocal, isForbiddenRemoteHostname, isLocalHostname, REPO_ROOT } from "./guard.mjs";
import { PRICES, ZONE_ID, ZONE_PRICE_ILS, SENTINEL_PREFIX } from "./fixtures.mjs";
import { client, customer, line, orderBody, seededUsers } from "../../tests/integration/local-supabase/helpers.mjs";

const [scenario, locale, viewportArg] = process.argv.slice(2);
const SCENARIOS = ["checkout", "tracking", "account", "admin"];
if (!SCENARIOS.includes(scenario) || !["en", "ar", "he"].includes(locale) || !["1440", "390"].includes(viewportArg)) {
  console.error("usage: browser-qa.mjs <checkout|tracking|account|admin> <en|ar|he> <1440|390>");
  process.exit(2);
}

const stack = guardLocal();
const c = client(stack);
const PORT = 4310;
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = join(REPO_ROOT, ".claude", "local-staging", "dist");
const OUT = join(REPO_ROOT, "test-results", "local-qa");
const tag = `${scenario}-${locale}-${viewportArg}`;
const viewport = viewportArg === "1440" ? { width: 1440, height: 900 } : { width: 390, height: 844 };
mkdirSync(OUT, { recursive: true });

const scrub = (s) =>
  String(s)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    .replace(/sb_(secret|publishable)_\w+/g, "[key]")
    .slice(0, 400);

const result = {
  scenario,
  locale,
  viewport: viewportArg,
  steps: [],
  hosts: {},
  abortedHosts: {},
  hostedSupabaseAttempts: 0,
  consoleErrors: [],
  warnings: [],
  pass: false,
};
const NETWORK_PATHS = /\/(rest|auth)\/v1|\/functions\/v1/;

function recordRequest(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "allow";
  }
  if (!/^https?:$/.test(u.protocol)) {
    // data:/blob:/about: carry no hostname; anything else naming a non-local host fails the run.
    if (u.hostname && !isLocalHostname(u.hostname)) {
      result.nonHttpRemoteRequests = (result.nonHttpRemoteRequests ?? 0) + 1;
      result.abortedHosts[u.hostname] = (result.abortedHosts[u.hostname] ?? 0) + 1;
      return "abort";
    }
    return "allow";
  }
  const host = u.hostname;
  result.hosts[host] = (result.hosts[host] ?? 0) + 1;
  if (isLocalHostname(host)) return "allow";
  result.abortedHosts[host] = (result.abortedHosts[host] ?? 0) + 1;
  if (isForbiddenRemoteHostname(host) || NETWORK_PATHS.test(u.pathname)) result.hostedSupabaseAttempts++;
  return "abort";
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    result.steps.push({ name, pass: true, ms: Date.now() - started, ...(detail ? { detail: scrub(detail) } : {}) });
  } catch (err) {
    result.steps.push({ name, pass: false, ms: Date.now() - started, error: scrub(err?.message ?? err) });
    throw err;
  }
}
function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* -- fixtures through the real API (in-process credentials, never printed) -- */

async function placeOrder(cust, token) {
  const r = await c.fn("place-order", orderBody([line("it-retro-regular")], { customer: cust }), token ? { token } : {});
  check(r.status === 200, `place-order HTTP ${r.status}`);
  const orderNumber = r.json?.orderNumber ?? r.json?.order?.orderNumber;
  check(typeof orderNumber === "string" && orderNumber.startsWith("CR-"), "place-order returned no order number");
  return orderNumber;
}
async function ordersOf(customerId) {
  const r = await c.svc(`orders?select=order_number&customer_id=eq.${customerId}&order=created_at.desc`);
  check(r.status === 200, `orders lookup HTTP ${r.status}`);
  return r.json.map((o) => o.order_number);
}

/* -- static server + browser ------------------------------------------------ */

const server = spawn(process.execPath, [join(REPO_ROOT, "scripts", "serve.mjs"), DIST, String(PORT)], { stdio: "ignore", windowsHide: true });
let browser;

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error("static server did not start");
}

async function newPage() {
  const context = await browser.newContext({ serviceWorkers: "block", viewport, locale: locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL", baseURL: BASE });
  await context.route("**/*", (route) => {
    if (recordRequest(route.request().url()) === "abort") return route.abort("blockedbyclient");
    return route.continue();
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && result.consoleErrors.push(scrub(m.text())));
  page.on("pageerror", (e) => result.consoleErrors.push(scrub(`pageerror: ${e.message}`)));
  return { context, page };
}

async function layoutChecks(page, { storefront = true } = {}) {
  const info = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
  if (storefront) {
    const want = locale === "en" ? "ltr" : "rtl";
    check(info.dir === want, `html dir is "${info.dir}", expected "${want}"`);
  }
  if (info.overflowX > 1) result.warnings.push(`horizontal overflow ${info.overflowX}px at ${page.url().replace(BASE, "")}`);
  return `dir=${info.dir} lang=${info.lang}`;
}

/* -- scenarios -------------------------------------------------------------- */

async function checkout(page) {
  const email = `it-${tag}-${Date.now().toString(36)}@example.test`;
  await step("product page loads", async () => {
    await page.goto(`/${locale}/product/it-retro-regular`, { waitUntil: "networkidle" });
    await page.locator("#p-name").waitFor({ timeout: 10000 });
    return layoutChecks(page);
  });
  await step("choose size M + name/number personalization + confirmations", async () => {
    await page.locator("button.chip", { hasText: /^M$/ }).first().click();
    await page.fill("#p-name", "RONALDO");
    await page.fill("#p-number", "7");
    const boxes = page.locator("main input[type=checkbox]");
    for (let i = 0; i < (await boxes.count()); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  });
  await step("add to cart", async () => {
    await page.locator("button.btn--dark.btn--block").first().click();
    await sleep(400);
  });
  await step("cart shows the line with personalization", async () => {
    await page.goto(`/${locale}/cart`, { waitUntil: "networkidle" });
    const text = await page.locator("main").innerText();
    check(/RONALDO/i.test(text), "cart line does not show the personalization name");
    await layoutChecks(page);
  });
  await step("checkout as guest", async () => {
    await page.locator('a[href$="/checkout"]').first().click();
    await page.locator("#co-name").waitFor({ timeout: 10000 });
    await page.fill("#co-name", "QA Guest");
    await page.fill("#co-email", email);
    await page.fill("#co-phone", "0500000002");
    await page.selectOption("#co-zone", ZONE_ID);
    await page.fill("#co-city", "Test City");
    await page.fill("#co-address", "2 Test Street");
    await page.locator(".pay-option input").first().check();
    await page.locator(".check input[type=checkbox]").first().check();
    await layoutChecks(page);
    await page.locator('main form button[type="submit"].btn--gold').click();
    await page.waitForURL(/order\/confirmation\/CR-/, { timeout: 20000 });
  });
  const orderNumber = page.url().match(/CR-[A-Z0-9]+/)?.[0] ?? "";
  await step("confirmation shows the order number", async () => {
    check(orderNumber, "no order number in the URL");
    await page.getByText(orderNumber).first().waitFor({ timeout: 10000 });
    return layoutChecks(page);
  });
  await step("order exists in local DB with server-computed total", async () => {
    const r = await c.svc(`orders?select=order_number,total_ils,payment_status,locale,data&order_number=eq.${orderNumber}`);
    check(r.status === 200 && r.json.length === 1, "order row not found");
    const row = r.json[0];
    const total = Number(row.total_ils);
    const expectedTotal = PRICES.retroRegular + ZONE_PRICE_ILS;
    check(total === expectedTotal, `total_ils ${total} is not exactly ${expectedTotal}`);
    check(Number(row.data?.subtotalIls) === PRICES.retroRegular, `subtotalIls ${row.data?.subtotalIls} is not ${PRICES.retroRegular}`);
    check(Number(row.data?.deliveryIls) === ZONE_PRICE_ILS, `deliveryIls ${row.data?.deliveryIls} is not ${ZONE_PRICE_ILS}`);
    check(row.locale === locale, `stored locale "${row.locale}" is not "${locale}"`);
    const items = Array.isArray(row.data?.items) ? row.data.items : [];
    check(items.length === 1, `expected 1 stored line, found ${items.length}`);
    check(items[0]?.personalization?.name === "RONALDO", "stored personalization name is not RONALDO");
    check(items[0]?.personalization?.number === "7", "stored personalization number is not 7");
    return `total_ils=${total} payment=${r.json[0].payment_status}`;
  });
}

async function tracking(page) {
  const cust = customer({ tag: `trk${Date.now().toString(36)}` });
  let orderNumber;
  await step("create guest order through place-order", async () => {
    orderNumber = await placeOrder(cust);
  });
  await step("track page shows status for number + contact", async () => {
    await page.goto(`/${locale}/track`, { waitUntil: "networkidle" });
    await page.fill("#tr-number", orderNumber);
    await page.fill("#tr-contact", cust.email);
    await page.locator('main form button[type="submit"]').click();
    await page.locator(".timeline").waitFor({ timeout: 10000 });
    await layoutChecks(page);
  });
  await step("no internal fields rendered", async () => {
    const html = (await page.content()).toLowerCase();
    for (const bad of [SENTINEL_PREFIX, "contact_hash", "supplier", "idempotency", "internal_notes", "costusd"]) {
      check(!html.includes(bad.toLowerCase()), `tracking page contains "${bad}"`);
    }
  });
  await step("wrong contact reveals nothing", async () => {
    await page.goto(`/${locale}/track`, { waitUntil: "networkidle" });
    await page.fill("#tr-number", orderNumber);
    await page.fill("#tr-contact", "wrong@example.test");
    await page.locator('main form button[type="submit"]').click();
    await sleep(1200);
    check((await page.locator(".timeline").count()) === 0, "timeline shown for a wrong contact");
    await page.locator(".field__error").first().waitFor({ timeout: 5000 });
  });
}

async function uiLogin(page, path, user, selectors) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.fill(selectors.email, user.email);
  await page.fill(selectors.password, user.password);
  await page.locator(selectors.submit).click();
}

async function account(page) {
  const users = seededUsers();
  const A = users.customerA;
  const B = users.customerB;
  let ordersA;
  let ordersB;
  await step("seed one order for A and one for B (if missing)", async () => {
    ordersA = await ordersOf(A.id);
    if (ordersA.length === 0) {
      const sa = await c.signIn("customerA");
      await placeOrder({ ...customer(), email: A.email }, sa.token);
      ordersA = await ordersOf(A.id);
    }
    ordersB = await ordersOf(B.id);
    if (ordersB.length === 0) {
      const sb = await c.signIn("customerB");
      await placeOrder({ ...customer(), email: B.email }, sb.token);
      ordersB = await ordersOf(B.id);
    }
    check(ordersA.length > 0 && ordersB.length > 0, "fixture orders missing");
    return `A=${ordersA.length} B=${ordersB.length}`;
  });
  await step("log in as customer A", async () => {
    await uiLogin(page, `/${locale}/login`, A, { email: "#lg-email", password: "#lg-pass", submit: 'main form button[type="submit"]' });
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 });
  });
  await step("order history lists only A's orders", async () => {
    await page.goto(`/${locale}/account/orders`, { waitUntil: "networkidle" });
    await page.locator('a[href*="/account/orders/CR-"]').first().waitFor({ timeout: 15000 });
    const shown = await page
      .locator('a[href*="/account/orders/CR-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("href").match(/CR-[A-Z0-9]+/)[0]));
    check(shown.length === ordersA.length, `shows ${shown.length} orders, A owns ${ordersA.length}`);
    for (const n of shown) check(ordersA.includes(n), "shows an order not owned by A");
    for (const n of ordersB) check(!shown.includes(n), "shows one of B's orders");
    const body = await page.locator("main").innerText();
    for (const n of ordersB) check(!body.includes(n), "B's order number appears in the page text");
    await layoutChecks(page);
    return `shown=${shown.length}`;
  });
  await step("order detail opens for A's order", async () => {
    await page.locator('a[href*="/account/orders/CR-"]').first().click();
    await page.waitForURL(/account\/orders\/CR-/, { timeout: 10000 });
    await page.locator("main ul li").first().waitFor({ timeout: 10000 });
  });
}

async function adminAs(userKey, label) {
  const users = seededUsers();
  const { context, page } = await newPage();
  try {
    await step(`${label}: sign in to /admin`, async () => {
      await uiLogin(page, "/admin", users[userKey], { email: 'input[type="email"]', password: 'input[type="password"]', submit: 'form button[type="submit"]' });
      await page.locator(".admin__sidebar").waitFor({ timeout: 15000 });
      await layoutChecks(page, { storefront: false });
    });
    await step(`${label}: orders list shows orders`, async () => {
      await page.goto("/admin/orders", { waitUntil: "networkidle" });
      await page.locator("tbody tr").first().waitFor({ timeout: 15000 });
      const rows = await page.locator("tbody tr").count();
      check(rows > 0, "no order rows");
      return `rows=${rows}`;
    });
    await step(`${label}: order detail opens`, async () => {
      await page.locator('a[href*="/admin/orders/CR-"]').first().click();
      await page.waitForURL(/admin\/orders\/CR-/, { timeout: 10000 });
      await page.locator(".timeline li").first().waitFor({ timeout: 15000 });
      await page.screenshot({ path: join(OUT, `${tag}-${label}.png`), fullPage: true });
    });
  } finally {
    await context.close();
  }
}

async function admin() {
  await step("ensure at least one order exists", async () => {
    const r = await c.svc("orders?select=order_number&limit=1");
    check(r.status === 200, `orders lookup HTTP ${r.status}`);
    if (r.json.length === 0) await placeOrder(customer());
  });
  await adminAs("orderManager", "order_manager");
  await adminAs("owner", "owner");
}

/* -- main ------------------------------------------------------------------- */

let page;
let context;
try {
  await waitForServer();
  browser = await chromium.launch();
  if (scenario === "admin") {
    await admin();
    ({ context, page } = await newPage());
    await page.goto("/admin", { waitUntil: "networkidle" });
  } else {
    ({ context, page } = await newPage());
    const run = { checkout, tracking, account }[scenario];
    await run(page);
  }
  result.pass = result.steps.every((s) => s.pass);
} catch (err) {
  result.pass = false;
  result.fatal = scrub(err?.message ?? err);
} finally {
  try {
    if (page) await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: true });
  } catch {
    /* page may be gone */
  }
  try {
    await context?.close();
  } catch {
    /* ignore */
  }
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  server.kill();
  if (result.hostedSupabaseAttempts > 0) {
    result.pass = false;
    result.fatal = `${result.fatal ? result.fatal + "; " : ""}hosted-Supabase request attempted (${result.hostedSupabaseAttempts})`;
  }
  if (result.nonHttpRemoteRequests > 0) {
    result.pass = false;
    result.fatal = `${result.fatal ? result.fatal + "; " : ""}non-http(s) request to a non-local host (${result.nonHttpRemoteRequests})`;
  }
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(result, null, 2));
  console.log(
    `[qa] ${tag}: ${result.pass ? "PASS" : "FAIL"} hosts=${JSON.stringify(result.hosts)} aborted=${JSON.stringify(result.abortedHosts)}${result.fatal ? ` fatal=${result.fatal}` : ""}`,
  );
}
process.exit(result.pass ? 0 : 1);
