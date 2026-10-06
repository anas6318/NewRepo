/**
 * Shared helpers for the LOCAL Supabase integration suite.
 *
 * Importing this module performs no request. Every test file calls
 * `guardLocal()` itself (scripts/local-staging/guard.mjs) before anything
 * else; the helpers below only accept the stack object that guard returned.
 *
 * Keys and passwords stay in memory: they go into request headers / bodies
 * to 127.0.0.1 only, never into URLs, assertion messages or logs.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO_ROOT } from "../../../scripts/local-staging/guard.mjs";
import { psqlScalar, sqlText } from "../../../scripts/local-staging/local-db.mjs";
import { SENTINEL_COST_USD, SENTINEL_PREFIX, USERS_FILE_REL, ZONE_ID } from "../../../scripts/local-staging/fixtures.mjs";

export { sleep };

export const FUNCTIONS_LOG = join(REPO_ROOT, ".claude", "local-staging", "functions.log");

/* ── HTTP ────────────────────────────────────────────────────────────────── */

async function call(url, { method = "GET", apikey, token, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(apikey ? { apikey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

export function client(stack) {
  const rest = (path, opts = {}) => call(`${stack.restUrl}/${path}`, { apikey: stack.anonKey, token: stack.anonKey, ...opts });
  const svc = (path, opts = {}) => call(`${stack.restUrl}/${path}`, { ...opts, apikey: stack.serviceRoleKey, token: stack.serviceRoleKey });
  const asUser = (token) => (path, opts = {}) => call(`${stack.restUrl}/${path}`, { ...opts, apikey: stack.anonKey, token });
  const fn = (name, body, { token = stack.anonKey, query = "", method = "POST" } = {}) =>
    call(`${stack.functionsUrl}/${name}${query}`, { method, apikey: stack.anonKey, token, body });

  const sessions = new Map();
  /** Password sign-in for a seeded user (users.json). Cached per process. */
  async function signIn(userKey) {
    if (sessions.has(userKey)) return sessions.get(userKey);
    const u = seededUsers()[userKey];
    assert.ok(u, `seeded user ${userKey} missing — run npm run local:seed`);
    let r;
    // The local Auth rate limit (sign_in_sign_ups, per 5 minutes) can trip
    // on back-to-back suite runs: wait it out rather than fail spuriously.
    for (let attempt = 0; attempt < 8; attempt++) {
      r = await call(`${stack.authUrl}/token?grant_type=password`, {
        method: "POST",
        apikey: stack.anonKey,
        body: { email: u.email, password: u.password },
      });
      if (r.status !== 429) break;
      await sleep(15_000);
    }
    assert.equal(r.status, 200, `sign-in for ${userKey} failed with HTTP ${r.status}`);
    const s = { token: r.json.access_token, id: r.json.user.id, email: u.email, role: u.role };
    sessions.set(userKey, s);
    return s;
  }

  /** The raw stored order row (service role). */
  async function orderRow(orderNumber) {
    const r = await svc(
      `orders?select=id,order_number,customer_id,contact_hash,payment_status,fulfillment_status,total_ils,locale,idempotency_key,data&order_number=eq.${encodeURIComponent(orderNumber)}`,
    );
    assert.equal(r.status, 200);
    return r.json[0] ?? null;
  }

  return { rest, svc, asUser, fn, signIn, orderRow };
}

/** `select count(*) from <table> where <whereSql>` on the local database. */
export function countRows(table, whereSql) {
  return Number(psqlScalar(`select count(*) from ${table} where ${whereSql};`));
}

export { sqlText };

/* ── seeded users (credentials stay in memory) ───────────────────────────── */

let usersCache;
export function seededUsers() {
  if (usersCache) return usersCache;
  const p = join(REPO_ROOT, USERS_FILE_REL);
  assert.ok(existsSync(p), `${USERS_FILE_REL} missing — run npm run local:seed first`);
  usersCache = JSON.parse(readFileSync(p, "utf8")).users;
  return usersCache;
}

/* ── order requests ──────────────────────────────────────────────────────── */

export function uniqueTag(prefix = "t") {
  return `${prefix}${randomUUID().slice(0, 8)}`;
}

/** Synthetic customer; `domainTag` puts the address on its own
 * `<tag>.example.test` subdomain so console-mode email log lines (which keep
 * only the first character and the domain) can be attributed to one test. */
export function customer({ tag = uniqueTag("c"), domainTag } = {}) {
  return {
    name: "IT Customer",
    email: domainTag ? `it-${tag}@${domainTag}.example.test` : `it-${tag}@example.test`,
    phone: "0500000001",
    city: "Test City",
    address: "1 Test Street",
  };
}

export const line = (productId, extra = {}) => ({ productId, size: "M", quantity: 1, ...extra });

export function orderBody(lines, extra = {}) {
  return { locale: "en", customer: customer(), zoneId: ZONE_ID, paymentMethod: "bank_transfer", lines, ...extra };
}

/* ── assertions ──────────────────────────────────────────────────────────── */

/** Every key at every depth. */
export function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** No SUPPLIER-SENTINEL text and no seeded supplier cost anywhere in `value`. */
export function assertNoSupplierData(value, what) {
  const text = JSON.stringify(value);
  assert.ok(!text.includes(SENTINEL_PREFIX), `${what}: contains a ${SENTINEL_PREFIX} value`);
  assert.ok(!text.includes(String(SENTINEL_COST_USD)), `${what}: contains the seeded supplier cost`);
}

/* ── edge-function console log (written by the orchestrator's functions serve) ── */

export function functionLogLines() {
  if (!existsSync(FUNCTIONS_LOG)) return [];
  return readFileSync(FUNCTIONS_LOG, "utf8").split(/\r?\n/);
}

/** Polls until `predicate()` is truthy or the timeout passes; returns the last value. */
export async function waitFor(predicate, { timeoutMs = 5000, stepMs = 150 } = {}) {
  const until = Date.now() + timeoutMs;
  let last = await predicate();
  while (!last && Date.now() < until) {
    await sleep(stepMs);
    last = await predicate();
  }
  return last;
}
