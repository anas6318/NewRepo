import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { useSettings } from "../../services/store.tsx";
import { useL } from "../../components/ui/bits.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";

export function PolicyPage({ slug }: { slug: "returns" | "privacy" | "terms" }) {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const L = useL();
  const policy = settings?.policies[slug];
  const title = policy ? L(policy.title) : "";

  usePageMeta({ title: title || t("footer.legal"), path: `/policies/${slug}`, locale });

  return (
    <main id="main" className="container--narrow container section--tight section">
      <Breadcrumbs items={[{ label: title, path: `/policies/${slug}` }]} />
      <h1 className="section__title mb-4">{title}</h1>
      {policy?.needsLegalReview && <p className="badge badge--warn mb-6">{t("policy.legalReviewNote")}</p>}
      <div className="prose" style={{ whiteSpace: "pre-line" }}>
        {policy ? L(policy.body) : t("common.loading")}
      </div>
    </main>
  );
}

export function AccessibilityPage() {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const L = useL();
  const policy = settings?.policies.accessibility;
  const title = policy ? L(policy.title) : t("footer.accessibility");

  usePageMeta({ title, path: "/accessibility", locale });

  return (
    <main id="main" className="container--narrow container section--tight section">
      <Breadcrumbs items={[{ label: title, path: "/accessibility" }]} />
      <h1 className="section__title mb-6">{title}</h1>
      <div className="prose" style={{ whiteSpace: "pre-line" }}>
        {policy ? L(policy.body) : t("common.loading")}
      </div>
    </main>
  );
}
