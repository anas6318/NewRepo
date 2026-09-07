/**
 * Supplier-confirmed sizing + availability rules.
 * Every measurement asserted here comes from the supplier charts; the tests
 * exist to stop fabricated or drifted values from shipping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartIdFor,
  CONFIRMED_SIZE_CHARTS,
  convertValue,
  AVAILABILITY_FRESH_DAYS,
  confirmationFreshness,
  effectiveStatus,
  FAN_SIZES,
  formatRange,
  hasConfirmedRow,
  KIDS_SIZES,
  normalizeChart,
  normalizeSizeLabel,
  PLAYER_SIZES,
  requiresSupplierConfirmation,
  resolveAvailability,
  SIZE_RULES,
  sizeKey,
  sizeOptionsFor,
  TRAINING_SUIT_SIZES,
  unitLabel,
  validateSizes,
} from "../../src/services/sizing.ts";
import type { Product, SizeChart } from "../../src/services/types.ts";

const chart = (id: string) => CONFIRMED_SIZE_CHARTS.find((c) => c.id === id)!;
const row = (id: string, size: string) => chart(id).rows.find((r) => r.size === size)!;

/* ── size options per product type ── */

test("Fan offers sizes through 3XL, and 4XL is available as an option", () => {
  assert.ok(SIZE_RULES.fan.default.includes("3XL"), "3XL is a default fan size");
  assert.ok(FAN_SIZES.includes("4XL"), "4XL is an allowed fan size");
  assert.ok(!SIZE_RULES.fan.default.includes("4XL"), "4XL is not enabled by default");
  assert.deepEqual(SIZE_RULES.fan.optIn, ["4XL"], "4XL is opt-in per product");
});

test("Fan 4XL has no fabricated measurement row", () => {
  assert.equal(hasConfirmedRow("fan", "3XL"), true, "3XL is supplier-confirmed");
  assert.equal(hasConfirmedRow("fan", "4XL"), false, "4XL must not be invented");
  assert.equal(chart("fan").rows.some((r) => r.size === "4XL"), false);
});

test("a product with 4XL enabled marks it as needing supplier confirmation", () => {
  const product = {
    status: "made_to_order",
    kids: false,
    categorySlug: "current-season",
    tags: [],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
  } as unknown as Product;
  const options = sizeOptionsFor(product, "fan");
  const fourXl = options.find((o) => o.size === "4XL")!;
  assert.equal(fourXl.availability.measurementsUnconfirmed, true, "4XL flags unconfirmed measurements");
  const threeXl = options.find((o) => o.size === "3XL")!;
  assert.equal(threeXl.availability.measurementsUnconfirmed, false, "3XL is measured");
});

test("Player and Training suit stop at 2XL — no 3XL or 4XL", () => {
  for (const list of [PLAYER_SIZES, TRAINING_SUIT_SIZES]) {
    assert.ok(!list.includes("3XL"));
    assert.ok(!list.includes("4XL"));
  }
  assert.equal(chart("player").rows.length, 5);
  assert.equal(chart("training-suit").rows.length, 5);
  assert.equal(hasConfirmedRow("player", "3XL"), false);
  assert.equal(hasConfirmedRow("training-suit", "3XL"), false);
});

test("Kids sizes remain 16–28", () => {
  assert.deepEqual(KIDS_SIZES, ["16", "18", "20", "22", "24", "26", "28"]);
  assert.deepEqual(chart("kids").rows.map((r) => r.size), KIDS_SIZES);
});

/* ── supplier-confirmed measurements ── */

test("Fan S width laid flat is 53–55 cm (not a chest circumference)", () => {
  assert.deepEqual(row("fan", "S").values.widthFlatCm, { min: 53, max: 55 });
  assert.deepEqual(row("fan", "S").values.lengthCm, { min: 69, max: 71 });
  assert.equal(row("fan", "S").values.legacyChestCm, undefined, "no unverified chest value");
});

test("Player S width laid flat is 49–51 cm and length is exactly 69", () => {
  assert.deepEqual(row("player", "S").values.widthFlatCm, { min: 49, max: 51 });
  assert.deepEqual(row("player", "S").values.lengthCm, { min: 69 }, "single value, no fake range");
});

test("Kids size 16 shirt length is 43 cm with the full supplied kit data", () => {
  const r = row("kids", "16").values;
  assert.deepEqual(r.lengthCm, { min: 43 });
  assert.deepEqual(r.halfChestCm, { min: 32 });
  assert.deepEqual(r.shortsLengthCm, { min: 32 });
  assert.deepEqual(r.waistCm, { min: 20, max: 37 });
  assert.deepEqual(r.heightCm, { min: 95, max: 105 });
  assert.deepEqual(r.age, { min: 2, max: 3 });
});

