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
import { SafeImage } from "../ui/SafeImage.tsx";

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

/** How far the real photograph has got. Keyed to its src, so a new product
 * (or a changed URL) starts over rather than inheriting a stale "ready". */
export type RealStatus = "idle" | "loading" | "ready" | "error";

/**
 * Drives one product's view state.
 *
 * The rule this hook exists to enforce: THE VIEW ONLY BECOMES "real" ONCE THE
 * PHOTOGRAPH HAS ACTUALLY DECODED. Previously the view flipped on click and
 * the frame separately decided whether to reveal the photo, so on a touch
 * device — where nothing had prefetched it — the button read "Real Product"
 * while the styled render was still the thing on screen, and a failed request
 * left it that way permanently. Deciding here, before the view changes, makes
 * that disagreement unrepresentable.
 *
 * `pending` is the view the customer asked for but that is not on screen yet;
 * it drives a loading affordance, never a pressed state.
 *
 * `pinned` records that the customer chose a view themselves — after that,
 * hover stops overriding it and nothing ever switches back on its own.
 */
export function useMediaView(media: ProductMedia, resetKey: string) {
  const [view, setView] = useState<MediaView | undefined>(media.defaultView);
  const [pending, setPending] = useState<MediaView | null>(null);
  const [realStatus, setRealStatus] = useState<RealStatus>("idle");
  const pinned = useRef(false);
  const hoverCapable = useHoverCapable();

  const realSrc = media.real?.src ?? "";
  // Guards every async callback: a load that resolves after the card has been
  // recycled onto another product must not touch the new product's state.
  const activeSrc = useRef(realSrc);
  const statusRef = useRef<RealStatus>("idle");
  statusRef.current = realStatus;

  useEffect(() => {
    setView(media.defaultView);
    setPending(null);
    setRealStatus("idle");
    statusRef.current = "idle";
    activeSrc.current = realSrc;
    pinned.current = false;
    // Cards are reused as the grid filters; a new product starts fresh.
  }, [resetKey, media.defaultView, realSrc]);

  /**
   * Starts (or reuses) the photograph's download. Resolves to true only when
   * the bytes are decodable — a 404, a DNS failure or a `file:///` URL that
   * the browser refuses all resolve to false.
   */
  const loadReal = useCallback((): Promise<boolean> => {
    if (!realSrc) return Promise.resolve(false);
    if (statusRef.current === "ready") return Promise.resolve(true);
    if (statusRef.current === "error") return Promise.resolve(false);
    if (typeof window === "undefined" || typeof window.Image !== "function") return Promise.resolve(false);

    const src = realSrc;
    setRealStatus("loading");
    statusRef.current = "loading";
    return new Promise<boolean>((resolve) => {
      const img = new window.Image();
      const settle = (ok: boolean) => {
        if (activeSrc.current !== src) return resolve(false);
        setRealStatus(ok ? "ready" : "error");
        statusRef.current = ok ? "ready" : "error";
        resolve(ok);
      };
      img.onload = () => settle(true);
      img.onerror = () => settle(false);
      img.src = src;
      // A cached image can be complete before the handlers attach.
      if (img.complete && img.naturalWidth > 0) settle(true);
    });
  }, [realSrc]);

  /** Desktop hover / touch-start warm-up. Never changes what is displayed. */
  const prefetchReal = useCallback(() => {
    void loadReal();
  }, [loadReal]);

  const choose = useCallback(
    (next: MediaView) => {
      pinned.current = true;
      if (next !== "real") {
        // The styled render is already on screen; switching back is instant.
        setPending(null);
        setView(next);
        return;
      }
      if (statusRef.current === "ready") {
        setPending(null);
        setView("real");
        return;
      }
      const src = realSrc;
      setPending("real");
      void loadReal().then((ok) => {
        if (activeSrc.current !== src) return;
        setPending(null);
        // On failure the view stays where it was, so the pressed button and
        // the visible image continue to agree. The frame surfaces the error.
        if (ok) setView("real");
      });
    },
    [loadReal, realSrc],
  );

  const preview = useCallback(
    (next: MediaView) => {
      if (!media.canSwitch || pinned.current) return;
      if (next !== "real") {
        setView(next);
        return;
      }
      // Hover only reveals the photograph once it is genuinely available, for
      // exactly the same reason a tap does.
      const src = realSrc;
      void loadReal().then((ok) => {
        if (activeSrc.current !== src || pinned.current || !ok) return;
        setView("real");
      });
    },
    [media.canSwitch, loadReal, realSrc],
  );

  return { view, pending, realStatus, hoverCapable, choose, preview, prefetchReal };
}

