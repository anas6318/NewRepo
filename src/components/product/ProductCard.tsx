import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useWishlist } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import type { Product } from "../../services/types.ts";
import { DemoBadge, Price, SaleBadge, StatusBadge, useL } from "../ui/bits.tsx";
import { IconHeart } from "../ui/Icons.tsx";
import { isDiscounting, resolveProductSale } from "../../lib/sales.ts";
import { productMedia } from "../../lib/media.ts";
import { MediaFrame, MediaLabel, MediaToggle, useMediaView } from "./MediaSwitch.tsx";

export function ProductCard({ product, eager }: { product: Product; eager?: boolean }) {
  const { locale, t } = useI18n();
  const L = useL();
  const wishlist = useWishlist();
  const inWishlist = wishlist.has(product.slug);
  const media = productMedia(product);
  const { view, wantReal, hoverCapable, choose, preview, prefetchReal } = useMediaView(media, product.slug);
  const category = t(`nav.${categoryNavKey(product.categorySlug)}`);
  // Resolved against the base price, which is exactly what the card shows —
  // so the struck-through figure is the product's real regular price and the
  // sale figure is one the customer can actually reach.
  const sale = resolveProductSale(product);
  const onSale = isDiscounting(sale);
  const cardPrice = onSale ? round2(product.basePriceIls - Math.min(sale!.discountIls, product.basePriceIls)) : product.basePriceIls;

  return (
    <article className={`prod-card${media.canSwitch ? " prod-card--dual" : ""}`}>
      <div
        className="prod-card__frame"
        /* Hover lives on the media area only, and pointerenter/leave do not
           fire for the overlay controls inside it — so moving across the
           wishlist button or the switch cannot make the image flicker. */
        onPointerEnter={(e) => {
          if (e.pointerType === "touch" || !hoverCapable) return;
          prefetchReal();
          preview("real");
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch" || !hoverCapable) return;
          preview("styled");
        }}
        /* Keyboard equivalent: reaching the media area shows the photograph,
           unless focus is on the switch itself, which speaks for the
           customer. */
        onFocus={(e) => {
          prefetchReal();
          if (!(e.target as HTMLElement).closest(".media-toggle")) preview("real");
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          preview("styled");
        }}
        onTouchStart={prefetchReal}
      >
        <MediaFrame
          media={media}
          view={view}
          wantReal={wantReal}
          {...(eager ? { eager } : {})}
          fallback={<div className="prod-card__noimg" aria-hidden="true">CROWNED</div>}
        />
        {/* The media area gets its own cover link, stacked ABOVE the title's
            stretched pseudo-element. Two things follow: clicking the image
            still opens the product, and the pointer genuinely enters the
            frame — with the stretched link on top, hover could only ever be
            detected for the whole card. It is hidden from assistive tech and
            from the tab order: the product title link already speaks for it. */}
        <Link
          className="prod-card__cover"
          to={`/${locale}/product/${product.slug}`}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => track("select_item", { item_id: product.slug })}
        />
        <div className="prod-card__media-ui">
          <MediaLabel media={media} />
          <MediaToggle media={media} view={view} onSelect={choose} onPrefetch={prefetchReal} />
        </div>
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
