/**
 * Supplier confirmation and order-update AUTH through the real
 * `admin-actions?action=update-order` Edge Function with real staff JWTs
 * (LOCAL stack). Rules under test: supabase/functions/_shared/order-lifecycle.ts
 *   ORDER_ROLES / MONEY_ROLES = owner, admin, order_manager; content_manager
 *   and customers may not update orders; PRICING_ROLES = owner, admin.
 * Customer emails run in console mode: each order's ledger
 * (`data.customerEmails`) and its attributed console lines in the functions
 * log are both checked, so "no payment-confirmed email" means neither an
 * attempt recorded on the order nor a line written by the function.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { psql, psqlScalar } from "../../../scripts/local-staging/local-db.mjs";
import { client, countRows, customer, functionLogLines, line, orderBody, sleep, sqlText, uniqueTag } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

const SUBJECT = {
  received: "CROWNED — your order has been received",
  held: "CROWNED — order received, awaiting supplier confirmation",
  supplierConfirmed: "CROWNED — your order's availability is confirmed",
  paid: "CROWNED — payment confirmed",
};

const S = {};
before(async () => {
  for (const k of ["contentManager", "orderManager", "admin", "owner", "customerA"]) S[k] = await c.signIn(k);
});

async function place(productId) {
  const domainTag = uniqueTag("adm");
  const r = await c.fn("place-order", orderBody([line(productId)], { customer: customer({ domainTag }) }));
  assert.equal(r.status, 200, `place-order: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return { orderNumber: r.json.orderNumber, order: r.json.order, domainTag };
}

const update = (who, orderNumber, patch) => c.fn("admin-actions", { orderNumber, patch }, { token: S[who]?.token ?? who, query: "?action=update-order" });

async function updateOk(who, orderNumber, patch) {
  const r = await update(who, orderNumber, patch);
  assert.equal(r.status, 200, `${who} ${JSON.stringify(patch)}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.json.ok, true);
  return r.json.order;
}

/** Console email lines attributed to this order's customer address. */
async function emailSubjects(domainTag, settleMs = 1200) {
  await sleep(settleMs);
  return functionLogLines()
    .filter((l) => l.includes(`@${domainTag}.example.test`) && l.includes("[customer-email:"))
    .map((l) => l.slice(l.indexOf("subject=") + "subject=".length).trim());
}

const ledger = (row) => Object.keys(row.data.customerEmails ?? {}).sort();

test("supplier confirmation: a held order starts in awaiting_supplier_confirmation with no payment request", async () => {
  const h = await place("it-hold");
  assert.equal(h.order.fulfillmentStatus, "awaiting_supplier_confirmation");
  assert.equal(h.order.paymentStatus, "awaiting_payment");
  assert.deepEqual(h.order.supplierConfirmation, { required: true, status: "pending", items: [{ slug: "it-hold", size: "M" }] });
  const row = await c.orderRow(h.orderNumber);
  assert.equal(row.fulfillment_status, "awaiting_supplier_confirmation");
  assert.equal(row.payment_status, "awaiting_payment");
  assert.deepEqual(ledger(row), ["order_received"]);
  assert.deepEqual(await emailSubjects(h.domainTag), [SUBJECT.held], "held variant only — no bank-transfer 'order received' mail");
});

test("supplier confirmation: confirming an UNPAID held order → awaiting_payment, never payment_confirmed, no payment-confirmed email before payment", async () => {
  const h = await place("it-hold");
  const after = await updateOk("orderManager", h.orderNumber, { supplierConfirmation: { status: "confirmed" } });
  assert.equal(after.fulfillmentStatus, "awaiting_payment");
  assert.equal(after.paymentStatus, "awaiting_payment");
  assert.equal(after.supplierConfirmation.status, "confirmed");
  assert.equal(after.supplierConfirmation.decidedBy, S.orderManager.email);
  let row = await c.orderRow(h.orderNumber);
  assert.equal(row.fulfillment_status, "awaiting_payment");
  assert.equal(row.payment_status, "awaiting_payment");
  assert.ok(!row.data.tracking.some((t) => t.status === "payment_confirmed"));
  assert.deepEqual(ledger(row), ["order_received", "supplier_confirmed"]);
  let subjects = await emailSubjects(h.domainTag);
  assert.deepEqual(subjects, [SUBJECT.held, SUBJECT.supplierConfirmed]);

  // Advancing without payment is refused, and emails nobody.
  const early = await update("orderManager", h.orderNumber, { fulfillmentStatus: "payment_confirmed" });
  assert.equal(early.status, 400);
  assert.equal(early.json.error, "invalid_transition");
  const toProd = await update("orderManager", h.orderNumber, { fulfillmentStatus: "sent_to_supplier" });
  assert.equal(toProd.status, 400);
  row = await c.orderRow(h.orderNumber);
  assert.equal(row.fulfillment_status, "awaiting_payment");
  assert.ok(!ledger(row).includes("payment_confirmed"));

  // Only an actual payment produces the payment-confirmed state and email (once).
  const paid = await updateOk("orderManager", h.orderNumber, { paymentStatus: "paid" });
  assert.equal(paid.fulfillmentStatus, "payment_confirmed");
  row = await c.orderRow(h.orderNumber);
  assert.equal(row.payment_status, "paid");
  assert.equal(row.fulfillment_status, "payment_confirmed");
  assert.equal(row.data.customerEmails.payment_confirmed.attempts, 1);
  subjects = await emailSubjects(h.domainTag);
  assert.deepEqual(subjects, [SUBJECT.held, SUBJECT.supplierConfirmed, SUBJECT.paid]);
});

