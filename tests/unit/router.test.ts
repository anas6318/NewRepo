import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPath, matchBest, localePath, swapLocale } from "../../src/lib/router-core.ts";

test("static match", () => {
  assert.ok(matchPath("/ar/shop", "/ar/shop"));
  assert.equal(matchPath("/ar/shop", "/ar/cart"), null);
});

test("params decode + match", () => {
  const m = matchPath("/:locale/product/:slug", "/he/product/royal-1998");
  assert.deepEqual(m?.params, { locale: "he", slug: "royal-1998" });
  const enc = matchPath("/:locale/product/:slug", "/ar/product/%D9%82%D9%85%D9%8A%D8%B5");
  assert.equal(enc?.params.slug, "قميص");
});

test("length mismatch fails", () => {
  assert.equal(matchPath("/:locale/shop", "/ar/shop/extra"), null);
  assert.equal(matchPath("/:locale/shop/deep", "/ar/shop"), null);
});

test("wildcard captures remainder", () => {
  const m = matchPath("/admin/*", "/admin/orders/CR-1");
  assert.equal(m?.params["*"], "orders/CR-1");
});

test("specificity: static beats param beats wildcard", () => {
  const best = matchBest(["/:locale/:page", "/:locale/shop", "/:locale/*"], "/en/shop");
  assert.equal(best?.pattern, "/:locale/shop");
});

test("locale path helpers", () => {
  assert.equal(localePath("ar", "/"), "/ar");
  assert.equal(localePath("en", "/shop"), "/en/shop");
});

test("swapLocale preserves the equivalent page (spec §4)", () => {
  assert.equal(swapLocale("/ar/product/x", "he", ["ar", "he", "en"]), "/he/product/x");
  assert.equal(swapLocale("/admin/orders", "en", ["ar", "he", "en"]), "/en/admin/orders");
  assert.equal(swapLocale("/", "en", ["ar", "he", "en"]), "/en");
});
