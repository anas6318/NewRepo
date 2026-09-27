/** CROWNED Studio selection: the reserved `crowned-studio` tag, the catalog
 * `tag` filter the homepage uses, and the 4-product cap. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STUDIO_LIMIT, STUDIO_TAG, hasStudioTag, setStudioTag, studioSelection } from "../../src/lib/studio.ts";
import { setProductClubTag } from "../../src/lib/clubs.ts";
import { filterProducts } from "../../src/services/catalog.ts";
import { normalizeTag, productHasTag } from "../../src/lib/tags.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import type { Product } from "../../src/services/types.ts";

const all = () => structuredClone(demoProducts) as Product[];
const studioSlugs = (products: Product[]) => filterProducts(products, { tag: STUDIO_TAG }, demoCategories).map((p) => p.slug);

test("setStudioTag on: adds exactly one canonical tag", () => {
  assert.deepEqual(setStudioTag([], true), ["crowned-studio"]);
  assert.deepEqual(setStudioTag(undefined, true), ["crowned-studio"]);
  assert.deepEqual(setStudioTag(["home"], true), ["home", "crowned-studio"]);
});

test("setStudioTag keeps every unrelated tag byte-identical and in order", () => {
  const tags = ["Retro", "ac-milan", "  Away ", "home"];
  assert.deepEqual(setStudioTag(tags, true), ["Retro", "ac-milan", "  Away ", "home", "crowned-studio"]);
  assert.deepEqual(setStudioTag(["Retro", "crowned-studio", "ac-milan"], false), ["Retro", "ac-milan"]);
  assert.deepEqual(tags, ["Retro", "ac-milan", "  Away ", "home"], "input not mutated");
});

test("setStudioTag never duplicates; variants and duplicates collapse to one", () => {
  let tags = setStudioTag(["home"], true);
  tags = setStudioTag(tags, true);
  assert.deepEqual(tags, ["home", "crowned-studio"]);
  tags = setStudioTag(setStudioTag(setStudioTag(tags, true), false), true);
  assert.deepEqual(tags, ["home", "crowned-studio"]);
  assert.deepEqual(setStudioTag(["crowned-studio", "x", "Crowned-Studio ", " CROWNED-STUDIO"], true), ["x", "crowned-studio"]);
});

test("setStudioTag off removes only the Studio tag; hasStudioTag is missing-tags safe", () => {
  assert.deepEqual(setStudioTag(["Crowned-Studio ", "crowned-studio-archive", "barcelona"], false), ["crowned-studio-archive", "barcelona"]);
  assert.deepEqual(setStudioTag(null, false), []);
  for (const v of [undefined, null, "crowned-studio", 7, {}]) assert.equal(hasStudioTag(v), false, String(v));
  assert.equal(hasStudioTag([" Crowned-Studio "]), true);
  assert.equal(hasStudioTag(["crowned-studio-archive", "studio"]), false);
});

test("Studio and Club edits do not clobber each other", () => {
  let tags = setStudioTag(["home"], true);
  tags = setProductClubTag(tags, "ac-milan");
  assert.deepEqual(tags, ["home", "crowned-studio", "ac-milan"]);
  tags = setStudioTag(tags, false);
  assert.deepEqual(tags, ["home", "ac-milan"]);
  tags = setProductClubTag(setStudioTag(tags, true), "");
  assert.deepEqual(tags, ["home", "crowned-studio"]);
});

test("tag filter: tagged published products are returned, untagged excluded", () => {
  const products = all();
  products[0]!.tags = setStudioTag(products[0]!.tags, true);
  products[1]!.tags = [...products[1]!.tags, "CROWNED-STUDIO"];
  const slugs = studioSlugs(products);
  assert.deepEqual([...slugs].sort(), [products[0]!.slug, products[1]!.slug].sort());
  assert.deepEqual(studioSlugs(all()), [], "no tagged products → empty");
});

test("tag filter: draft and archived tagged products never appear", () => {
  const products = all();
  for (const p of products.slice(0, 3)) p.tags = setStudioTag(p.tags, true);
  products[0]!.status = "draft";
  products[1]!.status = "archived";
  assert.deepEqual(studioSlugs(products), [products[2]!.slug]);
});

test("tag filter: whole tag only, never a substring; missing tags safe", () => {
  const products = all();
  products[0]!.tags = ["crowned-studio-archive"];
  products[1]!.tags = ["studio"];
  delete (products[2] as Partial<Product>).tags;
  assert.deepEqual(studioSlugs(products), []);
});

test("homepage selection caps at 4, keeping order", () => {
  assert.equal(STUDIO_LIMIT, 4);
  const products = all();
  for (const p of products.slice(0, 6)) p.tags = setStudioTag(p.tags, true);
  const listed = filterProducts(products, { tag: STUDIO_TAG }, demoCategories);
  assert.ok(listed.length >= 6);
  assert.deepEqual(studioSelection(listed), listed.slice(0, 4));
  assert.deepEqual(studioSelection([1, 2]), [1, 2]);
});

test("setStudioTag drops non-string entries and returns a true string[]", () => {
  const messy = ["Retro", 7, null, "  Away ", { x: 1 }, undefined, "crowned-studio", ["nested"], "home"] as unknown[];
  assert.deepEqual(setStudioTag(messy, true), ["Retro", "  Away ", "home", "crowned-studio"]);
  assert.deepEqual(setStudioTag(messy, false), ["Retro", "  Away ", "home"]);
  for (const t of setStudioTag(messy, true)) assert.equal(typeof t, "string");
  assert.equal(messy.length, 9, "input not mutated");
});

test("neutral tag helpers: normalizeTag and productHasTag (whole tag, missing-safe)", () => {
  assert.equal(normalizeTag("  Crowned-Studio "), "crowned-studio");
  for (const v of [undefined, null, 7, {}, []]) assert.equal(normalizeTag(v), "");
  assert.equal(productHasTag({ tags: [" HOME ", 3] }, "home"), true);
  assert.equal(productHasTag({ tags: ["home-kit"] }, "home"), false, "never a substring");
  assert.equal(productHasTag({ tags: ["home"] }, "  "), false, "empty tag never matches");
  for (const p of [undefined, null, {}, { tags: "home" }, { tags: null }]) assert.equal(productHasTag(p, "home"), false);
});

test("catalog tag filter uses the neutral matcher: non-club tags work, club filter unchanged", () => {
  const products = all();
  products[0]!.tags = [...products[0]!.tags, "Limited-Drop"];
  assert.deepEqual(
    filterProducts(products, { tag: "limited-drop" }, demoCategories).map((p) => p.slug),
    [products[0]!.slug],
  );
  products[1]!.tags = setProductClubTag(products[1]!.tags, "ac-milan");
  assert.ok(filterProducts(products, { club: "ac-milan" }, demoCategories).some((p) => p.slug === products[1]!.slug));
});

test("homepage derives Curated, Retro and Studio from one listProducts() exactly as the old per-section calls", () => {
  // Both data services implement listProducts(f) as filterProducts(published, f ?? {}),
  // so old = filterProducts(raw, f) and new = filterProducts(filterProducts(raw, {}), f).
  const raw = all();
  for (const p of raw.slice(2, 8)) p.tags = setStudioTag(p.tags, true);
  raw[0]!.status = "draft";
  raw[0]!.featured = true;
  raw[0]!.tags = setStudioTag(raw[0]!.tags, true);
  const one = filterProducts(raw, {}, demoCategories);
  for (const f of [{ featured: true }, { category: "retro", sort: "newest" as const }, { tag: STUDIO_TAG }]) {
    const oldIds = filterProducts(raw, f, demoCategories).map((p) => p.id);
    assert.ok(oldIds.length > 0, `${JSON.stringify(f)} non-empty`);
    assert.ok(!oldIds.includes(raw[0]!.id), "draft excluded");
    assert.deepEqual(filterProducts(one, f, demoCategories).map((p) => p.id), oldIds, JSON.stringify(f));
  }
});
