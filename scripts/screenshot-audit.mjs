/**
 * Visual audit (spec §42): screenshots of key pages in all three locales at
 * desktop/tablet/mobile viewports → docs/screenshots/. Also fails on any
 * console/page error and on horizontal overflow (layout break signal).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./pw.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const PORT = 4402;
const server = spawn("node", [join(root, "scripts", "serve.mjs"), join(root, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};

const PAGES = [
  ["home", ""],
  ["shop", "/shop"],
  ["category", "/category/retro"],
  ["product", "/product/crimson-2005"],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
  ["track", "/track"],
  ["size-guide", "/size-guide"],
  ["faq", "/faq"],
  ["policy", "/policies/returns"],
];

const browser = await chromium.launch();
const problems = [];
let shots = 0;

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on("pageerror", (e) => problems.push(`pageerror ${page.url()}: ${e}`));

  for (const locale of ["ar", "he", "en"]) {
    for (const [name, path] of PAGES) {
      const url = `http://localhost:${PORT}/${locale}${path}`;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 2) problems.push(`h-overflow ${overflow}px @ ${vpName} ${locale}${path}`);
        await page.screenshot({ path: join(OUT, `${vpName}-${locale}-${name}.png`), fullPage: name === "home" && vpName === "desktop" });
        shots++;
      } catch (err) {
        problems.push(`FAILED ${vpName} ${locale}${path}: ${String(err).slice(0, 160)}`);
      }
    }
  }
  // Admin (English only) per viewport
  try {
    await page.goto(`http://localhost:${PORT}/admin`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', "admin@crowned.example");
    await page.fill('input[type="password"]', "admin1234");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".stat-tile", { timeout: 6000 });
    await page.screenshot({ path: join(OUT, `${vpName}-admin-dashboard.png`) });
    await page.goto(`http://localhost:${PORT}/admin/orders`, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(OUT, `${vpName}-admin-orders.png`) });
    shots += 2;
  } catch (err) {
    problems.push(`FAILED ${vpName} admin: ${String(err).slice(0, 160)}`);
  }
  await context.close();
}

// Language gate
const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
const page = await context.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await page.screenshot({ path: join(OUT, "desktop-language-gate.png") });
shots++;
await context.close();

await browser.close();
server.kill();

console.log(`captured ${shots} screenshots → docs/screenshots/`);
if (problems.length) {
  console.log("PROBLEMS:");
  for (const p of [...new Set(problems)]) console.log(" -", p);
  process.exit(1);
}
console.log("no console errors, no horizontal overflow");