test("supplier confirmation: supplier-unavailable path (rejected) → supplier_unavailable, decision final, no payment email", async () => {
  const h = await place("it-hold");
  const after = await updateOk("orderManager", h.orderNumber, { supplierConfirmation: { status: "rejected", note: "IT internal rejection note" } });
  assert.equal(after.fulfillmentStatus, "supplier_unavailable");
  assert.equal(after.supplierConfirmation.status, "rejected");
  assert.equal(after.paymentStatus, "awaiting_payment");
  const row = await c.orderRow(h.orderNumber);
  assert.equal(row.fulfillment_status, "supplier_unavailable");
  assert.deepEqual(ledger(row), ["order_received"], "a rejection sends no automatic email");

  const reconfirm = await update("orderManager", h.orderNumber, { supplierConfirmation: { status: "confirmed" } });
  assert.equal(reconfirm.status, 400, "a supplier decision is final");
  const toPaid = await update("orderManager", h.orderNumber, { fulfillmentStatus: "payment_confirmed" });
  assert.equal(toPaid.status, 400);
  assert.equal((await c.orderRow(h.orderNumber)).fulfillment_status, "supplier_unavailable");
  assert.deepEqual(await emailSubjects(h.domainTag), [SUBJECT.held]);

  // The customer sees the outcome, not the internal note or who decided.
  const tracked = await c.fn("track-order", { orderNumber: h.orderNumber, contact: (await c.orderRow(h.orderNumber)).data.customer.email });
  assert.equal(tracked.status, 200);
  assert.deepEqual(tracked.json.order.supplierConfirmation, { required: true, status: "rejected", items: [{ slug: "it-hold", size: "M" }] });
  assert.ok(!JSON.stringify(tracked.json).includes("IT internal rejection note"));
});

test("supplier confirmation: payment recorded while still waiting stays held — no production, no payment-confirmed email; confirming later moves to payment_confirmed once", async () => {
  const h = await place("it-hold");
  const paid = await updateOk("orderManager", h.orderNumber, { paymentStatus: "paid" });
  assert.equal(paid.paymentStatus, "paid");
  assert.equal(paid.fulfillmentStatus, "awaiting_supplier_confirmation", "payment never releases a held order");
  let row = await c.orderRow(h.orderNumber);
  assert.equal(row.payment_status, "paid");
  assert.equal(row.fulfillment_status, "awaiting_supplier_confirmation");
  assert.equal(row.data.paymentHistory.length, 1);
  assert.deepEqual(ledger(row), ["order_received"], "no 'payment confirmed / moving to preparation' email while held");
  assert.deepEqual(await emailSubjects(h.domainTag), [SUBJECT.held]);

  const prod = await update("orderManager", h.orderNumber, { fulfillmentStatus: "sent_to_supplier" });
  assert.equal(prod.status, 400, "paid but unconfirmed must not go to production");
  assert.match(prod.json.detail ?? "", /supplier_not_confirmed/);

  const confirmed = await updateOk("orderManager", h.orderNumber, { supplierConfirmation: { status: "confirmed" } });
  assert.equal(confirmed.fulfillmentStatus, "payment_confirmed");
  row = await c.orderRow(h.orderNumber);
  assert.equal(row.fulfillment_status, "payment_confirmed");
  assert.deepEqual(ledger(row), ["order_received", "payment_confirmed"], "no 'please pay' supplier_confirmed mail to a paid order");
  // Re-saving the same state is a no-op: still exactly one payment email.
  await updateOk("orderManager", h.orderNumber, { paymentStatus: "paid", supplierConfirmation: { status: "confirmed" } });
  row = await c.orderRow(h.orderNumber);
  assert.equal(row.data.customerEmails.payment_confirmed.attempts, 1);
  assert.deepEqual(await emailSubjects(h.domainTag), [SUBJECT.held, SUBJECT.paid]);
});

