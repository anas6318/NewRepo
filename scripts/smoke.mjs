/** Quick pipeline smoke: serve dist/, open pages, report console errors. */
import { spawn } from "node:child_process";
import { chromium } from "./pw.mjs";

const PORT = 4199;
const server = spawn("node", ["scripts/serve.mjs", "dist", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// External font CDN is unreachable inside the sandbox — block it so its
// network failure doesn't mask real application errors.
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
const errors = [];
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const url = msg.location()?.url ?? "";
  if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return; // blocked by design in sandbox
  errors.push(`${msg.text()} [${url}]`);
});
page.on("pageerror", (err) => errors.push(String(err)));

const targets = process.argv.slice(2);
const urls = targets.length ? targets : ["/", "/ar", "/he", "/en", "/en/shop"];
for (const u of urls) {
  await page.goto(`http://localhost:${PORT}${u}`, { waitUntil: "networkidle" }).catch((e) => errors.push(`${u}: ${e.message}`));
  await page.waitForTimeout(250);
  const title = await page.title();
  const h1 = await page.locator("h1").first().textContent().catch(() => "(no h1)");
  const dir = await page.evaluate(() => document.documentElement.dir);
  console.log(`${u}  → dir=${dir}  h1=${(h1 ?? "").trim().slice(0, 60)}  title=${title.slice(0, 40)}`);
}
await page.screenshot({ path: "/tmp/smoke.png", fullPage: false });
await browser.close();
server.kill();

if (errors.length) {
  console.log("\nCONSOLE/PAGE ERRORS:");
  for (const e of [...new Set(errors)]) console.log(" -", e.slice(0, 300));
  process.exit(1);
}
console.log("\nSMOKE OK — no console errors");