export function MediaFrame({
  media,
  view,
  realStatus = "idle",
  eager,
  width = 600,
  height = 750,
  fallback,
}: {
  media: ProductMedia;
  view: MediaView | undefined;
  /** Load state of the photograph, owned by useMediaView. */
  realStatus?: RealStatus;
  eager?: boolean;
  width?: number;
  height?: number;
  /** Rendered when the product has no images at all (unchanged behaviour). */
  fallback?: ReactNode;
}) {
  const L = useL();
  const { t } = useI18n();
  const styled = media.styled;
  const real = media.real;
  const single = imageForView(media, view);

  if (!styled || !real) {
    // One image (or none): exactly the markup this app rendered before.
    if (!single?.src) return <>{fallback}</>;
    return (
      <SafeImage
        src={single.src}
        alt={L(single.alt)}
        loading={eager ? "eager" : "lazy"}
        width={width}
        height={height}
        {...(eager ? { fetchPriority: "high" as const } : {})}
      />
    );
  }

  // `view` is only ever "real" once the photograph has decoded (useMediaView
  // enforces that), so what is displayed always matches what is pressed.
  const showReal = view === "real";

  return (
    <div className="media-stack" data-media-view={showReal ? "real" : "styled"} data-real-status={realStatus}>
      <SafeImage
        className={`media-stack__img${showReal ? "" : " is-on"}`}
        src={styled.src}
        alt={L(styled.alt)}
        loading={eager ? "eager" : "lazy"}
        width={width}
        height={height}
        decoding="async"
        {...(eager ? { fetchPriority: "high" as const } : {})}
      />
      {(realStatus === "ready" || realStatus === "loading") && (
        <SafeImage
          className={`media-stack__img${showReal ? " is-on" : ""}`}
          src={real.src}
          alt={L(real.alt)}
          loading="lazy"
          width={width}
          height={height}
          decoding="async"
        />
      )}
      {realStatus === "loading" && (
        <span className="media-stack__busy" role="status" aria-live="polite">
          <span className="media-stack__spinner" aria-hidden="true" />
          <span className="sr-only">{t("media.loadingReal")}</span>
        </span>
      )}
      {realStatus === "error" && (
        // Said plainly rather than silently falling back: the styled render is
        // still on screen and must not be mistaken for the photograph.
        <span className="media-stack__note" role="status">
          {t("media.realUnavailable")}
        </span>
      )}
    </div>
  );
}

export function MediaToggle({
  media,
  view,
  pending = null,
  realStatus = "idle",
  onSelect,
  onPrefetch,
  variant = "card",
}: {
  media: ProductMedia;
  /** The view actually on screen. This — not the click — drives aria-pressed. */
  view: MediaView | undefined;
  /** Asked for but not yet displayed. Shown as busy, never as pressed. */
  pending?: MediaView | null;
  realStatus?: RealStatus;
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
        const busy = pending === v;
        const unavailable = v === "real" && realStatus === "error";
        return (
          <button
            key={v}
            type="button"
            className={`media-toggle__opt${v === view ? " is-on" : ""}${busy ? " is-busy" : ""}`}
            aria-pressed={v === view}
            aria-busy={busy || undefined}
            aria-label={unavailable ? `${label} — ${t("media.realUnavailable")}` : label}
            data-view={v}
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
