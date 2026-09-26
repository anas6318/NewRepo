import { test } from "node:test";
import assert from "node:assert/strict";
import { CLUBS, clubForTag, clubShopPath, normalizeClubTag, productClubTags, productHasClub } from "../../src/lib/clubs.ts";

test("registry: the 8 live club tags, lowercase and unique, no Juventus", () => {
  assert.deepEqual(
    CLUBS.map((c) => c.tag).sort(),
    ["ac-milan", "atc-madrid", "barcelona", "inter-milan", "liverpool", "mancity", "manunited", "real-madrid"],
  );
  for (const c of CLUBS) {
    assert.equal(c.tag, normalizeClubTag(c.tag), `${c.tag} is canonical`);
    for (const locale of ["ar", "he", "en"] as const) assert.ok(c.label[locale].trim(), `${c.tag}/${locale} label`);
  }
  assert.equal(clubForTag("juventus"), undefined);
});

test("normalizeClubTag: trim + lowercase; non-strings give empty", () => {
  assert.equal(normalizeClubTag("  AC-Milan "), "ac-milan");
  for (const v of [undefined, null, 42, {}, ["ac-milan"]]) assert.equal(normalizeClubTag(v), "");
});

test("clubForTag: normalized exact match; unknown or empty is undefined", () => {
  assert.equal(clubForTag("AC-MILAN")?.tag, "ac-milan");
  assert.equal(clubForTag(" ManUnited ")?.tag, "manunited");
  for (const v of ["random-value", "milan", "", "   ", null, undefined, 7]) assert.equal(clubForTag(v), undefined, String(v));
});

test("productHasClub: whole tag, case-insensitive, missing-tags safe", () => {
  assert.equal(productHasClub({ tags: ["AC-Milan", "away"] }, "ac-milan"), true);
  assert.equal(productHasClub({ tags: ["inter-milan"] }, "ac-milan"), false);
  assert.equal(productHasClub({ tags: ["inter-milan"] }, "milan"), false);
  assert.equal(productHasClub({ tags: ["ac-milan"] }, ""), false);
  for (const p of [{}, { tags: undefined }, { tags: null }, { tags: "ac-milan" }, null, undefined]) {
    assert.equal(productHasClub(p as { tags?: unknown }, "ac-milan"), false);
  }
});

test("productClubTags: registry clubs on a product, canonical and deduped", () => {
  assert.deepEqual(productClubTags(["Home", "MANCITY", "mancity", "retro"]), ["mancity"]);
  assert.deepEqual(productClubTags(["inter-milan", "ac-milan"]), ["ac-milan", "inter-milan"]);
  assert.deepEqual(productClubTags(["chelsea"]), []);
  for (const v of [undefined, null, "ac-milan", 3]) assert.deepEqual(productClubTags(v), []);
});

test("URL helpers: a valid ?club= gives the canonical club path; an invalid one resolves to nothing", () => {
  const valid = clubForTag("AC-Milan");
  assert.ok(valid);
  assert.equal(clubShopPath(valid.tag), "/shop?club=ac-milan");
  assert.equal(clubForTag("random-value"), undefined, "invalid club is ignored (page falls back to /shop)");
});
