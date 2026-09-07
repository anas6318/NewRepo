/**
 * Mobile navigation drawer — designed for small screens rather than a
 * compressed desktop menu. Clear hierarchy: shopping links first, then
 * customer-service (Track Order etc.), then account, with language selection
 * in the footer. Consumes the same typed navigation content as the desktop
 * navigation.
 *
 * Accessibility: role="dialog" + aria-modal, labelled controls, focus is
 * moved in on open and restored on close, Tab is contained, Escape closes,
 * background scroll is locked, and the slide-in transition respects
 * prefers-reduced-motion (global motion-safety rules in base.css).
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "../../lib/router.tsx";
import { LOCALES, localeName, useI18n, type Locale } from "../../lib/i18n/index.tsx";
import { swapLocale } from "../../lib/router-core.ts";
import { useSession, useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { MOBILE_SHOP_NAV, UTILITY_NAV } from "../../content/navigation.ts";
import { LOGO, logoWidthFor } from "../../content/brand.ts";
import { IconClose, IconHeart, IconInstagram, IconUser } from "../ui/Icons.tsx";

export const MOBILE_MENU_ID = "mobile-menu";

export function MobileNavigation({ onClose }: { onClose: () => void }) {
  const { locale, t } = useI18n();
  const { customer } = useSession();
  const { settings } = useSettings();
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus containment + Escape close + scroll lock; focus restored on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);

  const L = `/${locale}`;
  const logoH = 22;

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div id={MOBILE_MENU_ID} className="drawer drawer--start" role="dialog" aria-modal="true" aria-label={t("nav.menu")} ref={panelRef}>
        <div className="drawer__head">
          <Link to={L} className="drawer__logo" aria-label={LOGO.alt}>
            <img src={LOGO.onLight.src} alt={LOGO.alt} width={logoWidthFor(LOGO.onLight, logoH)} height={logoH} />
          </Link>
          <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <nav className="drawer__body mobile-nav" aria-label={t("nav.menu")}>
          <p className="mobile-nav__heading">{t("nav.shop")}</p>
          {MOBILE_SHOP_NAV.map((item) => (
            <Link key={item.id} to={`${L}${item.path}`} className="mobile-nav__link">
              {t(item.labelKey)}
            </Link>
          ))}

          <p className="mobile-nav__heading">{t("nav.customerCare")}</p>
          {UTILITY_NAV.map((item) => (
            <Link key={item.id} to={`${L}${item.path}`} className="mobile-nav__link mobile-nav__link--utility">
              {t(item.labelKey)}
            </Link>
          ))}

          <p className="mobile-nav__heading">{t("nav.account")}</p>
          <Link to={`${L}/wishlist`} className="mobile-nav__link mobile-nav__link--utility row">
            <IconHeart size={18} /> {t("nav.wishlist")}
          </Link>
          <Link to={customer ? `${L}/account` : `${L}/login`} className="mobile-nav__link mobile-nav__link--utility row">
            <IconUser size={18} /> {t("nav.account")}
          </Link>
          {settings?.instagramUsername && (
            <a
              href={`https://instagram.com/${settings.instagramUsername}`}
              target="_blank"
              rel="noreferrer"
              className="mobile-nav__link mobile-nav__link--utility row"
              onClick={() => track("instagram_click", { placement: "mobile_menu" })}
            >
              <IconInstagram size={18} /> Instagram
            </a>
          )}
        </nav>

        <div className="drawer__foot">
          <div className="row row--center" style={{ gap: "var(--sp-2)" }}>
            {LOCALES.map((loc) => (
              <LangLink key={loc} loc={loc} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function LangLink({ loc }: { loc: Locale }) {
  const { locale } = useI18n();
  const location = useLocation();
  return (
    <Link to={swapLocale(location.pathname, loc, LOCALES)} className={`chip${loc === locale ? " is-selected" : ""}`} lang={loc}>
      {localeName(loc)}
    </Link>
  );
}
