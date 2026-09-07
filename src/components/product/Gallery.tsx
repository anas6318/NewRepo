import { useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import type { Product, ProductImage } from "../../services/types.ts";
import { imageForView, productMedia } from "../../lib/media.ts";
import { useL } from "../ui/bits.tsx";
import { MediaFrame, MediaLabel, MediaToggle, useMediaView } from "./MediaSwitch.tsx";

type Slide = { kind: "hero" } | { kind: "image"; img: ProductImage };

/**
 * Product gallery: thumbnails, mobile swipe (scroll-snap), tap/click zoom.
 *
 * When the owner has tagged a styled preview and/or a real photograph, the
 * FIRST slide becomes the switchable hero and those two images drop out of
 * the ordinary slide list — the photograph is referenced by the switch
 * instead of being duplicated as its own slide. Everything else (back,
 * close-ups, badge and personalization shots) keeps working exactly as it
 * did, and a product with no tagged images renders the untouched old
 * gallery.
 */
export function Gallery({ product }: { product: Product }) {
  const { t } = useI18n();
  const L = useL();
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const media = productMedia(product);
  const { view, wantReal, choose, prefetchReal } = useMediaView(media, product.slug);
  const hasHero = media.views.length > 0;

  const fallback: ProductImage[] = product.images.length ? product.images : [{ src: "", alt: product.name }];
  const slides: Slide[] = hasHero
    ? [{ kind: "hero" }, ...media.extras.map((img) => ({ kind: "image" as const, img }))]
    : fallback.map((img) => ({ kind: "image" as const, img }));

  const imageOf = (slide: Slide | undefined): ProductImage | undefined =>
    slide?.kind === "hero" ? imageForView(media, view) : slide?.img;
  const current = imageOf(slides[Math.min(active, slides.length - 1)]);

  return (
    <div className="gallery">
      <div className="gallery__stage">
      <div className="gallery__track" role="group" aria-roledescription="carousel" aria-label={L(product.name)}>
        {slides.map((slide, i) => (
          <button
            key={i}
            type="button"
            className={`gallery__slide${i === active ? " is-active" : ""}`}
            aria-label={`${t("product.zoomImage")} ${i + 1}/${slides.length}`}
            onClick={() => {
              setActive(i);
              setZoom(true);
            }}
          >
            {slide.kind === "hero" ? (
              <MediaFrame media={media} view={view} wantReal={wantReal} eager width={720} height={900} />
            ) : slide.img.src ? (
              <img
                src={slide.img.src}
                alt={L(slide.img.alt)}
                loading={i === 0 ? "eager" : "lazy"}
                width={720}
                height={900}
                {...(i === 0 ? { fetchPriority: "high" as const } : {})}
              />
            ) : (
              <span className="prod-card__noimg">CROWNED</span>
            )}
          </button>
        ))}
      </div>
        {/* At the bottom edge of the image container — the customer meets it
            before the price, the sizes, the badges and add-to-cart, and it
            stays on screen with the image on every viewport. */}
        {hasHero && (
          <div className="gallery__media-ui">
            <MediaLabel media={media} variant="page" />
            <MediaToggle media={media} view={view} onSelect={choose} onPrefetch={prefetchReal} variant="page" />
          </div>
        )}
      </div>

      {hasHero && <p className="gallery__media-note">{t(view === "real" ? "media.realNote" : "media.styledNote")}</p>}

      {slides.length > 1 && (
        <div className="gallery__thumbs" role="tablist" aria-label={t("product.galleryThumbs")}>
          {slides.map((slide, i) => {
            const img = imageOf(slide);
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === active}
                className={`gallery__thumb${i === active ? " is-active" : ""}`}
                onClick={() => setActive(i)}
              >
                {img?.src ? <img src={img.src} alt="" width={64} height={80} loading="lazy" /> : null}
              </button>
            );
          })}
        </div>
      )}

      {zoom && current?.src && (
        <div className="dialog-backdrop" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label={t("product.zoomImage")}>
          <img src={current.src} alt={L(current.alt)} style={{ maxHeight: "88dvh", maxWidth: "94vw", objectFit: "contain", borderRadius: "var(--r-md)" }} />
          <button type="button" className="btn btn--dark gallery__zoom-close" onClick={() => setZoom(false)}>
            {t("common.close")}
          </button>
        </div>
      )}
    </div>
  );
}