test("Training suit keeps the supplier's bust value, never relabelled as flat width", () => {
  assert.deepEqual(row("training-suit", "S").values.bustCm, { min: 100 });
  assert.equal(row("training-suit", "S").values.widthFlatCm, undefined);
  assert.ok(chart("training-suit").columns.some((c) => c.key === "bustCm"));
  assert.ok(!chart("training-suit").columns.some((c) => c.key === "widthFlatCm"));
});

test("jersey charts label width as laid-flat width, never chest circumference", () => {
  for (const id of ["fan", "player"]) {
    const cols = chart(id).columns.map((c) => c.key);
    assert.ok(cols.includes("widthFlatCm"));
    assert.ok(!cols.includes("legacyChestCm"));
  }
});

test("all confirmed charts are flagged supplier_confirmed", () => {
  for (const c of CONFIRMED_SIZE_CHARTS) {
    assert.equal(c.confirmation, "supplier_confirmed", `${c.id} is confirmed`);
    assert.equal(c.isPlaceholder, false);
  }
});

/* ── unit conversion (display only) ── */

test("metric to imperial converts ranges and rounds to one decimal", () => {
  assert.equal(formatRange({ min: 53, max: 55 }, "cm", "metric"), "53–55");
  assert.equal(formatRange({ min: 53, max: 55 }, "cm", "imperial"), "20.9–21.7");
  assert.equal(formatRange({ min: 69 }, "cm", "imperial"), "27.2", "single values stay single");
  assert.equal(formatRange({ min: 50, max: 62 }, "kg", "imperial"), "110.2–136.7");
});

test("age is never converted and carries no unit label", () => {
  assert.equal(convertValue(3, "age", "imperial"), 3);
  assert.equal(formatRange({ min: 2, max: 3 }, "age", "imperial"), "2–3");
  assert.equal(unitLabel("age", "imperial"), "");
  assert.equal(unitLabel("cm", "imperial"), "in");
  assert.equal(unitLabel("kg", "imperial"), "lb");
});

test("stored values stay metric — conversion is display-only", () => {
  const before = JSON.stringify(row("fan", "S"));
  formatRange(row("fan", "S").values.widthFlatCm, "cm", "imperial");
  assert.equal(JSON.stringify(row("fan", "S")), before);
});

/* ── size labels ── */

test("supplier aliases normalise onto public labels", () => {
  assert.equal(normalizeSizeLabel("P"), "S");
  assert.equal(normalizeSizeLabel("GG"), "2XL");
  assert.equal(normalizeSizeLabel("XG"), "XL");
  assert.equal(normalizeSizeLabel("2XG"), "2XL");
  assert.equal(normalizeSizeLabel("xxl"), "2XL");
});

test("import rejects sizes that do not belong to the product type", () => {
  assert.deepEqual(validateSizes("player", ["S", "3XL", "4XL"]), { valid: ["S"], invalid: ["3XL", "4XL"] });
  assert.deepEqual(validateSizes("kids", ["16", "XL"]), { valid: ["16"], invalid: ["XL"] });
  assert.deepEqual(validateSizes("fan", ["P", "GG"]), { valid: ["S", "2XL"], invalid: [] });
});

/* ── chart selection ── */

test("chart selection is product-type specific", () => {
  const p = (categorySlug: string, kids = false, tags: string[] = []) => ({ categorySlug, kids, tags });
  assert.equal(chartIdFor(p("current-season"), "fan"), "fan");
  assert.equal(chartIdFor(p("current-season"), "player"), "player");
  assert.equal(chartIdFor(p("player-version")), "player");
  assert.equal(chartIdFor(p("kids", true)), "kids");
  assert.equal(chartIdFor(p("hoodies")), "hoodie");
  assert.equal(chartIdFor(p("long-sleeve")), "long-sleeve");
  assert.equal(chartIdFor(p("retro")), "retro");
  assert.equal(chartIdFor(p("current-season", false, ["training-suit"])), "training-suit");
});

/* ── availability ── */

const baseProduct = (extra: Partial<Product> = {}) =>
  ({
    status: "made_to_order",
    kids: false,
    categorySlug: "current-season",
    tags: [],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    ...extra,
  }) as unknown as Product;

test("catalog presence defaults imported products to confirmation_required", () => {
  const imported = baseProduct({ availability: { status: "confirmation_required" } });
  const state = resolveAvailability(imported, "fan", "M");
  assert.equal(state.status, "confirmation_required");
  assert.equal(requiresSupplierConfirmation(state.status), true);
});

test("a product with no availability record is unconfirmed, not available", () => {
  const state = resolveAvailability(baseProduct(), "fan", "M");
  assert.equal(state.status, "confirmation_required", "catalog presence alone confirms nothing");
  assert.equal(state.source, "derived");
});

