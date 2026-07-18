/**
 * Resolves Playwright from local node_modules when installed (normal
 * machines), else from known global locations (network-restricted
 * verification environment, where playwright + chromium are preinstalled).
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

const CANDIDATES = [
  "playwright",
  "/home/claude/.npm-global/lib/node_modules/playwright",
  "/usr/lib/node_modules/playwright",
];

export function loadPlaywright() {
  for (const c of CANDIDATES) {
    try {
      if (c !== "playwright" && !existsSync(c)) continue;
      return require(c);
    } catch {
      /* try next */
    }
  }
  throw new Error("playwright not found — run `npm install` first");
}

export const { chromium, devices } = loadPlaywright();
