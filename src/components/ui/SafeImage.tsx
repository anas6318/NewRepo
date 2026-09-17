/**
 * An <img> that cannot show the browser's broken-image glyph.
 *
 * Three rules, two about honesty and one about layout:
 *
 *  1. A failed request is replaced by a neutral CROWNED placeholder — never
 *     by a DIFFERENT product image and never by the other media role. A
 *     styled render must not be able to stand in for a photograph of the
 *     goods just because the photograph 404'd.
 *  2. A decorative image (alt="") stays decorative when it fails.
 *  3. THE PLACEHOLDER IS ITSELF AN <img>, carrying the same width/height
 *     attributes and the same className as the image it replaces. That is
 *     the whole point: `width={600}` on an <img> is an intrinsic-size HINT
 *     that `width: 100%` in a stylesheet overrides, whereas an inline
 *     `style={{ width: "600px" }}` on a <span> does not — so an earlier
 *     version of this component could blow a 600px placeholder out of a
 *     280px card and overflow the page. Using the same element with the same
 *     attributes makes the layout box identical by construction, rather than
 *     by a second set of rules that has to be kept in sync.
 *
 * The placeholder's pixels are an inline SVG data URI, so it costs no network
 * request and scales to whatever box CSS gives it.
 */
import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";

export type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | undefined;
  alt: string;
};

/** A dark CROWNED plate at the same aspect ratio as the missing image. */
function placeholderSrc(width: number, height: number): string {
  // The mark scales with the box so it stays legible in a 40px cart thumb
  // and in a 720px gallery frame without a second set of breakpoints.
  const size = Math.max(6, Math.min(width, height) * 0.09);
  const tracking = size * 0.18;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice"><rect width="100%" height="100%" fill="#0b0b0d"/><rect width="100%" height="100%" fill="none" stroke="rgba(246,244,239,0.06)" stroke-width="2"/><text x="50%" y="50%" fill="rgba(246,244,239,0.22)" font-family="system-ui,-apple-system,sans-serif" font-size="${size.toFixed(1)}" font-weight="600" letter-spacing="${tracking.toFixed(2)}" text-anchor="middle" dominant-baseline="central">CROWNED.</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function SafeImage({ src, alt, className, onError, ...rest }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  // A new src deserves a fresh attempt — otherwise a recycled card would stay
  // stuck on the placeholder after the grid filters to a different product.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  // Only the RATIO matters here; the rendered size still comes from CSS.
  const fallbackSrc = useMemo(() => placeholderSrc(asNumber(rest.width, 4), asNumber(rest.height, 5)), [rest.width, rest.height]);

  if (!src || failed) {
    const decorative = alt === "";
    return (
      <img
        {...rest}
        className={className}
        src={fallbackSrc}
        alt={decorative ? "" : alt}
        data-testid="img-fallback"
        {...(decorative ? { "aria-hidden": true } : {})}
        // Never let a failing placeholder loop back into this handler.
        onError={undefined}
      />
    );
  }

  return (
    <img
      {...rest}
      className={className}
      src={src}
      alt={alt}
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}
