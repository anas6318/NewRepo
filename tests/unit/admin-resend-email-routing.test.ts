/**
 * Admin "resend customer email" routing contract (A2-B2).
 *
 * SupabaseDataService.invoke(name, payload) does
 * `fetch(`${url}/functions/v1/${name}`, { body: JSON.stringify(payload) })`
 * (src/services/supabase/client.ts) — the action name has to be encoded in
 * the ENDPOINT STRING (the "name" argument), because admin-actions/index.ts
 * routes purely on `url.searchParams.get("action") ?? <pathname alias>`
 * (never on a body field). Every other admin call follows that
 * `"admin-actions?action=<x>"` form; `adminResendCustomerEmail` used to be
 * the one outlier that put `action` in the body instead, so the server
 * fell through to its pathname-alias branch and resend-email silently
 * mis-routed.
 *
 * This is a source-level contract test (no live Supabase/network): it reads
 * both files as text and checks the client call site uses the same
 * routing form as the other admin calls, and that the resulting action
 * name is one the server's switch actually handles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSrc = readFileSync(new URL("../../src/services/supabase/SupabaseDataService.ts", import.meta.url), "utf8");
const serverSrc = readFileSync(new URL("../../supabase/functions/admin-actions/index.ts", import.meta.url), "utf8");

/** Every `guard().invoke("admin-actions?action=...", ...)` call in the client. */
function adminActionInvocations(src: string): { action: string; call: string }[] {
  const out: { action: string; call: string }[] = [];
  const re = /\.invoke(?:<[^>]*>)?\("admin-actions\?action=([a-z-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ action: m[1]!, call: m[0] });
  return out;
}

/** Every `case "...":` action name in the server's switch statement. */
function serverActionCases(src: string): string[] {
  const switchStart = src.indexOf("switch (action.replace(");
  const switchBody = src.slice(switchStart, src.indexOf("\n    }", switchStart));
  const re = /case "([a-z-]+)":/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(switchBody))) out.push(m[1]!);
  return out;
}

test("adminResendCustomerEmail is present and uses the query-param routing form, like every other admin call", () => {
  const fnSrc = clientSrc.slice(clientSrc.indexOf("async adminResendCustomerEmail"), clientSrc.indexOf("async adminListCustomers"));
  assert.ok(fnSrc.includes('"admin-actions?action=resend-customer-email"'), 'adminResendCustomerEmail must call .invoke("admin-actions?action=resend-customer-email", ...) — the query-param form the server routes on');
  assert.ok(!/\.invoke\(\s*"admin-actions"\s*,/.test(fnSrc), 'must not call .invoke("admin-actions", ...) with a bare endpoint');
  assert.ok(!/action:\s*"resend-customer-email"/.test(fnSrc), "action must not be smuggled into the request body — the server never reads it from there");
});

test("every admin-actions?action=<x> call from the client matches a case the server actually routes", () => {
  const invocations = adminActionInvocations(clientSrc);
  assert.ok(invocations.length >= 8, "sanity: expected to find the admin invoke call sites");
  const serverCases = new Set(serverActionCases(serverSrc));
  assert.ok(serverCases.has("resend-customer-email"), "server must still route resend-customer-email");

  const unmatched = invocations.filter((i) => !serverCases.has(i.action));
  assert.deepEqual(unmatched, [], `client calls an action the server switch does not handle: ${unmatched.map((u) => u.action).join(", ")}`);
});

test("the client and server agree on the resend-email request shape (orderNumber + event, no action field)", () => {
  const clientFn = clientSrc.slice(clientSrc.indexOf("async adminResendCustomerEmail"), clientSrc.indexOf("async adminListCustomers"));
  assert.match(clientFn, /orderNumber/);
  assert.match(clientFn, /event/);

  const serverFn = serverSrc.slice(serverSrc.indexOf("async function resendCustomerEmail"), serverSrc.indexOf("\n}\n", serverSrc.indexOf("async function resendCustomerEmail")));
  assert.match(serverFn, /body:\s*\{\s*orderNumber:\s*string;\s*event:\s*string\s*\}/, "server's declared body shape must still be { orderNumber, event }");
});
