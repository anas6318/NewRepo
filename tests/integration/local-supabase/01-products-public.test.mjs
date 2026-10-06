/**
 * Migration 0007 §1 against the LOCAL stack: the storefront reads
 * `products_public` (supplier/internal keys removed server-side), anon can no
 * longer read raw `products.data`, and draft/archived rows never surface.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { psqlScalar } from "../../../scripts/local-staging/local-db.mjs";
import { BADGE_ID, BADGE_SUPPLIER_REF, HIDDEN_PRODUCT_IDS, PUBLISHED_PRODUCT_IDS, SENTINEL_PREFIX, productSentinelValues } from "../../../scripts/local-staging/fixtures.mjs";
import { allKeys, assertNoSupplierData, client } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

/** Keys 0007 removes from `data` outright. */
const REMOVED_KEYS = ["supplier", "supplierNote", "supplierReference", "internalNotes"];
/** Keys 0007 rebuilds from an allowlist (status + lastCheckedAt). */
const REBUILT_KEYS = ["availability", "versionAvailability", "sizeAvailability"];
const FORBIDDEN_KEYS = [...REMOVED_KEYS, "costUsd", "sku"];

const IT_FILTER = "id=like.it-*";
let raw; // id → raw row (service role)
let view; // id → products_public row (anon)

before(async () => {
  const r = await c.svc(`products?select=id,slug,status,category_slug,data&${IT_FILTER}`);
  assert.equal(r.status, 200);
  raw = new Map(r.json.map((p) => [p.id, p]));
  for (const id of [...PUBLISHED_PRODUCT_IDS, ...HIDDEN_PRODUCT_IDS]) assert.ok(raw.has(id), `fixture ${id} missing — run npm run local:seed`);
  const v = await c.rest(`products_public?select=id,slug,status,category_slug,data&${IT_FILTER}`);
  assert.equal(v.status, 200, `anon products_public read: HTTP ${v.status}`);
  view = new Map(v.json.map((p) => [p.id, p]));
});

test("products_public (anon): published it- products present with every storefront field intact", () => {
  assert.deepEqual([...view.keys()].sort(), [...PUBLISHED_PRODUCT_IDS].sort());
  for (const id of PUBLISHED_PRODUCT_IDS) {
    const src = raw.get(id);
    const pub = view.get(id);
    assert.equal(pub.slug, src.slug);
    assert.equal(pub.status, src.status);
    assert.equal(pub.category_slug, src.category_slug);
    const expectedKeys = Object.keys(src.data).filter((k) => !REMOVED_KEYS.includes(k)).sort();
    assert.deepEqual(Object.keys(pub.data).sort(), expectedKeys, `${id}: view key set`);
    for (const k of expectedKeys) {
      if (REBUILT_KEYS.includes(k)) continue;
      assert.deepEqual(pub.data[k], src.data[k], `${id}: storefront field ${k} changed by the view`);
    }
    // The fields the storefront and the price display depend on.
    for (const k of ["name", "basePriceIls", "images", "sizes", "versions", "badges", "sale", "personalizable", "qualifiesForFreeDelivery"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(pub.data, k), `${id}: ${k} missing`);
    }
  }
});

