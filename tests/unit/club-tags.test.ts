/**
 * Club assignment: Admin form, server-side save and bulk import.
 *
 * - Parity: supabase/functions/_shared/clubs.ts (the edge function's copy)
 *   must behave exactly like src/lib/clubs.ts over one shared input table.
 * - Rules: at most one registry club tag per product, canonical lowercase;
 *   every other tag keeps its exact value, case and order.
 * - End to end in code: products saved/imported through the demo data
 *   service are found by the storefront club filter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as web from "../../src/lib/clubs.ts";
import * as edge from "../../supabase/functions/_shared/clubs.ts";

/* ── mirror parity ─────────────────────────────────────────────────────── */

const TAG_INPUTS: unknown[] = [
  undefined,
  null,
  "ac-milan",
  "not-an-array",
  42,
  { 0: "ac-milan" },
  [],
  ["home", "Retro", "AC-Milan"],
  ["AC-MILAN", "away"],
  ["  ac-milan  ", "away"],
  ["ac-milan", "inter-milan"],
  ["ManUnited", "manunited", "retro"],
  ["home", 7, null, "Barcelona", { tag: "x" }],
  ["milan", "inter", "chelsea", "juventus"],
  ["current", "training-suit", "Away", "HOME"],
  ["mancity", "Real-Madrid", "liverpool"],
];
const CLUB_INPUTS: unknown[] = ["", "   ", null, undefined, "ac-milan", "AC-Milan", "  INTER-MILAN ", "manunited", "mancity", "chelsea", "juventus", "milan", 5];
const ROWS: Record<string, unknown>[] = [
  {},
  { club: "" },
  { club: "   " },
  { club: "barcelona" },
  { club: "  MANUNITED " },
  { club: "Atc-Madrid" },
  { club: "chelsea" },
  { club: "Manchester United" },
  { club: 3 },
];

/** Run fn, turning a throw into a comparable value. */
function outcome<T>(fn: () => T): { ok: T } | { threw: string } {
  try {
    return { ok: fn() };
  } catch (e) {
    return { threw: (e as Error).message };
  }
}

test("mirror parity: edge clubs.ts has the same registry and behaves identically to src/lib/clubs.ts", () => {
  assert.deepEqual(
    edge.CLUBS.map((c) => c.tag),
    web.CLUBS.map((c) => c.tag),
  );
  assert.deepEqual(edge.CLUBS, web.CLUBS);
  const values: unknown[] = [...CLUB_INPUTS, ...TAG_INPUTS];
  for (const v of values) {
    assert.equal(edge.normalizeClubTag(v), web.normalizeClubTag(v), `normalizeClubTag ${JSON.stringify(v)}`);
    assert.equal(edge.isClubTag(v), web.isClubTag(v), `isClubTag ${JSON.stringify(v)}`);
    assert.deepEqual(edge.productClubTags(v), web.productClubTags(v), `productClubTags ${JSON.stringify(v)}`);
  }
  for (const tags of TAG_INPUTS) {
    assert.deepEqual(edge.normalizeProductTags(tags), web.normalizeProductTags(tags), `normalizeProductTags ${JSON.stringify(tags)}`);
    for (const club of CLUB_INPUTS) {
      assert.deepEqual(
        outcome(() => edge.setProductClubTag(tags, club)),
        outcome(() => web.setProductClubTag(tags, club)),
        `setProductClubTag ${JSON.stringify(tags)} ${JSON.stringify(club)}`,
      );
    }
  }
  for (const row of ROWS) assert.deepEqual(edge.parseImportedClub(row), web.parseImportedClub(row), `parseImportedClub ${JSON.stringify(row)}`);
});

/* ── setProductClubTag ─────────────────────────────────────────────────── */

