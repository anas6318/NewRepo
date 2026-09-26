import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { CatalogResults, FilterBar, useCatalog } from "../../components/product/CatalogGrid.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";
import { useL } from "../../components/ui/bits.tsx";
import { clubByTag } from "../../content/navigation.ts";

export function ShopPage() {
  const { locale, t } = useI18n();
  const lt = useL();
  const { products, params, setFilter } = useCatalog({});
  // ?club= filters by an exact product tag. Only a known Shop-by-Club tag gets
  // a heading; the raw tag itself is never shown (an unknown one still
  // filters, like any other URL filter, under the plain "Shop" heading).
  const club = clubByTag(params.get("club"));
  const title = club ? lt(club.label) : t("nav.shop");

  usePageMeta({
    title,
    description: t("shop.metaDescription"),
    path: "/shop",
    locale,
  });

  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs items={club ? [{ label: t("nav.shop"), path: "/shop" }, { label: title, path: `/shop?club=${encodeURIComponent(club.tag)}` }] : [{ label: t("nav.shop"), path: "/shop" }]} />
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
