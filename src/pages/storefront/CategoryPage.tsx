import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta, breadcrumbJsonLd } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { track } from "../../lib/analytics.ts";
import type { CategoryDef } from "../../services/types.ts";
import { CatalogResults, FilterBar, useCatalog } from "../../components/product/CatalogGrid.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";
import { useL } from "../../components/ui/bits.tsx";
import { NotFoundPage } from "./ErrorPages.tsx";

export function CategoryPage({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const L = useL();
  const [category, setCategory] = useState<CategoryDef | null | undefined>(undefined);
  const { products, params, setFilter } = useCatalog({ category: slug });

  useEffect(() => {
    let alive = true;
    dataService()
      .listCategories()
      .then((cats) => {
        if (!alive) return;
        setCategory(cats.find((c) => c.slug === slug) ?? null);
        track("view_category", { category: slug });
      })
      .catch(() => alive && setCategory(null));
    return () => {
      alive = false;
    };
  }, [slug]);

  const title = category ? L(category.name) : "";
  usePageMeta({
    title: title || t("nav.shop"),
    description: category ? L(category.description) : undefined,
    path: `/category/${slug}`,
    locale,
    jsonLd: category
      ? [breadcrumbJsonLd([{ name: t("nav.shop"), path: "/shop" }, { name: title, path: `/category/${slug}` }], locale)]
      : [],
  });

  if (category === null) return <NotFoundPage />;

  return (
    <main id="main">
      <section className="theme-dark section--tight section">
        <div className="container">
          <Breadcrumbs
            items={[
              { label: t("nav.shop"), path: "/shop" },
              { label: title, path: `/category/${slug}` },
            ]}
          />
          <h1 className="section__title">{title}</h1>
          {category && <p className="section__sub">{L(category.description)}</p>}
        </div>
      </section>
      <div className="container section--tight section stack stack--lg">
        <FilterBar params={params} setFilter={setFilter} showAudience={slug !== "kids"} />
        <p className="text-sm text-muted" aria-live="polite">
          {products ? t("shop.resultCount", { count: products.length }) : t("common.loading")}
        </p>
        <CatalogResults products={products} />
      </div>
    </main>
  );
}
