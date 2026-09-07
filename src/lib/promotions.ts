/**
 * Cart promotions — pure resolution logic. No I/O, no framework imports, no
 * hard-coded campaign: the percentage, the qualifying quantity, the dates,
 * the eligible products and the labels are all configuration.
 *
 * Only one rule exists today, `second_item_percentage`: buy N eligible units,
 * the cheapest unit of each complete group is discounted.
 *
 * Four invariants hold everywhere:
 *  1. Only MERCHANDISE participates. Badge/patch charges, personalization and
 *     delivery are excluded from both the qualifying value and the discount.
 *  2. Grouping never depends on the order lines were added to the cart. Units
 *     are sorted by merchandise value (with a stable tie-break) first.
 *  3. A unit already carrying a product-level sale never also receives this
 *     discount unless the owner explicitly enabled stacking.
 *  4. Being eligible says nothing about supplier availability — the two
 *     systems never read each other.
 *
 * The same rules are mirrored (deliberately — Deno edge functions cannot
 * import from `src/`) in supabase/functions/place-order/index.ts. The
 * contract both sides implement is pinned by tests/unit/promotions.test.ts.
 */
import type {
  LocalizedText,
  PromotionAllocation,
  PromotionConfig,
  PromotionSnapshot,
  PromotionType,
} from "../services/types.ts";

export type Locale = "ar" | "he" | "en";

/** Defaults for a newly created campaign. Disabled, so nothing goes live by
 * accident; the numbers match the brief's default campaign. */
export const PROMOTION_DEFAULTS = {
  type: "second_item_percentage" as PromotionType,
  enabled: false,
  discountPercent: 15,
  minimumQuantity: 2,
  repeatPerPair: true,
  stackWithProductSales: false,
} as const;

