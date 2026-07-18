import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useWishlist } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import type { Product } from "../../services/types.ts";
import { DemoBadge, Price, StatusBadge, useL } from "../ui/bits.tsx";
import { IconHeart } from "../ui/Icons.tsx";

export function ProductCard({ product, eager }: { product: Product; eager?: boolean }) {
  const { locale, t } = useI18n();
  const L = useL();
  const wishlist = useWishlist();
  const inWishlist = wishlist.has(product.slug);
  const img = product.images[0];
  const category = t(`nav.${categoryNavKey(product.categorySlug)}`);

  return (
    <article className="prod-card">
      <div className="prod-card__frame">
        {img ? (
          <img src={img.src} alt={L(img.alt)} loading={eager ? "eager" : "lazy"} width={600} height={750} />
        ) : (
          <div className="prod-card__noimg" aria-hidden="true">CROWNED</div>
        )}
        <div className="prod-card__badges">
          {product.isDemo && <DemoBadge />}
          <StatusBadge status={product.status} />
        </div>
        <button
          type="button"
          className={`prod-card__wish${inWishlist ? " is-on" : ""}`}
          aria-label={inWishlist ? t("product.wishlistRemove") : t("product.wishlistAdd")}
          aria-pressed={inWishlist}
          onClick={() => {
            wishlist.toggle(product.slug);
            if (!inWishlist) track("add_to_wishlist", { item_id: product.slug });
          }}
        >
          <IconHeart size={18} filled={inWishlist} />
        </button>
      </div>
      <div className="prod-card__meta">
        <span className="prod-card__cat">{category}</span>
        <h3 className="prod-card__title">
          <Link to={`/${locale}/product/${product.slug}`} onClick={() => track("select_item", { item_id: product.slug })}>
            {L(product.name)}
          </Link>
        </h3>
        <Price ils={product.basePriceIls} compareIls={product.compareAtPriceIls} />
      </div>
    </article>
  );
}

function categoryNavKey(slug: string): string {
  const map: Record<string, string> = {
    retro: "retro",
    "current-season": "currentSeason",
    "national-teams": "nationalTeams",
    "player-version": "playerVersion",
    "fan-version": "fanVersion",
    "long-sleeve": "longSleeve",
    hoodies: "hoodies",
    kids: "kids",
  };
  return map[slug] ?? "shop";
}
