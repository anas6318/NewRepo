/**
 * Badge / patch options — the contract both the storefront resolver and the
 * place-order edge function implement. Every price here comes from data;
 * nothing in the application may assume a fixed adjustment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeDeletionBlockers,
  badgeSnapshot,
  formatBadgeAdjustment,
  normalizeBadgeOption,
  parseImportedBadges,
  productBadgeSettings,
  resolveBadgeSelection,
  resolveProductBadges,
  toPublicBadge,
  toPublicBadgeSnapshot,
  validateBadgeCatalog,
} from "../../src/lib/badges.ts";
import { priceLine, cartSubtotal } from "../../src/lib/pricing.ts";
import type { BadgeOption, Product } from "../../src/services/types.ts";

const L = (ar: string, he: string, en: string) => ({ ar, he, en });

/** Mirrors the shape produced by migration 0004. */
const CATALOG: BadgeOption[] = [
  // The migrated legacy option: its ₪5 price is stored data, not a constant.
  { id: "league-patch", code: "league", name: L("شارة الدوري", "פאץ' הליגה", "League badge"), priceIls: 5, active: true, sortOrder: 10, supplierReference: "SUP-LEAGUE" },
  { id: "ucl-badge", code: "ucl", name: L("شارة دوري الأبطال", "פאץ' ליגת האלופות", "Champions League badge"), priceIls: 10, active: true, sortOrder: 20, supplierReference: "SUP-UCL" },
  { id: "cwc-badge", code: "club_world_cup", name: L("شارة كأس العالم للأندية", "פאץ' גביע העולם", "Club World Cup badge"), priceIls: 7, active: true, sortOrder: 30 },
  { id: "retired-badge", code: "retired", name: L("شارة سابقة", "פאץ' ישן", "Retired badge"), priceIls: 6, active: false, sortOrder: 40 },
];

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "test-shirt",
    categorySlug: "retro",
    name: L("قميص", "חולצה", "Shirt"),
    description: L("", "", ""),
    details: L("", "", ""),
    seoTitle: L("", "", ""),
    seoDescription: L("", "", ""),
    status: "made_to_order",
    basePriceIls: 170,
    versions: [],
    sleeves: ["short"],
    longSleeveAdjustmentIls: 0,
    sizes: ["S", "M", "L"],
    personalizable: true,
    patchIds: [],
    badges: [
      { badgeId: "league-patch", enabled: true },
      { badgeId: "ucl-badge", enabled: true },
      { badgeId: "cwc-badge", enabled: false },
      { badgeId: "retired-badge", enabled: true },
    ],
    qualifiesForFreeDelivery: true,
    featured: false,
    images: [],
    relatedSlugs: [],
    tags: [],
    rightsStatus: "cleared",
    isDemo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ── 1. migrated legacy price ─────────────────────────────────────────── */

test("the migrated legacy badge still adds exactly ₪5", () => {
  const product = makeProduct();
  const selection = resolveBadgeSelection(product, CATALOG, "league-patch");
  assert.ok(selection.ok && selection.badge);
  assert.equal(selection.badge.priceIls, 5);
  assert.equal(priceLine({ basePriceIls: 170, badgePriceIls: selection.badge.priceIls, quantity: 1 }).unitPriceIls, 175);
});

/* ── 2. a different configurable global price ─────────────────────────── */

test("a badge can carry a different global price", () => {
  const selection = resolveBadgeSelection(makeProduct(), CATALOG, "ucl-badge");
  assert.ok(selection.ok && selection.badge);
  assert.equal(selection.badge.priceIls, 10);
  assert.equal(selection.badge.priceSource, "global");
});

/* ── 3. product override wins ─────────────────────────────────────────── */

test("a product-specific override wins over the global price", () => {
  const product = makeProduct({
    badges: [{ badgeId: "ucl-badge", enabled: true, priceOverrideIls: 12 }],
  });
  const selection = resolveBadgeSelection(product, CATALOG, "ucl-badge");
  assert.ok(selection.ok && selection.badge);
  assert.equal(selection.badge.priceIls, 12, "override, not the global ₪10");
  assert.equal(selection.badge.priceSource, "override");
});

test("an override of ₪0 is honoured rather than falling back to the global price", () => {
  const product = makeProduct({ badges: [{ badgeId: "ucl-badge", enabled: true, priceOverrideIls: 0 }] });
  const selection = resolveBadgeSelection(product, CATALOG, "ucl-badge");
  assert.ok(selection.ok && selection.badge);
  assert.equal(selection.badge.priceIls, 0);
});

/* ── 4. no badge ──────────────────────────────────────────────────────── */

test("\"no badge\" adds ₪0 and is allowed by default", () => {
  const selection = resolveBadgeSelection(makeProduct(), CATALOG, undefined);
  assert.ok(selection.ok);
  assert.equal(selection.badge, undefined);
  assert.equal(priceLine({ basePriceIls: 170, badgePriceIls: 0, quantity: 1 }).unitPriceIls, 170);
});

test("a product may require a badge, and then \"no badge\" is refused", () => {
  const product = makeProduct({ allowNoBadge: false });
  const selection = resolveBadgeSelection(product, CATALOG, undefined);
  assert.equal(selection.ok, false);
  assert.equal(selection.ok === false && selection.error, "badge_required");
});

