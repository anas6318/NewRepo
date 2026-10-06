/**
 * Checkout idempotency (A2-S3, shared contract §Idempotency): one checkout
 * attempt creates at most one order.
 *
 *  1. the pure module (supabase/functions/_shared/order-idempotency.ts):
 *     key parsing, canonical request hash, decideReplay matrix;
 *  2. the REAL place-order handler executed under Node with its I/O stubbed
 *     (same text transform as the golden harness) against an in-memory
 *     `orders` table that enforces the unique index — replay, conflict,
 *     contact mismatch, legacy, and two concurrent requests with one key;
 *  3. static wiring checks for what the harness cannot see (ordering);
 *  4. the demo service, executed in Node, with the same semantics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  IDEMPOTENCY_UNIQUE_INDEX,
  canonicalJson,
  canonicalOrderRequest,
  decideReplay,
  isIdempotencyUniqueViolation,
  parseIdempotencyKey,
  quickFingerprint,
  requestHashInput,
} from "../../supabase/functions/_shared/order-idempotency.ts";
import { toCustomerOrderData } from "../../supabase/functions/_shared/customer-order.ts";
import { currentHandlerSource, transformHandlerSource } from "./fixtures/place-order-harness.ts";
import { CUSTOMER, body as orderBody, db as fixtureDb, line, type OrderFixture, type Row } from "./fixtures/order-pricing-cases.ts";
import { DemoDataService } from "../../src/services/demo/DemoDataService.ts";
import type { PlaceOrderInput } from "../../src/services/DataService.ts";
import type { Order } from "../../src/services/types.ts";

const KEY = "3b241101-e2bb-4255-8caf-4136c566a962";
const KEY2 = "9f1c2d3e-4b5a-4c6d-9e8f-0a1b2c3d4e5f";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* ── 1. pure module ─────────────────────────────────────────────────────── */

test("parseIdempotencyKey: absent → legacy, UUID v4 → key (lower-cased), anything else → invalid", () => {
  assert.deepEqual(parseIdempotencyKey(undefined), { ok: true });
  assert.deepEqual(parseIdempotencyKey(null), { ok: true });
  assert.deepEqual(parseIdempotencyKey(KEY), { ok: true, key: KEY });
  assert.deepEqual(parseIdempotencyKey(KEY.toUpperCase()), { ok: true, key: KEY }, "one UUID, one key, whatever the case");
  for (const bad of [
    "",
    "not-a-uuid",
    "3b241101-e2bb-1255-8caf-4136c566a962", // version 1
    "3b241101-e2bb-4255-7caf-4136c566a962", // bad variant
    `${KEY} `,
    ` ${KEY}`,
    `${KEY}x`,
    "3b241101e2bb42558caf4136c566a962",
    "' or 1=1 --",
    "3b241101-e2bb-4255-8caf-4136c566a962&idempotency_key=is.null",
    42,
    {},
    [KEY],
    true,
  ]) {
    assert.deepEqual(parseIdempotencyKey(bad), { ok: false }, `must reject ${JSON.stringify(bad)}`);
  }
});

const base = (): Row => orderBody([line("retro-1", { quantity: 2, personalization: { name: "DANA", number: "10" } })], { marketingConsent: false });

test("canonical request: stable across key order, whitespace the server trims, and non-order fields", () => {
  const a = base();
  const reordered = JSON.parse(
    JSON.stringify({
      marketingConsent: false,
      lines: [{ quantity: 2, size: "M", personalization: { number: " 10 ", name: "DANA " }, productId: "retro-1" }],
      paymentMethod: "bank_transfer",
      zoneId: "north",
      customer: { address: " 1 Herzl St ", city: "Haifa ", phone: " 0501234567", email: " dana@example.com ", name: "  Dana Levi" },
      locale: "en",
    }),
  );
  assert.equal(requestHashInput(reordered), requestHashInput(a));
  // The key itself and unknown keys never contribute.
  assert.equal(requestHashInput({ ...a, idempotencyKey: KEY, isAdmin: true, totalIls: 1 }), requestHashInput(a));
  // notes: absent, null and "" are all "no notes" (as in sanitizeCustomer).
  const withNotes = (notes: unknown) => ({ ...a, customer: { ...CUSTOMER, notes } });
  assert.equal(requestHashInput(withNotes("")), requestHashInput(a));
  assert.equal(requestHashInput(withNotes(null)), requestHashInput(a));
  assert.equal(requestHashInput(withNotes("   ")), requestHashInput(a));
  // patchId is the legacy spelling of badgeId.
  assert.equal(
    requestHashInput(orderBody([line("retro-1", { patchId: "pl" })])),
    requestHashInput(orderBody([line("retro-1", { badgeId: "pl" })])),
  );
  // empty personalization == none
  assert.equal(
    requestHashInput(orderBody([line("retro-1", { personalization: { name: " ", number: "" } })])),
    requestHashInput(orderBody([line("retro-1")])),
  );
  // canonicalJson sorts keys at every level
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalOrderRequest(a).v, 1);
});

