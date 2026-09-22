import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import type { Product, ProductImage } from "../../services/types.ts";
import { imageForView, productMedia } from "../../lib/media.ts";
import { useL } from "../ui/bits.tsx";
import { MediaFrame, MediaLabel, MediaToggle, useMediaView } from "./MediaSwitch.tsx";
import { SafeImage } from "../ui/SafeImage.tsx";

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
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** Ignores scroll events while a programmatic scroll is still animating, so
   * the slides it passes over on the way do not each become "active". */
  const settling = useRef(0);
  const media = productMedia(product);
  const { view, pending, realStatus, choose, prefetchReal } = useMediaView(media, product.slug);
  const hasHero = media.views.length > 0;

  const fallback: ProductImage[] = product.images.length ? product.images : [{ src: "", alt: product.name }];
  const slides: Slide[] = hasHero
    ? [{ kind: "hero" }, ...media.extras.map((img) => ({ kind: "image" as const, img }))]
    : fallback.map((img) => ({ kind: "image" as const, img }));

  const imageOf = (slide: Slide | undefined): ProductImage | undefined =>
    slide?.kind === "hero" ? imageForView(media, view) : slide?.img;
  const activeIndex = Math.min(active, slides.length - 1);
  const current = imageOf(slides[activeIndex]);
  /** The switch and its caption describe the HERO. They must not be on screen
   * while a different gallery image is, or toggling them appears to do
   * nothing — the hero changes out of sight. */
  const heroVisible = hasHero && activeIndex === 0;

  /**
   * The one way the gallery changes slide.
   *
   * `active` used to be plain React state while the visible slide was decided
   * by the scroll position of `.gallery__track`. Nothing kept the two in
   * step, so a thumbnail could mark slide 2 as selected while slide 1 was
   * still on screen. This moves the track AND the state together.
   *
   * RTL-safe by construction: the distance is MEASURED from the rendered
   * boxes and applied with `scrollBy`, so it never depends on how an engine
   * signs `scrollLeft` in a right-to-left container. `scrollBy` also cannot
   * scroll the page, which `scrollIntoView` can.
   */
  const goToSlide = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const clamped = Math.max(0, Math.min(index, slides.length - 1));
      setActive(clamped);
      const track = trackRef.current;
      const slide = track?.children[clamped] as HTMLElement | undefined;
      if (!track || !slide) return;
      const delta = slide.getBoundingClientRect().left - track.getBoundingClientRect().left;
      if (Math.abs(delta) < 1) return;
      settling.current = Date.now() + 700;
      track.scrollBy({ left: delta, behavior });
    },
    [slides.length],
  );

  /**
   * The other direction: a swipe or trackpad scroll moves the track, so
   * `active` has to follow the slide nearest the track's centre. Without
   * this, swiping on a phone left the thumbnails and the hero controls
   * describing a slide the customer had already moved past.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      if (Date.now() < settling.current) return; // our own scroll, still animating
      const box = track.getBoundingClientRect();
      const centre = box.left + box.width / 2;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < track.children.length; i++) {
        const r = (track.children[i] as HTMLElement).getBoundingClientRect();
        const distance = Math.abs(r.left + r.width / 2 - centre);
        if (distance < best) {
          best = distance;
          nearest = i;
        }
      }
      setActive((prev) => (prev === nearest ? prev : nearest));
    };
    const onScroll = () => {
      // Coalesced to one measurement per frame: a swipe fires scroll events
      // far faster than React needs to re-render.
      if (!frame) frame = window.requestAnimationFrame(sync);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [slides.length]);

  // A different product starts at its first slide, with the track rewound.
  useEffect(() => {
    setActive(0);
    settling.current = 0;
    const track = trackRef.current;
    if (track) track.scrollTo({ left: 0, behavior: "auto" });
  }, [product.slug]);

  return (
    // `position: sticky` on .gallery creates a stacking context, which traps
    // the zoom overlay inside it — so the dialog (z-index 70) still painted
    // BELOW the site header (40) and its Close button, top-right, sat under
    // the header and could not be clicked. Lifting the gallery only while the
    // dialog is open keeps normal scrolling unchanged.
    <div className={`gallery${zoom ? " is-zoomed" : ""}`}>
      <div className="gallery__stage">
      <div className="gallery__track" ref={trackRef} role="group" aria-roledescription="carousel" aria-label={L(product.name)}>
        {slides.map((slide, i) => (
          <button
            key={i}
            type="button"
            className={`gallery__slide${i === activeIndex ? " is-active" : ""}`}
            aria-label={`${t("product.zoomImage")} ${i + 1}/${slides.length}`}
            onClick={() => {
              // Align the track on the slide that was clicked before zooming,
              // so the zoom always shows the slide the customer pointed at.
              goToSlide(i);
              setZoom(true);
            }}
          >
            {slide.kind === "hero" ? (
              <MediaFrame media={media} view={view} realStatus={realStatus} eager width={720} height={900} />
            ) : slide.img.src ? (
              <SafeImage
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
        {heroVisible && (
          <div className="gallery__media-ui">
            <MediaLabel media={media} variant="page" />
            <MediaToggle media={media} view={view} pending={pending} realStatus={realStatus} onSelect={choose} onPrefetch={prefetchReal} variant="page" />
          </div>
        )}
      </div>

      {heroVisible && <p className="gallery__media-note">{t(view === "real" ? "media.realNote" : "media.styledNote")}</p>}

      {slides.length > 1 && (
        <div className="gallery__thumbs" role="tablist" aria-label={t("product.galleryThumbs")}>
          {slides.map((slide, i) => {
            const img = imageOf(slide);
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                className={`gallery__thumb${i === activeIndex ? " is-active" : ""}`}
                data-slide={i}
                onClick={() => goToSlide(i)}
              >
                {img?.src ? <SafeImage src={img.src} alt="" width={64} height={80} loading="lazy" /> : null}
              </button>
            );
          })}
        </div>
      )}

      {zoom && current?.src && (
        <div className="dialog-backdrop" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label={t("product.zoomImage")}>
          <SafeImage src={current.src} alt={L(current.alt)} style={{ maxHeight: "88dvh", maxWidth: "94vw", objectFit: "contain", borderRadius: "var(--r-md)" }} />
          <button type="button" className="btn btn--dark gallery__zoom-close" onClick={() => setZoom(false)}>
            {t("common.close")}
          </button>
        </div>
      )}
    </div>
  );
}
