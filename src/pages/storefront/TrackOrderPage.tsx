/** Secure order tracking (spec §16): order number + email/phone match; the
 * "not found" and "wrong contact" outcomes are indistinguishable. */
import { useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import type { FulfillmentStatus, Order } from "../../services/types.ts";
import { FULFILLMENT_FLOW } from "../../services/types.ts";
import { Field } from "../../components/product/ReviewsSection.tsx";
import { Price, useL } from "../../components/ui/bits.tsx";
import { IconCheck } from "../../components/ui/Icons.tsx";
import { IssueReportForm } from "../../components/checkout/IssueReportForm.tsx";

const STATUS_KEY: Record<FulfillmentStatus, string> = {
  order_received: "statusOrderReceived",
  awaiting_payment: "statusAwaitingPayment",
  payment_confirmed: "statusPaymentConfirmed",
  sent_to_supplier: "statusSentToSupplier",
  production_started: "statusProductionStarted",
  supplier_processing: "statusSupplierProcessing",
  supplier_dispatched: "statusSupplierDispatched",
  in_transit: "statusInTransit",
  arrived_locally: "statusArrivedLocally",
  out_for_delivery: "statusOutForDelivery",
  delivered: "statusDelivered",
  issue_reported: "statusIssueReported",
  cancelled: "statusCancelled",
  refunded: "statusRefunded",
};

export function TrackOrderPage() {
  const { locale, t } = useI18n();
  const L = useL();
  const [orderNumber, setOrderNumber] = useState("");
  const [contact, setContact] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "found">("idle");
  const [showIssue, setShowIssue] = useState(false);

  usePageMeta({ title: t("nav.trackOrder"), description: t("tracking.metaDescription"), path: "/track", locale });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderNumber.trim() || contact.trim().length < 4) {
      setState("notfound");
      return;
    }
    setState("loading");
    const found = await dataService().trackOrder(orderNumber, contact);
    if (found) {
      setOrder(found);
      setState("found");
    } else {
      setOrder(null);
      setState("notfound");
    }
  };

  return (
    <main id="main" className="container--narrow container section--tight section">
      <h1 className="section__title mb-4">{t("nav.trackOrder")}</h1>
      <p className="text-muted mb-6">{t("tracking.intro")}</p>

      <form className="card stack" onSubmit={submit}>
        <div className="form-grid">
          <Field id="tr-number" label={t("tracking.orderNumber")} required>
            <input id="tr-number" className="input" dir="ltr" placeholder="CR-XXXXXX" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </Field>
          <Field id="tr-contact" label={t("tracking.verifyWith")} required hint={t("tracking.verifyHint")}>
            <input id="tr-contact" className="input" dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
        </div>
        <button type="submit" className="btn btn--gold" style={{ alignSelf: "flex-start" }} disabled={state === "loading"}>
          {state === "loading" ? t("common.loading") : t("tracking.submit")}
        </button>
        {state === "notfound" && (
          <p className="field__error" role="alert">
            {t("tracking.notFound")}
          </p>
        )}
      </form>

      {order && state === "found" && (
        <div className="stack stack--lg mt-8">
          <div className="card stack--sm stack">
            <div className="row row--between row--wrap">
              <h2 className="drawer__title">
                <bdi>{order.orderNumber}</bdi>
              </h2>
              <span className="badge badge--gold">{t(`tracking.${STATUS_KEY[order.fulfillmentStatus]}`)}</span>
            </div>
            <p className="text-sm text-muted">
              {new Date(order.createdAt).toLocaleDateString(locale === "en" ? "en-GB" : locale === "he" ? "he-IL" : "ar")} · {order.items.length}{" "}
              {t("tracking.items")} · <Price ils={order.totalIls} />
            </p>
            {order.trackingNumber && (
              <p className="text-sm">
                {t("tracking.trackingNumber")}: <bdi className="num">{order.trackingNumber}</bdi>
                {order.trackingUrl && (
                  <>
                    {" — "}
                    <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="text-gold">
                      {t("tracking.carrierLink")}
                    </a>
                  </>
                )}
              </p>
            )}
            {order.estimatedDeliveryAt && (
              <p className="text-sm text-muted">
                {t("tracking.estimatedDelivery")}: {new Date(order.estimatedDeliveryAt).toLocaleDateString(locale === "en" ? "en-GB" : locale === "he" ? "he-IL" : "ar")}
              </p>
            )}
            {order.customerVisibleMessage && <p className="text-sm">{L(order.customerVisibleMessage)}</p>}
          </div>

          <OrderTimeline order={order} />

          <div className="stack--sm stack">
            <button type="button" className="btn btn--outline btn--sm" style={{ alignSelf: "flex-start" }} aria-expanded={showIssue} onClick={() => setShowIssue((v) => !v)}>
              {t("tracking.reportIssue")}
            </button>
            {showIssue && <IssueReportForm orderNumber={order.orderNumber} defaultContact={contact} />}
          </div>
        </div>
      )}
    </main>
  );
}

export function OrderTimeline({ order }: { order: Order }) {
  const { locale, t } = useI18n();
  const reached = new Map(order.tracking.map((ev) => [ev.status, ev.at]));
  const isTerminalBad = ["cancelled", "refunded", "issue_reported"].includes(order.fulfillmentStatus);
  const flow: FulfillmentStatus[] = order.paymentMethod === "bank_transfer" ? ["order_received", "awaiting_payment", ...FULFILLMENT_FLOW.slice(1)] : FULFILLMENT_FLOW;
  const currentIdx = flow.findIndex((s) => s === order.fulfillmentStatus);

  return (
    <ol className="timeline card" aria-label={t("tracking.timeline")}>
      {flow.map((status, i) => {
        const at = reached.get(status);
        const done = at !== undefined && i < (currentIdx === -1 ? flow.length : currentIdx);
        const current = status === order.fulfillmentStatus;
        return (
          <li key={status} className={current ? "is-current" : done ? "is-done" : "is-pending"}>
            <span className="timeline__dot">{done && <IconCheck size={13} />}</span>
            <p className="timeline__label">{t(`tracking.${STATUS_KEY[status]}`)}</p>
            {at && (
              <p className="timeline__meta">
                {new Date(at).toLocaleString(locale === "en" ? "en-GB" : locale === "he" ? "he-IL" : "ar", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
          </li>
        );
      })}
      {isTerminalBad && (
        <li className="is-current">
          <span className="timeline__dot" />
          <p className="timeline__label">{t(`tracking.${STATUS_KEY[order.fulfillmentStatus]}`)}</p>
        </li>
      )}
    </ol>
  );
}
