/**
 * Cart-promotion presentation, shared by the cart page, the cart drawer and
 * checkout so all three always agree.
 *
 * Two pieces:
 *  - `PromotionLine` — the separate discount row in an order summary. The
 *    saving is never folded into the subtotal; the customer sees the amount.
 *  - `PromotionProgress` — a truthful status line. It states only what is
 *    already true ("applied") or exactly what is still needed ("add one
 *    more"). There is no countdown, no scarcity claim and no urgency.
 */
import { useI18n } from "../../lib/i18n/index.tsx";
import { isPromotionApplied, promotionLabelIn, type PromotionResult } from "../../lib/promotions.ts";
import { Price } from "../ui/bits.tsx";

/** The discount row for an order summary. Renders nothing until the cart
 * actually qualifies — an unearned promotion is never shown as a saving. */
export function PromotionLine({ promotion }: { promotion?: PromotionResult }) {
  const { t } = useI18n();
  if (!isPromotionApplied(promotion)) return null;
  return (
    <div className="row row--between text-sm promo-line">
      <span className="promo-line__label">{t("promotion.summaryLabel")}</span>
      <span className="promo-line__amount">
        −<Price ils={promotion!.discountIls} />
      </span>
    </div>
  );
}

/** "Add one more eligible item…" / "Second-item discount applied." */
export function PromotionProgress({ promotion, className }: { promotion?: PromotionResult; className?: string }) {
  const { locale, t } = useI18n();
  if (!promotion) return null;

  if (isPromotionApplied(promotion)) {
    return (
      <p className={`promo-note promo-note--on ${className ?? ""}`} role="status">
        {t("promotion.applied")}
      </p>
    );
  }
  // Not qualifying yet. Only speak when the customer is genuinely close —
  // an empty cart gets the campaign name, not a countdown.
  const needed = promotion.unitsToNextDiscount;
  if (promotion.eligibleUnits === 0 || needed <= 0) {
    return (
      <p className={`promo-note ${className ?? ""}`}>{promotionLabelIn(promotion.promotion, locale)}</p>
    );
  }
  return (
    <p className={`promo-note ${className ?? ""}`} role="status">
      {needed === 1 ? t("promotion.addOneMore") : t("promotion.addMore", { count: String(needed) })}
    </p>
  );
}

/** The campaign name, for product and shop pages. Deliberately phrased as a
 * future condition — it never implies this single item is already reduced. */
export function PromotionTeaser({ promotion, className }: { promotion?: PromotionResult; className?: string }) {
  const { locale } = useI18n();
  if (!promotion) return null;
  return <p className={`promo-note ${className ?? ""}`}>{promotionLabelIn(promotion.promotion, locale)}</p>;
}