test("canonical request: any field that defines the order changes the hash", () => {
  const h0 = requestHashInput(base());
  const variants: [string, Row][] = [
    ["quantity", orderBody([line("retro-1", { quantity: 3, personalization: { name: "DANA", number: "10" } })], { marketingConsent: false })],
    ["size", orderBody([line("retro-1", { quantity: 2, size: "L", personalization: { name: "DANA", number: "10" } })], { marketingConsent: false })],
    ["version", orderBody([line("retro-1", { quantity: 2, version: "fan", personalization: { name: "DANA", number: "10" } })], { marketingConsent: false })],
    ["sleeve", orderBody([line("retro-1", { quantity: 2, sleeve: "long", personalization: { name: "DANA", number: "10" } })], { marketingConsent: false })],
    ["badge", orderBody([line("retro-1", { quantity: 2, badgeId: "pl", personalization: { name: "DANA", number: "10" } })], { marketingConsent: false })],
    ["personalization", orderBody([line("retro-1", { quantity: 2, personalization: { name: "DANA", number: "11" } })], { marketingConsent: false })],
    ["product", orderBody([line("retro-2", { quantity: 2, personalization: { name: "DANA", number: "10" } })], { marketingConsent: false })],
    ["extra line", orderBody([line("retro-1", { quantity: 2, personalization: { name: "DANA", number: "10" } }), line("season-1")], { marketingConsent: false })],
    ["zone", { ...base(), zoneId: "center" }],
    ["payment", { ...base(), paymentMethod: "card" }],
    ["locale", { ...base(), locale: "he" }],
    ["consent", { ...base(), marketingConsent: true }],
    ["email", { ...base(), customer: { ...CUSTOMER, email: "other@example.com" } }],
    ["phone", { ...base(), customer: { ...CUSTOMER, phone: "0507654321" } }],
    ["address", { ...base(), customer: { ...CUSTOMER, address: "2 Herzl St" } }],
    ["notes", { ...base(), customer: { ...CUSTOMER, notes: "ring twice" } }],
  ];
  const seen = new Set([h0]);
  for (const [name, b] of variants) {
    const h = requestHashInput(b);
    assert.notEqual(h, h0, `${name} must change the request hash`);
    seen.add(h);
  }
  assert.equal(seen.size, variants.length + 1, "every variant hashes differently");
  // Line order is the stored order.
  const two = orderBody([line("retro-1"), line("season-1")]);
  const swapped = orderBody([line("season-1"), line("retro-1")]);
  assert.notEqual(requestHashInput(two), requestHashInput(swapped));
});

test("decideReplay matrix", () => {
  const r = { requestHash: "R", contactHash: "C" };
  assert.equal(decideReplay({ existing: null, ...r }), "create");
  assert.equal(decideReplay({ existing: { requestHash: "R", contactHash: "C" }, ...r }), "replay");
  assert.equal(decideReplay({ existing: { requestHash: "X", contactHash: "C" }, ...r }), "conflict", "same key, different request");
  assert.equal(decideReplay({ existing: { requestHash: "R", contactHash: "X" }, ...r }), "conflict", "same key + request, different contact");
  assert.equal(decideReplay({ existing: { requestHash: "X", contactHash: "X" }, ...r }), "conflict");
  // A stored order without readable bookkeeping fails closed.
  assert.equal(decideReplay({ existing: { requestHash: undefined, contactHash: "C" }, ...r }), "conflict");
  assert.equal(decideReplay({ existing: { requestHash: "R", contactHash: null }, ...r }), "conflict");
});

