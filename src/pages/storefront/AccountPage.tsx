import { useEffect, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { useSession } from "../../services/store.tsx";
import type { Order } from "../../services/types.ts";
import { OrderTimeline } from "./TrackOrderPage.tsx";
import { Price, useL } from "../../components/ui/bits.tsx";

export function AccountPage({ tab, orderNumber }: { tab: "profile" | "orders" | "order-detail" | string; orderNumber?: string }) {
  const { locale, t } = useI18n();
  const L = useL();
  const navigate = useNavigate();
  const { customer, loading, logout } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);

  usePageMeta({ title: t("account.overviewTitle"), path: "/account", locale, noindex: true });

  useEffect(() => {
    if (!loading && !customer) navigate(`/${locale}/login`, { replace: true });
  }, [loading, customer, navigate, locale]);

  useEffect(() => {
    if (!customer) return;
    let alive = true;
    dataService()
      .listCustomerOrders(customer.id)
      .then((o) => alive && setOrders(o))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [customer]);

  if (loading || !customer) {
    return <main id="main" className="container section" aria-busy="true" />;
  }

  const P = `/${locale}/account`;
  const detail = tab === "order-detail" ? orders.find((o) => o.orderNumber === orderNumber) : undefined;

  return (
    <main id="main" className="container section--tight section">
      <div className="row row--between row--wrap mb-6">
        <h1 className="section__title">{t("account.overviewTitle")}</h1>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => void logout().then(() => navigate(`/${locale}`))}>
          {t("account.logout")}
        </button>
      </div>

      <nav className="tabs mb-6" aria-label={t("account.overviewTitle")}>
        <Link to={P} aria-current={tab === "profile" ? "page" : undefined}>
          <span className="tabs__item" aria-selected={tab === "profile"} role="presentation" style={{ display: "inline-block", padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, fontSize: "var(--fs-sm)", borderBlockEnd: tab === "profile" ? "2px solid var(--gold-500)" : "2px solid transparent", color: tab === "profile" ? "var(--fg)" : "var(--fg-muted)" }}>
            {t("account.profileTab")}
          </span>
        </Link>
        <Link to={`${P}/orders`} aria-current={tab !== "profile" ? "page" : undefined}>
          <span className="tabs__item" role="presentation" style={{ display: "inline-block", padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, fontSize: "var(--fs-sm)", borderBlockEnd: tab !== "profile" ? "2px solid var(--gold-500)" : "2px solid transparent", color: tab !== "profile" ? "var(--fg)" : "var(--fg-muted)" }}>
            {t("account.orderHistoryTitle")}
          </span>
        </Link>
      </nav>

      {tab === "profile" && (
        <div className="card stack" style={{ maxWidth: 560 }}>
          <p>
            <span className="text-xs upper text-muted">{t("account.fullName")}</span>
            <br />
            <strong>{customer.name}</strong>
          </p>
          <p>
            <span className="text-xs upper text-muted">{t("account.email")}</span>
            <br />
            <bdi>{customer.email}</bdi>
          </p>
          {customer.isDemo && <span className="badge badge--demo">{t("common.demoLabel")}</span>}
        </div>
      )}

      {tab === "orders" && (
        <div className="stack">
          {orders.length === 0 && <p className="text-muted">{t("account.noOrders")}</p>}
          {orders.map((o) => (
            <Link key={o.id} to={`${P}/orders/${o.orderNumber}`} className="card row row--between row--wrap" style={{ padding: "var(--sp-4)" }}>
              <div>
                <strong>
                  <bdi>{o.orderNumber}</bdi>
                </strong>
                <p className="text-xs text-muted">
                  {new Date(o.createdAt).toLocaleDateString(locale === "en" ? "en-GB" : locale === "he" ? "he-IL" : "ar")} · {o.items.length} {t("tracking.items")}
                </p>
              </div>
              <div className="row">
                <span className="badge badge--gold">{t(`tracking.status${statusKey(o.fulfillmentStatus)}`)}</span>
                <Price ils={o.totalIls} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === "order-detail" &&
        (detail ? (
          <div className="stack stack--lg">
            <div className="card stack--sm stack">
              <h2 className="drawer__title">
                <bdi>{detail.orderNumber}</bdi>
              </h2>
              <ul style={{ listStyle: "none", padding: 0 }} className="stack--sm stack">
                {detail.items.map((item, i) => (
                  <li key={i} className="row row--between text-sm">
                    <span>
                      {L(item.title)} ×{item.quantity} — {item.size}
                      {item.personalization && <span className="text-muted"> · {`${item.personalization.name ?? ""} ${item.personalization.number ?? ""}`.trim()}</span>}
                    </span>
                    <Price ils={item.lineTotalIls} />
                  </li>
                ))}
              </ul>
              <div className="row row--between" style={{ fontWeight: 800 }}>
                <span>{t("cart.total")}</span>
                <Price ils={detail.totalIls} />
              </div>
            </div>
            <OrderTimeline order={detail} />
          </div>
        ) : (
          <p className="text-muted">{t("tracking.notFound")}</p>
        ))}
    </main>
  );
}

function statusKey(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}
