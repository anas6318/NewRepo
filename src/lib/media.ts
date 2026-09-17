/**
 * Product media resolution — which image is the styled preview, which is the
 * real photograph, and what is left for the ordinary gallery.
 *
 * Pure functions, no I/O and no React, so the storefront, the admin editor
 * and the tests all read the same rules.
 *
 * HONESTY RULE, and the reason this file exists: an image is only ever
 * labelled when the owner has actually said what it is. An untagged image
 * makes no claim, gets no label and offers no switch — a legacy photograph
 * must never be presented as a styled render, and a styled render must never
 * be presented as a photograph of the goods.
 */
import type { LocalizedText, Product, ProductImage, ProductImageRole } from "../services/types.ts";

export type MediaView = ProductImageRole;

export interface ProductMedia {
  /** Premium presentation image, when the owner has set one. */
  styled?: ProductImage;
  /** Photograph of the actual product, when the owner has set one. */
  real?: ProductImage;
  /** Everything else, in stored order — back, close-ups, detail shots. */
  extras: ProductImage[];
  /** Views the customer may switch between, in display order. */
  views: MediaView[];
  /** The view shown first. Styled leads whenever it exists. */
  defaultView: MediaView | undefined;
  /** True only when BOTH images exist, i.e. there is something to switch. */
  canSwitch: boolean;
  /** What a card, thumbnail or share image should show. */
  cover: ProductImage | undefined;
}

/** Resolves a product's images into the styled / real / gallery structure. */
export function productMedia(product: Pick<Product, "images">): ProductMedia {
  const images = Array.isArray(product.images) ? product.images.filter((i) => i && typeof i.src === "string" && i.src !== "") : [];
  const styled = images.find((i) => i.role === "styled");
  const real = images.find((i) => i.role === "real");
  const extras = images.filter((i) => i !== styled && i !== real);
  const views: MediaView[] = [];
  if (styled) views.push("styled");
  if (real) views.push("real");
  return {
    ...(styled ? { styled } : {}),
    ...(real ? { real } : {}),
    extras,
    views,
    // Styled is the hero whenever it exists; a real-only product simply
    // shows its photograph, which needs no "switch back" affordance.
    defaultView: views[0],
    canSwitch: Boolean(styled && real),
    cover: styled ?? real ?? images[0],
  };
}

/** The image behind a given view. */
export function imageForView(media: ProductMedia, view: MediaView | undefined): ProductImage | undefined {
  if (view === "styled") return media.styled;
  if (view === "real") return media.real;
  return media.cover;
}

/** The card / thumbnail / Open Graph image. */
export function coverImage(product: Pick<Product, "images">): ProductImage | undefined {
  return productMedia(product).cover;
}

/**
 * Canonical stored order: styled first, then the real photograph, then the
 * rest untouched. Existing code that treats `images[0]` as the cover (cart
 * lines, order snapshots, prerendered metadata) therefore stays correct
 * without having to learn about roles.
 */
export function orderImages(images: ProductImage[]): ProductImage[] {
  const styled = images.filter((i) => i.role === "styled").slice(0, 1);
  const real = images.filter((i) => i.role === "real").slice(0, 1);
  const rest = images.filter((i) => i !== styled[0] && i !== real[0]);
  return [...styled, ...real, ...rest];
}

/**
 * Replaces (or clears) one role slot, keeping every other image and the
 * canonical order. Used by the admin editor so setting the styled preview
 * cannot disturb the gallery or any unrelated product field.
 */
export function setRoleImage(
  images: ProductImage[],
  role: ProductImageRole,
  next: { src: string; alt: LocalizedText } | undefined,
): ProductImage[] {
  const without = images.filter((i) => i.role !== role);
  return orderImages(next && next.src ? [{ ...next, role }, ...without] : without);
}

/** i18n key for a view's customer-facing name, e.g. `media.styled`. */
export function viewLabelKey(view: MediaView): string {
  return view === "styled" ? "media.styled" : "media.real";
}

/** i18n key for the compact label used on narrow product cards. */
export function viewShortLabelKey(view: MediaView): string {
  return view === "styled" ? "media.styledShort" : "media.realShort";
}

/* ── Image URL validation ───────────────────────────────────────────────────
 *
 * A product image URL is only useful if a CUSTOMER'S browser can fetch it.
 * A `file:///C:/Users/...` path renders perfectly on the machine that typed
 * it and is a broken image for everyone else, which is exactly how a bad URL
 * reaches production unnoticed. These rules run in Admin before save AND
 * server-side in the edge function — the client check is the courtesy, the
 * server check is the guarantee.
 */

export type ImageUrlProblem = "local_file" | "windows_path" | "relative_path" | "insecure_scheme" | "not_a_url";

/** Absolute non-http(s) schemes that can never work for a remote customer. */
const LOCAL_SCHEMES = /^(file|blob|data|filesystem|about|chrome|chrome-extension|ms-appx|content|resource):/i;
/** `C:\…`, `C:/…`, `\\server\share`. */
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Returns the problem with an image URL, or undefined when it is usable.
 * An EMPTY string is not an error here — "no image" is a valid state and is
 * handled by the caller.
 */
export function imageUrlProblem(raw: string): ImageUrlProblem | undefined {
  const src = raw.trim();
  if (!src) return undefined;
  if (WINDOWS_PATH.test(src)) return "windows_path";
  if (LOCAL_SCHEMES.test(src)) return "local_file";
  // Site-relative paths are legitimate for bundled assets (/brand/…, /demo/…)
  // and are served from the same origin as the storefront.
  if (src.startsWith("/") && !src.startsWith("//")) return undefined;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return "not_a_url";
  }
  if (url.protocol === "https:") return undefined;
  // http:// would be blocked as mixed content on the HTTPS storefront.
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? "local_file" : "insecure_scheme";
  return "insecure_scheme";
}

/** Admin-facing English explanation. Admin is an internal, English-only UI. */
export function imageUrlProblemMessage(problem: ImageUrlProblem, src: string): string {
  const shown = src.length > 60 ? `${src.slice(0, 57)}…` : src;
  switch (problem) {
    case "windows_path":
    case "local_file":
      return `"${shown}" is a file on your own computer. Customers cannot load it. Upload the image to Supabase Storage and paste its public https:// URL.`;
    case "insecure_scheme":
      return `"${shown}" is not served over https. The storefront is HTTPS, so the browser will block it. Use an https:// URL.`;
    case "relative_path":
      return `"${shown}" is a relative path. Use a site-absolute path starting with "/" or a full https:// URL.`;
    case "not_a_url":
      return `"${shown}" is not a valid URL. Paste the full https:// address of the image.`;
  }
}

/** Every bad image URL on a product, labelled by where it came from. */
export function productImageIssues(images: readonly ProductImage[]): string[] {
  const issues: string[] = [];
  images.forEach((image, index) => {
    const problem = imageUrlProblem(image.src ?? "");
    if (!problem) return;
    const where = image.role === "styled" ? "Styled preview" : image.role === "real" ? "Real product photo" : `Gallery image ${index + 1}`;
    issues.push(`${where}: ${imageUrlProblemMessage(problem, image.src ?? "")}`);
  });
  return issues;
}
