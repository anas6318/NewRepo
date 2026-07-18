import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";

export function Breadcrumbs({ items }: { items: { label: string; path: string }[] }) {
  const { locale, t } = useI18n();
  return (
    <nav className="crumbs mb-4" aria-label={t("common.breadcrumbs")}>
      <Link to={`/${locale}`}>{t("nav.home")}</Link>
      {items.map((item, i) => (
        <span key={item.path} className="row" style={{ gap: "var(--sp-2)" }}>
          <span className="sep" aria-hidden="true">
            /
          </span>
          {i === items.length - 1 ? <span aria-current="page">{item.label}</span> : <Link to={`/${locale}${item.path}`}>{item.label}</Link>}
        </span>
      ))}
    </nav>
  );
}
