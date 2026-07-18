/**
 * E2E runner: builds the app, serves dist/, and runs every spec in this
 * directory against a real Chromium (spec §37/§42). Zero external deps
 * beyond the preinstalled Playwright.
 *
 * Usage: node tests/e2e/run-e2e.mjs [--skip-build] [filter]
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "../../scripts/pw.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const PORT = 4310;
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const filter = args.find((a) => !a.startsWith("--"));

if (!skipBuild) {
  const build = spawnSync("node", [join(root, "scripts", "sandbox-build.mjs")], { stdio: "inherit", cwd: root });
  if (build.status !== 0) process.exit(1);
}

const server = spawn("node", [join(root, "scripts", "serve.mjs"), join(root, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch();
let passed = 0;
let failed = 0;
const failures = [];

async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  return { page, context, pageErrors };
}

const specFiles = readdirSync(here)
  .filter((f) => f.endsWith(".e2e.mjs") && (!filter || f.includes(filter)))
  .sort();

for (const file of specFiles) {
  const mod = await import(pathToFileURL(join(here, file)).href);
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    const label = `${file} › ${name}`;
    const { page, context, pageErrors } = await newPage();
    try {
      await fn({ page, BASE, newPage });
      if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ").slice(0, 300)}`);
      passed++;
      console.log(`✓ ${label}`);
    } catch (err) {
      failed++;
      failures.push({ label, err: String(err).slice(0, 500) });
      console.log(`✗ ${label}\n   ${String(err).slice(0, 300)}`);
      try {
        await page.screenshot({ path: `/tmp/e2e-fail-${failed}.png` });
      } catch {
        /* ignore */
      }
    } finally {
      await context.close();
    }
  }
}

await browser.close();
server.kill();

console.log(`\nE2E: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f.label}: ${f.err.slice(0, 160)}`);
  process.exit(1);
}