test("products_public (anon): no supplier sku/reference/cost/notes/internalNotes anywhere — every SUPPLIER-SENTINEL value searched", async () => {
  // Positive control: the raw rows really do carry every sentinel, so a leak would be visible.
  for (const id of PUBLISHED_PRODUCT_IDS) {
    const rawText = JSON.stringify(raw.get(id).data);
    const expected = productSentinelValues(id).filter((s) => !(id === "it-hold" && /VERSION-NOTE|SIZE-NOTE/.test(s)) && !(id !== "it-season" && /VERSION-NOTE/.test(s)));
    for (const s of expected) assert.ok(rawText.includes(s), `control: raw ${id} lacks ${s}`);
  }
  // Every published row in the whole view (demo catalog included), as anon.
  const all = await c.rest("products_public?select=*");
  assert.equal(all.status, 200);
  assert.ok(all.json.length >= PUBLISHED_PRODUCT_IDS.length);
  const text = JSON.stringify(all.json);
  for (const id of PUBLISHED_PRODUCT_IDS) {
    for (const s of productSentinelValues(id)) assert.ok(!text.includes(s), `products_public leaks ${s}`);
  }
  assertNoSupplierData(all.json, "products_public");
  assert.ok(!text.includes(SENTINEL_PREFIX));
  const keys = allKeys(all.json.map((r) => r.data));
  for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `products_public exposes key "${k}"`);
  // Availability records keep nothing but status / lastCheckedAt.
  for (const row of all.json) {
    const recs = [row.data.availability, ...Object.values(row.data.versionAvailability ?? {}), ...Object.values(row.data.sizeAvailability ?? {})].filter(Boolean);
    for (const rec of recs) for (const k of Object.keys(rec)) assert.ok(["status", "lastCheckedAt"].includes(k), `${row.id}: availability key ${k}`);
  }
});

test("products_public (anon): availability / versionAvailability / sizeAvailability keep status + lastCheckedAt", () => {
  const rr = raw.get("it-retro-regular").data;
  const pr = view.get("it-retro-regular").data;
  assert.deepEqual(pr.availability, { status: rr.availability.status, lastCheckedAt: rr.availability.lastCheckedAt });
  assert.deepEqual(pr.sizeAvailability, { "*:M": { status: "available", lastCheckedAt: rr.sizeAvailability["*:M"].lastCheckedAt } });

  const rs = raw.get("it-season").data;
  const ps = view.get("it-season").data;
  assert.deepEqual(ps.versionAvailability, {
    fan: { status: "available", lastCheckedAt: rs.versionAvailability.fan.lastCheckedAt },
    player: { status: "available", lastCheckedAt: rs.versionAvailability.player.lastCheckedAt },
  });
  assert.equal(typeof ps.versionAvailability.fan.lastCheckedAt, "string");

  // No check date recorded → the key is absent, not empty.
  assert.deepEqual(view.get("it-hold").data.availability, { status: "confirmation_required" });
  assert.equal(view.get("it-hold").data.sizeAvailability, undefined);
});

test("products_public: draft and archived rows are not in the view (not even by direct id filter)", async () => {
  for (const id of HIDDEN_PRODUCT_IDS) assert.ok(!view.has(id));
  const direct = await c.rest(`products_public?select=id&id=in.(${HIDDEN_PRODUCT_IDS.join(",")})`);
  assert.equal(direct.status, 200);
  assert.deepEqual(direct.json, []);
  const anyHidden = await c.rest("products_public?select=id&status=in.(draft,archived)");
  assert.deepEqual(anyHidden.json, []);
  // Control: the hidden rows exist in the raw table.
  assert.equal(raw.get("it-draft").status, "draft");
  assert.equal(raw.get("it-archived").status, "archived");
});

