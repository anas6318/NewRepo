/**
 * Sandbox build pipeline — produces dist/ from the same src/ + index.html
 * that Vite consumes, using a locally available esbuild binary. Exists so the
 * app can be compiled, served, tested and screenshotted inside the
 * network-restricted build environment (no npm registry access).
 *
 * On a normal machine prefer `npm run build` (Vite). Both pipelines emit the
 * same SPA shape: dist/index.html + dist/assets/app.js + dist/assets/app.css.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ESBUILD_CANDIDATES = [
  join(root, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild"),
  join(root, "node_modules", ".bin", "esbuild"),
  "/home/claude/.npm-global/lib/node_modules/tsx/node_modules/@esbuild/linux-x64/bin/esbuild",
];
const GLOBAL_NODE_MODULES = "/home/claude/.npm-global/lib/node_modules";

const esbuild = ESBUILD_CANDIDATES.find((p) => existsSync(p));
if (!esbuild) {
  console.error("No esbuild binary found. On a normal machine run `npm install` and use `npm run build` (Vite) instead.");
  process.exit(1);
}

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const args = [
  join(root, "src", "main.tsx"),
  "--bundle",
  `--outdir=${join(dist, "assets")}`,
  "--entry-names=app",
  "--format=esm",
  "--target=es2020",
  "--jsx=automatic",
  "--minify",
  "--sourcemap",
  "--loader:.json=json",
  "--log-level=warning",
];

const env = { ...process.env };
if (existsSync(GLOBAL_NODE_MODULES) && !existsSync(join(root, "node_modules", "react"))) {
  env.NODE_PATH = GLOBAL_NODE_MODULES;
}

const started = Date.now();
const result = spawnSync(esbuild, args, { stdio: "inherit", env, cwd: root });
if (result.status !== 0) process.exit(result.status ?? 1);

// Static assets
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), dist, { recursive: true });
}

// index.html — rewrite the Vite module entry to the bundled assets.
let html = readFileSync(join(root, "index.html"), "utf8");
html = html.replace(
  /<script type="module" src="\/src\/main\.tsx"><\/script>/,
  '<link rel="stylesheet" href="/assets/app.css" />\n    <script type="module" src="/assets/app.js"></script>',
);
writeFileSync(join(dist, "index.html"), html);

console.log(`sandbox build OK in ${Date.now() - started}ms → dist/`);
