/**
 * Storage object paths are KEYS, not file names.
 *
 * Regression cover for the live failure: the Real Product image of
 * `test-jersey` was saved as if the object were
 * `product-images/ac-milan-06-07-away-retro-front.png`, while the object in
 * the bucket is `product-images(white background_/ac-milan-06-07-away-retro-front.png`.
 * The folder segment had been dropped, Storage returned 404, and the customer
 * was stuck on the styled render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeStorageObjectPath,
  encodeStorageObjectPath,
  parseStoragePublicUrl,
  storagePublicUrl,
  storageUrlProblem,
} from "../../supabase/functions/_shared/storage-url.ts";

const PROJECT = "https://abcdefgh.supabase.co";
const BUCKET = "product-images";
/** The real object path from the live bucket, verbatim. */
const REAL_KEY = "product-images(white background_/ac-milan-06-07-away-retro-front.png";

/* ── nested folders survive ─────────────────────────────────────────────── */

test("a nested object path keeps every folder", () => {
  const url = storagePublicUrl(PROJECT, BUCKET, REAL_KEY);
  assert.ok(url.includes("/object/public/product-images/"), "the bucket is there");
  assert.ok(url.includes("product-images(white%20background_/"), `the folder survives — got ${url}`);
  assert.ok(url.endsWith("/ac-milan-06-07-away-retro-front.png"), "and the file name is last");
});

test("the folder separator is never encoded away", () => {
  // encodeURIComponent on the whole path would give %2F and address one
  // oddly-named object instead of a nested one.
  const encoded = encodeStorageObjectPath("a/b c/d(e)/f.png");
  assert.equal(encoded.split("/").length, 4, "four segments remain");
  assert.ok(!encoded.includes("%2F"), "no encoded slashes");
});

test("spaces and parentheses inside a segment are encoded", () => {
  const encoded = encodeStorageObjectPath(REAL_KEY);
  assert.ok(!/\s/.test(encoded), `no literal space survives — got ${encoded}`);
  assert.ok(encoded.includes("%20"), "the space became %20");
});

test("encoding round-trips back to the original key", () => {
  for (const key of [
    REAL_KEY,
    "simple.png",
    "a/b/c/deep.png",
    "with spaces/and (parens)/shirt.png",
    "قمصان/ريال-مدريد.png",
    "2006-07/AC Milan/away #7.png",
  ]) {
    assert.equal(decodeStorageObjectPath(encodeStorageObjectPath(key)), key, `round-trip: ${key}`);
  }
});

test("a built URL parses back to the same bucket and key", () => {
  const url = storagePublicUrl(PROJECT, BUCKET, REAL_KEY);
  const parsed = parseStoragePublicUrl(url);
  assert.ok(parsed);
  assert.equal(parsed.bucket, BUCKET);
  assert.equal(parsed.objectPath, REAL_KEY, "the full key comes back, folder included");
  assert.equal(parsed.depth, 1, "one folder level");
});

test("a deeply nested key reports its real depth", () => {
  const parsed = parseStoragePublicUrl(storagePublicUrl(PROJECT, BUCKET, "a/b/c/shirt.png"));
  assert.equal(parsed?.depth, 3);
});

/* ── the exact live bug, and how it is now detectable ───────────────────── */

test("the URL that was actually saved differs from the correct one", () => {
  const broken = storagePublicUrl(PROJECT, BUCKET, "ac-milan-06-07-away-retro-front.png");
  const correct = storagePublicUrl(PROJECT, BUCKET, REAL_KEY);
  assert.notEqual(broken, correct, "flattening the path produces a different, non-existent object");
  assert.equal(parseStoragePublicUrl(broken)?.depth, 0, "the broken one has no folder at all");
  assert.equal(parseStoragePublicUrl(correct)?.depth, 1, "the correct one does");
});

test("a bare file name at depth 0 is exactly what Admin warns about", () => {
  // Admin uses `depth === 0` to say "the object path is just a file name".
  const parsed = parseStoragePublicUrl(storagePublicUrl(PROJECT, BUCKET, "shirt.png"));
  assert.equal(parsed?.depth, 0);
  const src = readFileSync("src/pages/admin/AdminCatalog.tsx", "utf8");
  assert.ok(/parsed\.depth === 0/.test(src), "Admin keys its hint off the same signal");
});

test("a literal space left in a pasted URL is reported", () => {
  const bad = `${PROJECT}/storage/v1/object/public/product-images/product-images(white background_/x.png`;
  assert.equal(storageUrlProblem(bad), "unencoded_space");
  assert.equal(storageUrlProblem(storagePublicUrl(PROJECT, BUCKET, REAL_KEY)), undefined, "the built URL is clean");
});

test("a URL with a bucket but no object is reported", () => {
  assert.equal(storageUrlProblem(`${PROJECT}/storage/v1/object/public/product-images/`), "missing_object_path");
});

test("a non-Storage URL is left to the other rules", () => {
  assert.equal(storageUrlProblem("https://cdn.example.com/a.png"), undefined);
  assert.equal(parseStoragePublicUrl("https://cdn.example.com/a.png"), undefined);
});

test("query strings and fragments do not become part of the key", () => {
  const parsed = parseStoragePublicUrl(`${storagePublicUrl(PROJECT, BUCKET, "a/b.png")}?width=200#x`);
  assert.equal(parsed?.objectPath, "a/b.png");
});

test("an empty bucket or path yields no URL rather than a broken one", () => {
  assert.equal(storagePublicUrl(PROJECT, "", "a.png"), "");
  assert.equal(storagePublicUrl(PROJECT, BUCKET, ""), "");
});

/* ── the save gate ──────────────────────────────────────────────────────── */

test("Admin loads every image before saving, and can be overridden deliberately", () => {
  const src = readFileSync("src/pages/admin/AdminCatalog.tsx", "utf8");
  assert.ok(/findUnreachableImages\(product\.images\.map/.test(src), "every image is probed, not just the roles");
  assert.ok(/!unreachableAck/.test(src), "the first failed save warns rather than silently storing a dead URL");
  assert.ok(/Press Save again/.test(src), "and the owner is told how to proceed deliberately");
  assert.ok(src.indexOf("findUnreachableImages") < src.indexOf("adminSaveProduct"), "the probe runs before the write");
});

test("the probe treats a non-browser environment as inconclusive, not as failure", () => {
  const src = readFileSync("src/lib/image-probe.ts", "utf8");
  assert.ok(/typeof window === "undefined"[\s\S]{0,300}?ok: true/.test(src), "prerender must not block saves it cannot judge");
});

test("the URL builder is offered in Admin so nobody assembles one by hand", () => {
  const src = readFileSync("src/pages/admin/AdminCatalog.tsx", "utf8");
  assert.ok(/function StorageUrlHelper/.test(src));
  assert.ok(/storagePublicUrl\(getConfig\(\)\.supabaseUrl/.test(src), "it builds from the configured project");
});