test("auth: content_manager cannot mark paid or refunded (403) and the order is unchanged", async () => {
  const o = await place("it-retro-regular");
  const snapshot = await c.orderRow(o.orderNumber);
  assert.equal(snapshot.payment_status, "awaiting_payment");
  for (const patch of [{ paymentStatus: "paid" }, { paymentStatus: "refunded" }, { paymentStatus: "partially_refunded" }, { internalNotes: "x" }, { supplierConfirmation: { status: "confirmed" } }]) {
    const r = await update("contentManager", o.orderNumber, patch);
    assert.equal(r.status, 403, `${JSON.stringify(patch)}: HTTP ${r.status}`);
    assert.equal(r.json.error, "forbidden");
  }
  assert.deepEqual(await c.orderRow(o.orderNumber), snapshot, "403s must leave the full order row unchanged");
  // Once paid by an order role, content_manager still cannot refund.
  await updateOk("orderManager", o.orderNumber, { paymentStatus: "paid" });
  const mid = await c.orderRow(o.orderNumber);
  const refund = await update("contentManager", o.orderNumber, { paymentStatus: "refunded" });
  assert.equal(refund.status, 403);
  assert.deepEqual(await c.orderRow(o.orderNumber), mid);
});

test("auth: customers and anonymous callers cannot use update-order (403)", async () => {
  const o = await place("it-retro-regular");
  const before0 = await c.orderRow(o.orderNumber);
  for (const who of ["customerA", stack.anonKey]) {
    const r = await update(who, o.orderNumber, { paymentStatus: "paid" });
    assert.equal(r.status, 403, `${who === stack.anonKey ? "anon" : who}: HTTP ${r.status}`);
  }
  assert.deepEqual(await c.orderRow(o.orderNumber), before0);
});

test("auth: order_manager may mark paid and refund (lifecycle MONEY_ROLES) but may not change pricing (save-promotions 403)", async () => {
  const o = await place("it-retro-regular");
  const paid = await updateOk("orderManager", o.orderNumber, { paymentStatus: "paid" });
  assert.equal(paid.paymentStatus, "paid");
  assert.equal(paid.fulfillmentStatus, "payment_confirmed");
  const refunded = await updateOk("orderManager", o.orderNumber, { paymentStatus: "refunded" });
  assert.equal(refunded.paymentStatus, "refunded");
  const row = await c.orderRow(o.orderNumber);
  assert.equal(row.payment_status, "refunded");
  assert.deepEqual(row.data.paymentHistory.map((h) => `${h.from}>${h.to}:${h.by}`), [
    `awaiting_payment>paid:${S.orderManager.email}`,
    `paid>refunded:${S.orderManager.email}`,
  ]);
  // Pricing is owner/admin only. `[{}]` would fail validation (400) BEFORE any
  // write if the role gate were missing, so this probe can never delete data.
  const promosBefore = await c.svc("promotions?select=id,enabled,data&order=id");
  for (const who of ["orderManager", "contentManager"]) {
    const r = await c.fn("admin-actions", { promotions: [{}] }, { token: S[who].token, query: "?action=save-promotions" });
    assert.equal(r.status, 403, `${who} save-promotions: HTTP ${r.status}`);
    const b = await c.fn("admin-actions", { badges: [{}] }, { token: S[who].token, query: "?action=save-badges" });
    assert.equal(b.status, 403, `${who} save-badges: HTTP ${b.status}`);
  }
  assert.deepEqual((await c.svc("promotions?select=id,enabled,data&order=id")).json, promosBefore.json);
});