test("only a violation of orders_idempotency_key_uidx counts as a lost race", () => {
  const pgrst = (constraint: string) =>
    new Error(`db insert failed: 409 {"code":"23505","details":null,"hint":null,"message":"duplicate key value violates unique constraint \\"${constraint}\\""}`);
  assert.equal(isIdempotencyUniqueViolation(pgrst(IDEMPOTENCY_UNIQUE_INDEX)), true);
  assert.equal(isIdempotencyUniqueViolation(pgrst("orders_order_number_key")), false, "an order-number collision is not a replay");
  assert.equal(isIdempotencyUniqueViolation(pgrst("orders_pkey")), false);
  assert.equal(isIdempotencyUniqueViolation(new Error("db insert failed: 500 boom")), false);
  assert.equal(isIdempotencyUniqueViolation(undefined), false);
});

test("quickFingerprint is deterministic and discriminating", () => {
  assert.equal(quickFingerprint("abc"), quickFingerprint("abc"));
  assert.notEqual(quickFingerprint("abc"), quickFingerprint("abd"));
  assert.match(quickFingerprint(""), /^[0-9a-f]{28}$/);
});

/* ── 2. the real handler, I/O stubbed ───────────────────────────────────── */

interface StoredRow extends Row {
  order_number: string;
  contact_hash: string;
  idempotency_key?: string;
  data: Row;
}

interface World {
  fixture: OrderFixture;
  orders: StoredRow[];
  selects: string[];
  emails: number;
  ownerAlerts: number;
  sheetsRows: number;
  leads: number;
  audits: number;
  orderNumbers: number;
  /** Resolves every orders SELECT only once `n` of them are waiting —
   * forces two requests to both miss the key before either inserts. */
  barrier?: { n: number; waiting: (() => void)[] };
  failInsert?: Error;
}

let world: World;
const freshWorld = (): World => ({ fixture: fixtureDb(), orders: [], selects: [], emails: 0, ownerAlerts: 0, sheetsRows: 0, leads: 0, audits: 0, orderNumbers: 0 });

const stubs = {
  preflight: () => null,
  json: (body: Row, status = 200) => ({ __reply: true, body, status }),
  handleError: (err: unknown) => ({ __reply: true, body: { error: "internal_error", err: String(err) }, status: 500 }),
  dbSelect: async (path: string): Promise<Row[]> => {
    world.selects.push(path);
    const f = world.fixture;
    if (path.startsWith("orders?")) {
      const m = /idempotency_key=eq\.([^&]*)/.exec(path);
      assert.ok(m, `orders select must filter by key: ${path}`);
      const b = world.barrier;
      if (b) {
        await new Promise<void>((resolve) => {
          b.waiting.push(resolve);
          if (b.waiting.length >= b.n) {
            world.barrier = undefined;
            for (const w of b.waiting) w();
          }
        });
      }
      const key = decodeURIComponent(m[1]!);
      return world.orders.filter((o) => o.idempotency_key === key).map((o) => JSON.parse(JSON.stringify(o)) as Row);
    }
    if (path.startsWith("store_settings")) return f.settings ? [{ data: f.settings }] : [];
    if (path.startsWith("shipping_zones")) {
      const id = decodeURIComponent(/id=eq\.([^&]*)/.exec(path)![1]!);
      return f.zones.filter((z) => z.id === id);
    }
    if (path.startsWith("patches")) return f.patches;
    if (path.startsWith("products")) return f.products;
    if (path.startsWith("promotions")) return f.promotions;
    throw new Error(`unexpected select ${path}`);
  },
  db: async (path: string) => {
    if (path === "rpc/generate_order_number") {
      const n = ++world.orderNumbers;
      return { ok: true, json: async () => `CR-T${String(n).padStart(5, "0")}` };
    }
    throw new Error(`unexpected db call ${path}`);
  },
  dbInsert: async (table: string, row: Row) => {
    await Promise.resolve();
    if (table === "orders") {
      if (world.failInsert) throw world.failInsert;
      const r = JSON.parse(JSON.stringify(row)) as StoredRow;
      if (r.idempotency_key && world.orders.some((o) => o.idempotency_key === r.idempotency_key)) {
        throw new Error(
          `db insert failed: 409 {"code":"23505","details":"Key (idempotency_key)=(${r.idempotency_key}) already exists.","hint":null,"message":"duplicate key value violates unique constraint \\"orders_idempotency_key_uidx\\""}`,
        );
      }
      world.orders.push(r);
    } else if (table === "sheets_sync_log") world.sheetsRows++;
    else if (table === "leads") world.leads++;
    else throw new Error(`unexpected insert ${table}`);
  },
  dbUpdate: async () => undefined,
  dbRpc: async () => null,
  audit: async () => {
    world.audits++;
  },
  callerProfile: async () => null,
  contactHash: async (email: string) => `hash(${email.trim().toLowerCase().replace(/[\s-]/g, "")})`,
  deliverStatusEmail: async () => {
    world.emails++;
  },
  shouldSendOwnerNotification: () => true,
  sendOwnerOrderNotification: async () => {
    world.ownerAlerts++;
    return { status: "sent" };
  },
  toCustomerOrderData,
};

