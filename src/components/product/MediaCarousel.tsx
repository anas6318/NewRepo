/**
 * A compact image carousel for product cards.
 *
 * Replaces the old binary Styled/Real switch. That control asked a shopper to
 * understand an internal distinction — a styled presentation render versus a
 * photograph — before they could look at the product. A carousel just shows
 * every image in a sensible order: styled preview, real front, real back.
 *
 * The one genuinely hard part is that a product card is also a LINK. A drag
 * that ends on the image must not navigate, while a deliberate tap must. The
 * component therefore tracks pointer movement and, when the gesture that just
 * ended was a drag, swallows the click so `onActivate` never fires.
 *
 * Scrolling is native (`scroll-snap` on a `overflow-x: auto` track), so touch
 * swipe, trackpad and momentum all behave the way the platform intends.
 * Programmatic movement uses a MEASURED DELTA applied with `scrollBy`, which
 * is correct in both LTR and RTL without depending on how an engine signs
 * `scrollLeft` in a right-to-left container.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import type { ProductImage } from "../../services/types.ts";
import { useL } from "../ui/bits.tsx";
import { SafeImage } from "../ui/SafeImage.tsx";
import { IconChevronDown } from "../ui/Icons.tsx";

/** Movement beyond this many pixels counts as a drag, not a tap. */
const DRAG_THRESHOLD_PX = 8;

export interface MediaCarouselProps {
  images: ProductImage[];
  eager?: boolean;
  width?: number;
  height?: number;
  /** Rendered when there are no images at all. */
  fallback?: React.ReactNode;
  /**
   * Called for a DELIBERATE tap (not a drag). The product card uses this to
   * open the product: the card cannot put a link on top of the track, because
   * a link covering the scroller swallows the touch and the carousel could
   * never be swiped on a phone.
   */
  onActivate?: () => void;
}

export function MediaCarousel({
  images,
  eager,
  width = 600,
  height = 750,
  fallback,
  onActivate,
}: MediaCarouselProps) {
  const { t } = useI18n();
  const L = useL();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  /** Suppresses scroll-sync while our own animated scroll is still running. */
  const settling = useRef(0);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  const count = images.length;

  const goTo = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const track = trackRef.current;
      const clamped = Math.max(0, Math.min(index, count - 1));
      setActive(clamped);
      const slide = track?.children[clamped] as HTMLElement | undefined;
      if (!track || !slide) return;
      // Measured delta — RTL-safe, and it cannot scroll the page.
      const delta = slide.getBoundingClientRect().left - track.getBoundingClientRect().left;
      if (Math.abs(delta) < 1) return;
      settling.current = Date.now() + 700;
      track.scrollBy({ left: delta, behavior });
    },
    [count],
  );

  // A swipe moves the track; `active` has to follow what is on screen.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      if (Date.now() < settling.current) return;
      const box = track.getBoundingClientRect();
      const centre = box.left + box.width / 2;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < track.children.length; i++) {
        const r = (track.children[i] as HTMLElement).getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - centre);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      setActive((prev) => (prev === nearest ? prev : nearest));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(sync);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [count]);

  /* ── drag vs tap ──────────────────────────────────────────────────────── */

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || dragged.current) return;
    if (Math.abs(e.clientX - start.x) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - start.y) > DRAG_THRESHOLD_PX) {
      dragged.current = true;
    }
  };
  const endPointer = () => {
    dragStart.current = null;
    if (dragged.current) {
      // Cleared on the next tick, AFTER the click event this gesture would
      // otherwise produce has been swallowed by the track's onClick.
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
    }
  };

  if (count === 0) return <>{fallback}</>;

  const single = count === 1;

  return (
    <div className="media-carousel">
      <div
        className="media-carousel__track"
        ref={trackRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={t("product.carouselLabel")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={() => {
          // `dragged` is still set here — it is cleared on the next tick.
          if (dragged.current || !onActivate) return;
          onActivate();
        }}
      >
        {images.map((img, i) => (
          <div className="media-carousel__slide" key={`${img.src}-${i}`} aria-hidden={i === active ? undefined : true}>
            <SafeImage
              src={img.src}
              alt={L(img.alt)}
              loading={i === 0 && eager ? "eager" : "lazy"}
              width={width}
              height={height}
              decoding="async"
              draggable={false}
              {...(i === 0 && eager ? { fetchPriority: "high" as const } : {})}
            />
          </div>
        ))}
      </div>

      {!single && (
        <>
          {/* Deliberately understated: small chevrons that appear on hover or
              focus, never large arrows sitting on top of the shirt. */}
          <button
            type="button"
            className="media-carousel__nav media-carousel__nav--prev"
            aria-label={t("product.previousImage")}
            tabIndex={-1}
            disabled={active === 0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goTo(active - 1);
            }}
          >
            <IconChevronDown size={14} />
          </button>
          <button
            type="button"
            className="media-carousel__nav media-carousel__nav--next"
            aria-label={t("product.nextImage")}
            tabIndex={-1}
            disabled={active === count - 1}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goTo(active + 1);
            }}
          >
            <IconChevronDown size={14} />
          </button>

          <div className="media-carousel__dots" role="tablist" aria-label={t("product.carouselLabel")}>
            {images.map((img, i) => (
              <button
                key={`${img.src}-dot-${i}`}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={t("product.goToImage", { n: i + 1 })}
                data-dot={i}
                className={`media-carousel__dot${i === active ? " is-on" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  goTo(i);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