test("auth: admin and owner may mark paid / refund per lifecycle roles; illegal transitions and non-allowlisted keys refused for everyone", async () => {
  const o1 = await place("it-retro-regular");
  assert.equal((await updateOk("admin", o1.orderNumber, { paymentStatus: "paid" })).paymentStatus, "paid");
  assert.equal((await updateOk("owner", o1.orderNumber, { paymentStatus: "refunded" })).paymentStatus, "refunded");
  const final = await update("owner", o1.orderNumber, { paymentStatus: "paid" });
  assert.equal(final.status, 400, "refunded is terminal");

  const o2 = await place("it-retro-regular");
  const before0 = await c.orderRow(o2.orderNumber);
  for (const who of ["owner", "admin", "orderManager"]) {
    const keyR = await update(who, o2.orderNumber, { totalIls: 1 });
    assert.equal(keyR.status, 400);
    assert.equal(keyR.json.error, "invalid_patch_key");
    const refundUnpaid = await update(who, o2.orderNumber, { paymentStatus: "refunded" });
    assert.equal(refundUnpaid.status, 400, `${who}: refund before payment must be refused`);
  }
  assert.deepEqual(await c.orderRow(o2.orderNumber), before0);
  // Staff can list (read) promotions; only the gate on writes differs by role.
  for (const who of ["contentManager", "orderManager", "admin", "owner"]) {
    const r = await c.fn("admin-actions", {}, { token: S[who].token, query: "?action=list-promotions" });
    assert.equal(r.status, 200, `${who} list-promotions`);
  }
});

test("auth: admin and owner pass the pricing gate for save-promotions / save-badges (PRICING_ROLES); content_manager and order_manager do not", async () => {
  // `[{}]` clears the role gate and then fails validation (400) BEFORE any write,
  // so a 400 (not 403) proves the role may save, without touching data.
  const promosBefore = await c.svc("promotions?select=id,enabled,sort_order,data&order=id");
  const badgesBefore = await c.svc("patches?select=id,active,sort_order,data,supplier_ref&order=id");
  for (const who of ["admin", "owner"]) {
    const p = await c.fn("admin-actions", { promotions: [{}] }, { token: S[who].token, query: "?action=save-promotions" });
    assert.equal(p.status, 400, `${who} save-promotions: HTTP ${p.status}`);
    assert.equal(p.json.error, "promotion_missing_id");
    const b = await c.fn("admin-actions", { badges: [{}] }, { token: S[who].token, query: "?action=save-badges" });
    assert.equal(b.status, 400, `${who} save-badges: HTTP ${b.status}`);
    assert.equal(b.json.error, "badge_missing_id_or_code");
  }
  for (const who of ["contentManager", "orderManager"]) {
    const p = await c.fn("admin-actions", { promotions: [{}] }, { token: S[who].token, query: "?action=save-promotions" });
    assert.equal(p.status, 403, `${who} save-promotions`);
    const b = await c.fn("admin-actions", { badges: [{}] }, { token: S[who].token, query: "?action=save-badges" });
    assert.equal(b.status, 403, `${who} save-badges`);
  }
  assert.deepEqual((await c.svc("promotions?select=id,enabled,sort_order,data&order=id")).json, promosBefore.json);
  assert.deepEqual((await c.svc("patches?select=id,active,sort_order,data,supplier_ref&order=id")).json, badgesBefore.json);
});

/* ── concurrency: compare-and-set order transitions (migration 0008) ─────────
   N near-simultaneous identical "mark paid" requests (double-click, two tabs,
   two staff members) must produce exactly ONE transition: one winner that
   writes, emails, audits and queues one Sheets row; every other request is a
   200 `alreadyApplied` that changes nothing. Each burst uses a fresh unpaid
   order whose customer address sits on its own example.test subdomain, so the
   console email lines in the functions log are attributable to it. */

/** `orders.version` (0008). NaN — never a throw — when the column is missing,
 * so against a pre-0008 database the burst still runs and the email count is
 * what fails first. */
function orderVersion(orderNumber) {
  const r = psql(`select version from public.orders where order_number = ${sqlText(orderNumber)};`, { allowError: true });
  return r.status === 0 ? Number(r.stdout.trim()) : Number.NaN;
}
const transitionRpc = (args) => c.svc("rpc/transition_order_data", { method: "POST", body: args });
const PAID_TRANSITION_KEYS = new Set(["paymentStatus", "fulfillmentStatus", "paymentHistory", "tracking", "customerEmails"]);

