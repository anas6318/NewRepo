/**
 * Data exposure hardening (migration 0007, A2-S1 / A2-S2 / A2-S4).
 *
 * SQL cannot run here (no Postgres), so the migration is checked
 * statically: comments are stripped first, so the rollback notes in the
 * header can never satisfy an assertion. The app-side fallbacks ARE run,
 * against a fake Supabase client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isMissingFunctionError,
  isMissingRelationError,
  PUBLIC_PRODUCTS_VIEW,
  SupabaseDataService,
} from "../../src/services/supabase/SupabaseDataService.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** SQL with `--` comments removed and whitespace collapsed, lower-cased. */
const RAW_SQL = read("../../supabase/migrations/0007_commerce_hardening.sql");
const SQL = RAW_SQL.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

/** The `create ... view public.products_public ... ;` statement. */
const VIEW = (() => {
  const start = SQL.indexOf("create or replace view public.products_public");
  assert.ok(start >= 0, "products_public view is created");
  return SQL.slice(start, SQL.indexOf(";", start));
})();

/** Keys removed wholesale from products.data by the view. */
const REMOVED = (() => {
  const m = VIEW.match(/p\.data - array\[([^\]]+)\]/);
  assert.ok(m, "the view subtracts a key list from data");
  return m[1]!.split(",").map((k) => k.trim().replace(/'/g, ""));
})();

/* ── products_public view ─────────────────────────────────────────────── */

test("0007 header documents purpose, manual application, deploy order and rollback", () => {
  const header = RAW_SQL.slice(0, RAW_SQL.indexOf("begin;"));
  for (const phrase of ["PURPOSE", "NOT APPLIED AUTOMATICALLY", "DEPLOY ORDER", "ROLLBACK"]) {
    assert.ok(header.includes(phrase), `header mentions ${phrase}`);
  }
  assert.ok(SQL.trimStart().startsWith("begin;") && SQL.includes("commit;"), "runs in one transaction");
});

test("the view removes every supplier/internal product key by name", () => {
  for (const key of ["supplier", "suppliernote", "supplierreference", "internalnotes"]) {
    assert.ok(REMOVED.includes(key), `${key} is removed from products.data`);
  }
  // Every supplier*/internal* key declared on Product must be covered.
  const types = read("../../src/services/types.ts");
  const product = types.slice(types.indexOf("export interface Product {"), types.indexOf("\n}", types.indexOf("export interface Product {")));
  const declared = [...product.matchAll(/^\s*((?:supplier|internal|cost)\w*)\??:/gm)].map((m) => m[1]!.toLowerCase());
  assert.ok(declared.includes("supplier"), "sanity: Product.supplier is found");
  for (const key of declared) assert.ok(REMOVED.includes(key), `Product.${key} is not stripped by products_public`);
});

test("every availability shape is rebuilt from status/lastCheckedAt only (no supplierNote)", () => {
  for (const shape of ["availability", "versionavailability", "sizeavailability"]) {
    assert.ok(REMOVED.includes(shape), `${shape} is removed before being rebuilt`);
    assert.ok(VIEW.includes(`'${shape}'`), `${shape} is re-added`);
  }
  // Outside the removal list, the only string literals the view uses are
  // the three shape names, the two allowlisted record keys and plumbing —
  // so no supplier/internal key can be copied into the output.
  const literals = [...VIEW.replace(/p\.data - array\[[^\]]+\]/, "").matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const allowed = new Set(["availability", "versionavailability", "sizeavailability", "status", "lastcheckedat", "object", "", "{}", "draft", "archived"]);
  for (const lit of literals) assert.ok(allowed.has(lit!), `unexpected key '${lit}' in products_public`);
  // Each shape names both kept keys twice: once as the output key, once as
  // the accessor on the stored record.
  assert.equal(VIEW.split("'lastcheckedat'").length - 1, 6, "lastCheckedAt kept in all three shapes");
  assert.equal(VIEW.split("'status'").length - 1, 6, "status kept in all three shapes");
  // AvailabilityRecord's own internal key is known to the test.
  assert.match(read("../../src/services/types.ts"), /supplierNote\?: string;/);
});

test("the view only exposes published rows and blocks leaky predicates", () => {
  assert.ok(VIEW.includes("where p.status not in ('draft', 'archived')"));
  assert.ok(VIEW.includes("security_barrier = true"));
  assert.ok(!VIEW.includes("security_invoker = true"), "owner-rights view: anon has no data column on products");
  assert.ok(VIEW.includes("select p.id, p.slug, p.status, p.category_slug,"));
});

test("anon/authenticated may only SELECT the view", () => {
  assert.ok(SQL.includes("revoke all on public.products_public from public;"));
  for (const role of ["anon", "authenticated"]) {
    assert.ok(SQL.includes(`revoke all on public.products_public from ${role};`), `revoke all from ${role}`);
    assert.ok(SQL.includes(`grant select on public.products_public to ${role};`), `grant select to ${role}`);
  }
  assert.ok(!/grant (all|insert|update|delete)[^;]*products_public/.test(SQL), "no write grant on the view");
});

/* ── raw products: no public data read ─────────────────────────────────── */

test("anon loses SELECT on raw products.data; non-staff authenticated lose row access", () => {
  assert.ok(SQL.includes("drop policy if exists products_public_read on public.products;"));
  const policy = SQL.match(/create policy products_public_read on public\.products ([^;]+);/);
  assert.ok(policy, "anon row policy recreated");
  assert.ok(policy[1]!.includes("for select to anon"), "policy applies to anon only (not authenticated)");
  assert.ok(!policy[1]!.includes("is_staff"), "no staff arm needed: staff read via products_staff_write");
  assert.ok(SQL.includes("revoke select on public.products from anon;"));
  const colGrant = SQL.match(/grant select \(([^)]+)\) on public\.products to anon;/);
  assert.ok(colGrant, "anon keeps a column-level grant");
  const cols = colGrant[1]!.split(",").map((c) => c.trim());
  assert.ok(!cols.includes("data"), "the data column is withheld from anon");
  assert.ok(cols.includes("slug"), "sitemap slug read keeps working");
  assert.ok(!/grant select on public\.products to (anon|authenticated)/.test(SQL), "no table-wide public SELECT");
});

