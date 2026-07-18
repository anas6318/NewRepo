import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "../../lib/router.tsx";
import { swapLocale } from "../../lib/router-core.ts";
import { LOCALES, localeName, useI18n, type Locale } from "../../lib/i18n/index.tsx";
import { useCart, useSession, useWishlist } from "../../services/store.tsx";
import { useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { IconBag, IconClose, IconGlobe, IconHeart, IconInstagram, IconMenu, IconSearch, IconUser } from "../ui/Icons.tsx";

const NAV_ITEMS: { key: string; path: string }[] = [
  { key: "shop", path: "/shop" },
  { key: "retro", path: "/category/retro" },
  { key: "currentSeason", path: "/category/current-season" },
  { key: "nationalTeams", path: "/category/national-teams" },
  { key: "hoodies", path: "/category/hoodies" },
  { key: "kids", path: "/category/kids" },
  { key: "trackOrder", path: "/track" },
];

const MENU_EXTRA: { key: string; path: string }[] = [
  { key: "playerVersion", path: "/category/player-version" },
  { key: "fanVersion", path: "/category/fan-version" },
  { key: "longSleeve", path: "/category/long-sleeve" },
  { key: "sizeGuide", path: "/size-guide" },
  { key: "about", path: "/about" },
  { key: "contact", path: "/contact" },
];

export function Header() {
  const { locale, t } = useI18n();
  const cart = useCart();
  const wishlist = useWishlist();
  const { customer } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const L = `/${locale}`;
  return (
    <header className="site-header theme-dark">
      <div className="container site-header__inner">
        <button type="button" className="icon-btn show-sm-only" aria-label={t("nav.menu")} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <IconMenu />
        </button>

        <Link to={L} className="site-header__logo" aria-label="CROWNED — {home}">
          <img src="/brand/logo-white.svg" alt="CROWNED" width={150} height={38} />
        </Link>

        <nav className="site-header__nav hide-sm" aria-label={t("nav.menu")}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.key} to={`${L}${item.path}`} className="site-header__link">
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>

        <div className="site-header__actions">
          <Link to={`${L}/search`} className="icon-btn" aria-label={t("nav.search")}>
            <IconSearch />
          </Link>
          <Link to={`${L}/wishlist`} className="icon-btn hide-sm" aria-label={t("nav.wishlist")}>
            <IconHeart />
            {wishlist.slugs.length > 0 && <span className="count-dot">{wishlist.slugs.length}</span>}
          </Link>
          <Link to={customer ? `${L}/account` : `${L}/login`} className="icon-btn hide-sm" aria-label={t("nav.account")}>
            <IconUser />
          </Link>
          <LanguageSwitcher />
          <button type="button" className="icon-btn" aria-label={t("nav.cart")} onClick={() => cart.setDrawerOpen(true)}>
            <IconBag />
            {cart.count > 0 && <span className="count-dot">{cart.count}</span>}
          </button>
        </div>
      </div>

      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} />}
    </header>
  );
}

export function LanguageSwitcher({ dark }: { dark?: boolean }) {
  const { locale, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    track("language_selected", { language: next });
    // Preserve the equivalent page in the new language (spec §4).
    navigate(swapLocale(location.pathname, next, LOCALES) + location.search);
  };

  return (
    <div className={`lang-switch${dark ? " lang-switch--dark" : ""}`} ref={ref}>
      <button type="button" className="icon-btn" aria-label={t("common.language")} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((o) => !o)}>
        <IconGlobe />
      </button>
      {open && (
        <ul className="lang-switch__menu" role="listbox" aria-label={t("common.language")}>
          {LOCALES.map((loc) => (
            <li key={loc}>
              <button type="button" role="option" aria-selected={loc === locale} className={loc === locale ? "is-active" : ""} onClick={() => choose(loc)} lang={loc}>
                {localeName(loc)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const { locale, t } = useI18n();
  const { customer } = useSession();
  const { settings } = useSettings();
  const panelRef = useRef<HTMLDivElement>(null);

  // Basic focus containment + Esc close (a11y).
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
  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="drawer drawer--start" role="dialog" aria-modal="true" aria-label={t("nav.menu")} ref={panelRef}>
        <div className="drawer__head">
          <img src="/brand/logo.svg" alt="CROWNED" width={130} height={33} />
          <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <nav className="drawer__body mobile-nav" aria-label={t("nav.menu")}>
          {[...NAV_ITEMS, ...MENU_EXTRA].map((item) => (
            <Link key={item.key} to={`${L}${item.path}`} className="mobile-nav__link">
              {t(`nav.${item.key}`)}
            </Link>
          ))}
          <hr className="divider" />
          <Link to={`${L}/wishlist`} className="mobile-nav__link">
            {t("nav.wishlist")}
          </Link>
          <Link to={customer ? `${L}/account` : `${L}/login`} className="mobile-nav__link">
            {t("nav.account")}
          </Link>
          {settings?.instagramUsername && (
            <a
              href={`https://instagram.com/${settings.instagramUsername}`}
              target="_blank"
              rel="noreferrer"
              className="mobile-nav__link row"
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
