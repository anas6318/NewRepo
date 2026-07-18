import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts, filtersForCategory } from "../../src/services/catalog.ts";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";

const all = () => structuredClone(demoProducts);

test("draft/archived never appear publicly", () => {
  const products = all();
  const first = products[0];
  if (!first) throw new Error("seed catalog is empty — test precondition failed");
  first.status = "draft";
  const out = filterProducts(products, {}, demoCategories);
  assert.ok(!out.some((p) => p.id === first.id));
});

test("unavailable products remain visible (labeled), not hidden", () => {
  const out = filterProducts(all(), {}, demoCategories);
  assert.ok(out.some((p) => p.status === "unavailable"));
});

test("facet categories derive filters (spec §8)", () => {
  assert.deepEqual(filtersForCategory("player-version"), { version: "player" });
  assert.deepEqual(filtersForCategory("national-teams"), { national: true });
  assert.deepEqual(filtersForCategory("long-sleeve"), { sleeve: "long" });
  assert.deepEqual(filtersForCategory("retro"), { category: "retro" });
});

test("category filter: hoodies contains only hoodies", () => {
  const out = filterProducts(all(), { category: "hoodies" }, demoCategories);
  assert.ok(out.length >= 2);
  assert.ok(out.every((p) => p.categorySlug === "hoodies"));
});

test("player-version facet finds versioned products", () => {
  const out = filterProducts(all(), { category: "player-version" }, demoCategories);
  assert.ok(out.every((p) => p.versions.some((v) => v.version === "player")));
  assert.ok(out.some((p) => p.slug === "onyx-home"));
});

test("kids audience filter", () => {
  const kids = filterProducts(all(), { audience: "kids" }, demoCategories);
  assert.ok(kids.every((p) => p.kids));
  const adults = filterProducts(all(), { audience: "adult" }, demoCategories);
  assert.ok(adults.every((p) => !p.kids));
});

test("price range filter", () => {
  const out = filterProducts(all(), { priceMin: 201 }, demoCategories);
  assert.ok(out.every((p) => p.basePriceIls > 200));
});

test("search matches all three languages", () => {
  assert.ok(filterProducts(all(), { query: "crimson" }, demoCategories).some((p) => p.slug === "crimson-2005"));
  assert.ok(filterProducts(all(), { query: "القرمزي" }, demoCategories).some((p) => p.slug === "crimson-2005"));
  assert.ok(filterProducts(all(), { query: "הארגמנית" }, demoCategories).some((p) => p.slug === "crimson-2005"));
});

test("typo tolerance: 'crimsn' still finds crimson", () => {
  assert.ok(filterProducts(all(), { query: "crimsn" }, demoCategories).some((p) => p.slug === "crimson-2005"));
});

test("sorting: price ascending", () => {
  const out = filterProducts(all(), { sort: "price_asc" }, demoCategories);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const curr = out[i];
    assert.ok(prev && curr && prev.basePriceIls <= curr.basePriceIls);
  }
});
