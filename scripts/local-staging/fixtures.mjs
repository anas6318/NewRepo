/**
 * Synthetic `it-` fixtures for the LOCAL Supabase stack — one definition
 * shared by the seed (scripts/local-staging/seed-local.mjs) and the
 * integration suite (tests/integration/local-supabase/), so the tests assert
 * against exactly what was seeded.
 *
 * Pricing rules (CROWNED, mirrored from tests/unit/fixtures/order-pricing-cases.ts):
 *   Retro regular ₪169; an active Retro sale to ₪149 (S–2XL);
 *   current-season Fan ₪149 (S–4XL) and Player ₪179 (= 149 + 30, S–2XL);
 *   personalization (name + number) free; badge `it-badge` ₪12.
 *
 * Every supplier-only / internal key a product can carry
 * (src/services/types.ts Product.supplier {sku, reference, costUsd},
 * AvailabilityRecord.supplierNote at product / version / size level, plus the
 * defensive top-level supplierNote / supplierReference / internalNotes that
 * migration 0007 strips) is populated with a SUPPLIER-SENTINEL-* value. The
 * badge's internal `patches.supplier_ref` column is a sentinel too.
 * No real person, address, phone or brand appears here.
 */

export const IT_PREFIX = "it-";
export const SENTINEL_PREFIX = "SUPPLIER-SENTINEL";
/** Numeric supplier cost: cannot carry a string sentinel, so it is a value
 * that appears nowhere else in the catalog and is searched for literally. */
export const SENTINEL_COST_USD = 9876.54;

export const ZONE_ID = "it-zone";
export const ZONE_PRICE_ILS = 30;
export const BADGE_ID = "it-badge";
export const BADGE_PRICE_ILS = 12;
export const BADGE_SUPPLIER_REF = `${SENTINEL_PREFIX}-BADGE-SUPPLIER-REF`;
export const PROMO_ID = "it-promo-disabled";

export const ADULT = ["S", "M", "L", "XL", "2XL"];
export const ADULT_4XL = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];

export const PRICES = Object.freeze({
  retroRegular: 169,
  retroSale: 149,
  fan: 149,
  player: 179,
});

const L = (en) => ({ ar: `${en} (ar)`, he: `${en} (he)`, en });

/** Midnight UTC today: fresh for the 7-day confirmation window, and stable
 * across two seed runs on the same day (so a re-run rewrites identical rows). */
export function checkedAtToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function sentinelsFor(id) {
  const tag = id.toUpperCase();
  return {
    sku: `${SENTINEL_PREFIX}-SKU-${tag}`,
    reference: `${SENTINEL_PREFIX}-REF-${tag}`,
    availabilityNote: `${SENTINEL_PREFIX}-AVAIL-NOTE-${tag}`,
    fanNote: `${SENTINEL_PREFIX}-VERSION-NOTE-FAN-${tag}`,
    playerNote: `${SENTINEL_PREFIX}-VERSION-NOTE-PLAYER-${tag}`,
    sizeNote: `${SENTINEL_PREFIX}-SIZE-NOTE-${tag}`,
    topNote: `${SENTINEL_PREFIX}-TOP-NOTE-${tag}`,
    topReference: `${SENTINEL_PREFIX}-TOP-REF-${tag}`,
    internalNotes: `${SENTINEL_PREFIX}-INTERNAL-NOTES-${tag}`,
  };
}

/** Every SUPPLIER-SENTINEL string seeded for one product id. */
export function productSentinelValues(id) {
  return Object.values(sentinelsFor(id));
}