for (const [name, lib] of [
  ["src", web],
  ["edge", edge],
] as const) {
  test(`${name} setProductClubTag: replaces only the club tag, other tags byte-identical and in order`, () => {
    const before = ["home", "Retro", "AC-Milan"];
    assert.deepEqual(lib.setProductClubTag(before, "inter-milan"), ["home", "Retro", "inter-milan"]);
    assert.deepEqual(before, ["home", "Retro", "AC-Milan"], "input not mutated");
    assert.deepEqual(lib.setProductClubTag(["Away", "retro", "training-suit"], " MANCITY "), ["Away", "retro", "training-suit", "mancity"]);
    assert.deepEqual(lib.setProductClubTag(["ac-milan", "home", "INTER-MILAN"], "barcelona"), ["home", "barcelona"], "all club tags dropped, one added");
  });

  test(`${name} setProductClubTag: "" / null clears the club; missing tags are []`, () => {
    assert.deepEqual(lib.setProductClubTag(["home", "Retro", "AC-Milan"], ""), ["home", "Retro"]);
    assert.deepEqual(lib.setProductClubTag(["home", "AC-Milan"], null), ["home"]);
    assert.deepEqual(lib.setProductClubTag(["home"], undefined), ["home"]);
    assert.deepEqual(lib.setProductClubTag(undefined, "ac-milan"), ["ac-milan"]);
    assert.deepEqual(lib.setProductClubTag("ac-milan", ""), []);
  });

  test(`${name} setProductClubTag: an unknown club throws, naming the value`, () => {
    assert.throws(() => lib.setProductClubTag(["home"], "chelsea"), /unknown club "chelsea"/);
    assert.throws(() => lib.setProductClubTag(["home"], "juventus"), /unknown club "juventus"/);
    assert.throws(() => lib.setProductClubTag(["home"], "milan"), /unknown club "milan"/);
  });

  /* ── normalizeProductTags ────────────────────────────────────────────── */

  test(`${name} normalizeProductTags: canonicalizes club tags, leaves others untouched`, () => {
    assert.deepEqual(lib.normalizeProductTags(["AC-MILAN", "away"]), { tags: ["ac-milan", "away"] });
    assert.deepEqual(lib.normalizeProductTags(["Away", " ManUnited ", "Retro"]), { tags: ["Away", "manunited", "Retro"] });
    assert.deepEqual(lib.normalizeProductTags(["home", "ac-milan", "AC-Milan"]), { tags: ["home", "ac-milan"] }, "same club kept once");
    assert.deepEqual(lib.normalizeProductTags(["home", 7, null, "retro"]), { tags: ["home", "retro"] }, "non-strings dropped");
    assert.deepEqual(lib.normalizeProductTags(["milan", "home"]), { tags: ["milan", "home"] }, "not a registry tag: untouched");
  });

  test(`${name} normalizeProductTags: two different clubs is multiple_clubs`, () => {
    assert.equal(lib.normalizeProductTags(["ac-milan", "inter-milan"]).error, "multiple_clubs");
    assert.equal(lib.normalizeProductTags(["home", "Barcelona", "REAL-MADRID"]).error, "multiple_clubs");
  });

  test(`${name} normalizeProductTags: missing or non-array tags give []`, () => {
    for (const v of [undefined, null, "ac-milan", 1, {}]) assert.deepEqual(lib.normalizeProductTags(v), { tags: [] }, String(v));
  });

  /* ── import row ──────────────────────────────────────────────────────── */

  test(`${name} parseImportedClub: known club in any case → [canonical]; blank → []; unknown → row error`, () => {
    assert.deepEqual(lib.parseImportedClub({ club: "  MANUNITED " }), { tags: ["manunited"], errors: [] });
    assert.deepEqual(lib.parseImportedClub({ club: "Ac-Milan" }), { tags: ["ac-milan"], errors: [] });
    assert.deepEqual(lib.parseImportedClub({ club: "" }), { tags: [], errors: [] });
    assert.deepEqual(lib.parseImportedClub({ club: "  " }), { tags: [], errors: [] });
    assert.deepEqual(lib.parseImportedClub({ slug: "x" }), { tags: [], errors: [] });
    const bad = lib.parseImportedClub({ club: " chelsea " });
    assert.deepEqual(bad.tags, []);
    assert.equal(bad.errors.length, 1);
    assert.match(bad.errors[0]!, /^unknown club "chelsea"/);
  });
}

/* ── wiring: the edge function uses the mirror ─────────────────────────── */

