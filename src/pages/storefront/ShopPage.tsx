import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { CatalogResults, FilterBar, useCatalog } from "../../components/product/CatalogGrid.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";
import { useL } from "../../components/ui/bits.tsx";
import { clubShopPath } from "../../lib/clubs.ts";

export function ShopPage() {
  const { locale, t } = useI18n();
  const lt = useL();
  const { products, params, setFilter, club } = useCatalog({});
  // ?club= resolves (any case) to a registry club, which gets its localized
  // name as the heading and its own canonical URL; the raw tag is never shown.
  // An unknown value is ignored and dropped from the URL by useCatalog.
  const title = club ? lt(club.label) : t("nav.shop");
  const path = club ? clubShopPath(club.tag) : "/shop";

  usePageMeta({
    title,
    description: t("shop.metaDescription"),
    path,
    locale,
  });

  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs items={club ? [{ label: t("nav.shop"), path: "/shop" }, { label: title, path }] : [{ label: t("nav.shop"), path: "/shop" }]} />
      <h1 className="section__title mb-6">{title}</h1>
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
