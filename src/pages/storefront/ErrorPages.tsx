import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { IconCrown } from "../../components/ui/Icons.tsx";

export function NotFoundPage() {
  const { locale, t } = useI18n();
  usePageMeta({ title: t("errors.notFoundTitle"), path: "/not-found", locale, noindex: true });
  return (
    <main id="main" className="container section">
      <div className="empty-state">
        <div className="empty-state__icon">
          <IconCrown size={24} />
        </div>
        <p className="eyebrow">404</p>
        <h1 className="section__title">{t("errors.notFoundTitle")}</h1>
        <p className="text-muted">{t("errors.notFoundBody")}</p>
        <div className="row">
          <Link to={`/${locale}`} className="btn btn--gold">
            {t("nav.home")}
          </Link>
          <Link to={`/${locale}/shop`} className="btn btn--outline">
            {t("nav.shop")}
          </Link>
        </div>
      </div>
    </main>
  );
}

export function MaintenancePage() {
  const { t } = useI18n();
  usePageMeta({ title: t("maintenance.title"), path: "/maintenance", locale: "en", noindex: true });
  return (
    <main id="main" className="theme-dark" style={{ minHeight: "70dvh", display: "flex", alignItems: "center" }}>
      <div className="container empty-state">
        <img src="/brand/logo-white.svg" alt="CROWNED" width={190} height={48} />
        <h1 className="section__title">{t("maintenance.title")}</h1>
        <p className="text-muted">{t("maintenance.body")}</p>
      </div>
    </main>
  );
}
