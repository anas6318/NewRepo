/**
 * Primary desktop navigation: an accessible "Shop" dropdown followed by the
 * main category links. Consumes the same typed navigation content as the
 * mobile menu (src/content/navigation.ts).
 *
 * Dropdown accessibility: opens on click (keyboard + touch friendly) and on
 * hover (pointer convenience, never the only path), closes on Escape /
 * outside pointer / focus leaving / navigation, and returns focus to its
 * trigger when closed with Escape. Positioning uses logical properties so it
 * behaves correctly in RTL and LTR.
 */
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { PRIMARY_NAV, SHOP_MENU, type NavGroup, type NavItem } from "../../content/navigation.ts";
import { IconChevronDown } from "../ui/Icons.tsx";

export function DesktopNavigation() {
  const { locale, t } = useI18n();
  const L = `/${locale}`;
  return (
    <nav className="site-header__nav" aria-label={t("nav.menu")}>
      <ShopDropdown groups={SHOP_MENU} />
      {PRIMARY_NAV.map((item: NavItem) => (
        <NavLink key={item.id} to={`${L}${item.path}`} className="site-header__link">
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

const CLOSE_DELAY_MS = 160;

function ShopDropdown({ groups }: { groups: NavGroup[] }) {
  const { locale, t } = useI18n();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Distinguishes hover-open from explicit click-open, so a click right
   * after hover pins the menu instead of instantly toggling it shut. */
  const openedByHover = useRef(false);
  const L = `/${locale}`;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  // Close on Escape (restoring focus) and on outside pointer interaction.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => cancelClose, []);

  return (
    <div
      className="nav-dropdown"
      ref={rootRef}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          cancelClose();
          if (!open) {
            openedByHover.current = true;
            setOpen(true);
          }
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") scheduleClose();
      }}
      onBlur={(e) => {
        // Close when keyboard focus leaves the whole dropdown.
        if (rootRef.current && !rootRef.current.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`site-header__link nav-dropdown__trigger${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls="shop-menu"
        aria-haspopup="true"
        onClick={() => {
          if (!open) {
            openedByHover.current = false;
            setOpen(true);
          } else if (openedByHover.current) {
            // Was only hover-opened — treat this click as the explicit open.
            openedByHover.current = false;
          } else {
            setOpen(false);
          }
        }}
      >
        {t("nav.shop")}
        <IconChevronDown size={14} className="nav-dropdown__chevron" />
      </button>

      <div id="shop-menu" className="nav-dropdown__panel" role="group" aria-label={t("nav.shopMenu")} hidden={!open}>
        {groups.map((group) => (
          <div key={group.id} className="nav-dropdown__group">
            <p className="nav-dropdown__label" id={`shop-menu-${group.id}`}>
              {t(group.labelKey)}
            </p>
            <ul className="nav-dropdown__list" aria-labelledby={`shop-menu-${group.id}`}>
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link to={`${L}${item.path}`} className="nav-dropdown__link">
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
