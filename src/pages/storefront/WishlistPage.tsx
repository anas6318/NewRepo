import { useEffect, useState } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { useWishlist } from "../../services/store.tsx";
import type { Product } from "../../services/types.ts";
import { ProductCard } from "../../components/product/ProductCard.tsx";
import { EmptyState } from "../../components/ui/bits.tsx";
import { IconHeart } from "../../components/ui/Icons.tsx";

export function WishlistPage() {
  const { locale, t } = useI18n();
  const wishlist = useWishlist();
  const [products, setProducts] = useState<Product[] | null>(null);

  usePageMeta({ title: t("nav.wishlist"), path: "/wishlist", locale, noindex: true });

  useEffect(() => {
    let alive = true;
    Promise.all(wishlist.slugs.map((slug) => dataService().getProduct(slug)))
      .then((list) => alive && setProducts(list.filter((p): p is Product => !!p)))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [wishlist.slugs]);

  return (
    <main id="main" className="container section--tight section">
      <h1 className="section__title mb-6">
        {t("nav.wishlist")} {products && products.length > 0 && <span className="text-muted">({products.length})</span>}
      </h1>
      {products === null ? (
        <div aria-busy="true" className="prod-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: "4/5", borderRadius: "var(--r-md)" }} />
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          icon={<IconHeart size={22} />}
          title={t("wishlist.emptyTitle")}
          body={t("wishlist.emptyBody")}
          action={
            <Link to={`/${locale}/shop`} className="btn btn--gold">
              {t("cart.continueShopping")}
            </Link>
          }
        />
      ) : (
        <div className="prod-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
