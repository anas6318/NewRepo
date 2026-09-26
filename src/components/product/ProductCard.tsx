import { Link, useNavigate } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useWishlist } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import type { Product } from "../../services/types.ts";
import { DemoBadge, Price, SaleBadge, StatusBadge, useL } from "../ui/bits.tsx";
import { IconHeart } from "../ui/Icons.tsx";
import { isDiscounting, resolveProductSale } from "../../lib/sales.ts";
import { customerSlides } from "../../lib/media.ts";
import { MediaCarousel } from "./MediaCarousel.tsx";

export function ProductCard({ product, eager }: { product: Product; eager?: boolean }) {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const L = useL();
  const wishlist = useWishlist();
  const inWishlist = wishlist.has(product.slug);
  // Every image, in customer order: styled preview → real front → real back.
  const slides = customerSlides(product);
  const category = t(`nav.${categoryNavKey(product.categorySlug)}`);
  // Resolved against the base price, which is exactly what the card shows —
  // so the struck-through figure is the product's real regular price and the
  // sale figure is one the customer can actually reach.
  const sale = resolveProductSale(product);
  const onSale = isDiscounting(sale);
  const cardPrice = onSale ? round2(product.basePriceIls - Math.min(sale!.discountIls, product.basePriceIls)) : product.basePriceIls;

  return (
    <article className={`prod-card${slides.length > 1 ? " prod-card--carousel" : ""}`}>
      <div className="prod-card__frame">
        <MediaCarousel
          images={slides}
          {...(eager ? { eager } : {})}
          // Tap-vs-drag is settled inside the carousel: a swipe never reaches onActivate.
          onActivate={() => {
            track("select_item", { item_id: product.slug });
            navigate(`/${locale}/product/${product.slug}`);
          }}
          fallback={<div className="prod-card__noimg" aria-hidden="true">CROWNED</div>}
        />
        <div className="prod-card__badges">
          {product.isDemo && <DemoBadge />}
          {/* Sits in the existing badge stack in a corner of the frame, so it
              never covers the shirt itself. */}
          {sale && <SaleBadge sale={sale} />}
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
        <Price ils={cardPrice} compareIls={onSale ? product.basePriceIls : product.compareAtPriceIls} />
      </div>
    </article>
  );
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
