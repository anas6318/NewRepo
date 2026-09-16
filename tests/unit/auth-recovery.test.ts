/**
 * Password-recovery rules: the redirect URL, the recovery-link parser and the
 * shared password policy. Everything here is pure, so these are real
 * assertions about the code the pages actually run — not mocks of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PASSWORD_MIN_LENGTH, parseRecoveryFragment, resetRedirectUrl, validateNewPassword } from "../../src/lib/auth-recovery.ts";

/* ── the minimum password rule is the SAME one registration enforces ── */

test("the minimum password length matches the registration form's rule", () => {
  const registerSource = readFileSync("src/pages/storefront/AuthPages.tsx", "utf8");
  // RegisterPage validates with `password.length < 8`.
  assert.ok(registerSource.includes("password.length < 8"), "registration still uses a literal 8-character minimum");
  assert.equal(PASSWORD_MIN_LENGTH, 8, "reset uses the same minimum");
});

test("a password shorter than the minimum is rejected", () => {
  assert.equal(validateNewPassword("short12", "short12"), "too_short");
  assert.equal(validateNewPassword("", ""), "too_short");
});

test("mismatched passwords are rejected even when both are long enough", () => {
  assert.equal(validateNewPassword("longenough1", "longenough2"), "mismatch");
});

test("a long, matching pair is accepted", () => {
  assert.equal(validateNewPassword("longenough1", "longenough1"), undefined);
});

test("length is checked before equality, so a short pair reports too_short", () => {
  assert.equal(validateNewPassword("abc", "abc"), "too_short");
});

/* ── redirect URL construction ── */

test("the redirect URL points at the same-locale reset page on the same origin", () => {
  assert.equal(resetRedirectUrl("https://crowned.example", "ar"), "https://crowned.example/ar/reset-password");
  assert.equal(resetRedirectUrl("https://crowned.example", "he"), "https://crowned.example/he/reset-password");
  assert.equal(resetRedirectUrl("https://crowned.example", "en"), "https://crowned.example/en/reset-password");
});

test("a trailing slash on the origin does not produce a double slash", () => {
  assert.equal(resetRedirectUrl("https://crowned.example/", "ar"), "https://crowned.example/ar/reset-password");
});

test("the redirect URL never leaves the origin it was given", () => {
  const url = new URL(resetRedirectUrl("https://crowned.example", "en"));
  assert.equal(url.origin, "https://crowned.example");
});

/* ── recovery-link parsing ── */

const NOW = 1_700_000_000_000;

test("a real recovery fragment yields the tokens and an absolute expiry", () => {
  const parsed = parseRecoveryFragment("#access_token=aaa.bbb.ccc&refresh_token=rrr&expires_in=3600&token_type=bearer&type=recovery", NOW);
  assert.ok(parsed.ok);
  assert.equal(parsed.tokens.accessToken, "aaa.bbb.ccc");
  assert.equal(parsed.tokens.refreshToken, "rrr");
  assert.equal(parsed.tokens.expiresAt, Math.floor(NOW / 1000) + 3600);
});

test("an empty fragment is an invalid link, not a crash", () => {
  assert.deepEqual(parseRecoveryFragment("", NOW), { ok: false, error: "invalid_link" });
  assert.deepEqual(parseRecoveryFragment("#", NOW), { ok: false, error: "invalid_link" });
});

test("a link of a different type (magiclink, signup) is not accepted as a recovery", () => {
  const parsed = parseRecoveryFragment("#access_token=a&refresh_token=r&expires_in=3600&type=signup", NOW);
  assert.deepEqual(parsed, { ok: false, error: "invalid_link" });
});

test("a fragment missing the refresh token is rejected", () => {
  assert.deepEqual(parseRecoveryFragment("#access_token=a&expires_in=3600&type=recovery", NOW), { ok: false, error: "invalid_link" });
});

test("GoTrue's expired-link fragment is reported as expired, not invalid", () => {
  const parsed = parseRecoveryFragment("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", NOW);
  assert.deepEqual(parsed, { ok: false, error: "expired_link" });
});

test("an unrecognised error fragment falls back to invalid_link", () => {
  const parsed = parseRecoveryFragment("#error=server_error&error_description=Something+else+went+wrong", NOW);
  assert.deepEqual(parsed, { ok: false, error: "invalid_link" });
});

