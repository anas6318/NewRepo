/**
 * An <img> that cannot show the browser's broken-image glyph.
 *
 * Two rules, both about honesty:
 *
 *  1. A failed request is replaced by a neutral CROWNED placeholder — never
 *     by a DIFFERENT product image and never by the other media role. A
 *     styled render must not be able to stand in for a photograph of the
 *     goods just because the photograph 404'd.
 *  2. The placeholder occupies exactly the same box as the image would have,
 *     so a failure cannot shift the layout around it.
 *
 * Everything else is a plain <img>: the same props, the same loading and
 * decoding attributes, so nothing about performance changes.
 */
import { useEffect, useState, type ImgHTMLAttributes } from "react";

export type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | undefined;
  alt: string;
};

export function SafeImage({ src, alt, className, onError, ...rest }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  // A new src deserves a fresh attempt — otherwise a recycled card would stay
  // stuck on the placeholder after the grid filters to a different product.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    // A decorative image (alt="") stays decorative when it fails — announcing
    // "image missing" to a screen reader would be noise, not information.
    const decorative = alt === "";
    return (
      <span
        className={`img-fallback${className ? ` ${className}` : ""}`}
        {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": alt })}
        data-testid="img-fallback"
        style={{
          width: rest.width ? `${rest.width}px` : "100%",
          ...(rest.height ? { height: `${rest.height}px` } : {}),
          aspectRatio: rest.width && rest.height ? `${rest.width} / ${rest.height}` : undefined,
        }}
      >
        <span className="img-fallback__mark" aria-hidden="true">
          CROWNED.
        </span>
      </span>
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
