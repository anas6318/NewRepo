/**
 * Local-staging guard (scripts/local-staging/guard.mjs) — the pure decision
 * functions only. No network, no CLI, no database: every case feeds a
 * hand-written `supabase status` object, environment and link flag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRequestUrl,
  environmentRefusals,
  evaluateLocalStack,
  isForbiddenRemoteHostname,
  installNetworkGuard,
  isLocalHostname,
} from "../../scripts/local-staging/guard.mjs";

const LOCAL_STATUS = {
  API_URL: "http://127.0.0.1:54321",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  ANON_KEY: "local-anon-placeholder",
  SERVICE_ROLE_KEY: "local-service-placeholder",
};
const CLEAN_ENV: Record<string, string | undefined> = { PATH: "/usr/bin" };

function refused(input: Parameters<typeof evaluateLocalStack>[0]): string[] {
  const v = evaluateLocalStack(input);
  assert.equal(v.ok, false, "expected the guard to refuse");
  return v.ok ? [] : v.reasons;
}

test("guard accepts the local CLI stack (127.0.0.1:54321, local DB, no token, not linked)", () => {
  assert.deepEqual(evaluateLocalStack({ status: LOCAL_STATUS, env: CLEAN_ENV, projectRefExists: false }), { ok: true });
  assert.deepEqual(
    evaluateLocalStack({ status: { ...LOCAL_STATUS, API_URL: "http://localhost:54321", DB_URL: "postgresql://postgres:x@localhost:54322/postgres" }, env: CLEAN_ENV, projectRefExists: false }),
    { ok: true },
  );
});

test("guard refuses a hosted Supabase API_URL (*.supabase.co / *.supabase.in)", () => {
  for (const API_URL of ["https://abcdefghijklmnop.supabase.co", "https://abcdefghijklmnop.supabase.in", "http://abc.supabase.co:54321"]) {
    const reasons = refused({ status: { ...LOCAL_STATUS, API_URL }, env: CLEAN_ENV, projectRefExists: false });
    assert.ok(reasons.some((r) => r.includes("API_URL host")), `${API_URL}: ${reasons.join(" | ")}`);
  }
});

test("guard refuses a non-local API host, a non-54321 port and https", () => {
  assert.ok(refused({ status: { ...LOCAL_STATUS, API_URL: "http://10.0.0.5:54321" }, env: CLEAN_ENV, projectRefExists: false }).some((r) => r.includes("not 127.0.0.1/localhost")));
  assert.ok(refused({ status: { ...LOCAL_STATUS, API_URL: "http://127.0.0.1:8000" }, env: CLEAN_ENV, projectRefExists: false }).some((r) => r.includes("port 8000")));
  assert.ok(refused({ status: { ...LOCAL_STATUS, API_URL: "https://127.0.0.1:54321" }, env: CLEAN_ENV, projectRefExists: false }).some((r) => r.includes("protocol")));
  // A lookalike suffix is not loopback.
  assert.ok(refused({ status: { ...LOCAL_STATUS, API_URL: "http://127.0.0.1.evil.test:54321" }, env: CLEAN_ENV, projectRefExists: false }).length > 0);
});

test("guard refuses a remote DB_URL (e.g. the hosted pooler)", () => {
  const reasons = refused({
    status: { ...LOCAL_STATUS, DB_URL: "postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" },
    env: CLEAN_ENV,
    projectRefExists: false,
  });
  assert.ok(reasons.some((r) => r.startsWith("DB_URL host")), reasons.join(" | "));
});

test("guard refuses a linked repo (supabase/.temp/project-ref exists)", () => {
  const reasons = refused({ status: LOCAL_STATUS, env: CLEAN_ENV, projectRefExists: true });
  assert.ok(reasons.some((r) => r.includes("project-ref")));
  assert.ok(environmentRefusals({ env: CLEAN_ENV, projectRefExists: true }).length === 1);
});

test("guard refuses when SUPABASE_ACCESS_TOKEN is present (even empty)", () => {
  for (const value of ["fixture-access-token-not-a-secret", ""]) {
    const reasons = refused({ status: LOCAL_STATUS, env: { ...CLEAN_ENV, SUPABASE_ACCESS_TOKEN: value }, projectRefExists: false });
    assert.ok(reasons.some((r) => r.includes("SUPABASE_ACCESS_TOKEN")));
    // The token value itself never appears in a refusal message.
    if (value) assert.ok(reasons.every((r) => !r.includes(value)));
  }
});

test("guard refuses missing/garbled status and missing keys", () => {
  assert.ok(refused({ status: null, env: CLEAN_ENV, projectRefExists: false }).length > 0);
  assert.ok(refused({ status: { ...LOCAL_STATUS, API_URL: "not a url" }, env: CLEAN_ENV, projectRefExists: false }).length > 0);
  assert.ok(refused({ status: { ...LOCAL_STATUS, SERVICE_ROLE_KEY: "" }, env: CLEAN_ENV, projectRefExists: false }).some((r) => r.includes("SERVICE_ROLE_KEY")));
});

test("refusal reasons never echo key material", () => {
  const token = "fixture-token-must-not-be-echoed";
  const reasons = refused({ status: { ...LOCAL_STATUS, API_URL: "https://x.supabase.co" }, env: { SUPABASE_ACCESS_TOKEN: token }, projectRefExists: true });
  assert.ok(reasons.length >= 3);
  for (const r of reasons) {
    assert.ok(!r.includes(LOCAL_STATUS.ANON_KEY) && !r.includes(LOCAL_STATUS.SERVICE_ROLE_KEY) && !r.includes(token), r);
  }
});

test("network guard decision: only loopback hosts pass; supabase.co/.in always fail", () => {
  for (const ok of ["http://127.0.0.1:54321/rest/v1/x", "http://localhost:54321/functions/v1/place-order", "http://[::1]:54321/"]) {
    assert.deepEqual(checkRequestUrl(ok), { ok: true }, ok);
  }
  for (const bad of [
    "https://abc.supabase.co/rest/v1/orders",
    "https://abc.supabase.in/rest/v1/orders",
    "https://api.resend.com/emails",
    "https://oauth2.googleapis.com/token",
    "http://127.0.0.1.nip.io:54321/",
    "not a url",
  ]) {
    assert.equal(checkRequestUrl(bad).ok, false, bad);
  }
  assert.equal(isForbiddenRemoteHostname("ABC.SUPABASE.CO"), true);
  assert.equal(isForbiddenRemoteHostname("supabase.co."), true);
  assert.equal(isForbiddenRemoteHostname("notsupabase.com"), false);
  assert.equal(isLocalHostname("localhost"), true);
  assert.equal(isLocalHostname("localhost.example.test"), false);
  assert.equal(isLocalHostname(undefined), false);
});

test("installNetworkGuard wraps fetch: blocks hosted/non-local hosts, passes loopback, and can be undone", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  const stub = (async (input: unknown) => {
    seen.push(typeof input === "string" ? input : String((input as URL).href ?? (input as Request).url));
    return new Response("ok");
  }) as typeof fetch;
  globalThis.fetch = stub;
  try {
    installNetworkGuard();
    assert.notEqual(globalThis.fetch, stub, "fetch must be wrapped");
    for (const bad of ["https://x.supabase.co/rest/v1/orders", "https://x.supabase.in/rest/v1/orders", "https://api.resend.com/emails"]) {
      await assert.rejects(() => globalThis.fetch(bad), /local-staging network guard/, bad);
      await assert.rejects(() => globalThis.fetch(new URL(bad)), /local-staging network guard/, bad);
    }
    assert.deepEqual(seen, [], "blocked requests must never reach the underlying fetch");
    const res = await globalThis.fetch("http://127.0.0.1:54321/rest/v1/x");
    assert.equal(await res.text(), "ok");
    assert.deepEqual(seen, ["http://127.0.0.1:54321/rest/v1/x"]);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(globalThis.fetch, original);
});