test("anon: GET /rest/v1/products?select=data (and select=*) is denied, select=slug,status (sitemap columns) works", async () => {
  for (const sel of ["data", "*", "id,data"]) {
    const r = await c.rest(`products?select=${sel}&limit=1`);
    assert.ok([401, 403].includes(r.status), `select=${sel}: expected 401/403, got ${r.status}`);
    assert.equal(r.json?.code, "42501", `select=${sel}: expected permission denied (42501)`);
  }
  const ok = await c.rest(`products?select=slug,status&${IT_FILTER}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.map((p) => p.slug).sort(), [...PUBLISHED_PRODUCT_IDS].sort(), "anon sitemap read must list published it- products only");
  for (const p of ok.json) assert.deepEqual(Object.keys(p).sort(), ["slug", "status"]);
});

test("anon cannot write through products_public or products", async () => {
  const before0 = raw.get("it-retro-regular");
  const viaView = await c.rest("products_public?id=eq.it-retro-regular", { method: "PATCH", body: { status: "draft" }, headers: { Prefer: "return=representation" } });
  assert.ok([401, 403].includes(viaView.status), `PATCH products_public: got ${viaView.status}`);
  const viaTable = await c.rest("products?id=eq.it-retro-regular", { method: "PATCH", body: { status: "draft" }, headers: { Prefer: "return=representation" } });
  assert.ok([401, 403].includes(viaTable.status) || (viaTable.status === 200 && viaTable.json.length === 0), `PATCH products: got ${viaTable.status}`);
  const del = await c.rest("products_public?id=eq.it-retro-regular", { method: "DELETE" });
  assert.ok([401, 403].includes(del.status), `DELETE products_public: got ${del.status}`);
  const after = await c.svc("products?select=status,data&id=eq.it-retro-regular");
  assert.equal(after.json[0].status, before0.status);
  assert.deepEqual(after.json[0].data, before0.data);
});

test("signed-in customer reads the catalog through products_public only; staff keep the raw read Admin needs", async () => {
  const a = await c.signIn("customerA");
  const rawA = await c.asUser(a.token)("products?select=id,data&id=eq.it-retro-regular");
  assert.ok(rawA.status === 200 ? rawA.json.length === 0 : [401, 403].includes(rawA.status), "customer must not read raw products.data");
  const viewA = await c.asUser(a.token)("products_public?select=id,data&id=eq.it-retro-regular");
  assert.equal(viewA.status, 200);
  assert.equal(viewA.json.length, 1);
  assertNoSupplierData(viewA.json, "products_public as customer");

  const cm = await c.signIn("contentManager");
  const staffRaw = await c.asUser(cm.token)("products?select=id,data&id=eq.it-retro-regular");
  assert.equal(staffRaw.status, 200);
  assert.equal(staffRaw.json.length, 1);
  assert.equal(staffRaw.json[0].data.supplier.sku, raw.get("it-retro-regular").data.supplier.sku, "staff (Admin → Catalog) still reads supplier data");
  const staffDraft = await c.asUser(cm.token)("products?select=id&id=eq.it-draft");
  assert.equal(staffDraft.json.length, 1, "staff still see drafts in the raw table");
});

test("badges: anon reads the badge catalog but never the internal supplier_ref column", async () => {
  const ok = await c.rest(`patches?select=id,active,data&id=eq.${BADGE_ID}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.length, 1);
  assertNoSupplierData(ok.json, "anon patches read");
  for (const sel of ["supplier_ref", "*", "id,supplier_ref"]) {
    const r = await c.rest(`patches?select=${sel}&id=eq.${BADGE_ID}`);
    assert.ok([401, 403].includes(r.status), `select=${sel}: HTTP ${r.status}`);
    assert.ok(!r.text.includes(BADGE_SUPPLIER_REF));
  }
  const svcRow = await c.svc(`patches?select=supplier_ref&id=eq.${BADGE_ID}`);
  assert.equal(svcRow.json[0].supplier_ref, BADGE_SUPPLIER_REF, "control: the ref is stored");
});

test("catalog: 0007 privileges on products / products_public", () => {
  const q = (sql) => psqlScalar(`select ${sql};`);
  assert.equal(q("has_column_privilege('anon', 'public.products', 'data', 'SELECT')"), "f");
  assert.equal(q("has_column_privilege('anon', 'public.products', 'slug', 'SELECT')"), "t");
  for (const role of ["anon", "authenticated"]) {
    assert.equal(q(`has_table_privilege('${role}', 'public.products_public', 'SELECT')`), "t");
    for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      assert.equal(q(`has_table_privilege('${role}', 'public.products_public', '${priv}')`), "f", `${role} ${priv} on products_public`);
    }
  }
  assert.equal(q("(select (reloptions @> array['security_barrier=true'])::text from pg_class where oid = 'public.products_public'::regclass)"), "true");
});
