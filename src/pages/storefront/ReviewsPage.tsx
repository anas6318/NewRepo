import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { ReviewsSection } from "../../components/product/ReviewsSection.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";

export function ReviewsPage() {
  const { locale, t } = useI18n();
  usePageMeta({ title: t("reviews.title"), description: t("reviews.pageIntro"), path: "/reviews", locale });
  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs items={[{ label: t("reviews.title"), path: "/reviews" }]} />
      <h1 className="section__title mb-4">{t("reviews.title")}</h1>
      <p className="text-muted mb-8" style={{ maxWidth: "60ch" }}>
        {t("reviews.pageIntro")}
      </p>
      <ReviewsSection heading=" " />
    </main>
  );
}