test("admin-actions uses the shared club helpers in save-product and import-products", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../supabase/functions/admin-actions/index.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ normalizeProductTags, parseImportedClub \} from "\.\.\/_shared\/clubs\.ts";/);
  const save = src.slice(src.indexOf("async function saveProduct"), src.indexOf("async function importProducts"));
  assert.match(save, /normalizeProductTags\(product\.tags\)/);
  assert.match(save, /throw new HttpError\(400, tagCheck\.error\)/);
  assert.match(save, /product\.tags = tagCheck\.tags/);
  const imp = src.slice(src.indexOf("async function importProducts"), src.indexOf("function parseImportedBadges"));
  assert.match(imp, /parseImportedClub\(row\)/);
  assert.match(imp, /tags: clubImport\.tags/);
});

/* ── end to end in code: demo save / import → storefront club filter ──── */

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

test("demo data service: saved and imported club products are found by filterProducts for their club only", async () => {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true, writable: true });
  }
  const { DemoDataService } = await import("../../src/services/demo/DemoDataService.ts");
  const { DEMO_CREDENTIALS, demoCategories, demoProducts } = await import("../../src/services/demo/seed-data.ts");
  const { filterProducts } = await import("../../src/services/catalog.ts");

  const svc = new DemoDataService();
  assert.equal((await svc.login(DEMO_CREDENTIALS.admin.email, DEMO_CREDENTIALS.admin.password)).ok, true);

  // 1. Admin save path: a published product whose tags carry AC Milan
  //    (non-canonical case) plus unrelated tags.
  const base = structuredClone(demoProducts[0]!);
  const saved = { ...base, id: "u2-club-save", slug: "u2-club-save", status: "made_to_order" as const, rightsStatus: "cleared" as const, tags: ["home", "Retro", "AC-Milan"] };
  assert.deepEqual(await svc.adminSaveProduct(saved), { ok: true });

  // Two different clubs is refused, like the edge function's 400.
  const twoClubs = { ...saved, id: "u2-two-clubs", slug: "u2-two-clubs", tags: ["ac-milan", "inter-milan"] };
  assert.deepEqual(await svc.adminSaveProduct(twoClubs), { ok: false, error: "multiple_clubs" });

  // 2. Import path: club column with Manchester United's tag in upper case,
  //    plus an unknown club that must fail its row.
  const imported = await svc.adminImportProducts([
    { slug: "u2-club-import", name_en: "U2 Club Import", category: "retro", price_ils: "170", club: "MANUNITED" },
    { slug: "u2-club-bad", name_en: "U2 Club Bad", category: "retro", price_ils: "170", club: "chelsea" },
  ]);
  assert.equal(imported.created, 1);
  assert.equal(imported.results[0]!.ok, true);
  assert.equal(imported.results[1]!.ok, false);
  assert.ok(imported.results[1]!.errors.some((e) => e.startsWith('unknown club "chelsea"')), imported.results[1]!.errors.join("; "));

  let all = await svc.adminListProducts();
  const imp = all.find((p) => p.slug === "u2-club-import")!;
  assert.deepEqual(imp.tags, ["manunited"]);
  assert.equal(imp.status, "draft", "imports never publish");
  assert.deepEqual(all.find((p) => p.slug === "u2-club-save")!.tags, ["home", "Retro", "ac-milan"]);
  assert.equal(all.some((p) => p.slug === "u2-two-clubs" || p.slug === "u2-club-bad"), false);

  // Publish the imported draft through the same save path (rights cleared).
  assert.deepEqual(await svc.adminSaveProduct({ ...imp, status: "made_to_order", rightsStatus: "cleared" }), { ok: true });
  all = await svc.adminListProducts();

  const slugs = (club: string) => filterProducts(all, { club }, demoCategories).map((p) => p.slug);
  assert.ok(slugs("ac-milan").includes("u2-club-save"));
  assert.ok(!slugs("inter-milan").includes("u2-club-save"));
  assert.ok(slugs("manunited").includes("u2-club-import"));
  assert.ok(!slugs("mancity").includes("u2-club-import"));
  assert.ok(!slugs("ac-milan").includes("u2-club-import"));
  // The storefront's own listing (filterProducts over public products) agrees.
  assert.ok((await svc.listProducts({ club: "ac-milan" })).some((p) => p.slug === "u2-club-save"));
  assert.ok((await svc.listProducts({ club: "manunited" })).some((p) => p.slug === "u2-club-import"));
});
