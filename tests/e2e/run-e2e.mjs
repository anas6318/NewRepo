/**
 * E2E runner: builds the app, serves dist/, and runs every spec in this
 * directory against a real Chromium (spec §37/§42). Zero external deps
 * beyond the preinstalled Playwright.
 *
 * Usage: node tests/e2e/run-e2e.mjs [--skip-build] [filter]
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
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
  // process.execPath, not "node": on Windows a bare "node" can fail to spawn,
  // and the failure used to exit silently with no output at all.
  const build = spawnSync(process.execPath, [join(root, "scripts", "sandbox-build.mjs")], { stdio: "inherit", cwd: root });
  if (build.error) {
    console.error(`Could not start the sandbox build: ${build.error.message}`);
    process.exit(1);
  }
  if (build.status !== 0) {
    console.error(`Sandbox build failed (exit ${build.status}). No specs were run.`);
    process.exit(1);
  }
}

const server = spawn(process.execPath, [join(root, "scripts", "serve.mjs"), join(root, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  server.kill();
  console.error(
    `Could not launch Chromium: ${String(err).slice(0, 300)}\n` +
      "Playwright's browser binary is not installed. Run:\n  npx playwright install chromium",
  );
  process.exit(1);
}
let passed = 0;
let failed = 0;
const failures = [];

async function newPage(viewport = { width: 1280, height: 900 }, contextOptions = {}) {
  // Extra context options let a spec ask for a real touch device (hasTouch /
  // isMobile), which is how hover-capability behaviour is exercised.
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  return { page, context, pageErrors };
}

const specFiles = readdirSync(here)
  .filter((f) => f.endsWith(".e2e.mjs") && (!filter || f.includes(filter)))
  .sort();

if (specFiles.length === 0) {
  console.error(filter ? `No spec files matched "${filter}".` : "No spec files found.");
  await browser.close();
  server.kill();
  process.exit(1);
}

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
        await page.screenshot({ path: join(tmpdir(), `e2e-fail-${failed}.png`) });
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