test("publishing a product is not a supplier confirmation", () => {
  for (const status of ["available", "made_to_order", "draft"] as const) {
    const state = resolveAvailability(baseProduct({ status }), "fan", "M");
    assert.equal(state.status, "confirmation_required", `publication status "${status}" confirms nothing`);
  }
});

test("`available` without a recorded check date is treated as unconfirmed", () => {
  const undated = baseProduct({ availability: { status: "available" } });
  assert.equal(resolveAvailability(undated, "fan", "M").status, "confirmation_required");
  assert.equal(effectiveStatus({ status: "available" }), "confirmation_required");

  const dated = baseProduct({ availability: { status: "available", lastCheckedAt: new Date().toISOString() } });
  assert.equal(resolveAvailability(dated, "fan", "M").status, "available", "a dated owner check does confirm");
  assert.equal(effectiveStatus({ status: "available", lastCheckedAt: new Date().toISOString() }), "available");
});

/* ── confirmation freshness ── */

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

test("a supplier confirmation is trusted for 7 days", () => {
  assert.equal(AVAILABILITY_FRESH_DAYS, 7);
  const fresh = baseProduct({ availability: { status: "available", lastCheckedAt: daysAgo(1) } });
  assert.equal(resolveAvailability(fresh, "fan", "M", NOW).status, "available", "checked yesterday");

  const edge = baseProduct({ availability: { status: "available", lastCheckedAt: daysAgo(7) } });
  assert.equal(resolveAvailability(edge, "fan", "M", NOW).status, "available", "exactly 7 days still counts");
});

test("a confirmation older than 7 days resolves as confirmation_required", () => {
  const stale = baseProduct({ availability: { status: "available", lastCheckedAt: daysAgo(8) } });
  const resolved = resolveAvailability(stale, "fan", "M", NOW);
  assert.equal(resolved.status, "confirmation_required", "an aged-out check no longer confirms");
  assert.equal(resolved.stale, true, "the resolver reports it as stale");
  assert.equal(resolved.lastCheckedAt, daysAgo(8), "the original check date is still reported");
});

test("the stored owner decision is never rewritten by staleness", () => {
  const record = { status: "available", lastCheckedAt: daysAgo(30) } as const;
  const product = baseProduct({ availability: record });
  const before = JSON.stringify(product.availability);
  resolveAvailability(product, "fan", "M", NOW);
  assert.equal(JSON.stringify(product.availability), before, "resolution is read-only");
  assert.equal(product.availability!.status, "available", "the owner's decision is intact");
});

test("reconfirming restores available", () => {
  const product = baseProduct({ availability: { status: "available", lastCheckedAt: daysAgo(20) } });
  assert.equal(resolveAvailability(product, "fan", "M", NOW).status, "confirmation_required");
  // the admin "reconfirm" action stamps a new check date
  product.availability = { status: "available", lastCheckedAt: new Date(NOW).toISOString() };
  assert.equal(resolveAvailability(product, "fan", "M", NOW).status, "available", "a fresh check confirms again");
  assert.equal(resolveAvailability(product, "fan", "M", NOW).stale, false);
});

test("unavailable and discontinued never expire into available", () => {
  for (const status of ["unavailable", "discontinued"] as const) {
    const old = baseProduct({ availability: { status, lastCheckedAt: daysAgo(365) } });
    assert.equal(resolveAvailability(old, "fan", "M", NOW).status, status, `${status} is a decision, not a perishable claim`);
    const undated = baseProduct({ availability: { status } });
    assert.equal(resolveAvailability(undated, "fan", "M", NOW).status, status, `${status} holds without a date`);
    assert.equal(effectiveStatus({ status, lastCheckedAt: daysAgo(365) }, NOW), status);
  }
});

test("staleness applies at version and size level too", () => {
  const product = baseProduct({
    availability: { status: "available", lastCheckedAt: daysAgo(1) },
    versionAvailability: { player: { status: "available", lastCheckedAt: daysAgo(40) } },
    sizeAvailability: { [sizeKey("fan", "3XL")]: { status: "available", lastCheckedAt: daysAgo(40) } },
  });
  assert.equal(resolveAvailability(product, "fan", "M", NOW).status, "available", "fresh product check still holds");
  assert.equal(resolveAvailability(product, "player", "M", NOW).status, "confirmation_required", "stale version check expires");
  assert.equal(resolveAvailability(product, "fan", "3XL", NOW).status, "confirmation_required", "stale size check expires");
});