let handlerPromise: Promise<(req: unknown) => Promise<{ body: Row; status: number }>> | undefined;
function handler() {
  handlerPromise ??= (async () => {
    const transformed = transformHandlerSource(currentHandlerSource());
    const g = globalThis as Record<string, unknown>;
    const h = { stubs, handler: undefined as unknown };
    g.__placeOrderHarness = h;
    const dir = join(tmpdir(), "crowned-place-order-idem");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `place-order-idem-${sha256(transformed).slice(0, 16)}-${process.pid}.ts`);
    writeFileSync(file, transformed, "utf8");
    await import(pathToFileURL(file).href);
    assert.equal(typeof h.handler, "function");
    return h.handler as (req: unknown) => Promise<{ body: Row; status: number }>;
  })();
  return handlerPromise;
}

async function post(b: unknown) {
  const h = await handler();
  return h({ method: "POST", headers: new Headers(), json: async () => JSON.parse(JSON.stringify(b)) });
}

const withKey = (b: Row, key = KEY): Row => ({ ...b, idempotencyKey: key });
const sideEffects = () => ({ orders: world.orders.length, emails: world.emails, ownerAlerts: world.ownerAlerts, sheetsRows: world.sheetsRows, leads: world.leads, audits: world.audits });

test("handler: first request with a key creates the order and stores key + request hash", async () => {
  world = freshWorld();
  const res = await post(withKey(base()));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.duplicate, undefined, "a fresh order is not a duplicate");
  assert.deepEqual(sideEffects(), { orders: 1, emails: 1, ownerAlerts: 1, sheetsRows: 1, leads: 0, audits: 1 });
  const row = world.orders[0]!;
  assert.equal(row.idempotency_key, KEY);
  assert.deepEqual(row.data.idempotency, { key: KEY, requestHash: sha256(requestHashInput(base())) });
  assert.equal(JSON.stringify(res.body).includes(KEY), false, "the bookkeeping is never echoed to the browser");
  assert.equal((res.body.order as Row).idempotency, undefined);
});

test("handler: same key + same request (reformatted) → replay of the same order, no side effects, no pricing reads", async () => {
  world = freshWorld();
  const first = await post(withKey({ ...base(), marketingConsent: true }));
  const before = sideEffects();
  world.selects = [];
  const reformatted = JSON.parse(JSON.stringify({ ...base(), marketingConsent: true, customer: { ...CUSTOMER, name: "  Dana Levi " } })) as Row;
  const again = await post(withKey(reformatted, KEY.toUpperCase()));
  assert.equal(again.status, 200);
  assert.equal(again.body.ok, true);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.orderNumber, first.body.orderNumber);
  assert.equal(again.body.trackingContact, CUSTOMER.email);
  assert.deepEqual(again.body.order, JSON.parse(JSON.stringify(first.body.order)), "the same sanitized order (as it travels over JSON)");
  assert.deepEqual(sideEffects(), before, "no second order, email, owner alert, Sheets row, lead or audit");
  assert.equal(world.orderNumbers, 1, "no order number was spent on the replay");
  assert.deepEqual(
    world.selects.map((s) => s.split("?")[0]),
    ["orders"],
    "a replay reads only the order it replays",
  );
  assert.equal((again.body.order as Row).idempotency, undefined, "the replay is sanitized too");
});

