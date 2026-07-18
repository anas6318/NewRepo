import { useI18n } from "../../lib/i18n/index.tsx";
import { useCart } from "../../services/store.tsx";

/** Honest free-delivery progress (spec §12): quantity-based, three states. */
export function FreeDeliveryProgress() {
  const { t } = useI18n();
  const cart = useCart();
  const { fdMessage, freeDelivery, minItems } = cart;

  const text =
    fdMessage.key === "unlocked"
      ? t("cart.freeDeliveryUnlocked")
      : fdMessage.key === "progressOne"
        ? t("cart.freeDeliveryProgressOne")
        : t("cart.freeDeliveryProgressMany", { count: fdMessage.count ?? 0 });

  const pct = Math.min(100, Math.round((freeDelivery.qualifyingItemCount / minItems) * 100));

  return (
    <div className="fd-progress" role="status">
      <span>{text}</span>
      <div className="fd-progress__bar" aria-hidden="true">
        <div className="fd-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
