/**
 * Runs the REAL place-order handler source under Node, with only its I/O
 * stubbed. Nothing about validation or pricing is re-implemented here: the
 * handler file is loaded as text, its imports of the four I/O modules
 * (helpers, customer-notifications, owner-notification, customer-order) are
 * replaced by in-memory stubs, any other relative import is rewritten to an
 * absolute URL, and `Deno.serve` captures the request handler.
 *
 * The stubs answer PostgREST paths from a fixture (see
 * order-pricing-cases.ts), record the `orders` insert, and freeze the clock.
 * This is how the golden outputs were captured from the baseline handler and
 * how the golden test replays the current one.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GoldenCase, OrderFixture, Row } from "./order-pricing-cases.ts";

export const BASELINE_SHA = "c532a2bd7b15a8be75a273972be5059061995369";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HANDLER_REL = "supabase/functions/place-order/index.ts";
const HANDLER_DIR_URL = pathToFileURL(join(REPO_ROOT, "supabase/functions/place-order/")).href;

/** Modules whose exports are replaced by stubs (all do I/O or formatting
 * that is out of scope for pricing). */
const STUBBED_MODULES = ["helpers.ts", "customer-notifications.ts", "owner-notification.ts", "customer-order.ts"];
const STUB_NAMES = [
  "audit",
  "callerProfile",
  "contactHash",
  "db",
  "dbInsert",
  "dbRpc",
  "dbSelect",
  "dbUpdate",
  "handleError",
  "json",
  "preflight",
  "deliverStatusEmail",
  "sendOwnerOrderNotification",
  "shouldSendOwnerNotification",
  "toCustomerOrderData",
];

export function currentHandlerSource(): string {
  return readFileSync(join(REPO_ROOT, HANDLER_REL), "utf8");
}

export function baselineHandlerSource(): string {
  return execFileSync("git", ["show", `${BASELINE_SHA}:${HANDLER_REL}`], { cwd: REPO_ROOT, encoding: "utf8" });
}

/** Text transform — the handler body is left untouched. */
export function transformHandlerSource(src: string): string {
  const out: string[] = [];
  let sawServe = false;
  for (const lineText of src.split(/\r?\n/)) {
    const m = /^import\s.*\sfrom\s+"([^"]+)";\s*$/.exec(lineText);
    if (m) {
      const spec = m[1]!;
      if (STUBBED_MODULES.some((mod) => spec.endsWith(`/${mod}`))) continue;
      if (spec.startsWith(".")) {
        out.push(lineText.replace(`"${spec}"`, `"${new URL(spec, HANDLER_DIR_URL).href}"`));
        continue;
      }
      throw new Error(`harness: unexpected import ${spec}`);
    }
    if (/^import\s/.test(lineText)) throw new Error(`harness: multi-line import not supported: ${lineText}`);
    if (lineText.startsWith("Deno.serve(")) sawServe = true;
    out.push(lineText);
  }
  if (!sawServe) throw new Error("harness: Deno.serve( not found");
  const prelude = [
    "const __po = (globalThis as any).__placeOrderHarness;",
    `const { ${STUB_NAMES.join(", ")} } = __po.stubs;`,
    "type OwnerNotificationResult = Record<string, unknown>;",
    "const Deno = { serve: (h: unknown) => { __po.handler = h; }, env: { get: (_k: string) => \"\" } };",
    "const crypto = { randomUUID: () => \"00000000-0000-4000-8000-000000000000\" };",
    "const fetch = async (..._a: unknown[]) => ({ ok: true });",
  ];
  return [...prelude, ...out].join("\n");
}

interface HarnessState {
  fixture: OrderFixture;
  orderRow?: Row;
  selects: string[];
}

interface HarnessReply {
  __harness: true;
  body: Row;
  status: number;
}

const harness = {
  state: undefined as HarnessState | undefined,
  handler: undefined as unknown,
  stubs: {} as Record<string, unknown>,
};

function st(): HarnessState {
  if (!harness.state) throw new Error("harness: no active run");
  return harness.state;
}

function eqParam(path: string): string | undefined {
  const m = /[?&]id=eq\.([^&]*)/.exec(path);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** Parses `id=in.(a,b)` where each value is URI-encoded and may be a
 * PostgREST double-quoted string with backslash escapes. */
function inParam(path: string): string[] | undefined {
  const m = /[?&]id=in\.\(([^)]*)\)/.exec(path);
  if (!m) return undefined;
  return m[1]!
    .split(",")
    .filter((s) => s !== "")
    .map((raw) => {
      const v = decodeURIComponent(raw);
      return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v;
    });
}

