/** Internal management tags (crowned-studio) must not affect customer
 * free-text search, while exact tag filters, club filters and ordinary
 * customer-facing tags keep working. Both the search page and the header
 * suggestions search through filterProducts({ query }). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts } from "../../src/services/catalog.ts";
import { INTERNAL_TAGS, isInternalTag, searchableTags } from "../../src/lib/tags.ts";
import { STUDIO_TAG } from "../../src/lib/studio.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import type { Product } from "../../src/services/types.ts";

/** A published product whose visible text contains none of the search terms
 * used below, so any match can only come from its tags. */
function product(slug: string, tags: unknown): Product {
  const base = structuredClone(demoProducts[0]!) as Product;
  return {
    ...base,
    id: slug,
    slug,
    status: "available",
    name: { en: "Plain Shirt", ar: "قميص", he: "חולצה" },
    categorySlug: "retro",
    era: undefined,
    season: undefined,
    nationalTeam: false,
    tags: tags as string[],
  };
}

const search = (products: Product[], query: string) => filterProducts(products, { query }, demoCategories).map((p) => p.slug);

test("the Studio tag is registered as internal and stays in sync with STUDIO_TAG", () => {
  assert.ok(INTERNAL_TAGS.includes(STUDIO_TAG));
  assert.equal(isInternalTag("crowned-studio"), true);
  assert.equal(isInternalTag(" Crowned-Studio "), true);
  assert.equal(isInternalTag("studio"), false);
  assert.equal(isInternalTag("barcelona"), false);
});

test("1: 'studio' does not match a product solely because of crowned-studio", () => {
  const products = [product("studio-only", [STUDIO_TAG]), product("studio-mixed-case", ["Crowned-Studio "])];
  assert.deepEqual(search(products, "studio"), []);
  assert.deepEqual(search(products, "Studio"), []);
});

test("2: 'crowned' does not match a product solely because of crowned-studio", () => {
  const products = [product("studio-only", [STUDIO_TAG, "home"])];
  assert.deepEqual(search(products, "crowned"), []);
  assert.deepEqual(search(products, "crowned-studio"), []);
});

test("3: the exact { tag: 'crowned-studio' } filter still finds tagged products", () => {
  const products = [product("studio-a", [STUDIO_TAG]), product("studio-b", ["home", "CROWNED-STUDIO"]), product("plain", ["home"])];
  const slugs = filterProducts(products, { tag: "crowned-studio" }, demoCategories).map((p) => p.slug);
  assert.deepEqual(slugs.sort(), ["studio-a", "studio-b"]);
});

test("4: club searches still work, in free text and the club filter, even on a Studio product", () => {
  const products = [product("barca-studio", ["barcelona", STUDIO_TAG]), product("liverpool", ["liverpool"])];
  assert.deepEqual(search(products, "barcelona"), ["barca-studio"]);
  assert.deepEqual(search(products, "Barcelona"), ["barca-studio"]);
  assert.deepEqual(filterProducts(products, { club: "barcelona" }, demoCategories).map((p) => p.slug), ["barca-studio"]);
});

test("5: ordinary customer-facing tags still participate in search", () => {
  const products = [product("away-studio", ["away", STUDIO_TAG]), product("home", ["home"])];
  assert.deepEqual(search(products, "away"), ["away-studio"]);
  assert.deepEqual(search(products, "home"), ["home"]);
  // A customer-facing tag that merely contains the word is not internal.
  assert.deepEqual(search([product("studio-edition", ["studio-edition"])], "studio"), ["studio-edition"]);
});

test("searchableTags drops only internal tags, keeps order, and tolerates bad input", () => {
  assert.deepEqual(searchableTags(["retro", STUDIO_TAG, "Away", " crowned-studio "]), ["retro", "Away"]);
  assert.deepEqual(searchableTags(undefined), []);
  assert.deepEqual(searchableTags("crowned-studio"), []);
  assert.deepEqual(searchableTags(["home", 7, null]), ["home"]);
  // A product with missing tags is searchable by its other fields, not an error.
  assert.deepEqual(search([product("no-tags", undefined)], "plain"), ["no-tags"]);
});