export const DEFAULT_PROMOTION_LABEL: LocalizedText = {
  ar: "اشترِ قطعتين واحصل على خصم 15% على القطعة الثانية",
  he: "קנו 2 וקבלו 15% הנחה על הפריט השני",
  en: "Buy 2, get 15% off the second item",
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ── validation ───────────────────────────────────────────────────────── */

/** Human-readable problems. An empty list means the campaign is safe to
 * store and to apply; anything else means it is treated exactly like no
 * promotion at all. */
export function validatePromotion(promotion: PromotionConfig | undefined): string[] {
  if (!promotion || !promotion.enabled) return [];
  const errors: string[] = [];

  const p = promotion.discountPercent;
  if (typeof p !== "number" || !Number.isFinite(p)) errors.push("Enter a discount percentage.");
  else if (p <= 0) errors.push("The discount percentage must be greater than 0.");
  else if (p > 100) errors.push("The discount percentage cannot be more than 100%.");

  const q = promotion.minimumQuantity;
  if (!Number.isInteger(q)) errors.push("The minimum quantity must be a whole number.");
  else if (q < 2) errors.push("The minimum quantity must be at least 2 — a promotion on a single item is just a sale.");

  if (!promotion.label?.en?.trim() || !promotion.label?.ar?.trim() || !promotion.label?.he?.trim()) {
    errors.push("The campaign needs a customer-facing label in all three languages.");
  }

  if (promotion.startsAt && Number.isNaN(Date.parse(promotion.startsAt))) errors.push("Start date is not a valid date/time.");
  if (promotion.endsAt && Number.isNaN(Date.parse(promotion.endsAt))) errors.push("End date is not a valid date/time.");
  if (
    promotion.startsAt &&
    promotion.endsAt &&
    !Number.isNaN(Date.parse(promotion.startsAt)) &&
    !Number.isNaN(Date.parse(promotion.endsAt)) &&
    Date.parse(promotion.endsAt) <= Date.parse(promotion.startsAt)
  ) {
    errors.push("The campaign must end after it starts.");
  }
  return errors;
}

export type PromotionStatus = "disabled" | "scheduled" | "running" | "expired" | "invalid";

/** Where the campaign stands right now. Start inclusive, end exclusive —
 * identical to the product-sale scheduler. */
export function promotionStatus(promotion: PromotionConfig | undefined, now: number = Date.now()): PromotionStatus {
  if (!promotion || !promotion.enabled) return "disabled";
  if (validatePromotion(promotion).length) return "invalid";
  const start = promotion.startsAt ? Date.parse(promotion.startsAt) : undefined;
  const end = promotion.endsAt ? Date.parse(promotion.endsAt) : undefined;
  if (start !== undefined && now < start) return "scheduled";
  if (end !== undefined && now >= end) return "expired";
  return "running";
}

/** The single campaign in force at this instant, or undefined. Picking one
 * from a list keeps the door open for several campaigns later without
 * changing any caller. */
export function activePromotion(promotions: PromotionConfig[] | undefined, now: number = Date.now()): PromotionConfig | undefined {
  return [...(promotions ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id))
    .find((p) => promotionStatus(p, now) === "running");
}

/* ── eligibility ──────────────────────────────────────────────────────── */

/** What the resolver needs to know about one product. */
export interface PromotionProductRef {
  productId: string;
  slug: string;
  categorySlug?: string;
}

/**
 * Whether a product participates. Exclusions always win. With no eligible
 * list and no eligible categories configured, every product participates —
 * the owner narrows it deliberately rather than having to list the catalog.
 */
export function isEligibleProduct(promotion: PromotionConfig, product: PromotionProductRef): boolean {
  if ((promotion.excludedProductIds ?? []).includes(product.productId)) return false;
  const ids = promotion.eligibleProductIds ?? [];
  const cats = promotion.eligibleCategorySlugs ?? [];
  if (ids.length === 0 && cats.length === 0) return true;
  if (ids.includes(product.productId)) return true;
  return !!product.categorySlug && cats.includes(product.categorySlug);
}

/* ── the cart, expressed as units ─────────────────────────────────────── */

/** One cart line as the resolver sees it. `merchandiseUnitIls` is the price
 * of a single unit AFTER any product-level sale and EXCLUDING the badge —
 * callers derive it once so the rule never has to know about pricing. */
export interface PromotionLine {
  lineKey?: string;
  productId: string;
  slug: string;
  title: LocalizedText;
  categorySlug?: string;
  quantity: number;
  merchandiseUnitIls: number;
  /** True when this unit already receives a product-level sale discount. */
  hasProductSale: boolean;
}

/**
 * The merchandise value of one unit, from its stored price breakdown.
 *
 * This is the ONLY place the promotion learns what a unit is worth, and it
 * deliberately subtracts the badge charge: a ₪140 shirt with a ₪10 badge has
 * a merchandise value of ₪140, so the promotion is calculated against ₪140
 * and the badge stays a full ₪10 afterwards. Name/number personalization is
 * free in this store and therefore contributes nothing either way. Delivery
 * is never part of a line at all.
 *
 * A product-level sale is already reflected in `finalUnitPriceIls`, so the
 * value returned here is the currently valid merchandise price — step 1 and
 * 2 of the stacking rule.
 */
export function merchandiseUnitValue(price: { finalUnitPriceIls: number; badgeAdjustmentIls?: number } | undefined, fallbackUnitPriceIls: number, badgeFallbackIls = 0): number {
  if (price) return round2(price.finalUnitPriceIls - (price.badgeAdjustmentIls ?? 0));
  return round2(fallbackUnitPriceIls - badgeFallbackIls);
}

interface Unit {
  line: PromotionLine;
  /** Index of this unit within its line, for a fully stable ordering. */
  index: number;
}

/**
 * Deterministic ordering: most expensive merchandise first, then by product
 * id, slug, line key and unit index. Cart insertion order is deliberately
 * NOT part of this, so the same basket always produces the same result no
 * matter how it was assembled.
 */
function compareUnits(a: Unit, b: Unit): number {
  return (
    b.line.merchandiseUnitIls - a.line.merchandiseUnitIls ||
    a.line.productId.localeCompare(b.line.productId) ||
    a.line.slug.localeCompare(b.line.slug) ||
    (a.line.lineKey ?? "").localeCompare(b.line.lineKey ?? "") ||
    a.index - b.index
  );
}

function expandUnits(lines: PromotionLine[]): Unit[] {
  const units: Unit[] = [];
  for (const line of lines) {
    // Quantity 2 of one product is two qualifying units, not one line.
    const n = Number.isInteger(line.quantity) ? Math.max(0, line.quantity) : 0;
    for (let i = 0; i < n; i++) units.push({ line, index: i });
  }
  return units.sort(compareUnits);
}

/* ── resolution ───────────────────────────────────────────────────────── */

export interface PromotionResult {
  promotion: PromotionConfig;
  status: PromotionStatus;
  /** Eligible units in the cart, counted per unit rather than per line. */
  eligibleUnits: number;
  /** How many more eligible units are needed to earn the next discount.
   * 0 when a discount is already earned and no further one is possible. */
  unitsToNextDiscount: number;
  discountedUnits: number;
  originalMerchandiseIls: number;
  discountIls: number;
  finalMerchandiseIls: number;
  allocations: PromotionAllocation[];
  /** Per cart line, the total promotion discount that line received. */
  discountByLineKey: Record<string, number>;
}

/**
 * Applies the campaign to a cart.
 *
 * The algorithm, in full:
 *
 *  1. Expand every eligible line into individual units (quantity 3 → three
 *     units), so quantity of one product qualifies exactly like three
 *     separate products.
 *  2. Sort those units by merchandise value, descending, with a stable
 *     tie-break that never involves insertion order.
 *  3. Cut the sorted list into consecutive groups of `minimumQuantity`.
 *     Incomplete trailing groups earn nothing. When `repeatPerPair` is off,
 *     only the first complete group counts.
 *  4. In each complete group the CHEAPEST unit (the last one, since the list
 *     is descending) is the candidate for the discount. Sorting descending
 *     and pairing adjacently maximises the total discount, so this is the
 *     customer-favourable grouping as well as a deterministic one.
 *  5. If stacking is off and that candidate already has a product-level
 *     sale, the discount moves to the cheapest unit in the SAME group that
 *     has no product sale. If every unit in the group is already
 *     sale-discounted, that group earns nothing — no discount is fabricated.
 *  6. The discount is `discountPercent` of that unit's merchandise value,
 *     rounded to two decimals.
 *
 * Returns `undefined` only when there is no campaign to talk about at all.
 * A running campaign with an unqualifying cart still returns a result, so
 * the cart can show a truthful "add one more" message.
 */
export function resolvePromotion(
  promotions: PromotionConfig[] | undefined,
  lines: PromotionLine[],
  now: number = Date.now(),
): PromotionResult | undefined {
  const promotion = activePromotion(promotions, now);
  if (!promotion) return undefined;

  const eligibleLines = lines.filter((l) => isEligibleProduct(promotion, l));
  const units = expandUnits(eligibleLines);
  const groupSize = promotion.minimumQuantity;

  const allocations: PromotionAllocation[] = [];
  const discountByLineKey: Record<string, number> = {};
  let discountIls = 0;

  const completeGroups = Math.floor(units.length / groupSize);
  const groupsToApply = promotion.repeatPerPair ? completeGroups : Math.min(completeGroups, 1);

  for (let g = 0; g < groupsToApply; g++) {
    const group = units.slice(g * groupSize, (g + 1) * groupSize);
    // Cheapest first among the group's candidates.
    const candidates = [...group].reverse();
    const chosen = promotion.stackWithProductSales ? candidates[0] : candidates.find((u) => !u.line.hasProductSale);
    if (!chosen) continue; // every unit here already has a sale — earn nothing

    const unitDiscount = round2((chosen.line.merchandiseUnitIls * promotion.discountPercent) / 100);
    if (unitDiscount <= 0) continue;

    discountIls = round2(discountIls + unitDiscount);
    allocations.push({
      productId: chosen.line.productId,
      slug: chosen.line.slug,
      title: chosen.line.title,
      ...(chosen.line.lineKey ? { lineKey: chosen.line.lineKey } : {}),
      unitMerchandiseIls: chosen.line.merchandiseUnitIls,
      discountIls: unitDiscount,
    });
    if (chosen.line.lineKey) {
      discountByLineKey[chosen.line.lineKey] = round2((discountByLineKey[chosen.line.lineKey] ?? 0) + unitDiscount);
    }
  }

  const originalMerchandiseIls = round2(units.reduce((sum, u) => sum + u.line.merchandiseUnitIls, 0));
  // How many more eligible units earn the next discount. Zero once no
  // further discount is possible, so the cart can stay quiet rather than
  // promising something that will never arrive.
  const remainder = units.length % groupSize;
  const noFurtherDiscount = !promotion.repeatPerPair && completeGroups >= 1;
  const unitsToNextDiscount = noFurtherDiscount ? 0 : remainder === 0 ? groupSize : groupSize - remainder;

  return {
    promotion,
    status: "running",
    eligibleUnits: units.length,
    unitsToNextDiscount,
    discountedUnits: allocations.length,
    originalMerchandiseIls,
    discountIls,
    finalMerchandiseIls: round2(originalMerchandiseIls - discountIls),
    allocations,
    discountByLineKey,
  };
}

/** Freezes the applied promotion into the order. */
export function promotionSnapshot(result: PromotionResult, locale: Locale): PromotionSnapshot {
  const p = result.promotion;
  return {
    promotionId: p.id,
    type: p.type,
    label: p.label,
    labelText: p.label[locale] || p.label.en,
    discountPercent: p.discountPercent,
    minimumQuantity: p.minimumQuantity,
    repeatPerPair: p.repeatPerPair,
    stackWithProductSales: p.stackWithProductSales,
    ...(p.startsAt ? { startsAt: p.startsAt } : {}),
    ...(p.endsAt ? { endsAt: p.endsAt } : {}),
    eligibleUnits: result.eligibleUnits,
    discountedUnits: result.discountedUnits,
    originalMerchandiseIls: result.originalMerchandiseIls,
    discountIls: result.discountIls,
    finalMerchandiseIls: result.finalMerchandiseIls,
    items: result.allocations,
  };
}

/** True when the promotion is actually reducing this cart's total. */
export function isPromotionApplied(result?: PromotionResult): boolean {
  return !!result && result.discountIls > 0;
}

export function promotionLabelIn(promotion: Pick<PromotionConfig, "label">, locale: Locale): string {
  return promotion.label[locale] || promotion.label.en;
}