test("confirmationFreshness classifies records for the admin", () => {
  assert.equal(confirmationFreshness({ status: "available", lastCheckedAt: daysAgo(2) }, NOW), "confirmed");
  assert.equal(confirmationFreshness({ status: "available", lastCheckedAt: daysAgo(9) }, NOW), "expired");
  assert.equal(confirmationFreshness({ status: "available" }, NOW), "unconfirmed");
  assert.equal(confirmationFreshness({ status: "unavailable" }, NOW), "unconfirmed", "not an availability claim");
  assert.equal(confirmationFreshness(undefined, NOW), "unconfirmed");
});

test("a product-level available never overrides a narrower restriction", () => {
  const checked = { status: "available", lastCheckedAt: new Date().toISOString() } as const;
  const product = baseProduct({
    availability: checked,
    versionAvailability: { player: { status: "unavailable" } },
    sizeAvailability: { [sizeKey("fan", "3XL")]: { status: "confirmation_required" }, [sizeKey("fan", "2XL")]: { status: "unavailable" } },
  });
  assert.equal(resolveAvailability(product, "fan", "M").status, "available", "product confirmation still applies where nothing narrower says otherwise");
  assert.equal(resolveAvailability(product, "fan", "3XL").status, "confirmation_required", "size-level hold wins");
  assert.equal(resolveAvailability(product, "fan", "2XL").status, "unavailable", "size-level refusal wins");
  assert.equal(resolveAvailability(product, "player", "M").status, "unavailable", "version-level refusal wins");
});

test("a size marked available cannot re-enable an unavailable version", () => {
  const product = baseProduct({
    versionAvailability: { player: { status: "unavailable" } },
    sizeAvailability: { [sizeKey("player", "M")]: { status: "available", lastCheckedAt: new Date().toISOString() } },
  });
  assert.equal(resolveAvailability(product, "player", "M").status, "unavailable", "the broader refusal still wins");
});

test("availability differs by version and by size", () => {
  const product = baseProduct({
    availability: { status: "available", lastCheckedAt: new Date().toISOString() },
    versionAvailability: { player: { status: "unavailable" } },
    sizeAvailability: {
      [sizeKey("fan", "3XL")]: { status: "confirmation_required" },
      [sizeKey("fan", "4XL")]: { status: "confirmation_required" },
      [sizeKey("player", "2XL")]: { status: "unavailable" },
    },
  });
  assert.equal(resolveAvailability(product, "fan", "XL").status, "available");
  assert.equal(resolveAvailability(product, "fan", "3XL").status, "confirmation_required");
  assert.equal(resolveAvailability(product, "fan", "4XL").status, "confirmation_required");
  assert.equal(resolveAvailability(product, "player", "2XL").status, "unavailable");
  assert.equal(resolveAvailability(product, "player", "M").status, "unavailable", "version state applies");
  assert.equal(resolveAvailability(product, "fan", "M").source, "product");
});

test("fan availability never implies player availability", () => {
  const product = baseProduct({
    versionAvailability: { fan: { status: "available", lastCheckedAt: new Date().toISOString() }, player: { status: "confirmation_required" } },
  });
  assert.equal(resolveAvailability(product, "fan", "M").status, "available");
  assert.equal(resolveAvailability(product, "player", "M").status, "confirmation_required");
});

test("archived products resolve as discontinued and are not orderable", () => {
  const product = baseProduct({ status: "archived" });
  assert.equal(resolveAvailability(product, "fan", "M").status, "discontinued");
});

test("per-version size overrides drive the offered options", () => {
  const product = baseProduct({ versionSizes: { player: ["S", "M", "L", "XL", "2XL"] } });
  assert.deepEqual(sizeOptionsFor(product, "player").map((o) => o.size), ["S", "M", "L", "XL", "2XL"]);
  assert.ok(sizeOptionsFor(product, "fan").map((o) => o.size).includes("3XL"));
});

/* ── legacy data ── */

test("charts stored in the legacy shape load and are marked preliminary", () => {
  const legacy = {
    id: "retro",
    name: { ar: "", he: "", en: "Retro" },
    note: { ar: "", he: "", en: "" },
    rows: [{ size: "S", chestCm: 106, lengthCm: 70 }],
    isPlaceholder: true,
  } as unknown as SizeChart;
  const normalized = normalizeChart(legacy);
  assert.equal(normalized.confirmation, "preliminary");
  assert.ok(normalized.columns.length > 0, "columns are synthesised");
  assert.deepEqual(normalized.rows[0]!.values.lengthCm, { min: 70 });
  assert.deepEqual(normalized.rows[0]!.values.legacyChestCm, { min: 106 }, "unverified chest kept separate");
});

test("normalising a confirmed chart leaves it confirmed", () => {
  assert.equal(normalizeChart(chart("fan")).confirmation, "supplier_confirmed");
  assert.equal(normalizeChart(chart("fan")).rows.length, 6);
});
