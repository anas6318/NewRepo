/**
 * `npm run local:build` — builds the REAL (non-demo) storefront/admin against
 * the LOCAL Supabase stack only.
 *
 * - loadLocalStack() refuses anything that is not provably the local CLI stack.
 * - Writes ONLY four VITE_* values to a git-ignored env dir
 *   (.claude/local-staging/env/.env) and points Vite's `envDir` at it, so the
 *   repo-root .env.local (production config) is never loaded.
 * - Builds into .claude/local-staging/dist and asserts the bundle references
 *   127.0.0.1:54321 and contains no supabase.co / supabase.in string.
 *
 * The local anon key is written to the git-ignored env file and is baked into
 * the (git-ignored) bundle, as for any Vite build; it is never printed.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
import { loadLocalStack, REPO_ROOT } from "./guard.mjs";

const stack = loadLocalStack();
const SITE_URL = "http://127.0.0.1:4310";
const envDir = join(REPO_ROOT, ".claude", "local-staging", "env");
const outDir = join(REPO_ROOT, ".claude", "local-staging", "dist");

mkdirSync(envDir, { recursive: true });
writeFileSync(
  join(envDir, ".env"),
  [
    `VITE_SUPABASE_URL=${stack.apiUrl}`,
    `VITE_SUPABASE_ANON_KEY=${stack.anonKey}`,
    `VITE_SITE_URL=${SITE_URL}`,
    "VITE_DEMO_MODE=false",
    "",
  ].join("\n"),
);

// Shell-provided VITE_* values would override the env file; refuse them.
for (const k of Object.keys(process.env)) {
  if (k.startsWith("VITE_")) throw new Error(`refusing to build: ${k} is set in the shell environment`);
}

await build({
  root: REPO_ROOT,
  configFile: join(REPO_ROOT, "vite.config.ts"),
  envDir,
  logLevel: "warn",
  build: { outDir, emptyOutDir: true },
});

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let sawLocal = false;
const bad = [];
for (const file of walk(outDir)) {
  if (!/\.(js|mjs|html|css|json)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("127.0.0.1:54321")) sawLocal = true;
  if (/supabase\.(co|in)/i.test(text)) bad.push(file);
}
if (!sawLocal) throw new Error("bundle assertion failed: 127.0.0.1:54321 not found in the bundle");
if (bad.length) throw new Error(`bundle assertion failed: supabase.co/supabase.in found in ${bad.length} file(s)`);
console.log("[local:build] OK: bundle references 127.0.0.1:54321 and contains no supabase.co / supabase.in");