harness.stubs = {
  preflight: () => null,
  json: (body: Row, status = 200): HarnessReply => ({ __harness: true, body, status }),
  handleError: (_err: unknown): HarnessReply => ({ __harness: true, body: { ok: false, error: "internal_error" }, status: 500 }),
  dbSelect: async (path: string): Promise<Row[]> => {
    const s = st();
    s.selects.push(path);
    const f = s.fixture;
    if (path.startsWith("store_settings")) return f.settings ? [{ data: f.settings }] : [];
    if (path.startsWith("shipping_zones")) {
      const id = eqParam(path);
      return f.zones.filter((z) => z.id === id);
    }
    if (path.startsWith("patches")) return f.patches;
    if (path.startsWith("products")) {
      const one = eqParam(path);
      if (one !== undefined) return f.products.filter((p) => p.id === one);
      const many = inParam(path);
      if (many) return f.products.filter((p) => many.includes(p.id as string));
      throw new Error(`harness: unsupported products query ${path}`);
    }
    if (path.startsWith("promotions")) {
      // Stable sort by the column; ties keep fixture order (unspecified in a real DB).
      return [...f.promotions].sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0));
    }
    throw new Error(`harness: unexpected select ${path}`);
  },
  db: async (path: string) => {
    if (path === "rpc/generate_order_number") return { ok: true, json: async () => "CR-GOLDEN" };
    throw new Error(`harness: unexpected db call ${path}`);
  },
  dbInsert: async (table: string, row: Row) => {
    if (table === "orders") st().orderRow = JSON.parse(JSON.stringify(row)) as Row;
  },
  dbUpdate: async () => undefined,
  dbRpc: async () => null,
  audit: async () => undefined,
  callerProfile: async () => null,
  contactHash: async (email: string) => `hash(${email})`,
  deliverStatusEmail: async () => undefined,
  shouldSendOwnerNotification: () => false,
  sendOwnerOrderNotification: async () => {
    throw new Error("harness: owner alert must be guarded off");
  },
  toCustomerOrderData: (o: unknown) => o,
};

const loaded = new Map<string, (req: unknown) => Promise<unknown>>();

export async function loadHandler(src: string): Promise<(req: unknown) => Promise<unknown>> {
  const transformed = transformHandlerSource(src);
  const key = createHash("sha256").update(transformed).digest("hex").slice(0, 16);
  const cached = loaded.get(key);
  if (cached) return cached;
  (globalThis as Record<string, unknown>).__placeOrderHarness = harness;
  const dir = join(tmpdir(), "crowned-place-order-harness");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `place-order-${key}.ts`);
  writeFileSync(file, transformed, "utf8");
  harness.handler = undefined;
  await import(pathToFileURL(file).href);
  const h = harness.handler as ((req: unknown) => Promise<unknown>) | undefined;
  if (typeof h !== "function") throw new Error("harness: handler not captured");
  loaded.set(key, h);
  return h;
}

function fixedDate(fixedMs: number): DateConstructor {
  const Real = Date;
  const F = function (...args: unknown[]) {
    if (!new.target) return new Real(fixedMs).toString();
    return args.length === 0 ? new Real(fixedMs) : new (Real as any)(...args);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(F, Real);
  Object.defineProperty(F, "now", { value: () => fixedMs });
  Object.defineProperty(F, "prototype", { value: Real.prototype });
  return F;
}

/** Keys of the stored order that validation/pricing determines. */
const ORDER_KEYS = [
  "createdAt",
  "locale",
  "customer",
  "items",
  "subtotalIls",
  "promotion",
  "promotionDiscountIls",
  "deliveryIls",
  "freeDelivery",
  "totalIls",
  "zoneId",
  "paymentMethod",
  "paymentStatus",
  "fulfillmentStatus",
  "tracking",
  "supplierConfirmation",
];
const ROW_KEYS = ["customer_id", "contact_hash", "payment_status", "fulfillment_status", "total_ils", "locale", "created_at"];

const pick = (o: Row, keys: string[]): Row => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export type Outcome = Row;

export async function runCase(handler: (req: unknown) => Promise<unknown>, gc: GoldenCase): Promise<Outcome> {
  harness.state = { fixture: gc.db, selects: [] };
  const RealDate = Date;
  globalThis.Date = fixedDate(RealDate.parse(gc.nowIso));
  let reply: HarnessReply;
  try {
    reply = (await handler({ method: "POST", headers: new Headers(), json: async () => JSON.parse(JSON.stringify(gc.body ?? null)) })) as HarnessReply;
  } finally {
    globalThis.Date = RealDate;
  }
  const s = harness.state;
  harness.state = undefined;
  if (!reply || reply.__harness !== true) throw new Error("harness: handler returned a non-stub reply");
  if (reply.status !== 200 || reply.body.ok !== true) {
    if (s.orderRow) throw new Error("harness: an order was inserted for a failed request");
    return { status: reply.status, error: reply.body.error };
  }
  const row = s.orderRow;
  if (!row) throw new Error("harness: success without an orders insert");
  return JSON.parse(
    JSON.stringify({
      status: 200,
      orderNumber: reply.body.orderNumber,
      trackingContact: reply.body.trackingContact,
      row: pick(row, ROW_KEYS),
      order: pick(row.data as Row, ORDER_KEYS),
    }),
  ) as Outcome;
}
