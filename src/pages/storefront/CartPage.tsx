import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { useCart } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { FreeDeliveryProgress } from "../../components/product/FreeDeliveryProgress.tsx";
import { EmptyState, Price, useL } from "../../components/ui/bits.tsx";
import { IconBag, IconMinus, IconPlus, IconTrash } from "../../components/ui/Icons.tsx";

export function CartPage() {
  const { locale, t } = useI18n();
  const cart = useCart();
  const L = useL();

  usePageMeta({ title: t("cart.title"), path: "/cart", locale, noindex: true });

  if (cart.lines.length === 0) {
    return (
      <main id="main" className="container section">
        <h1 className="section__title mb-6">{t("cart.title")}</h1>
        <EmptyState
          icon={<IconBag size={22} />}
          title={t("cart.empty")}
          action={
            <Link to={`/${locale}/shop`} className="btn btn--gold">
              {t("cart.continueShopping")}
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main id="main" className="container section--tight section">
      <h1 className="section__title mb-6">
        {t("cart.title")} <span className="text-muted">({cart.count})</span>
      </h1>
      <div className="cart-layout">
        <div className="stack">
          <FreeDeliveryProgress />
          <ul className="cart-lines">
            {cart.lines.map((line) => (
              <li key={line.key} className="cart-line">
                <Link to={`/${locale}/product/${line.slug}`}>
                  <img src={line.image} alt="" width={88} height={110} className="cart-line__img" style={{ width: 88, height: 110 }} />
                </Link>
                <div className="cart-line__body">
                  <p className="cart-line__title">
                    <Link to={`/${locale}/product/${line.slug}`}>{L(line.title)}</Link>
                  </p>
                  <p className="text-xs text-muted">
                    {[
                      line.version ? t(`product.version${line.version === "fan" ? "Fan" : line.version === "player" ? "Player" : line.version === "kids" ? "Kids" : "Retro"}`) : null,
                      line.sleeve === "long" ? t("product.sleeveLong") : null,
                      `${t("product.size")}: ${line.size}`,
                      line.personalization?.name || line.personalization?.number ? `${line.personalization?.name ?? ""} ${line.personalization?.number ?? ""}`.trim() : null,
                      line.patchName ? L(line.patchName) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="row row--between mt-2 row--wrap">
                    <div className="qty">
                      <button type="button" aria-label="−" onClick={() => cart.updateQty(line.key, line.quantity - 1)}>
                        <IconMinus size={14} />
                      </button>
                      <span aria-live="polite">{line.quantity}</span>
                      <button type="button" aria-label="+" onClick={() => cart.updateQty(line.key, line.quantity + 1)}>
                        <IconPlus size={14} />
                      </button>
                    </div>
                    <div className="row">
                      <Price ils={line.unitPriceIls * line.quantity} />
                      <button
                        type="button"
                        className="icon-btn cart-line__remove"
                        aria-label={t("cart.remove")}
                        onClick={() => {
                          cart.remove(line.key);
                          track("remove_from_cart", { item_id: line.slug });
                        }}
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside className="card stack" aria-label={t("checkout.orderSummary")}>
          <h2 className="drawer__title">{t("checkout.orderSummary")}</h2>
          <div className="row row--between text-sm">
            <span className="text-muted">{t("cart.subtotal")}</span>
            <Price ils={cart.subtotalIls} />
          </div>
          <div className="row row--between text-sm">
            <span className="text-muted">{t("cart.delivery")}</span>
            <span className="text-muted">{cart.freeDelivery.isFreeDeliveryUnlocked ? t("cart.freeDeliveryUnlocked") : t("cart.deliveryAtCheckout")}</span>
          </div>
          <hr className="divider" style={{ marginBlock: "var(--sp-2)" }} />
          <p className="text-xs text-muted">{t("checkout.hiddenFeesNote")}</p>
          <Link
            to={`/${locale}/checkout`}
            className="btn btn--gold btn--lg btn--block"
            onClick={() => track("begin_checkout", { value: cart.subtotalIls, items: cart.count })}
          >
            {t("cart.checkout")}
          </Link>
          <Link to={`/${locale}/shop`} className="btn btn--ghost btn--block">
            {t("cart.continueShopping")}
          </Link>
        </aside>
      </div>
    </main>
  );
}