test("handler: same key + different request → 409 idempotency_conflict revealing nothing", async () => {
  world = freshWorld();
  await post(withKey(base()));
  const before = sideEffects();
  const changed = orderBody([line("retro-1", { quantity: 3, personalization: { name: "DANA", number: "10" } })], { marketingConsent: false });
  const res = await post(withKey(changed));
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { ok: false, error: "idempotency_conflict" });
  assert.deepEqual(sideEffects(), before);
});

test("handler: a key cannot be used to read someone else's order (contact mismatch → 409)", async () => {
  world = freshWorld();
  await post(withKey(base()));
  // An attacker who learned the key replays it with their own contact.
  const res = await post(withKey({ ...base(), customer: { ...CUSTOMER, email: "attacker@example.com" } }));
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { ok: false, error: "idempotency_conflict" }, "no order number, no order, no contact");
  assert.equal(world.orders.length, 1);
});

test("handler: a malformed key is a 400 before any read", async () => {
  world = freshWorld();
  const res = await post({ ...base(), idempotencyKey: "abc" });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: "invalid_idempotency_key" });
  assert.deepEqual(world.selects, []);
  assert.equal(world.orders.length, 0);
});

test("handler: no key → legacy path (each request is a new order, no orders lookup)", async () => {
  world = freshWorld();
  const a = await post(base());
  const b = await post(base());
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.body.orderNumber, b.body.orderNumber);
  assert.equal(world.orders.length, 2);
  assert.equal(world.orders[0]!.idempotency_key, undefined, "legacy rows carry no key (NULL)");
  assert.equal(world.orders[0]!.data.idempotency, undefined);
  assert.ok(!world.selects.some((s) => s.startsWith("orders")), "no idempotency lookup without a key");
});

test("handler: two concurrent requests with one key → exactly one order, the loser replays the winner", async () => {
  world = freshWorld();
  world.barrier = { n: 2, waiting: [] };
  const [a, b] = await Promise.all([post(withKey(base())), post(withKey(base()))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.orderNumber, b.body.orderNumber, "both answers name the same order");
  assert.deepEqual([a.body.duplicate, b.body.duplicate].sort(), [true, undefined].sort(), "exactly one is the replay");
  assert.equal(world.orderNumbers, 2, "both got past the lookup (the race was real)");
  assert.deepEqual(sideEffects(), { orders: 1, emails: 1, ownerAlerts: 1, sheetsRows: 1, leads: 0, audits: 1 });
});

test("handler: concurrent requests with one key but different content → one order + one 409", async () => {
  world = freshWorld();
  world.barrier = { n: 2, waiting: [] };
  const other = { ...base(), zoneId: "center" };
  const [a, b] = await Promise.all([post(withKey(base())), post(withKey(other))]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.deepEqual(loser.body, { ok: false, error: "idempotency_conflict" });
  assert.equal(world.orders.length, 1);
  assert.equal(world.emails, 1);
});

test("handler: any other insert failure is not mistaken for a replay", async () => {
  world = freshWorld();
  world.failInsert = new Error('db insert failed: 409 {"code":"23505","message":"duplicate key value violates unique constraint \\"orders_order_number_key\\""}');
  const res = await post(withKey(base()));
  assert.equal(res.status, 500);
  assert.deepEqual(sideEffects(), { orders: 0, emails: 0, ownerAlerts: 0, sheetsRows: 0, leads: 0, audits: 0 });
});

/* ── 3. static wiring (ordering the harness cannot observe) ─────────────── */

const src = readFileSync(fileURLToPath(new URL("../../supabase/functions/place-order/index.ts", import.meta.url)), "utf8");

test("place-order wiring: lookup before pricing and side effects; side effects only after the insert landed", () => {
  const at = (s: string) => {
    const i = src.indexOf(s);
    assert.ok(i >= 0, `missing: ${s}`);
    return i;
  };
  assert.match(src, /import \{[^}]*\bdecideReplay\b[^}]*\} from "\.\.\/_shared\/order-idempotency\.ts";/);
  assert.ok(at("const early = validateOrderRequest(body);") < at("parseIdempotencyKey("));
  assert.ok(at("parseIdempotencyKey(") < at("await findOrderByIdempotencyKey(idem.key)"));
  assert.ok(at("await findOrderByIdempotencyKey(idem.key)") < at('await dbSelect<{ data: StoreSettingsData }>("store_settings'), "lookup precedes pricing reads");
  assert.ok(at("await findOrderByIdempotencyKey(idem.key)") < at("validateAndPriceOrder({"));
  const insert = at('await dbInsert("orders"');
  const catchAt = src.indexOf("isIdempotencyUniqueViolation(e)", insert);
  assert.ok(catchAt > insert, "the orders insert handles the unique violation");
  for (const effect of [
    'await dbInsert("sheets_sync_log"',
    'await dbInsert("leads"',
    'await audit("storefront", "order_created"',
    "await deliverStatusEmail(",
    "await sendOwnerOrderNotification(",
    "functions/v1/sheets-sync",
  ]) {
    assert.ok(at(effect) > catchAt, `${effect} must run only after the insert succeeded`);
  }
  assert.ok(src.includes("idempotency_key: idem.key"), "the unique column is written");
  assert.ok(src.includes("idempotency: { key: idem.key, requestHash: idemRequestHash }"), "data.idempotency is written");
  assert.ok(src.includes('json({ ok: false, error: "idempotency_conflict" }, 409)'));
  assert.ok(src.includes('json({ ok: false, error: "invalid_idempotency_key" }, 400)'));
  assert.ok(src.includes("order: toCustomerOrderData(data)"), "a replay is sanitized");
  assert.ok(src.includes("idempotency_key=eq.${encodeURIComponent(key)}"), "the key is encoded into the filter");
});