/* ── orders ───────────────────────────────────────────────────────────── */

test("customers no longer read raw orders (orders_own_read narrowed to staff)", () => {
  assert.ok(SQL.includes("drop policy if exists orders_own_read on public.orders;"));
  assert.ok(!SQL.includes("create policy orders_own_read"), "the customer policy is not recreated");
  const staffRead = SQL.match(/create policy orders_staff_read on public\.orders ([^;]+);/);
  assert.ok(staffRead, "staff read policy exists");
  assert.equal(staffRead[1]!.trim(), "for select using (public.is_staff())");
  assert.ok(!SQL.includes("auth.uid()"), "no customer-scoped orders policy remains in 0007");
});

test("staff cannot PATCH orders over PostgREST (orders_staff_update removed)", () => {
  assert.ok(SQL.includes("drop policy if exists orders_staff_update on public.orders;"));
  assert.ok(!/create policy \w+ on public\.orders for (update|all)/.test(SQL), "no UPDATE/ALL policy on orders");
});

test("idempotency column and partial unique index are present", () => {
  assert.ok(SQL.includes("alter table public.orders add column if not exists idempotency_key text;"));
  assert.ok(
    SQL.includes("create unique index if not exists orders_idempotency_key_uidx on public.orders (idempotency_key) where idempotency_key is not null;"),
  );
});

/* ── patch_order_data ──────────────────────────────────────────────────── */

test("patch_order_data matches the shared contract", () => {
  const start = SQL.indexOf("create or replace function public.patch_order_data(");
  assert.ok(start >= 0);
  const fn = SQL.slice(start, SQL.indexOf("$$;", start));
  assert.ok(
    fn.includes("p_order_number text, p_patch jsonb, p_payment_status text default null, p_fulfillment_status text default null ) returns jsonb"),
    "signature",
  );
  assert.ok(fn.includes("security definer"));
  assert.ok(fn.includes("set search_path = public"));
  assert.ok(fn.includes("set data = o.data || p_patch"), "atomic top-level merge in one UPDATE");
  assert.ok(fn.includes("payment_status = coalesce(p_payment_status, o.payment_status)"));
  assert.ok(fn.includes("fulfillment_status = coalesce(p_fulfillment_status, o.fulfillment_status)"));
  assert.ok(fn.includes("returning o.data into v_data"));
  assert.ok(fn.includes("update public.orders o"), "schema-qualified table");
});

