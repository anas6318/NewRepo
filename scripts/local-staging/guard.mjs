/**
 * Local-staging guard — the first thing every local-staging script and
 * integration test runs.
 *
 * It refuses (throws BEFORE any HTTP request or database statement) unless
 * the Supabase stack it is about to talk to is provably the LOCAL CLI stack:
 *   - `SUPABASE_ACCESS_TOKEN` is not set in the environment (a token means
 *     this shell can reach a hosted project);
 *   - `supabase/.temp/project-ref` does not exist (the repo is not linked);
 *   - `npx supabase status -o json` reports API_URL on 127.0.0.1/localhost
 *     port 54321 and a DB_URL on a local host.
 *
 * `installNetworkGuard()` additionally wraps `globalThis.fetch` so any
 * request to a non-local host (and explicitly any *.supabase.co /
 * *.supabase.in host) throws instead of leaving the machine.
 *
 * The status output contains the CLI's local-only keys. They are returned
 * in-process only and are never logged, written to disk or put in a URL;
 * refusal messages name hosts and reasons, never key material.
 *
 * The pure decision functions (`evaluateLocalStack`, `isLocalHostname`,
 * `isForbiddenRemoteHostname`, `checkRequestUrl`) are unit-tested in
 * tests/unit/local-staging-guard.test.ts with no network.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROJECT_REF_PATH = join(REPO_ROOT, "supabase", ".temp", "project-ref");
export const LOCAL_API_PORT = "54321";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Exactly the loopback names this guard accepts. No wildcard, no suffix match. */
export function isLocalHostname(hostname) {
  if (typeof hostname !== "string") return false;
  return LOCAL_HOSTNAMES.has(hostname.trim().toLowerCase());
}

/** Hosted Supabase (`supabase.co` / `supabase.in` and every subdomain). */
export function isForbiddenRemoteHostname(hostname) {
  if (typeof hostname !== "string") return false;
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  return /(^|\.)supabase\.(co|in)$/.test(h);
}

function parseUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

/**
 * Pure decision, environment half: no hosted-project token, no link.
 * @param {{ env: Record<string, string | undefined>, projectRefExists: boolean }} input
 * @returns {string[]} refusal reasons (empty = acceptable)
 */
export function environmentRefusals({ env, projectRefExists }) {
  const reasons = [];
  if (env && Object.prototype.hasOwnProperty.call(env, "SUPABASE_ACCESS_TOKEN") && env.SUPABASE_ACCESS_TOKEN !== undefined) {
    reasons.push("SUPABASE_ACCESS_TOKEN is set in the environment (unset it: local staging never uses a hosted-project token)");
  }
  if (projectRefExists) {
    reasons.push("supabase/.temp/project-ref exists (the repo is linked to a hosted project)");
  }
  return reasons;
}

/**
 * Pure decision: may this process talk to the stack described by `status`?
 * @param {{ status: Record<string, unknown> | null | undefined, env: Record<string, string | undefined>, projectRefExists: boolean }} input
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function evaluateLocalStack({ status, env, projectRefExists }) {
  const reasons = environmentRefusals({ env, projectRefExists });
  if (!status || typeof status !== "object") {
    reasons.push("supabase status output is missing or not JSON");
    return { ok: false, reasons };
  }

  const api = parseUrl(status.API_URL);
  if (!api) {
    reasons.push("API_URL is missing or not a URL");
  } else {
    if (api.protocol !== "http:") reasons.push(`API_URL protocol ${api.protocol} is not http: (local CLI stack)`);
    if (!["127.0.0.1", "localhost"].includes(api.hostname)) reasons.push(`API_URL host ${api.hostname} is not 127.0.0.1/localhost`);
    if (api.port !== LOCAL_API_PORT) reasons.push(`API_URL port ${api.port || "(default)"} is not ${LOCAL_API_PORT}`);
    if (isForbiddenRemoteHostname(api.hostname)) reasons.push(`API_URL host ${api.hostname} is a hosted Supabase host`);
  }

  const dbUrl = parseUrl(status.DB_URL);
  if (!dbUrl) {
    reasons.push("DB_URL is missing or not a URL");
  } else if (!isLocalHostname(dbUrl.hostname)) {
    reasons.push(`DB_URL host ${dbUrl.hostname} is not local`);
  }

  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (typeof status[key] !== "string" || status[key].length === 0) reasons.push(`${key} missing from supabase status`);
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * Pure decision for one outgoing request URL.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkRequestUrl(url) {
  const u = parseUrl(url);
  if (!u) return { ok: false, reason: "unparseable request URL" };
  if (isForbiddenRemoteHostname(u.hostname)) return { ok: false, reason: `hosted Supabase host ${u.hostname} is forbidden` };
  if (!isLocalHostname(u.hostname)) return { ok: false, reason: `non-local host ${u.hostname} is forbidden` };
  return { ok: true };
}

/** Runs `npx supabase status -o json` and parses it. Output never echoed. */
function readSupabaseStatus() {
  // One fixed command string (no interpolated input), run through the shell so
  // Windows resolves npx.cmd.
  const res = spawnSync("npx supabase status -o json", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    windowsHide: true,
  });
  if (res.status !== 0) return null;
  const out = res.stdout ?? "";
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(out.slice(start, end + 1));
  } catch {
    return null;
  }
}

let cachedStack = null;

/**
 * Verifies the environment, then reads the local stack. Throws on refusal.
 * Environment and link checks run BEFORE the CLI is invoked at all.
 */
export function loadLocalStack() {
  if (cachedStack) return cachedStack;
  const pre = environmentRefusals({ env: process.env, projectRefExists: existsSync(PROJECT_REF_PATH) });
  if (pre.length) throw new Error(`local-staging guard refused: ${pre.join("; ")}`);

  const status = readSupabaseStatus();
  const verdict = evaluateLocalStack({ status, env: process.env, projectRefExists: existsSync(PROJECT_REF_PATH) });
  if (!verdict.ok) throw new Error(`local-staging guard refused: ${verdict.reasons.join("; ")}`);

  const apiUrl = String(status.API_URL).replace(/\/+$/, "");
  cachedStack = Object.freeze({
    apiUrl,
    restUrl: `${apiUrl}/rest/v1`,
    authUrl: `${apiUrl}/auth/v1`,
    functionsUrl: `${apiUrl}/functions/v1`,
    anonKey: String(status.ANON_KEY),
    serviceRoleKey: String(status.SERVICE_ROLE_KEY),
  });
  return cachedStack;
}

let networkGuardInstalled = false;

/** Wraps globalThis.fetch: any non-local destination throws before sending. */
export function installNetworkGuard() {
  if (networkGuardInstalled) return;
  const original = globalThis.fetch;
  if (typeof original !== "function") throw new Error("local-staging guard: global fetch is unavailable");
  globalThis.fetch = function guardedFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const verdict = checkRequestUrl(url);
    if (!verdict.ok) return Promise.reject(new Error(`local-staging network guard: ${verdict.reason}`));
    return original(input, init);
  };
  networkGuardInstalled = true;
}

/** Convenience: refuse-or-return, with the network guard in place. */
export function guardLocal() {
  installNetworkGuard();
  return loadLocalStack();
}
