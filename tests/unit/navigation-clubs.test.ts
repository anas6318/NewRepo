import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts } from "../../src/services/catalog.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import { CLUBS, clubForTag } from "../../src/lib/clubs.ts";
import { SHOP_BY_CLUB, clubByTag, clubNavItems } from "../../src/content/navigation.ts";
import type { LocalizedText, Product } from "../../src/services/types.ts";

/**
 * Live-catalog fixture. Every `live(...)` row is copied as a literal from the
 * read-only live-catalog snapshot taken 2026-09-26
 * (.claude/orchestrate-runs/20260926-1500/reports/probe/probe-live.utf8.json:
 * id, name_en/name_ar/name_he, tags, categorySlug). It is deliberately NOT
 * generated from SHOP_BY_CLUB or CLUBS, so the assertions below are evidence
 * about the live data, not the code agreeing with itself.
 *
 * One correction: the snapshot's name_en for the two Atletico rows reads
 * "Atl├⌐tico" — UTF-8 "é" (bytes C3 A9) mis-decoded as cp862, the same
 * capture fault the snapshot's provenance note repaired for name_ar/name_he
 * only. It is restored here to "Atlético".
 *
 * The rows marked SYNTHETIC are not in the snapshot: adversarial Inter decoys
 * whose names contain the fragment "ac" ("Black", "Track Jacket").
 */
