/**
 * SEO prerender (spec §31): serves dist/, renders every public route per
 * locale in headless Chromium, and saves the fully-rendered HTML (including
 * per-page meta, hreflang and JSON-LD) as static files. Crawlers get real
 * HTML without executing JS; the SPA hydrates on load for users.
 * Strategy documented in docs/architecture.md §SEO.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./pw.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/ missing — run a build first (vite build or sandbox:build)");
  process.exit(1);
}

const PORT = 4321;
const LOCALES = ["ar", "he", "en"];
const STATIC_PATHS = ["", "/shop", "/size-guide", "/about", "/how-it-works", "/delivery", "/faq", "/reviews", "/contact", "/track", "/policies/returns", "/policies/privacy", "/policies/terms", "/accessibility"];
const CATEGORY_SLUGS = ["retro", "current-season", "national-teams", "player-version", "fan-version", "long-sleeve", "hoodies", "kids"];

const seedSlugs = async () => {
  const out = spawn(process.execPath, ["--experimental-strip-types", "-e", `import("./src/services/demo/seed-data.ts").then(m=>console.log(m.demoProducts.filter(p=>!["draft","archived"].includes(p.status)).map(p=>p.slug).join(",")))`], { cwd: root });
  let buf = "";
  out.stdout.on("data", (d) => (buf += d));
  await new Promise((r) => out.on("close", r));
  return buf.trim().split(",").filter(Boolean);
};

const products = await seedSlugs();
const paths = [...STATIC_PATHS, ...CATEGORY_SLUGS.map((c) => `/category/${c}`), ...products.map((s) => `/product/${s}`)];

const server = spawn("node", [join(root, "scripts", "serve.mjs"), dist, String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let count = 0;
for (const locale of LOCALES) {
  for (const path of paths) {
    const url = `http://localhost:${PORT}/${locale}${path}`;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(150);
      const html = await page.content();
      const outDir = join(dist, locale, ...path.split("/").filter(Boolean));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "index.html"), `<!doctype html>\n${html.replace(/^<!doctype html>\s*/i, "")}`);
      count++;
    } catch (err) {
      console.error(`prerender FAILED ${url}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

await browser.close();
server.kill();
console.log(`prerendered ${count}/${paths.length * LOCALES.length} pages → dist/{ar,he,en}/…`);
