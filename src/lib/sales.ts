/**
 * Product sales — pure resolution logic. No I/O, no framework imports, no
 * hard-coded discounts: every value, schedule and label is configuration.
 *
 * Three rules hold everywhere:
 *  1. The regular price is never overwritten. A sale is applied on top and
 *     disappears cleanly when it ends.
 *  2. A sale is only "active" inside its window. Start is inclusive, end is
 *     exclusive, both compared in UTC.
 *  3. Being on sale says nothing about supplier availability or publication —
 *     those are separate states resolved elsewhere.
 *
 * The same rules are mirrored (deliberately — Deno edge functions cannot
 * import from `src/`) in supabase/functions/place-order/index.ts. The
 * contract both sides implement is pinned by tests/unit/sales.test.ts.
 */
import type { LocalizedText, Product, ResolvedSale, SaleConfig, SaleStatus, SaleType } from "../services/types.ts";

export type Locale = "ar" | "he" | "en";

/** Default store timezone for entering and displaying schedules in Admin.
 * Stored timestamps are always UTC; this only affects presentation. */
export const DEFAULT_TIMEZONE = "Asia/Jerusalem";

/** Fallback labels when the owner writes none and does not want the
 * automatic percentage label. */
const GENERIC_LABEL: LocalizedText = { ar: "تخفيض", he: "מבצע", en: "Sale" };

/** Automatic "{n}% off" label, phrased naturally per language. */
export function percentLabel(percent: number): LocalizedText {
  const n = formatPercent(percent);
  return { ar: `خصم ${n}%`, he: `${n}% הנחה`, en: `${n}% off` };
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, "");
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasText(text?: LocalizedText): boolean {
  return !!text && !!(text.en?.trim() || text.ar?.trim() || text.he?.trim());
}

/**
 * Validation shared by Admin, the demo service and the server. Returns a list
 * of human-readable problems; an empty list means the configuration is safe
 * to store and to apply.
 *
 * `discountableIls` is the price the sale would actually reduce (base price
 * plus the version adjustment, and the paid options too when the owner has
 * enabled add-on eligibility).
 */
export function validateSale(sale: SaleConfig | undefined, discountableIls: number): string[] {
  if (!sale || !sale.enabled || sale.type === "none") return [];
  const errors: string[] = [];

  if (sale.startsAt && Number.isNaN(Date.parse(sale.startsAt))) errors.push("Start date is not a valid date/time.");
  if (sale.endsAt && Number.isNaN(Date.parse(sale.endsAt))) errors.push("End date is not a valid date/time.");
  if (sale.startsAt && sale.endsAt && !Number.isNaN(Date.parse(sale.startsAt)) && !Number.isNaN(Date.parse(sale.endsAt))) {
    if (Date.parse(sale.endsAt) <= Date.parse(sale.startsAt)) errors.push("The sale must end after it starts.");
  }

  switch (sale.type) {
    case "percentage": {
      const p = sale.percentOff;
      if (typeof p !== "number" || !Number.isFinite(p)) errors.push("Enter a discount percentage.");
      else if (p <= 0) errors.push("The discount percentage must be greater than 0.");
      else if (p > 100) errors.push("The discount percentage cannot be more than 100%.");
      break;
    }
    case "fixed_amount": {
      const a = sale.amountOffIls;
      if (typeof a !== "number" || !Number.isFinite(a)) errors.push("Enter a discount amount in ₪.");
      else if (a <= 0) errors.push("The discount amount must be greater than ₪0.");
      else if (a > discountableIls) errors.push(`The discount amount cannot be more than the ₪${discountableIls} it applies to.`);
      break;
    }
    case "fixed_price": {
      const s = sale.salePriceIls;
      if (typeof s !== "number" || !Number.isFinite(s)) errors.push("Enter a sale price in ₪.");
      else if (s < 0) errors.push("The sale price cannot be negative.");
      else if (s >= discountableIls) errors.push(`The sale price must be below the regular ₪${discountableIls}.`);
      break;
    }
  }
  return errors;
}

/** Where a sale stands right now. `invalid` means the stored configuration
 * cannot be applied — it is treated exactly like no sale on the storefront. */
export function saleStatus(sale: SaleConfig | undefined, discountableIls: number, now: number = Date.now()): SaleStatus {
  if (!sale || !sale.enabled || sale.type === "none") return "disabled";
  if (validateSale(sale, discountableIls).length) return "invalid";
  const start = sale.startsAt ? Date.parse(sale.startsAt) : undefined;
  const end = sale.endsAt ? Date.parse(sale.endsAt) : undefined;
  // Start inclusive, end exclusive: a sale ending at 23:00 is over at 23:00.
  if (start !== undefined && now < start) return "scheduled";
  if (end !== undefined && now >= end) return "expired";
  return "active";
}

function saleLabelFor(sale: SaleConfig, percentOff?: number): LocalizedText {
  if (hasText(sale.label)) return sale.label!;
  if (sale.autoPercentLabel && percentOff !== undefined && percentOff > 0) return percentLabel(percentOff);
  return GENERIC_LABEL;
}

