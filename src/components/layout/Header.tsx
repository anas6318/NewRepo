/**
 * Site header — brand presentation + navigation shell.
 *
 * Composition (each part is its own component, all consuming the shared
 * typed navigation content in src/content/navigation.ts):
 *   UtilityBar          — slim customer-service bar (Track Order etc.) + language
 *   DesktopNavigation   — primary categories + accessible Shop dropdown
 *   HeaderActions       — search / wishlist / account / cart
 *   MobileNavigation    — purpose-built mobile drawer
 *
 * The official CROWNED logo (public/brand/crowned-logo.png) links to the
 * homepage and keeps its intrinsic ratio at every size; the header is sticky
 * with a subtle elevation once the page is scrolled.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "../../lib/router.tsx";
import { swapLocale } from "../../lib/router-core.ts";
import { LOCALES, localeName, useI18n, type Locale } from "../../lib/i18n/index.tsx";
import { track } from "../../lib/analytics.ts";
import { UTILITY_NAV } from "../../content/navigation.ts";
import { LOGO, logoWidthFor } from "../../content/brand.ts";
import { IconGlobe, IconMenu } from "../ui/Icons.tsx";
import { UtilityBar } from "./UtilityBar.tsx";
import { DesktopNavigation } from "./DesktopNavigation.tsx";
import { HeaderActions } from "./HeaderActions.tsx";
import { MobileNavigation, MOBILE_MENU_ID } from "./MobileNavigation.tsx";

const LOGO_HEIGHT = 24;

export function Header() {
  const { locale, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Subtle elevation once the page scrolls under the sticky header.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const L = `/${locale}`;
  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
      <UtilityBar items={UTILITY_NAV} />
      <div className="container site-header__inner">
        <button
          type="button"
          className="icon-btn show-sm-only"
          aria-label={t("nav.openMenu")}
          aria-expanded={menuOpen}
          aria-controls={MOBILE_MENU_ID}
          onClick={() => setMenuOpen(true)}
        >
          <IconMenu />
        </button>

        <Link to={L} className="site-header__logo">
          <img
            src={LOGO.onLight.src}
            alt={LOGO.alt}
            width={logoWidthFor(LOGO.onLight, LOGO_HEIGHT)}
            height={LOGO_HEIGHT}
            fetchPriority="high"
          />
        </Link>

        <DesktopNavigation />
        <HeaderActions />
      </div>

      {menuOpen && <MobileNavigation onClose={() => setMenuOpen(false)} />}
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