/* ── 5. globally disabled ─────────────────────────────────────────────── */

test("a globally disabled badge is neither offered nor selectable", () => {
  const product = makeProduct();
  assert.equal(
    resolveProductBadges(product, CATALOG).some((b) => b.id === "retired-badge"),
    false,
    "not offered even though the product enables it",
  );
  const selection = resolveBadgeSelection(product, CATALOG, "retired-badge");
  assert.equal(selection.ok, false);
  assert.equal(selection.ok === false && selection.error, "badge_inactive");
});

/* ── 6. not enabled for this product ──────────────────────────────────── */

test("a badge the product does not enable is rejected", () => {
  const selection = resolveBadgeSelection(makeProduct(), CATALOG, "cwc-badge");
  assert.equal(selection.ok, false);
  assert.equal(selection.ok === false && selection.error, "badge_not_enabled");
});

test("an unknown badge id is rejected rather than charged ₪0", () => {
  const selection = resolveBadgeSelection(makeProduct(), CATALOG, "totally-made-up");
  assert.equal(selection.ok, false);
  assert.equal(selection.ok === false && selection.error, "unknown_badge");
});

test("a negative stored price is refused and the option is hidden", () => {
  const broken: BadgeOption[] = [{ ...CATALOG[0]!, priceIls: -5 }];
  const product = makeProduct({ badges: [{ badgeId: "league-patch", enabled: true }] });
  assert.deepEqual(resolveProductBadges(product, broken), []);
  const selection = resolveBadgeSelection(product, broken, "league-patch");
  assert.equal(selection.ok, false);
  assert.equal(selection.ok === false && selection.error, "badge_price_invalid");
});

/* ── 7. a browser-submitted price is ignored ──────────────────────────── */

test("a price sent by the browser cannot influence what is charged", () => {
  const product = makeProduct();
  // Simulates a tampered client payload: extra fields are simply not read.
  const tampered = { badgeId: "ucl-badge", priceIls: 0, priceOverrideIls: 0 } as unknown as { badgeId: string };
  const selection = resolveBadgeSelection(product, CATALOG, tampered.badgeId);
  assert.ok(selection.ok && selection.badge);
  assert.equal(selection.badge.priceIls, 10, "catalog price, not the submitted ₪0");
});

/* ── 8/9. cart totals and quantity ────────────────────────────────────── */

test("cart totals include the configured badge price, multiplied by quantity", () => {
  const product = makeProduct({ badges: [{ badgeId: "ucl-badge", enabled: true, priceOverrideIls: 12 }] });
  const selection = resolveBadgeSelection(product, CATALOG, "ucl-badge");
  assert.ok(selection.ok && selection.badge);
  const line = priceLine({ basePriceIls: product.basePriceIls, badgePriceIls: selection.badge.priceIls, quantity: 2 });
  assert.equal(line.unitPriceIls, 182);
  assert.equal(line.lineTotalIls, 364);
  assert.equal(cartSubtotal([{ lineTotalIls: line.lineTotalIls }, { lineTotalIls: 170 }]), 534);
});

/* ── 10. snapshot immutability ────────────────────────────────────────── */

test("an existing order snapshot does not change when the badge is edited", () => {
  const product = makeProduct();
  const selection = resolveBadgeSelection(product, CATALOG, "league-patch");
  assert.ok(selection.ok && selection.badge);
  const snapshot = badgeSnapshot(selection.badge, "en");
  const before = structuredClone(snapshot);

  // The owner later renames the option and triples the price.
  const edited: BadgeOption[] = CATALOG.map((b) => (b.id === "league-patch" ? { ...b, priceIls: 15, name: L("جديد", "חדש", "Renamed badge") } : b));
  const now = resolveBadgeSelection(product, edited, "league-patch");
  assert.ok(now.ok && now.badge);
  assert.equal(now.badge.priceIls, 15, "new orders use the new price");
  assert.deepEqual(snapshot, before, "the stored snapshot is untouched");
  assert.equal(snapshot.priceIls, 5);
  assert.equal(snapshot.name.en, "League badge");
});

test("deleting an option is blocked while an order still references it", () => {
  const orders = [
    { orderNumber: "CR-AAA111", items: [{ badge: { badgeId: "league-patch", code: "league", name: L("", "", "League badge"), label: "League badge", priceIls: 5 } }] },
    { orderNumber: "CR-BBB222", items: [{ patchId: "ucl-badge" }] },
  ];
  assert.deepEqual(badgeDeletionBlockers("league-patch", orders), ["CR-AAA111"]);
  assert.deepEqual(badgeDeletionBlockers("ucl-badge", orders), ["CR-BBB222"], "pre-0004 items count too");
  assert.deepEqual(badgeDeletionBlockers("cwc-badge", orders), []);
});

/* ── 11. trilingual labels ────────────────────────────────────────────── */

