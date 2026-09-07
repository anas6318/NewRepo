/**
 * Brand asset configuration — the official CROWNED logo.
 *
 * Source of truth: the supplied master artwork (dark ink on white),
 * processed only by trimming the white background to transparency.
 * `onDark` is the white knockout of the same mark for dark surfaces
 * (footer, admin, error pages) — shapes and proportions are untouched.
 *
 * The intrinsic bitmap is 2092×272 (≈7.69:1), far above display size, so the
 * wordmark stays sharp on high-resolution screens. Rendered width/height
 * pairs below preserve that exact ratio to avoid distortion and layout shift.
 */

export interface LogoAsset {
  src: string;
  /** Intrinsic pixel size of the asset (for aspect-ratio math). */
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface LogoConfig {
  /** Accessible name for every rendering of the logo. */
  alt: string;
  /** Dark ink variant — use on light backgrounds (header, mobile menu). */
  onLight: LogoAsset;
  /** White variant — use on dark backgrounds (footer, admin, error pages). */
  onDark: LogoAsset;
}

export const LOGO: LogoConfig = {
  alt: "CROWNED",
  onLight: { src: "/brand/crowned-logo.png", intrinsicWidth: 2092, intrinsicHeight: 272 },
  onDark: { src: "/brand/crowned-logo-white.png", intrinsicWidth: 2092, intrinsicHeight: 272 },
};

/** Rendered size helper — returns width for a wanted display height, keeping ratio. */
export function logoWidthFor(asset: LogoAsset, height: number): number {
  return Math.round((asset.intrinsicWidth / asset.intrinsicHeight) * height);
}
