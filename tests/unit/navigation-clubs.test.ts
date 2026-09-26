import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts } from "../../src/services/catalog.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import { SHOP_BY_CLUB } from "../../src/content/navigation.ts";
import type { Product } from "../../src/services/types.ts";

const allDemo = () => structuredClone(demoProducts);

/**
 * Clubs the demo/sandbox catalog (src/services/demo/seed-data.ts) actually
 * contains a product for today. As of this test, none: the 16 demo products
 * use generic colorway names ("Crimson Home", "Royal Away", ...) and carry
 * no club/team identity in name, tags, or categorySlug — verified via
 * test-results/U1-clubs.json (matchCount 0 for every SHOP_BY_CLUB query
 * against the real matcher, src/services/catalog.ts:43-60). If seed data
 * ever adds club-branded products, add that club's id here so this test
 * starts asserting >=1 match for it instead of 0.
 */
const CLUBS_PRESENT_IN_DEMO_SEED = new Set<string>([]);

test("every SHOP_BY_CLUB query: >=1 match if the club is in the demo seed, else 0", () => {
  for (const club of SHOP_BY_CLUB) {
    const matches = filterProducts(allDemo(), { query: club.query }, demoCategories);
    if (CLUBS_PRESENT_IN_DEMO_SEED.has(club.id)) {
      assert.ok(matches.length >= 1, `expected >=1 demo match for "${club.query}" (${club.id}); got 0`);
    } else {
      assert.equal(matches.length, 0, `expected 0 demo matches for "${club.query}" (${club.id}) — seed has no club data; got ${matches.length}`);
    }
  }
});

test("SHOP_BY_CLUB queries never cross-match another club's products (demo seed)", () => {
  const resultsByClub = new Map(SHOP_BY_CLUB.map((c) => [c.id, filterProducts(allDemo(), { query: c.query }, demoCategories)]));

  for (const club of SHOP_BY_CLUB) {
    const ownIds = new Set(resultsByClub.get(club.id)!.map((p) => p.id));
    for (const other of SHOP_BY_CLUB) {
      if (other.id === club.id) continue;
      const overlap = resultsByClub.get(other.id)!.filter((p) => ownIds.has(p.id));
      assert.deepEqual(
        overlap.map((p) => p.id),
        [],
        `"${other.query}" (${other.id}) must not match product(s) also returned for "${club.query}" (${club.id})`,
      );
    }
  }
});

/**
 * Minimal live-shaped fixture, independent of test-results/. Only the id and
 * the name/tag/category fields filterProducts() reads (src/services/catalog.ts:43-60)
 * are populated, sourced from the live-catalog probe evaluated in
 * test-results/U1-clubs.json (test-results/probe-live.json, liveStatus "ok",
 * 40 products). Includes one product per SHOP_BY_CLUB club plus the two
 * decoys the WIP commit's own comment worried about (Inter Milan, Manchester
 * City), so the "0 other-club hits" assertion is exercised for real, not
 * vacuously (the demo seed has no such decoys). name.ar/he are left empty:
 * the probe's ar/he fields are corrupted by repeated mis-encoding and are
 * not usable evidence (see U1-clubs.json corruptedFieldsNote); the matcher
 * only needs name.en/tags/categorySlug to resolve these English queries.
 */
function makeProduct(id: string, nameEn: string, tags: string[], categorySlug: string): Product {
  return {
    id,
    slug: id,
    categorySlug,
    name: { ar: "", he: "", en: nameEn },
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

// club key -> its identifying tag, per probe-live.json (test-results/U1-clubs.json)
const FIXTURE_CLUB_TAG: Record<string, string> = {
  barcelona: "barcelona",
  "real-madrid": "real-madrid",
  "ac-milan": "ac-milan",
  "inter-milan": "inter-milan", // decoy only, not a SHOP_BY_CLUB entry
  "manchester-united": "manunited",
  "manchester-city": "mancity", // decoy only, not a SHOP_BY_CLUB entry
  liverpool: "liverpool",
};

const LIVE_FIXTURE: Product[] = [
  makeProduct("barcelona-08-09-away-retro", "Barcelona 08/09 Away Retro Jersey", ["barcelona", "away", "retro"], "retro"),
  makeProduct("real-madrid-24-25-home", "Real Madrid 24/25 Home Jersey", ["real-madrid", "home", "current"], "current-season"),
  makeProduct("ac-milan-06-07-away-retro", "AC Milan 06/07 Away Retro Jersey", ["ac-milan", "away", "retro"], "retro"),
  makeProduct("inter-milan-24-25-home", "Inter Milan 24/25 Home Jersey", ["inter-milan", "home", "current"], "current-season"),
  makeProduct("manchester-united-26-27-away", "Manchester United 26/27 Away Jersey", ["manunited", "away", "current"], "current-season"),
  makeProduct("manchester-city-26-27-home", "Manchester City 26/27 Home Jersey", ["mancity", "home", "current"], "current-season"),
  makeProduct("liverpool-26-27-home", "Liverpool 26/27 Home Jersey", ["liverpool", "home", "current"], "current-season"),
];

function clubOfFixture(p: Product): string | null {
  for (const [club, tag] of Object.entries(FIXTURE_CLUB_TAG)) {
    if (p.tags.includes(tag)) return club;
  }
  return null;
}

test("every SHOP_BY_CLUB query matches >=1 own-club product in the live-shaped fixture", () => {
  for (const club of SHOP_BY_CLUB) {
    const matches = filterProducts(structuredClone(LIVE_FIXTURE), { query: club.query }, demoCategories);
    const ownMatches = matches.filter((p) => clubOfFixture(p) === club.id);
    assert.ok(ownMatches.length >= 1, `expected >=1 own-club fixture match for "${club.query}" (${club.id}); got ${matches.length} total`);
  }
});

test("every SHOP_BY_CLUB query matches 0 other-club products in the live-shaped fixture", () => {
  for (const club of SHOP_BY_CLUB) {
    const matches = filterProducts(structuredClone(LIVE_FIXTURE), { query: club.query }, demoCategories);
    const otherClubHits = matches.filter((p) => {
      const c = clubOfFixture(p);
      return c !== null && c !== club.id;
    });
    assert.deepEqual(
      otherClubHits.map((p) => p.id),
      [],
      `"${club.query}" (${club.id}) must not match another club's product in the live-shaped fixture`,
    );
  }
});