test("labels resolve in Arabic, Hebrew and English without mixing", () => {
  const selection = resolveBadgeSelection(makeProduct(), CATALOG, "ucl-badge");
  assert.ok(selection.ok && selection.badge);
  assert.equal(badgeSnapshot(selection.badge, "ar").label, "شارة دوري الأبطال");
  assert.equal(badgeSnapshot(selection.badge, "he").label, "פאץ' ליגת האלופות");
  assert.equal(badgeSnapshot(selection.badge, "en").label, "Champions League badge");
  for (const locale of ["ar", "he", "en"] as const) {
    assert.doesNotMatch(badgeSnapshot(selection.badge, locale).label, /undefined|\[object/);
  }
});

test("the adjustment is isolated so it reads left-to-right inside RTL text", () => {
  assert.equal(formatBadgeAdjustment(10), "⁦+₪10⁩");
  assert.equal(formatBadgeAdjustment(0), "", "a free option shows no adjustment");
});

/* ── 12. internal fields never reach the public ───────────────────────── */

test("internal supplier references are stripped from public responses", () => {
  const publicBadge = toPublicBadge(CATALOG[0]!);
  assert.equal("supplierReference" in publicBadge, false);
  assert.equal(publicBadge.priceIls, 5, "everything else survives");

  const selection = resolveBadgeSelection(makeProduct(), CATALOG, "league-patch");
  assert.ok(selection.ok && selection.badge);
  const snapshot = badgeSnapshot(selection.badge, "en");
  assert.equal(snapshot.supplierReference, "SUP-LEAGUE", "the order keeps it for the owner");
  assert.equal("supplierReference" in toPublicBadgeSnapshot(snapshot), false, "the customer never sees it");
});

/* ── 13. admin catalog validation ─────────────────────────────────────── */

test("catalog validation catches the mistakes admin must not save", () => {
  assert.deepEqual(validateBadgeCatalog(CATALOG), []);
  const errors = validateBadgeCatalog([
    { ...CATALOG[0]! },
    { ...CATALOG[0]! }, // duplicate id and code
    { ...CATALOG[1]!, priceIls: -1 },
    { ...CATALOG[2]!, id: "x", code: "x", name: { ar: "", he: "", en: "Only English" } },
  ]);
  assert.ok(errors.some((e) => e.includes("Duplicate badge id")));
  assert.ok(errors.some((e) => e.includes("Duplicate badge code")));
  assert.ok(errors.some((e) => e.includes("₪0 or more")));
  assert.ok(errors.some((e) => e.includes("all three languages")));
});

test("reordering is expressed by sortOrder, and the resolver honours it", () => {
  const reordered: BadgeOption[] = CATALOG.map((b) => (b.id === "ucl-badge" ? { ...b, sortOrder: 1 } : b));
  const offered = resolveProductBadges(makeProduct(), reordered);
  assert.equal(offered[0]?.id, "ucl-badge");
});

/* ── legacy upgrade ───────────────────────────────────────────────────── */

test("a product still on patchIds keeps exactly the options it had", () => {
  const legacy = makeProduct({ badges: undefined, patchIds: ["league-patch", "ucl-badge"] });
  assert.deepEqual(productBadgeSettings(legacy), [
    { badgeId: "league-patch", enabled: true },
    { badgeId: "ucl-badge", enabled: true },
  ]);
  const offered = resolveProductBadges(legacy, CATALOG);
  assert.deepEqual(offered.map((b) => [b.id, b.priceIls]), [
    ["league-patch", 5],
    ["ucl-badge", 10],
  ]);
});

test("a catalog row stored before 0004 normalizes without inventing a price", () => {
  const upgraded = normalizeBadgeOption({ id: "cup-patch", name: L("شارة الكأس", "פאץ' הגביע", "Cup badge"), priceIls: 5 }, 30);
  assert.equal(upgraded.code, "cup-patch");
  assert.equal(upgraded.priceIls, 5);
  assert.equal(upgraded.active, true);
  assert.equal(upgraded.sortOrder, 30);
});

/* ── supplier import ──────────────────────────────────────────────────── */

test("import accepts known badge codes and applies overrides", () => {
  const { settings, errors } = parseImportedBadges({ badge_codes: "league|ucl", badge_price_overrides: "ucl:12" }, CATALOG);
  assert.deepEqual(errors, []);
  assert.deepEqual(settings, [
    { badgeId: "league-patch", enabled: true },
    { badgeId: "ucl-badge", enabled: true, priceOverrideIls: 12 },
  ]);
});

test("import reports unknown codes and never creates a global badge", () => {
  const { settings, errors } = parseImportedBadges({ badge_codes: "league|mystery_badge" }, CATALOG);
  assert.deepEqual(settings, [{ badgeId: "league-patch", enabled: true }], "the unknown code is skipped");
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /unknown badge code "mystery_badge"/);
});

test("import rejects negative, malformed and orphaned price overrides", () => {
  const { errors } = parseImportedBadges({ badge_codes: "league", badge_price_overrides: "league:-3|ucl:10|nonsense" }, CATALOG);
  assert.ok(errors.some((e) => e.includes("negative badge price override")));
  assert.ok(errors.some((e) => e.includes("not in badge_codes")));
  assert.ok(errors.some((e) => e.includes("expected code:price")));
});
