import { useEffect, useState } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { useSettings } from "../../services/store.tsx";
import type { Order } from "../../services/types.ts";
import { Price, useL } from "../../components/ui/bits.tsx";
import { IconCheck } from "../../components/ui/Icons.tsx";
import { formatBadgeAdjustment } from "../../lib/badges.ts";

export function ConfirmationPage({ orderNumber }: { orderNumber: string }) {
  const { locale, t } = useI18n();
  const L = useL();
  const { settings } = useSettings();
  const [order, setOrder] = useState<Order | null>(null);

  usePageMeta({ title: t("confirmation.title"), path: `/order/confirmation/${orderNumber}`, locale, noindex: true });

  useEffect(() => {
    // The confirmation page can only show details for the order just placed
    // in this session (tracking otherwise requires number + contact).
    try {
      const raw = sessionStorage.getItem("crowned_last_order");
      if (!raw) return;
      const { n, c } = JSON.parse(raw) as { n: string; c: string };
      if (n !== orderNumber) return;
      dataService()
        .trackOrder(n, c)
        .then((o) => setOrder(o))
        .catch(() => undefined);
    } catch {
      /* ignore */
    }
  }, [orderNumber]);

  const isBank = order?.paymentMethod === "bank_transfer";

  return (
    <main id="main" className="container--narrow container section">
      <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="empty-state__icon">
          <IconCheck size={26} />
        </span>
        <h1 className="section__title">{t("confirmation.title")}</h1>
        <p className="text-muted">{t("confirmation.body")}</p>
        <p className="confirm-number">
          <span className="text-xs upper text-muted">{t("tracking.orderNumber")}</span>
          <bdi>{orderNumber}</bdi>
        </p>
      </div>

      {order && (
        <div className="card stack mt-8">
          <h2 className="drawer__title">{t("checkout.orderSummary")}</h2>
          <ul className="stack stack--sm" style={{ listStyle: "none", padding: 0 }}>
            {order.items.map((item, i) => (
              <li key={i} className="row row--between text-sm">
                <span>
                  {L(item.title)} ×{item.quantity}
                  {item.personalization && (
                    <span className="text-muted"> — {`${item.personalization.name ?? ""} ${item.personalization.number ?? ""}`.trim()}</span>
                  )}
                  {item.badge && (
                    <span className="text-muted">
                      {" · "}
                      {L(item.badge.name)} {formatBadgeAdjustment(item.badge.priceIls)}
                    </span>
                  )}
                  {item.price?.saleLabel && <span className="badge badge--sale badge--inline">{item.price.saleLabel}</span>}
                </span>
                <Price ils={item.lineTotalIls} compareIls={item.price && item.price.saleDiscountIls > 0 ? item.price.regularUnitPriceIls * item.quantity : undefined} />
              </li>
            ))}
          </ul>
          {order.promotion && (
            <div className="row row--between text-sm promo-line">
              <span className="promo-line__label">{order.promotion.labelText}</span>
              <span className="promo-line__amount">
                −<Price ils={order.promotion.discountIls} />
              </span>
            </div>
          )}
          <div className="row row--between text-sm">
            <span className="text-muted">{t("cart.delivery")}</span>
            {order.freeDelivery ? <span style={{ color: "var(--ok)", fontWeight: 700 }}>{t("checkout.free")}</span> : <Price ils={order.deliveryIls} />}
          </div>
          <div className="row row--between" style={{ fontWeight: 800 }}>
            <span>{t("cart.total")}</span>
            <Price ils={order.totalIls} />
          </div>
        </div>
      )}

      {/* Supplier-confirmation gate: no payment instructions are pushed while
          availability is still unconfirmed. */}
      {order?.supplierConfirmation?.required && order.supplierConfirmation.status === "pending" && (
        <div className="card stack mt-6" style={{ borderColor: "var(--warn)" }}>
          <h2 className="drawer__title">{t("availability.awaitingConfirmation")}</h2>
          <p className="text-sm">{t("availability.requestReceived")}</p>
          {/* Honest about the sale: a discounted price held for an
              unconfirmed request is not promised indefinitely, and an
              already-ended sale is not silently extended. */}
          {(() => {
            const held = order.items.map((i) => i.price?.priceValidUntil).filter((d): d is string => !!d);
            const soonest = held.sort()[0];
            if (soonest) {
              return Date.parse(soonest) > Date.now() ? (
                <p className="text-sm">{t("sale.priceHeldUntil", { date: new Date(soonest).toLocaleString(locale === "en" ? "en-GB" : locale === "he" ? "he-IL" : "ar") })}</p>
              ) : (
                <p className="text-sm">{t("sale.endedBeforeConfirmation")}</p>
              );
            }
            return null;
          })()}
        </div>
      )}

      {isBank && settings && !(order?.supplierConfirmation?.required && order.supplierConfirmation.status === "pending") && (
        <div className="card stack mt-6" style={{ borderColor: "var(--gold-500)" }}>
          <h2 className="drawer__title">{t("checkout.bankTransferInfoTitle")}</h2>
          <p className="text-sm" style={{ whiteSpace: "pre-line" }}>
            {L(settings.bankTransferInstructions)}
          </p>
          <p className="text-xs text-muted">{t("confirmation.bankNote")}</p>
        </div>
      )}

      <div className="stack mt-8" style={{ alignItems: "center" }}>
        <h2 className="drawer__title">{t("confirmation.whatNext")}</h2>
        <p className="text-sm text-muted center-text" style={{ maxWidth: "50ch" }}>
          {t("confirmation.nextSteps")}
        </p>
        <div className="row">
          <Link to={`/${locale}/track`} className="btn btn--gold">
            {t("confirmation.trackCta")}
          </Link>
          <Link to={`/${locale}/shop`} className="btn btn--outline">
            {t("cart.continueShopping")}
          </Link>
        </div>
      </div>
    </main>
  );
}