async function markPaidBurst(n) {
  const o = await place("it-retro-regular");
  const before0 = await c.orderRow(o.orderNumber);
  assert.equal(before0.payment_status, "awaiting_payment");
  const v0 = orderVersion(o.orderNumber);
  const sheets0 = countRows("public.sheets_sync_log", `order_number = ${sqlText(o.orderNumber)}`);
  const audits0 = countRows("public.audit_log", `action = 'order_updated' and target = ${sqlText(o.orderNumber)}`);

  const results = await Promise.all(Array.from({ length: n }, () => update("orderManager", o.orderNumber, { paymentStatus: "paid" })));

  // The user-visible bug first: how many "payment confirmed" emails went out.
  const paidLines = (await emailSubjects(o.domainTag, 2000)).filter((s) => s === SUBJECT.paid);
  const shape = results.map((r) => `${r.status}${r.json?.alreadyApplied ? ":alreadyApplied" : ""}`).join(",");
  assert.equal(paidLines.length, 1, `${n}x parallel mark-paid sent ${paidLines.length} payment-confirmed emails (responses ${shape})`);

  // Exactly one request applied the change; every other one is a 200 no-op.
  const winners = results.filter((r) => r.status === 200 && r.json?.ok === true && r.json.alreadyApplied !== true);
  const losers = results.filter((r) => !winners.includes(r));
  assert.equal(winners.length, 1, `${n}x: exactly one request must apply the change (responses ${shape})`);
  assert.equal(winners[0].json.order.paymentStatus, "paid");
  for (const r of losers) {
    assert.equal(r.status, 200, `${n}x loser: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.alreadyApplied, true, `${n}x loser must report alreadyApplied (responses ${shape})`);
    assert.equal(r.json.order.paymentStatus, "paid", "a loser returns the already-paid order");
  }

  const after = await c.orderRow(o.orderNumber);
  // Money state: column and document agree.
  assert.equal(after.payment_status, "paid");
  assert.equal(after.data.paymentStatus, "paid");
  assert.equal(after.fulfillment_status, "payment_confirmed");
  assert.equal(after.data.fulfillmentStatus, "payment_confirmed");
  // History: exactly ONE awaiting_payment → paid entry, appended to what was there.
  const hist0 = before0.data.paymentHistory ?? [];
  assert.equal(after.data.paymentHistory.length, hist0.length + 1, `${n}x: paymentHistory entries`);
  assert.deepEqual(after.data.paymentHistory.slice(0, hist0.length), hist0);
  const entry = after.data.paymentHistory.at(-1);
  assert.equal(entry.from, "awaiting_payment");
  assert.equal(entry.to, "paid");
  assert.equal(entry.by, S.orderManager.email);
  // Tracking: exactly one new payment_confirmed step, no duplicates.
  const track0 = before0.data.tracking ?? [];
  assert.equal(after.data.tracking.length, track0.length + 1, `${n}x: tracking entries`);
  assert.deepEqual(after.data.tracking.slice(0, track0.length), track0);
  assert.equal(after.data.tracking.at(-1).status, "payment_confirmed");
  const statuses = after.data.tracking.map((t) => t.status);
  assert.equal(new Set(statuses).size, statuses.length, `duplicate tracking statuses: ${statuses.join(",")}`);
  // Ledger: one attempt, recorded without disturbing the other milestones.
  const rec = after.data.customerEmails.payment_confirmed;
  assert.ok(rec, "payment_confirmed recorded in the ledger");
  assert.equal(rec.attempts, 1, `${n}x: ledger attempts`);
  assert.ok(["sent", "disabled"].includes(rec.status), `ledger status ${rec.status} (console mode → disabled)`);
  for (const [k, v] of Object.entries(before0.data.customerEmails ?? {})) assert.deepEqual(after.data.customerEmails[k], v, `ledger key ${k} changed`);
  // One audit row, one new Sheets queue row.
  assert.equal(countRows("public.audit_log", `action = 'order_updated' and target = ${sqlText(o.orderNumber)}`) - audits0, 1, `${n}x: order_updated audit rows`);
  assert.equal(countRows("public.sheets_sync_log", `order_number = ${sqlText(o.orderNumber)}`) - sheets0, 1, `${n}x: new sheets_sync_log rows`);
  // Everything else on the order (items, totals, customer, notes, supplier
  // fields, owner alert, sheets status, …) is byte-identical.
  for (const k of new Set([...Object.keys(before0.data), ...Object.keys(after.data)])) {
    if (PAID_TRANSITION_KEYS.has(k)) continue;
    assert.equal(JSON.stringify(after.data[k]), JSON.stringify(before0.data[k]), `${n}x: unrelated key ${k} changed`);
  }
  for (const col of ["id", "customer_id", "contact_hash", "total_ils", "locale", "idempotency_key"]) assert.deepEqual(after[col], before0[col], `column ${col} changed`);

  // Version: exactly two committed writes — the winner's transition and its
  // ledger record. Losers wrote nothing.
  const v1 = orderVersion(o.orderNumber);
  assert.equal(v1 - v0, 2, `${n}x: version moved ${v0} → ${v1}`);
  // A direct compare-and-set with the stale version is refused and changes nothing.
  const stale = await transitionRpc({ p_order_number: o.orderNumber, p_expected_version: v0, p_patch: { itStaleProbe: true }, p_payment_status: "refunded" });
  assert.equal(stale.status, 200, `stale transition: HTTP ${stale.status}`);
  assert.equal(stale.json.applied, false);
  assert.equal(Number(stale.json.version), v1);
  const final = await c.orderRow(o.orderNumber);
  assert.deepEqual(final, after, "a stale transition changed the order");
  assert.equal(orderVersion(o.orderNumber), v1);
}

test("concurrency: 2 then 5 parallel identical 'mark paid' updates → exactly one transition, one email, one audit row, one sheets row", async () => {
  await markPaidBurst(2);
  await markPaidBurst(5);
});

/* ── concurrency: resend-customer-email claims before sending ───────────── */

const resend = (who, orderNumber, event) => c.fn("admin-actions", { orderNumber, event }, { token: S[who].token, query: "?action=resend-customer-email" });

/** Console lines for one milestone, attributed to this order's address. */
async function milestoneLines(domainTag, event, settleMs = 2000) {
  await sleep(settleMs);
  return functionLogLines().filter((l) => l.includes(`@${domainTag}.example.test`) && l.includes(`[customer-email:${event}:`));
}

/** Marks a milestone as FAILED in the stored ledger (as a provider outage would), with an old timestamp. */
function markMilestoneFailed(orderNumber, event, attempts) {
  const rec = JSON.stringify({ status: "failed", at: "2026-01-01T00:00:00.000Z", attempts, error: "IT simulated provider failure" });
  psql(
    `update public.orders set data = jsonb_set(data, '{customerEmails,${event}}', (data->'customerEmails'->'${event}') || ${sqlText(rec)}::jsonb) ` +
      `where order_number = ${sqlText(orderNumber)};`,
  );
}

async function resendBurst(n) {
  const o = await place("it-retro-regular");
  const event = "order_received";
  markMilestoneFailed(o.orderNumber, event, 1);
  const before0 = await c.orderRow(o.orderNumber);
  assert.equal(before0.data.customerEmails[event].status, "failed");
  const lines0 = (await milestoneLines(o.domainTag, event, 1200)).length;
  const v0 = orderVersion(o.orderNumber);
  const audits0 = countRows("public.audit_log", `action = 'customer_email_retried' and target = ${sqlText(o.orderNumber)}`);

  const results = await Promise.all(Array.from({ length: n }, () => resend("orderManager", o.orderNumber, event)));
  const shape = results.map((r) => r.status).join(",");

  // At most one email: exactly one new console line for this milestone.
  const newLines = (await milestoneLines(o.domainTag, event)).length - lines0;
  assert.equal(newLines, 1, `${n}x concurrent resends wrote ${newLines} email lines (responses ${shape})`);
  // One request sent (200; console mode reports "Not sent (disabled)"), the rest were refused before sending.
  const sent = results.filter((r) => r.status === 200);
  assert.equal(sent.length, 1, `${n}x: exactly one resend may send (responses ${shape})`);
  for (const r of results.filter((x) => x.status !== 200)) {
    assert.equal(r.status, 409, `${n}x loser: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.ok, false);
  }

  const after = await c.orderRow(o.orderNumber);
  const rec = after.data.customerEmails[event];
  assert.equal(rec.attempts, 2, `${n}x: ledger attempts (1 failed + 1 resend)`);
  assert.ok(["sent", "disabled"].includes(rec.status), `ledger status ${rec.status}`);
  const claim = after.data.customerEmailResends?.[event];
  assert.ok(claim, "the resend claim is recorded");
  assert.equal(claim.attempts, 1);
  assert.equal(claim.by, S.orderManager.email);
  assert.equal(countRows("public.audit_log", `action = 'customer_email_retried' and target = ${sqlText(o.orderNumber)}`) - audits0, 1, `${n}x: retry audit rows`);
  // Two committed writes: the claim and the ledger entry. Nothing else moved.
  assert.equal(orderVersion(o.orderNumber) - v0, 2, `${n}x: version delta`);
  for (const k of new Set([...Object.keys(before0.data), ...Object.keys(after.data)])) {
    if (k === "customerEmails" || k === "customerEmailResends") continue;
    assert.equal(JSON.stringify(after.data[k]), JSON.stringify(before0.data[k]), `${n}x: unrelated key ${k} changed`);
  }
  for (const [k, v] of Object.entries(before0.data.customerEmails)) if (k !== event) assert.deepEqual(after.data.customerEmails[k], v);
  assert.equal(after.payment_status, before0.payment_status);
  assert.equal(after.fulfillment_status, before0.fulfillment_status);

  // An immediate further retry is refused (claim cooldown) and sends nothing.
  const again = await resend("orderManager", o.orderNumber, event);
  assert.equal(again.status, 409);
  assert.equal((await milestoneLines(o.domainTag, event, 1200)).length - lines0, 1);
}

test("concurrency: 2 then 5 parallel resends of a FAILED milestone → at most one email, consistent ledger, one audit row", async () => {
  await resendBurst(2);
  await resendBurst(5);
});

test("resend: a milestone already delivered (sent) is still refused, sends nothing and writes nothing", async () => {
  const o = await place("it-retro-regular");
  psql(
    `update public.orders set data = jsonb_set(data, '{customerEmails,order_received,status}', '"sent"') where order_number = ${sqlText(o.orderNumber)};`,
  );
  const lines0 = (await milestoneLines(o.domainTag, "order_received", 1200)).length;
  const before0 = await c.orderRow(o.orderNumber);
  const v0 = orderVersion(o.orderNumber);
  const results = await Promise.all([1, 2].map(() => resend("orderManager", o.orderNumber, "order_received")));
  for (const r of results) {
    assert.equal(r.status, 409);
    assert.match(r.json.message, /already delivered/);
    assert.equal(r.json.error, r.json.message, "409 body must carry `error` for the Admin client");
  }
  assert.deepEqual(await c.orderRow(o.orderNumber), before0);
  assert.equal(orderVersion(o.orderNumber), v0);
  assert.equal((await milestoneLines(o.domainTag, "order_received", 1500)).length, lines0);
});

/* ── concurrency: the 0008 database functions themselves ────────────────── */

const rpcAs = (fnClient, name, args) => fnClient(`rpc/${name}`, { method: "POST", body: args });

test("concurrency: transition_order_data — two calls with the same expected version → exactly one applied; the trigger versions every write", async () => {
  const o = await place("it-retro-regular");
  const v0 = orderVersion(o.orderNumber);
  const [a, b] = await Promise.all([
    rpcAs(c.svc, "transition_order_data", { p_order_number: o.orderNumber, p_expected_version: v0, p_patch: { itCasA: 1 } }),
    rpcAs(c.svc, "transition_order_data", { p_order_number: o.orderNumber, p_expected_version: v0, p_patch: { itCasB: 1 } }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const applied = [a, b].filter((r) => r.json.applied === true);
  assert.equal(applied.length, 1, `applied: ${JSON.stringify([a.json.applied, b.json.applied])}`);
  const loser = [a, b].find((r) => r.json.applied !== true);
  assert.deepEqual(loser.json, { applied: false, version: v0 + 1 });
  assert.equal(applied[0].json.version, v0 + 1);
  const row = await c.orderRow(o.orderNumber);
  assert.equal(("itCasA" in row.data) + ("itCasB" in row.data), 1, "exactly one patch landed");
  assert.deepEqual(applied[0].json.data, row.data);
  assert.equal(orderVersion(o.orderNumber), v0 + 1);

  // Status columns: coalesced like patch_order_data; a stale version writes nothing.
  const v1 = v0 + 1;
  const s1 = await rpcAs(c.svc, "transition_order_data", { p_order_number: o.orderNumber, p_expected_version: v1, p_patch: {}, p_fulfillment_status: "awaiting_payment" });
  assert.equal(s1.json.applied, true);
  assert.equal((await c.orderRow(o.orderNumber)).payment_status, row.payment_status, "payment column untouched when not passed");
  const missing = await rpcAs(c.svc, "transition_order_data", { p_order_number: "CR-IT-NO-SUCH-ORDER", p_expected_version: 0, p_patch: {} });
  assert.deepEqual(missing.json, { applied: false, version: null });
  for (const bad of [[], "x", null]) {
    const r = await rpcAs(c.svc, "transition_order_data", { p_order_number: o.orderNumber, p_expected_version: v1 + 1, p_patch: bad });
    assert.ok(r.status >= 400, `non-object patch ${JSON.stringify(bad)}: HTTP ${r.status}`);
    assert.equal(r.json?.code, "22023");
  }

  // Every writer bumps the version, and a writer cannot forge it.
  const vBefore = orderVersion(o.orderNumber);
  const forged = await c.svc(`orders?order_number=eq.${encodeURIComponent(o.orderNumber)}`, { method: "PATCH", body: { version: 999999 } });
  assert.ok(forged.status < 300, `service PATCH: HTTP ${forged.status}`);
  assert.equal(orderVersion(o.orderNumber), vBefore + 1, "the trigger overrides an explicit version");
  await rpcAs(c.svc, "patch_order_data", { p_order_number: o.orderNumber, p_patch: { itViaPatch: 1 } });
  assert.equal(orderVersion(o.orderNumber), vBefore + 2, "patch_order_data bumps the version too");
});

test("transition_order_data / record_order_customer_email: EXECUTE denied for anon and authenticated (42501), granted to service_role", async () => {
  const o = await place("it-retro-regular");
  const before0 = await c.orderRow(o.orderNumber);
  const v0 = orderVersion(o.orderNumber);
  const callers = [
    ["anon", c.rest],
    ["customerA", c.asUser(S.customerA.token)],
    ...["contentManager", "orderManager", "admin", "owner"].map((k) => [k, c.asUser(S[k].token)]),
  ];
  for (const [who, fnClient] of callers) {
    const t = await rpcAs(fnClient, "transition_order_data", { p_order_number: o.orderNumber, p_expected_version: v0, p_patch: { itHacked: who }, p_payment_status: "paid" });
    assert.ok([401, 403].includes(t.status), `${who} transition: HTTP ${t.status}`);
    assert.equal(t.json?.code, "42501", `${who} transition`);
    const r = await rpcAs(fnClient, "record_order_customer_email", { p_order_number: o.orderNumber, p_event: "payment_confirmed", p_record: { status: "sent" } });
    assert.ok([401, 403].includes(r.status), `${who} record: HTTP ${r.status}`);
    assert.equal(r.json?.code, "42501", `${who} record`);
  }
  assert.deepEqual(await c.orderRow(o.orderNumber), before0, "a refused RPC changed the order");
  assert.equal(orderVersion(o.orderNumber), v0);

  const q = (sql) => psqlScalar(`select ${sql};`);
  for (const sig of ["'public.transition_order_data(text, bigint, jsonb, text, text)'", "'public.record_order_customer_email(text, text, jsonb)'"]) {
    assert.equal(q(`has_function_privilege('anon', ${sig}, 'EXECUTE')`), "f", sig);
    assert.equal(q(`has_function_privilege('authenticated', ${sig}, 'EXECUTE')`), "f", sig);
    assert.equal(q(`has_function_privilege('service_role', ${sig}, 'EXECUTE')`), "t", sig);
  }
  for (const name of ["transition_order_data", "record_order_customer_email"]) {
    assert.equal(q(`exists (select 1 from pg_proc p, unnest(p.proacl) a where p.proname = '${name}' and a::text like '=%')`), "f", `${name}: PUBLIC grant`);
    assert.equal(q(`(select prosecdef from pg_proc where proname = '${name}')`), "t", `${name}: security definer`);
  }
});

test("record_order_customer_email: writes only customerEmails.<event>, preserving other ledger keys and every other data key", async () => {
  const o = await place("it-retro-regular");
  const before0 = await c.orderRow(o.orderNumber);
  assert.ok(before0.data.customerEmails.order_received, "precondition: order_received recorded at checkout");
  const record = { status: "failed", at: "2026-01-02T00:00:00.000Z", attempts: 1, error: "IT probe" };
  const r = await rpcAs(c.svc, "record_order_customer_email", { p_order_number: o.orderNumber, p_event: "shipped", p_record: record });
  assert.equal(r.status, 200);
  const after = await c.orderRow(o.orderNumber);
  assert.deepEqual(r.json, after.data);
  assert.deepEqual(after.data.customerEmails, { ...before0.data.customerEmails, shipped: record });
  for (const k of Object.keys(before0.data)) if (k !== "customerEmails") assert.deepEqual(after.data[k], before0.data[k], `key ${k} changed`);
  // Replacing one event keeps the others.
  const record2 = { ...record, status: "disabled", attempts: 2 };
  await rpcAs(c.svc, "record_order_customer_email", { p_order_number: o.orderNumber, p_event: "shipped", p_record: record2 });
  assert.deepEqual((await c.orderRow(o.orderNumber)).data.customerEmails, { ...before0.data.customerEmails, shipped: record2 });
  const bad = await rpcAs(c.svc, "record_order_customer_email", { p_order_number: o.orderNumber, p_event: "shipped", p_record: [1] });
  assert.equal(bad.json?.code, "22023");
  const none = await rpcAs(c.svc, "record_order_customer_email", { p_order_number: "CR-IT-NO-SUCH-ORDER", p_event: "shipped", p_record: record });
  assert.equal(none.status, 200);
  assert.equal(none.json, null);
});
