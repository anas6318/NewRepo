import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts } from "../../src/services/catalog.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import { SHOP_BY_CLUB } from "../../src/content/navigation.ts";

const all = () => structuredClone(demoProducts);

/**
 * Clubs the demo/sandbox catalog (src/services/demo/seed-data.ts) actually
 * contains a product for today. As of this test, none: the 16 demo products
 * use generic colorway names ("Crimson Home", "Royal Away", ...) and carry
 * no club/team identity in name, tags, or categorySlug — verified via
 * test-results/U1-clubs.json (matchCount 0 for every SHOP_BY_CLUB query
 * against the real matcher, src/services/catalog.ts:43-59). If seed data
 * ever adds club-branded products, add that club's id here so this test
 * starts asserting >=1 match for it instead of 0.
 */
const CLUBS_PRESENT_IN_DEMO_SEED = new Set<string>([]);

test("every SHOP_BY_CLUB query: >=1 match if the club is in the demo seed, else 0", () => {
  for (const club of SHOP_BY_CLUB) {
    const matches = filterProducts(all(), { query: club.query }, demoCategories);
    if (CLUBS_PRESENT_IN_DEMO_SEED.has(club.id)) {
      assert.ok(matches.length >= 1, `expected >=1 demo match for "${club.query}" (${club.id}); got 0`);
    } else {
      assert.equal(matches.length, 0, `expected 0 demo matches for "${club.query}" (${club.id}) — seed has no club data; got ${matches.length}`);
    }
  }
});

test("SHOP_BY_CLUB queries never cross-match another club's products", () => {
  const resultsByClub = new Map(SHOP_BY_CLUB.map((c) => [c.id, filterProducts(all(), { query: c.query }, demoCategories)]));

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