test("the idempotency module stays pure", () => {
  const mod = readFileSync(fileURLToPath(new URL("../../supabase/functions/_shared/order-idempotency.ts", import.meta.url)), "utf8");
  for (const banned of ["Deno.", "fetch(", "crypto.", "dbSelect", "Date.now("]) {
    assert.ok(!mod.includes(banned), `order-idempotency.ts must not use ${banned}`);
  }
});

/* ── 4. demo service parity ─────────────────────────────────────────────── */

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function freshService(): DemoDataService {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true, writable: true });
  }
  return new DemoDataService();
}

const demoDb = (svc: DemoDataService) => (svc as unknown as { db: { orders: Order[]; audit: unknown[]; leads: unknown[] } }).db;
const DEMO_CUSTOMER = { name: "Idem Tester", email: "idem@example.com", phone: "0501234567", city: "Haifa", address: "Test street 1" };
const demoInput = (extra: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  locale: "en",
  customer: DEMO_CUSTOMER,
  zoneId: "center",
  paymentMethod: "bank_transfer",
  lines: [{ productId: "demo-crimson-2005", size: "L", quantity: 1 }],
  marketingConsent: true,
  ...extra,
});
const mine = (svc: DemoDataService) => demoDb(svc).orders.filter((o) => o.customer.email === DEMO_CUSTOMER.email);

test("demo: replay returns the same order with one ledger entry, lead and audit row", async () => {
  const svc = freshService();
  const audit0 = demoDb(svc).audit.length;
  const a = await svc.placeOrder(demoInput({ idempotencyKey: KEY }));
  const b = await svc.placeOrder(demoInput({ idempotencyKey: KEY, customer: { ...DEMO_CUSTOMER, name: "  Idem Tester " } }));
  assert.equal(a.ok, true);
  assert.equal(a.duplicate, undefined);
  assert.equal(b.ok, true);
  assert.equal(b.duplicate, true);
  assert.equal(b.orderNumber, a.orderNumber);
  assert.deepEqual(b.order, a.order);
  const orders = mine(svc);
  assert.equal(orders.length, 1);
  assert.equal(Object.keys(orders[0]!.customerEmails ?? {}).length, 1, "one customer-email ledger entry");
  assert.equal(demoDb(svc).leads.length, 1, "one marketing lead");
  assert.equal(demoDb(svc).audit.length, audit0 + 1, "one audit row");
  assert.equal(orders[0]!.idempotency?.key, KEY, "stored for the owner");
  assert.equal((b.order as unknown as Row).idempotency, undefined, "never returned to the customer");
});

