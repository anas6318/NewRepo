import { useEffect, useRef } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useCart } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { Price, useL } from "../ui/bits.tsx";
import { IconBag, IconClose, IconMinus, IconPlus, IconTrash } from "../ui/Icons.tsx";
import { FreeDeliveryProgress } from "../product/FreeDeliveryProgress.tsx";

export function CartDrawer() {
  const { locale, t } = useI18n();
  const cart = useCart();
  const L = useL();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cart.drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cart.setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [cart.drawerOpen, cart]);

  if (!cart.drawerOpen) return null;

  return (
    <>
      <div className="overlay" onClick={() => cart.setDrawerOpen(false)} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={t("cart.title")} ref={panelRef}>
        <div className="drawer__head">
          <h2 className="drawer__title">
            {t("cart.title")} {cart.count > 0 && <span className="text-muted">({cart.count})</span>}
          </h2>
          <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => cart.setDrawerOpen(false)}>
            <IconClose />
          </button>
        </div>

        <div className="drawer__body">
          {cart.lines.length === 0 ? (
            <div className="empty-state" style={{ padding: "var(--sp-10) 0" }}>
              <div className="empty-state__icon">
                <IconBag size={24} />
              </div>
              <p className="text-muted">{t("cart.empty")}</p>
              <Link to={`/${locale}/shop`} className="btn btn--dark" onClick={() => cart.setDrawerOpen(false)}>
                {t("cart.continueShopping")}
              </Link>
            </div>
          ) : (
            <div className="stack">
              <FreeDeliveryProgress />
              <ul className="cart-lines">
                {cart.lines.map((line) => (
                  <li key={line.key} className="cart-line">
                    <img src={line.image} alt="" width={72} height={90} className="cart-line__img" />
                    <div className="cart-line__body">
                      <p className="cart-line__title">{L(line.title)}</p>
                      <p className="text-xs text-muted">
                        {[
                          line.version ? t(`product.version${cap(line.version)}`) : null,
                          line.sleeve === "long" ? t("product.sleeveLong") : null,
                          line.size,
                          line.personalization?.name || line.personalization?.number
                            ? `${line.personalization?.name ?? ""} ${line.personalization?.number ?? ""}`.trim()
                            : null,
                          line.patchName ? L(line.patchName) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <div className="row row--between mt-2">
                        <div className="qty" aria-label={t("product.quantity")}>
                          <button type="button" aria-label="−" onClick={() => cart.updateQty(line.key, line.quantity - 1)}>
                            <IconMinus size={14} />
                          </button>
                          <span aria-live="polite">{line.quantity}</span>
                          <button type="button" aria-label="+" onClick={() => cart.updateQty(line.key, line.quantity + 1)}>
                            <IconPlus size={14} />
                          </button>
                        </div>
                        <Price ils={line.unitPriceIls * line.quantity} />
                      </div>
                    </div>
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
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {cart.lines.length > 0 && (
          <div className="drawer__foot">
            <div className="row row--between">
              <span className="text-sm text-muted">{t("cart.subtotal")}</span>
              <Price ils={cart.subtotalIls} />
            </div>
            <p className="text-xs text-muted">{t("checkout.hiddenFeesNote")}</p>
            <Link to={`/${locale}/checkout`} className="btn btn--gold btn--block" onClick={() => cart.setDrawerOpen(false)}>
              {t("cart.checkout")}
            </Link>
            <Link to={`/${locale}/cart`} className="btn btn--outline btn--block" onClick={() => cart.setDrawerOpen(false)}>
              {t("cart.viewCart")}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function cap(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}