test("a missing expires_in still produces a usable expiry rather than NaN", () => {
  const parsed = parseRecoveryFragment("#access_token=a&refresh_token=r&type=recovery", NOW);
  assert.ok(parsed.ok);
  assert.ok(Number.isFinite(parsed.tokens.expiresAt) && parsed.tokens.expiresAt > Math.floor(NOW / 1000));
});

/* ── no account-existence disclosure, at the source level ── */

/** Strips comments so a rule can be asserted about CODE, not about prose. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("no recovery code path carries an account-existence signal", () => {
  for (const file of ["src/lib/auth-recovery.ts", "src/services/supabase/client.ts"]) {
    const code = codeOf(file);
    for (const forbidden of ["user_not_found", "no_such_account", "unknown_email", "email_not_found", "accountExists"]) {
      assert.ok(!code.includes(forbidden), `${file} must not branch on "${forbidden}"`);
    }
  }
});

test("requestPasswordReset's return type cannot express failure", () => {
  const code = codeOf("src/services/DataService.ts");
  assert.ok(
    /requestPasswordReset\(email: string, redirectTo: string\): Promise<\{ ok: true \}>/.test(code),
    "the interface must pin the result to { ok: true } so no caller can learn whether the address existed",
  );
});

test("no recovery token is ever written to the console", () => {
  for (const file of ["src/lib/auth-recovery.ts", "src/services/supabase/client.ts", "src/pages/storefront/AuthPages.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(source), `${file} must not log (tokens could leak)`);
  }
});

/* ── the Supabase client's own non-disclosure behaviour ─────────────────── */

/**
 * These drive the REAL SupabaseClient.resetPasswordForEmail with a stubbed
 * global fetch, so they test the shipped code rather than a description of it.
 */
async function withFetch<T>(stub: typeof fetch, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

test("a reset request reports success even when the provider returns 400", async () => {
  const { SupabaseClient } = await import("../../src/services/supabase/client.ts");
  const result = await withFetch(
    (async () => new Response(JSON.stringify({ msg: "User not found" }), { status: 400 })) as typeof fetch,
    async () => new SupabaseClient().resetPasswordForEmail("nobody@example.com", "https://x.test/en/reset-password"),
  );
  assert.deepEqual(result, { ok: true }, "a 400 must not become a distinguishable failure");
});

test("a reset request reports success even when the network throws", async () => {
  const { SupabaseClient } = await import("../../src/services/supabase/client.ts");
  const result = await withFetch(
    (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    async () => new SupabaseClient().resetPasswordForEmail("someone@example.com", "https://x.test/en/reset-password"),
  );
  assert.deepEqual(result, { ok: true }, "a network failure must not become a distinguishable failure");
});

test("known and unknown addresses produce byte-identical results", async () => {
  const { SupabaseClient } = await import("../../src/services/supabase/client.ts");
  const client = new SupabaseClient();
  const respond = (status: number, msg: string) =>
    withFetch(
      (async () => new Response(JSON.stringify({ msg }), { status })) as typeof fetch,
      async () => client.resetPasswordForEmail("a@b.co", "https://x.test/en/reset-password"),
    );
  assert.deepEqual(await respond(200, "ok"), await respond(422, "User not found"));
});

test("the recovery request targets GoTrue's recover endpoint with an encoded redirect", async () => {
  const { SupabaseClient } = await import("../../src/services/supabase/client.ts");
  const seen: { url: string; body: string }[] = [];
  await withFetch(
    (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    async () => new SupabaseClient().resetPasswordForEmail("a@b.co", "https://crowned.example/ar/reset-password"),
  );
  assert.equal(seen.length, 1, "exactly one request");
  assert.ok(seen[0]!.url.includes("/auth/v1/recover"), `hits /auth/v1/recover: ${seen[0]!.url}`);
  assert.ok(
    seen[0]!.url.includes(encodeURIComponent("https://crowned.example/ar/reset-password")),
    "the locale-specific redirect is URL-encoded into redirect_to",
  );
  assert.equal(JSON.parse(seen[0]!.body).email, "a@b.co", "the address is sent in the body, not the query string");
});
