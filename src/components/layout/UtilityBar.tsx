/**
 * Slim customer-service bar above the main header (desktop/tablet only).
 * Houses secondary links — Track Order, Size Guide, About, Contact — so they
 * no longer compete with the product categories in the primary navigation,
 * plus the language switcher.
 */
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import type { NavItem } from "../../content/navigation.ts";
import { LanguageSwitcher } from "./Header.tsx";

export function UtilityBar({ items }: { items: NavItem[] }) {
  const { locale, t } = useI18n();
  const L = `/${locale}`;
  return (
    <div className="utility-bar theme-dark">
      <div className="container utility-bar__inner">
        <nav className="utility-bar__nav" aria-label={t("nav.customerCare")}>
          {items.map((item) => (
            <Link key={item.id} to={`${L}${item.path}`} className="utility-bar__link">
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <LanguageSwitcher />
      </div>
    </div>
  );
}
