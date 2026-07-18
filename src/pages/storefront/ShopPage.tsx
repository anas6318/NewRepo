import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { CatalogResults, FilterBar, useCatalog } from "../../components/product/CatalogGrid.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";

export function ShopPage() {
  const { locale, t } = useI18n();
  const { products, params, setFilter } = useCatalog({});

  usePageMeta({
    title: t("nav.shop"),
    description: t("shop.metaDescription"),
    path: "/shop",
    locale,
  });

  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs items={[{ label: t("nav.shop"), path: "/shop" }]} />
      <h1 className="section__title mb-6">{t("nav.shop")}</h1>
      <div className="stack stack--lg">
        <FilterBar params={params} setFilter={setFilter} />
        <p className="text-sm text-muted" aria-live="polite">
          {products ? t("shop.resultCount", { count: products.length }) : t("common.loading")}
        </p>
        <CatalogResults products={products} />
      </div>
    </main>
  );
}
