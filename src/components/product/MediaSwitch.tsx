/**
 * Styled Preview ⇄ Real Product presentation.
 *
 * Two ideas, deliberately kept small and shared by the shop cards and the
 * product page so the customer meets exactly one control everywhere:
 *
 *  • <MediaFrame> stacks both images in ONE frame of fixed aspect ratio and
 *    crossfades between them, so switching can never move the layout. The
 *    real photograph is not even requested until the customer shows intent,
 *    and while it is still arriving the current image stays on screen.
 *  • <MediaToggle> is the switch — two real buttons with `aria-pressed`, so
 *    hover is never the only way to reach the photograph.
 *
 * <MediaLabel> covers the products that have only one of the two: the image
 * is still named, because an unlabelled styled render would be passing
 * itself off as a photograph of the goods.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { imageForView, viewLabelKey, viewShortLabelKey, type MediaView, type ProductMedia } from "../../lib/media.ts";
import { IconCamera, IconSparkle } from "../ui/Icons.tsx";
import { useL } from "../ui/bits.tsx";

const VIEW_ICON = { styled: IconSparkle, real: IconCamera } as const;

/** True on pointers that can hover (mouse/trackpad), false on touch. */
export function useHoverCapable(): boolean {
  const [capable, setCapable] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCapable(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return capable;
}

/**
 * Drives one product's view state. `pinned` records that the customer chose
 * a view themselves — after that, hover stops overriding it and nothing ever
 * switches back on its own.
 */
export function useMediaView(media: ProductMedia, resetKey: string) {
  const [view, setView] = useState<MediaView | undefined>(media.defaultView);
  const [wantReal, setWantReal] = useState(false);
  const pinned = useRef(false);
  const hoverCapable = useHoverCapable();

  useEffect(() => {
    setView(media.defaultView);
    setWantReal(false);
    pinned.current = false;
    // Cards are reused as the grid filters; a new product starts fresh.
  }, [resetKey, media.defaultView]);

  const prefetchReal = useCallback(() => setWantReal(true), []);

  const choose = useCallback((next: MediaView) => {
    pinned.current = true;
    setWantReal(true);
    setView(next);
  }, []);

  const preview = useCallback(
    (next: MediaView) => {
      if (!media.canSwitch || pinned.current) return;
      if (next === "real") setWantReal(true);
      setView(next);
    },
    [media.canSwitch],
  );

  return { view, wantReal, hoverCapable, choose, preview, prefetchReal };
}

export function MediaFrame({
  media,
  view,
  wantReal,
  eager,
  width = 600,
  height = 750,
  fallback,
}: {
  media: ProductMedia;
  view: MediaView | undefined;
  /** Request the real photograph. Until this is true it is never fetched. */
  wantReal?: boolean;
  eager?: boolean;
  width?: number;
  height?: number;
  /** Rendered when the product has no images at all (unchanged behaviour). */
  fallback?: ReactNode;
}) {
  const L = useL();
  const [realReady, setRealReady] = useState(false);
  const styled = media.styled;
  const real = media.real;
  const single = imageForView(media, view);

  // Hold the current image until the photograph has actually decoded, so the
  // switch never flashes an empty frame.
  const showReal = view === "real" && (realReady || !styled);
  const mountReal = Boolean(real) && (wantReal || view === "real");

  const attachReal = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setRealReady(true);
  }, []);

  if (!styled || !real) {
    // One image (or none): exactly the markup this app rendered before.
    if (!single?.src) return <>{fallback}</>;
    return (
      <img
        src={single.src}
        alt={L(single.alt)}
        loading={eager ? "eager" : "lazy"}
        width={width}
        height={height}
        {...(eager ? { fetchPriority: "high" as const } : {})}
      />
    );
  }

  return (
    <div className="media-stack">
      <img
        className={`media-stack__img${showReal ? "" : " is-on"}`}
        src={styled.src}
        alt={L(styled.alt)}
        loading={eager ? "eager" : "lazy"}
        width={width}
        height={height}
        decoding="async"
        {...(eager ? { fetchPriority: "high" as const } : {})}
      />
      {mountReal && (
        <img
          ref={attachReal}
          className={`media-stack__img${showReal ? " is-on" : ""}`}
          src={real.src}
          alt={L(real.alt)}
          loading="lazy"
          width={width}
          height={height}
          decoding="async"
          onLoad={() => setRealReady(true)}
        />
      )}
    </div>
  );
}

export function MediaToggle({
  media,
  view,
  onSelect,
  onPrefetch,
  variant = "card",
}: {
  media: ProductMedia;
  view: MediaView | undefined;
  onSelect: (view: MediaView) => void;
  onPrefetch?: () => void;
  variant?: "card" | "page";
}) {
  const { t } = useI18n();
  if (!media.canSwitch) return null;

  // Cards sit under a stretched product link — the activation must never be
  // read as "open the product".
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={`media-toggle media-toggle--${variant}`} role="group" aria-label={t("media.toggleLabel")}>
      {media.views.map((v) => {
        const Icon = VIEW_ICON[v];
        const label = t(viewLabelKey(v));
        return (
          <button
            key={v}
            type="button"
            className={`media-toggle__opt${v === view ? " is-on" : ""}`}
            aria-pressed={v === view}
            aria-label={label}
            onPointerDown={v === "real" ? onPrefetch : undefined}
            onClick={(e) => {
              stop(e);
              onSelect(v);
            }}
          >
            <Icon size={variant === "page" ? 15 : 13} />
            <span className="media-toggle__full">{label}</span>
            <span className="media-toggle__short">{t(viewShortLabelKey(v))}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Names a lone styled/real image. Never rendered for an untagged image —
 * an image the owner has not described makes no claim about itself. */
export function MediaLabel({ media, variant = "card" }: { media: ProductMedia; variant?: "card" | "page" }) {
  const { t } = useI18n();
  if (media.canSwitch || media.views.length !== 1) return null;
  const view = media.views[0]!;
  const Icon = VIEW_ICON[view];
  return (
    <span className={`media-label media-label--${variant}`}>
      <Icon size={13} />
      {t(viewLabelKey(view))}
    </span>
  );
}
