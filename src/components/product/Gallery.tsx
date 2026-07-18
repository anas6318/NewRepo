import { useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import type { Product } from "../../services/types.ts";
import { useL } from "../ui/bits.tsx";

/** Product gallery: thumbnails, mobile swipe (scroll-snap), tap/click zoom. */
export function Gallery({ product }: { product: Product }) {
  const { t } = useI18n();
  const L = useL();
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const images = product.images.length ? product.images : [{ src: "", alt: product.name }];
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="gallery">
      <div className="gallery__track" role="group" aria-roledescription="carousel" aria-label={L(product.name)}>
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            className={`gallery__slide${i === active ? " is-active" : ""}`}
            aria-label={`${t("product.zoomImage")} ${i + 1}/${images.length}`}
            onClick={() => {
              setActive(i);
              setZoom(true);
            }}
          >
            {img.src ? (
              <img src={img.src} alt={L(img.alt)} loading={i === 0 ? "eager" : "lazy"} width={720} height={900} fetchPriority={i === 0 ? "high" : undefined} />
            ) : (
              <span className="prod-card__noimg">CROWNED</span>
            )}
          </button>
        ))}
      </div>
      {images.length > 1 && (
        <div className="gallery__thumbs" role="tablist" aria-label={t("product.galleryThumbs")}>
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`gallery__thumb${i === active ? " is-active" : ""}`}
              onClick={() => setActive(i)}
            >
              {img.src ? <img src={img.src} alt="" width={64} height={80} loading="lazy" /> : null}
            </button>
          ))}
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