function live(id: string, name: LocalizedText, tags: string[], categorySlug: string): Product {
  return {
    id,
    slug: id,
    categorySlug,
    name,
    description: { ar: "", he: "", en: "" },
    details: { ar: "", he: "", en: "" },
    seoTitle: { ar: "", he: "", en: "" },
    seoDescription: { ar: "", he: "", en: "" },
    status: "available",
    basePriceIls: 100,
    versions: [],
    sleeves: [],
    longSleeveAdjustmentIls: 0,
    sizes: [],
    personalizable: false,
    patchIds: [],
    qualifiesForFreeDelivery: false,
    featured: false,
    images: [],
    relatedSlugs: [],
    tags,
    rightsStatus: "cleared",
    isDemo: true,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

const LIVE_FIXTURE: Product[] = [
  live("barcelona-08-09-away-retro", { en: "Barcelona 08/09 Away Retro Jersey", ar: "قميص برشلونة 08/09 الاحتياطي ريترو", he: "חולצת ברצלונה 08/09 חוץ רטרו" }, ["barcelona", "away", "retro"], "retro"),
  live("barcelona-26-27-home", { en: "Barcelona 26/27 Home Jersey", ar: "قميص برشلونة 26/27 الأساسي", he: "חולצת ברצלונה 26/27 בית" }, ["barcelona", "home", "current"], "current-season"),
  live("real-madrid-24-25-home", { en: "Real Madrid 24/25 Home Jersey", ar: "قميص ريال مدريد 24/25 الأساسي", he: "חולצת ריאל מדריד 24/25 בית" }, ["real-madrid", "home", "current"], "current-season"),
  live("real-madrid-98-99-home-retro", { en: "Real Madrid 98/99 Home Retro Jersey", ar: "قميص ريال مدريد 98/99 الأساسي ريترو", he: "חולצת ריאל מדריד 98/99 בית רטרו" }, ["real-madrid", "home", "retro"], "retro"),
  live("ac-milan-06-07-away-retro", { en: "AC Milan 06/07 Away Retro Jersey", ar: "قميص ميلان 06/07 الاحتياطي ريترو", he: "חולצת מילאן 06/07 חוץ רטרו" }, ["ac-milan", "away", "retro"], "retro"),
  live("inter-milan-09-10-home-retro", { en: "Inter Milan 09/10 Home Retro Jersey", ar: "قميص إنتر ميلان 09/10 الأساسي ريترو", he: "חולצת אינטר מילאן 09/10 בית רטרו" }, ["inter-milan", "home", "retro"], "retro"),
  live("inter-milan-24-25-home", { en: "Inter Milan 24/25 Home Jersey", ar: "قميص إنتر ميلان 24/25 الأساسي", he: "חולצת אינטר מילאן 24/25 בית" }, ["inter-milan", "home", "current"], "current-season"),
  live("manchester-united-26-27-away", { en: "Manchester United 26/27 Away Jersey", ar: "قميص مانشستر يونايتد 26/27 الاحتياطي", he: "חולצת מנצ'סטר יונייטד 26/27 חוץ" }, ["manunited", "away", "current"], "current-season"),
  live("manchester-city-26-27-home", { en: "Manchester City 26/27 Home Jersey", ar: "قميص مانشستر سيتي 26/27 الأساسي", he: "חולצת מנצ'סטר סיטי 26/27 בית" }, ["mancity", "home", "current"], "current-season"),
  live("liverpool-26-27-home", { en: "Liverpool 26/27 Home Jersey", ar: "قميص ليفربول 26/27 الأساسي", he: "חולצת ליברפול 26/27 בית" }, ["liverpool", "home", "current"], "current-season"),
  live("atletico-madrid-26-27-home", { en: "Atlético Madrid 26/27 Home Jersey", ar: "قميص أتلتيكو مدريد 26/27 الأساسي", he: "חולצת אתלטיקו מדריד 26/27 בית" }, ["atc-madrid", "home", "current"], "current-season"),
  live("atletico-madrid-26-27-away", { en: "Atlético Madrid 26/27 Away Jersey", ar: "قميص أتلتيكو مدريد 26/27 الاحتياطي", he: "חולצת אתלטיקו מדריד 26/27 חוץ" }, ["atc-madrid", "away", "current"], "current-season"),
  live("chelsea-26-27-away", { en: "Chelsea 26/27 Away Jersey", ar: "قميص تشيلسي 26/27 الاحتياطي", he: "חולצת צ'לסי 26/27 חוץ" }, ["chelsea", "away", "current"], "current-season"),
  // SYNTHETIC decoys (see above).
  live("inter-milan-24-25-black-third", { en: "Inter Milan 24/25 Black Third Jersey", ar: "", he: "" }, ["inter-milan", "third", "current"], "current-season"),
  live("inter-milan-track-jacket", { en: "Inter Milan Track Jacket", ar: "", he: "" }, ["inter-milan", "training"], "current-season"),
];

const fixture = () => structuredClone(LIVE_FIXTURE);
const idsFor = (club: string) => filterProducts(fixture(), { club }, demoCategories).map((p) => p.id).sort();

/* ── club filter vs. live data ─────────────────────────────────────────── */

test("AC Milan and Inter Milan never select each other's products", () => {
  assert.deepEqual(idsFor("ac-milan"), ["ac-milan-06-07-away-retro"]);
  assert.deepEqual(idsFor("inter-milan"), [
    "inter-milan-09-10-home-retro",
    "inter-milan-24-25-black-third",
    "inter-milan-24-25-home",
    "inter-milan-track-jacket",
  ]);
});

test("Real Madrid excludes Atletico Madrid and vice versa", () => {
  assert.deepEqual(idsFor("real-madrid"), ["real-madrid-24-25-home", "real-madrid-98-99-home-retro"]);
  assert.deepEqual(idsFor("atc-madrid"), ["atletico-madrid-26-27-away", "atletico-madrid-26-27-home"]);
});

test("Manchester United excludes Manchester City and vice versa", () => {
  assert.deepEqual(idsFor("manunited"), ["manchester-united-26-27-away"]);
  assert.deepEqual(idsFor("mancity"), ["manchester-city-26-27-home"]);
});

test("?club= case and whitespace variants select the same products", () => {
  const expected = idsFor("ac-milan");
  for (const variant of ["AC-MILAN", " ac-milan ", "Ac-Milan"]) {
    assert.deepEqual(idsFor(variant), expected, `variant ${JSON.stringify(variant)}`);
  }
});

test("a partial tag never matches (whole tags only)", () => {
  assert.deepEqual(idsFor("milan"), []);
  assert.deepEqual(idsFor("madrid"), []);
  assert.deepEqual(idsFor("man"), []);
});

test("products with missing, undefined or non-array tags do not throw and are excluded", () => {
  const broken = [
    { ...live("no-tags", { en: "x", ar: "", he: "" }, [], "retro"), tags: undefined },
    { ...live("null-tags", { en: "x", ar: "", he: "" }, [], "retro"), tags: null },
    { ...live("string-tags", { en: "x", ar: "", he: "" }, [], "retro"), tags: "ac-milan" },
  ] as unknown as Product[];
  const withoutKey = live("absent-tags", { en: "x", ar: "", he: "" }, [], "retro") as Partial<Product>;
  delete withoutKey.tags;
  const products = [...fixture(), ...broken, withoutKey as Product];
  let ids: string[] = [];
  assert.doesNotThrow(() => {
    ids = filterProducts(products, { club: "ac-milan" }, demoCategories).map((p) => p.id);
  });
  assert.deepEqual(ids, ["ac-milan-06-07-away-retro"]);
});

test("hazard that motivated the tag filter: free-text 'ac milan' matches an Inter decoy", () => {
  // The free-text matcher requires every term as a substring, so "ac" is
  // satisfied by "Black" (and "Track Jacket"). The club filter avoids this.
  const ids = filterProducts(fixture(), { query: "ac milan" }, demoCategories).map((p) => p.id);
  assert.ok(ids.includes("inter-milan-24-25-black-third"), `expected the "Black" Inter decoy in ${ids.join(", ")}`);
});

test("every Shop by Club menu tag selects only its own club's live products", () => {
  const ownPrefix: Record<string, string> = {
    barcelona: "barcelona-",
    "real-madrid": "real-madrid-",
    "ac-milan": "ac-milan-",
    "manchester-united": "manchester-united-",
    liverpool: "liverpool-",
  };
  for (const club of SHOP_BY_CLUB) {
    const ids = idsFor(club.tag);
    assert.ok(ids.length >= 1, `${club.id}: >=1 live product`);
    for (const id of ids) assert.ok(id.startsWith(ownPrefix[club.id]), `${club.id} selected ${id}`);
  }
});

test("demo seed carries no club tags, so every club filters it to nothing", () => {
  for (const club of CLUBS) {
    assert.equal(filterProducts(structuredClone(demoProducts), { club: club.tag }, demoCategories).length, 0, club.tag);
  }
});

/* ── labels ────────────────────────────────────────────────────────────── */

test("the three new clubs' labels appear verbatim in their live product names, per locale", () => {
  // ar/he: straight from the snapshot. en: the Atletico rows use the restored
  // "Atlético" (see the fixture note).
  for (const tag of ["inter-milan", "atc-madrid", "mancity"]) {
    const club = clubForTag(tag);
    assert.ok(club, tag);
    const own = fixture().filter((p) => p.tags.includes(tag) && p.name.ar);
    assert.ok(own.length >= 1, `${tag}: live rows in fixture`);
    for (const locale of ["ar", "he", "en"] as const) {
      assert.ok(
        own.some((p) => p.name[locale].includes(club.label[locale])),
        `${tag}/${locale}: "${club.label[locale]}" not found in ${own.map((p) => p.name[locale]).join(" | ")}`,
      );
    }
  }
});

test("the five menu labels, ids and order are unchanged from before the registry", () => {
  // Literals copied from src/content/navigation.ts at ccbcefc.
  assert.deepEqual(
    SHOP_BY_CLUB.map((c) => ({ id: c.id, tag: c.tag, label: c.label })),
    [
      { id: "barcelona", tag: "barcelona", label: { ar: "برشلونة", he: "ברצלונה", en: "Barcelona" } },
      { id: "real-madrid", tag: "real-madrid", label: { ar: "ريال مدريد", he: "ריאל מדריד", en: "Real Madrid" } },
      { id: "ac-milan", tag: "ac-milan", label: { ar: "ميلان", he: "מילאן", en: "AC Milan" } },
      { id: "manchester-united", tag: "manunited", label: { ar: "مانشستر يونايتد", he: "מנצ׳סטר יונייטד", en: "Manchester United" } },
      { id: "liverpool", tag: "liverpool", label: { ar: "ليفربول", he: "ליברפול", en: "Liverpool" } },
    ],
  );
});

/* ── menu links ────────────────────────────────────────────────────────── */

test("club links are /shop?club=<tag> and clubByTag resolves any case", () => {
  assert.deepEqual(
    clubNavItems().map((i) => i.path),
    ["/shop?club=barcelona", "/shop?club=real-madrid", "/shop?club=ac-milan", "/shop?club=manunited", "/shop?club=liverpool"],
  );
  assert.equal(clubByTag("AC-Milan")?.id, "ac-milan");
  assert.equal(clubByTag(" manunited ")?.id, "manchester-united");
  assert.equal(clubByTag("inter-milan"), undefined, "registry club outside the menu");
  assert.equal(clubByTag("no-such-club"), undefined);
  assert.equal(clubByTag(null), undefined);
});
