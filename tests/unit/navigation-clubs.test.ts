import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts } from "../../src/services/catalog.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import { SHOP_BY_CLUB, clubByTag, clubNavItems } from "../../src/content/navigation.ts";
import type { Product } from "../../src/services/types.ts";

const allDemo = () => structuredClone(demoProducts);

/**
 * Clubs the demo/sandbox catalog (src/services/demo/seed-data.ts) actually
 * contains a product for today. As of this test, none: the demo products use
 * generic colorway names ("Crimson Home", "Royal Away", ...) and carry no club
 * tag. If seed data ever adds club-tagged products, add that club's id here
 * so this test starts asserting >=1 match for it instead of 0.
 */
const CLUBS_PRESENT_IN_DEMO_SEED = new Set<string>([]);

test("every SHOP_BY_CLUB tag: >=1 match if the club is in the demo seed, else 0", () => {
  for (const club of SHOP_BY_CLUB) {
    const matches = filterProducts(allDemo(), { club: club.tag }, demoCategories);
    if (CLUBS_PRESENT_IN_DEMO_SEED.has(club.id)) {
      assert.ok(matches.length >= 1, `expected >=1 demo match for tag "${club.tag}" (${club.id}); got 0`);
    } else {
      assert.equal(matches.length, 0, `expected 0 demo matches for tag "${club.tag}" (${club.id}); got ${matches.length}`);
    }
  }
});

test("every club link is /shop?club=<tag>", () => {
  const items = clubNavItems();
  assert.equal(items.length, SHOP_BY_CLUB.length);
  for (const club of SHOP_BY_CLUB) {
    const item = items.find((i) => i.id === club.id);
    assert.ok(item, `nav item for ${club.id}`);
    assert.equal(item.path, `/shop?club=${encodeURIComponent(club.tag)}`);
    assert.equal(clubByTag(club.tag), club);
  }
  assert.equal(clubByTag("no-such-club"), undefined);
  assert.equal(clubByTag(null), undefined);
});

/**
 * Live-shaped fixture: a subset of the live-catalog snapshot (ids, names,
 * tags) taken 2026-09-26, one or more products per SHOP_BY_CLUB club, plus
 * decoys that share words or tag fragments with them: Inter Milan
 * (`inter-milan`), Atletico Madrid (`atc-madrid`), Manchester City
 * (`mancity`). The two extra Inter products ("Black Third", "Track Jacket")
 * are synthetic adversarial decoys whose names contain the short fragment
 * "ac". name.ar/he are left empty: the club filter reads only `tags`.
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

// club key -> its identifying tag in the snapshot
const FIXTURE_CLUB_TAG: Record<string, string> = {
  barcelona: "barcelona",
  "real-madrid": "real-madrid",
  "ac-milan": "ac-milan",
  "inter-milan": "inter-milan", // decoy only, not a SHOP_BY_CLUB entry
  "manchester-united": "manunited",
  "manchester-city": "mancity", // decoy only, not a SHOP_BY_CLUB entry
  liverpool: "liverpool",
  "atletico-madrid": "atc-madrid", // decoy only, not a SHOP_BY_CLUB entry
};

const LIVE_FIXTURE: Product[] = [
  makeProduct("barcelona-08-09-away-retro", "Barcelona 08/09 Away Retro Jersey", ["barcelona", "away", "retro"], "retro"),
  makeProduct("barcelona-26-27-home", "Barcelona 26/27 Home Jersey", ["barcelona", "home", "current"], "current-season"),
  makeProduct("real-madrid-24-25-home", "Real Madrid 24/25 Home Jersey", ["real-madrid", "home", "current"], "current-season"),
  makeProduct("ac-milan-06-07-away-retro", "AC Milan 06/07 Away Retro Jersey", ["ac-milan", "away", "retro"], "retro"),
  makeProduct("inter-milan-24-25-home", "Inter Milan 24/25 Home Jersey", ["inter-milan", "home", "current"], "current-season"),
  makeProduct("inter-milan-24-25-black-third", "Inter Milan 24/25 Black Third Jersey", ["inter-milan", "third", "current"], "current-season"),
  makeProduct("inter-milan-track-jacket", "Inter Milan Track Jacket", ["inter-milan", "training"], "current-season"),
  makeProduct("manchester-united-26-27-away", "Manchester United 26/27 Away Jersey", ["manunited", "away", "current"], "current-season"),
  makeProduct("manchester-city-26-27-home", "Manchester City 26/27 Home Jersey", ["mancity", "home", "current"], "current-season"),
  makeProduct("liverpool-26-27-home", "Liverpool 26/27 Home Jersey", ["liverpool", "home", "current"], "current-season"),
  makeProduct("atletico-madrid-26-27-home", "Atletico Madrid 26/27 Home Jersey", ["atc-madrid", "home", "current"], "current-season"),
];

function clubOfFixture(p: Product): string | null {
  for (const [club, tag] of Object.entries(FIXTURE_CLUB_TAG)) {
    if (p.tags.includes(tag)) return club;
  }
  return null;
}

test("every SHOP_BY_CLUB tag matches >=1 own-club and 0 other-club products in the live-shaped fixture", () => {
  for (const club of SHOP_BY_CLUB) {
    const matches = filterProducts(structuredClone(LIVE_FIXTURE), { club: club.tag }, demoCategories);
    const own = matches.filter((p) => clubOfFixture(p) === club.id);
    const other = matches.filter((p) => clubOfFixture(p) !== club.id);
    assert.ok(own.length >= 1, `expected >=1 own-club match for tag "${club.tag}" (${club.id}); got ${matches.length} total`);
    assert.deepEqual(
      other.map((p) => p.id),
      [],
      `tag "${club.tag}" (${club.id}) must not match another club's product`,
    );
  }
});

test("hazard that motivated the tag filter: free-text 'ac milan' matches an Inter decoy", () => {
  // The free-text matcher requires every term as a substring, so "ac" is
  // satisfied by "Black" (and "Track Jacket"). The club filter avoids this.
  const ids = filterProducts(structuredClone(LIVE_FIXTURE), { query: "ac milan" }, demoCategories).map((p) => p.id);
  assert.ok(ids.includes("inter-milan-24-25-black-third"), `expected the "Black" Inter decoy in ${ids.join(", ")}`);
});