test("demo: same key with a different cart or contact → idempotency_conflict", async () => {
  const svc = freshService();
  await svc.placeOrder(demoInput({ idempotencyKey: KEY }));
  const changed = await svc.placeOrder(demoInput({ idempotencyKey: KEY, lines: [{ productId: "demo-crimson-2005", size: "L", quantity: 2 }] }));
  assert.deepEqual(changed, { ok: false, error: "idempotency_conflict" });
  const stranger = await svc.placeOrder(demoInput({ idempotencyKey: KEY, customer: { ...DEMO_CUSTOMER, email: "attacker@example.com" } }));
  assert.deepEqual(stranger, { ok: false, error: "idempotency_conflict" }, "no order data for another contact");
  assert.equal(mine(svc).length, 1);
});

test("demo: malformed key rejected; no key → legacy; a new key → a new order", async () => {
  const svc = freshService();
  assert.deepEqual(await svc.placeOrder(demoInput({ idempotencyKey: "nope" })), { ok: false, error: "invalid_idempotency_key" });
  const l1 = await svc.placeOrder(demoInput());
  const l2 = await svc.placeOrder(demoInput());
  assert.equal(l1.ok && l2.ok, true);
  assert.notEqual(l1.orderNumber, l2.orderNumber, "legacy: no key, no dedupe");
  const k1 = await svc.placeOrder(demoInput({ idempotencyKey: KEY }));
  const k2 = await svc.placeOrder(demoInput({ idempotencyKey: KEY2 }));
  assert.notEqual(k1.orderNumber, k2.orderNumber, "a fresh attempt is a fresh order");
  assert.equal(mine(svc).length, 4);
});

test("demo: concurrent double call with one key → one order", async () => {
  const svc = freshService();
  const [a, b] = await Promise.all([svc.placeOrder(demoInput({ idempotencyKey: KEY })), svc.placeOrder(demoInput({ idempotencyKey: KEY }))]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.orderNumber, b.orderNumber);
  assert.equal([a.duplicate, b.duplicate].filter(Boolean).length, 1);
  assert.equal(mine(svc).length, 1);
});

test("demo: a failed attempt stores nothing, so the same key then succeeds once", async () => {
  const svc = freshService();
  const bad = await svc.placeOrder(demoInput({ idempotencyKey: KEY, zoneId: "nowhere" }));
  assert.equal(bad.ok, false);
  // Same key, corrected request: the failed attempt created no order, so this creates.
  const good = await svc.placeOrder(demoInput({ idempotencyKey: KEY }));
  assert.equal(good.ok, true);
  assert.equal(good.duplicate, undefined);
  assert.equal(mine(svc).length, 1);
});

/* ── client wiring (CheckoutPage is TSX — static checks) ────────────────── */

test("checkout: one key per attempt — reuse, refresh on change, clear on success/409, sent to placeOrder", () => {
  const page = readFileSync(fileURLToPath(new URL("../../src/pages/storefront/CheckoutPage.tsx", import.meta.url)), "utf8");
  assert.ok(page.includes('CHECKOUT_IDEMPOTENCY_STORAGE_KEY = "crowned_checkout_idem_v1"'));
  assert.ok(page.includes("c.randomUUID()"), "UUID v4 from Web Crypto");
  assert.ok(page.includes("quickFingerprint(requestHashInput(input))"), "fingerprint = what the server hashes");
  assert.ok(page.includes("stored.fp === fp"), "reused only for the same attempt");
  assert.ok(page.includes("sessionStorage.setItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY"));
  assert.ok(page.includes('if (res.error === "idempotency_conflict") clearCheckoutIdempotencyKey();'));
  assert.ok(page.includes("placeOrder({ ...orderInput, ...(idempotencyKey ? { idempotencyKey } : {}) })"));
  const success = page.indexOf('track("purchase"');
  assert.ok(page.lastIndexOf("clearCheckoutIdempotencyKey();", success) > page.indexOf("if (!res.orderNumber)"), "cleared on success");
  assert.ok(page.includes("if (submittingRef.current || busy) return;"), "F5 re-entrancy guard intact");
  for (const loc of ["en", "ar", "he"]) {
    const dict = JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/lib/i18n/${loc}.json`, import.meta.url)), "utf8")) as { checkout: Record<string, string> };
    assert.ok((dict.checkout.error_idempotency_conflict ?? "").length > 10, `${loc}: conflict message`);
    assert.ok((dict.checkout.error_invalid_idempotency_key ?? "").length > 10, `${loc}: invalid-key message`);
  }
});