/**
 * Resolves a product's sale against the price it would discount.
 *
 * Returns `undefined` when there is nothing to show at all. A non-active sale
 * is still returned when the owner asked to advertise it before it starts, so
 * the storefront can show a truthful "starts on …" note — with `discountIls`
 * of 0, so no discounted price is ever displayed early.
 */
export function resolveSale(sale: SaleConfig | undefined, discountableIls: number, now: number = Date.now()): ResolvedSale | undefined {
  const status = saleStatus(sale, discountableIls, now);
  if (!sale || status === "disabled" || status === "invalid") return undefined;
  if (status === "expired") return undefined; // an ended sale simply stops existing
  if (status === "scheduled" && !sale.showBeforeStart) return undefined;

  const type = sale.type as Exclude<SaleType, "none">;
  const value = type === "percentage" ? sale.percentOff! : type === "fixed_amount" ? sale.amountOffIls! : sale.salePriceIls!;

  let discountIls = 0;
  if (status === "active") {
    if (type === "percentage") discountIls = round2((discountableIls * value) / 100);
    else if (type === "fixed_amount") discountIls = round2(value);
    else discountIls = round2(discountableIls - value);
    // Defensive: a sale can only ever reduce, never invert, a price.
    discountIls = Math.max(0, Math.min(discountIls, discountableIls));
  }

  // Only state a percentage when it is the truth about this exact price.
  const effective = status === "active" ? discountIls : projectedDiscount(type, value, discountableIls);
  const percentOff = discountableIls > 0 ? round2((effective / discountableIls) * 100) : undefined;

  return {
    status,
    type,
    value,
    discountIls,
    label: saleLabelFor(sale, percentOff),
    ...(percentOff !== undefined && percentOff > 0 ? { percentOff } : {}),
    ...(sale.startsAt ? { startsAt: sale.startsAt } : {}),
    ...(sale.endsAt ? { endsAt: sale.endsAt } : {}),
    includeAddOns: sale.includeAddOns === true,
  };
}

/** What the discount would be if the sale were running now — used for the
 * label of a scheduled sale, never to charge anyone. */
function projectedDiscount(type: Exclude<SaleType, "none">, value: number, discountableIls: number): number {
  if (type === "percentage") return round2((discountableIls * value) / 100);
  if (type === "fixed_amount") return round2(Math.min(value, discountableIls));
  return round2(Math.max(0, discountableIls - value));
}

/** The portion of a line a sale is allowed to reduce.
 *
 * By default that is the product's base price plus its version adjustment.
 * Paid add-ons — the badge, the long-sleeve upcharge — sit outside the sale
 * unless the owner explicitly enables add-on eligibility, so a ₪10 badge is
 * never quietly discounted along with the shirt. */
export function discountableAmount(
  parts: { basePriceIls: number; versionAdjustmentIls?: number; optionAdjustmentsIls?: number[]; badgePriceIls?: number },
  includeAddOns = false,
): number {
  const core = parts.basePriceIls + (parts.versionAdjustmentIls ?? 0);
  if (!includeAddOns) return round2(core);
  const options = (parts.optionAdjustmentsIls ?? []).reduce((sum, a) => sum + a, 0);
  return round2(core + options + (parts.badgePriceIls ?? 0));
}

/** Convenience for callers that hold a whole product: the discountable
 * amount for the currently selected version. */
export function productDiscountable(product: Pick<Product, "basePriceIls" | "versions" | "sale">, version?: string, includeAddOns = false): number {
  const adjustment = product.versions.find((v) => v.version === version)?.adjustmentIls ?? 0;
  return discountableAmount({ basePriceIls: product.basePriceIls, versionAdjustmentIls: adjustment }, includeAddOns);
}

/** The sale as it applies to a product's headline price — what a product card
 * shows. Resolved against the base price alone, with no version or option
 * adjustments, so the card's struck-through figure and its sale figure are
 * exactly the two numbers the card displays. */
export function resolveProductSale(product: Pick<Product, "basePriceIls" | "versions" | "sale">, now: number = Date.now()): ResolvedSale | undefined {
  return resolveSale(product.sale, product.basePriceIls, now);
}

/** Label in one language, for order snapshots and plain-text summaries. */
export function saleLabelIn(sale: ResolvedSale, locale: Locale): string {
  return sale.label[locale] || sale.label.en;
}

/** True when this sale is genuinely showing a reduced price right now. */
export function isDiscounting(sale?: ResolvedSale): boolean {
  return !!sale && sale.status === "active" && sale.discountIls > 0;
}

/** When a held (supplier-unconfirmed) order's price stops being guaranteed.
 * Honest by construction: it is exactly the sale's own end time, never an
 * invented extension. */
export function priceValidUntil(sale?: ResolvedSale): string | undefined {
  return sale && isDiscounting(sale) ? sale.endsAt : undefined;
}