test("patch_order_data EXECUTE is service_role only", () => {
  const sig = "on function public.patch_order_data(text, jsonb, text, text)";
  for (const role of ["public", "anon", "authenticated"]) {
    assert.ok(SQL.includes(`revoke all ${sig} from ${role};`), `revoked from ${role}`);
  }
  assert.ok(SQL.includes(`grant execute ${sig} to service_role;`));
  const grants = [...SQL.matchAll(/grant execute on function public\.patch_order_data\([^)]*\) to (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(grants, ["service_role"]);
});

/* ── my-orders edge function ───────────────────────────────────────────── */

test("my-orders requires an authenticated caller and sanitizes server-side", () => {
  const src = read("../../supabase/functions/my-orders/index.ts");
  assert.ok(src.includes("const profile = await callerProfile(req);"));
  assert.ok(src.includes('if (!profile) throw new HttpError(401, "unauthorized");'));
  assert.ok(src.includes("customer_id=eq.${encodeURIComponent(profile.id)}"), "scoped to the verified caller");
  assert.ok(!src.includes("req.json("), "the customer id is never taken from the request body");
  assert.ok(src.includes("toCustomerOrderData(row.data)"));
  assert.ok(src.includes("preflight(req)") && src.includes("handleError(err)"));
});

/* ── app wiring + fallbacks (executed against a fake client) ───────────── */

type Call = { kind: "select" | "invoke"; name: string; query?: string };

function fakeService(handlers: {
  select?: (table: string, query: string) => unknown[];
  invoke?: (name: string) => unknown;
}) {
  const calls: Call[] = [];
  const svc = new SupabaseDataService();
  (svc as unknown as { sb: unknown }).sb = {
    configured: true,
    async select(table: string, query: string) {
      calls.push({ kind: "select", name: table, query });
      if (table === "categories") return [];
      return handlers.select!(table, query);
    },
    async invoke(name: string) {
      calls.push({ kind: "invoke", name });
      return handlers.invoke!(name);
    },
  };
  return { svc, calls };
}

const PRODUCT = {
  id: "p1",
  slug: "p1",
  categorySlug: "retro",
  status: "available",
  supplier: { sku: "SKU-LEAK", costUsd: 7 },
  availability: { status: "available", lastCheckedAt: "2026-09-01", supplierNote: "NOTE-LEAK" },
};

const PGRST205 = 'select products_public: 404 {"code":"PGRST205","message":"Could not find the table \'public.products_public\' in the schema cache"}';

test("missing-relation / missing-function detection is narrow", () => {
  assert.ok(isMissingRelationError(new Error(PGRST205)));
  assert.ok(isMissingRelationError(new Error('select products_public: 404 {"code":"42P01"}')));
  assert.ok(!isMissingRelationError(new Error('select products_public: 401 {"code":"42501","message":"permission denied"}')));
  assert.ok(!isMissingRelationError(new Error("select products_public: 500 boom")));
  assert.ok(!isMissingRelationError(new Error("Failed to fetch")));
  assert.ok(isMissingFunctionError(new Error("invoke my-orders: 404")));
  assert.ok(isMissingFunctionError(new Error("Requested function was not found")));
  assert.ok(!isMissingFunctionError(new Error("unauthorized")));
  assert.ok(!isMissingFunctionError(new Error("internal_error")));
});

test("storefront product reads use products_public and never touch raw products when it exists", async () => {
  assert.equal(PUBLIC_PRODUCTS_VIEW, "products_public");
  const { svc, calls } = fakeService({ select: () => [{ id: "p1", data: PRODUCT }] });
  const list = await svc.listProducts();
  const one = await svc.getProduct("p1");
  assert.equal(list.length, 1);
  assert.equal(one?.slug, "p1");
  const tables = calls.filter((c) => c.kind === "select" && c.name !== "categories").map((c) => c.name);
  assert.deepEqual(tables, ["products_public", "products_public"]);
});

test("falls back to the legacy products read only when the view is missing, still sanitized", async () => {
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args);
  try {
    const { svc, calls } = fakeService({
      select: (table) => {
        if (table === "products_public") throw new Error(PGRST205);
        return [{ id: "p1", data: PRODUCT }];
      },
    });
    const list = await svc.listProducts();
    await svc.listProducts();
    const tables = calls.filter((c) => c.kind === "select" && c.name !== "categories").map((c) => c.name);
    assert.deepEqual(tables, ["products_public", "products", "products_public", "products"]);
    const json = JSON.stringify(list);
    assert.ok(!json.includes("SKU-LEAK") && !json.includes("NOTE-LEAK"), "client-side stripping still applies");
    assert.ok(warnings.length <= 1, "the fallback warning is logged once");
  } finally {
    console.warn = warn;
  }
});

test("a permission error on the view is surfaced, not masked by the fallback", async () => {
  const { svc, calls } = fakeService({
    select: (table) => {
      if (table === "products_public") throw new Error('select products_public: 401 {"code":"42501"}');
      return [{ id: "p1", data: PRODUCT }];
    },
  });
  await assert.rejects(() => svc.listProducts(), /42501/);
  assert.ok(!calls.some((c) => c.name === "products"));
});

test("account history comes from my-orders; legacy read only when the function is not deployed", async () => {
  const leaky = { orderNumber: "CR-1", items: [], internalNotes: "STAFF-LEAK", sheetsSync: { status: "synced" } };

  const ok = fakeService({ invoke: () => ({ orders: [leaky] }), select: () => assert.fail("no direct orders read") });
  const viaFn = await ok.svc.listCustomerOrders("cust-1");
  assert.equal(viaFn.length, 1);
  assert.ok(!JSON.stringify(viaFn).includes("STAFF-LEAK"));
  assert.deepEqual(ok.calls.map((c) => c.name), ["my-orders"]);

  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const missing = fakeService({
      invoke: () => {
        throw new Error("invoke my-orders: 404");
      },
      select: () => [{ id: "o1", data: leaky }],
    });
    const viaLegacy = await missing.svc.listCustomerOrders("cust-1");
    assert.deepEqual(missing.calls.map((c) => c.name), ["my-orders", "orders"]);
    assert.ok(!JSON.stringify(viaLegacy).includes("STAFF-LEAK"), "legacy path is still sanitized client-side");
  } finally {
    console.warn = warn;
  }

  const unauthorized = fakeService({
    invoke: () => {
      throw new Error("unauthorized");
    },
    select: () => assert.fail("no fallback on auth errors"),
  });
  await assert.rejects(() => unauthorized.svc.listCustomerOrders("cust-1"), /unauthorized/);
});