function baseProduct(id, { status = "available", categorySlug, basePriceIls, checkedAt, extra = {}, availability }) {
  const s = sentinelsFor(id);
  const fresh = { status: "available", lastCheckedAt: checkedAt };
  return {
    id,
    slug: id,
    categorySlug,
    name: L(`IT Product ${id}`),
    description: L(`Synthetic integration-test product ${id}.`),
    details: L("Synthetic."),
    seoTitle: L(`IT ${id}`),
    seoDescription: L("Synthetic integration-test product."),
    status,
    basePriceIls,
    versions: [],
    sleeves: ["short"],
    longSleeveAdjustmentIls: 0,
    sizes: ADULT,
    personalizable: true,
    patchIds: [],
    badges: [{ badgeId: BADGE_ID, enabled: true }],
    allowNoBadge: true,
    sale: { enabled: false, type: "none" },
    qualifiesForFreeDelivery: true,
    featured: false,
    images: [{ src: `/demo/${id}.webp`, alt: L(`IT ${id}`) }],
    relatedSlugs: [],
    tags: ["it-fixture"],
    rightsStatus: status === "draft" ? "pending_review" : "cleared",
    // ── supplier-only / internal (must never reach the storefront) ──
    supplier: { sku: s.sku, reference: s.reference, costUsd: SENTINEL_COST_USD },
    availability: availability ?? { ...fresh, supplierNote: s.availabilityNote },
    sizeAvailability: availability ? undefined : { "*:M": { ...fresh, supplierNote: s.sizeNote } },
    supplierNote: s.topNote,
    supplierReference: s.topReference,
    internalNotes: s.internalNotes,
    isDemo: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/** Product rows: { id, slug, status, rights_status, category_slug, data }. */
export function productFixtures(checkedAt = checkedAtToday()) {
  const s = (id) => sentinelsFor(id);
  const fresh = { status: "available", lastCheckedAt: checkedAt };
  const products = [
    baseProduct("it-retro-regular", { categorySlug: "retro", basePriceIls: PRICES.retroRegular, checkedAt }),
    baseProduct("it-retro-sale", {
      categorySlug: "retro",
      basePriceIls: PRICES.retroRegular,
      checkedAt,
      extra: {
        sale: {
          enabled: true,
          type: "fixed_price",
          salePriceIls: PRICES.retroSale,
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2099-01-01T00:00:00.000Z",
          label: L("IT Retro sale"),
        },
      },
    }),
    baseProduct("it-season", {
      categorySlug: "current-season",
      basePriceIls: PRICES.fan,
      checkedAt,
      extra: {
        versions: [
          { version: "fan", adjustmentIls: 0 },
          { version: "player", adjustmentIls: PRICES.player - PRICES.fan },
        ],
        sizes: ADULT_4XL,
        versionSizes: { fan: ADULT_4XL, player: ADULT },
        versionAvailability: {
          fan: { ...fresh, supplierNote: s("it-season").fanNote },
          player: { ...fresh, supplierNote: s("it-season").playerNote },
        },
      },
    }),
    // Supplier confirmation required: no fresh check anywhere → the order is held.
    baseProduct("it-hold", {
      categorySlug: "retro",
      basePriceIls: PRICES.retroRegular,
      checkedAt,
      availability: { status: "confirmation_required", supplierNote: s("it-hold").availabilityNote },
    }),
    baseProduct("it-draft", { status: "draft", categorySlug: "retro", basePriceIls: 111, checkedAt }),
    baseProduct("it-archived", { status: "archived", categorySlug: "retro", basePriceIls: 112, checkedAt }),
  ];
  return products.map((data) => {
    const clean = JSON.parse(JSON.stringify(data)); // drops undefined keys
    return {
      id: clean.id,
      slug: clean.slug,
      status: clean.status,
      rights_status: clean.rightsStatus,
      category_slug: clean.categorySlug,
      data: clean,
    };
  });
}

export const PUBLISHED_PRODUCT_IDS = ["it-retro-regular", "it-retro-sale", "it-season", "it-hold"];
export const HIDDEN_PRODUCT_IDS = ["it-draft", "it-archived"];

export function badgeFixture() {
  return {
    id: BADGE_ID,
    active: true,
    sort_order: 900,
    supplier_ref: BADGE_SUPPLIER_REF,
    data: { id: BADGE_ID, code: "it_badge", name: L("IT badge"), priceIls: BADGE_PRICE_ILS, active: true, sortOrder: 900 },
  };
}

export function zoneFixture() {
  return { id: ZONE_ID, active: true, data: { id: ZONE_ID, name: L("IT zone"), priceIls: ZONE_PRICE_ILS, etaDays: "2-4", active: true } };
}

/** A DISABLED campaign naming the it- products. Exists so a request can try
 * to switch it on from the client ("fake promotion") — it must stay off. */
export function promotionFixture() {
  return {
    id: PROMO_ID,
    enabled: false,
    sort_order: 900,
    data: {
      id: PROMO_ID,
      type: "second_item_percentage",
      enabled: false,
      discountPercent: 50,
      minimumQuantity: 2,
      repeatPerPair: true,
      stackWithProductSales: true,
      sortOrder: 900,
      label: L("IT disabled promo"),
      eligibleProductIds: PUBLISHED_PRODUCT_IDS,
    },
  };
}

/** Local auth users. Passwords are generated by the seed and stored only in
 * .claude/local-staging/users.json (gitignored). */
export const USERS = Object.freeze({
  customerA: { email: "it-customer-a@example.test", name: "IT Customer A", role: "customer" },
  customerB: { email: "it-customer-b@example.test", name: "IT Customer B", role: "customer" },
  contentManager: { email: "it-content-manager@example.test", name: "IT Content Manager", role: "content_manager" },
  orderManager: { email: "it-order-manager@example.test", name: "IT Order Manager", role: "order_manager" },
  admin: { email: "it-admin@example.test", name: "IT Admin", role: "admin" },
  owner: { email: "it-owner@example.test", name: "IT Owner", role: "owner" },
});

export const USERS_FILE_REL = ".claude/local-staging/users.json";
