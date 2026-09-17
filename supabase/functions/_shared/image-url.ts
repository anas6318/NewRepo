/**
 * Product image URL rules — the SERVER's copy.
 *
 * Edge functions cannot import from `src/`, so this mirrors
 * `src/lib/media.ts` exactly, the same way `customer-order.ts` mirrors
 * `src/lib/orders.ts`. Parity is pinned by tests/unit/image-url-parity.test.ts,
 * which runs BOTH implementations over the same table of inputs — so the two
 * copies cannot drift without a test failing.
 *
 * This is the correctness boundary. The Admin form runs the same rules as a
 * courtesy, but anyone can POST to this function directly, and a
 * `file:///C:/Users/...` URL saved that way renders perfectly for whoever
 * typed it and is a broken image for every customer.
 *
 * Runtime: no top-level Deno access, so tests exercise this exact module
 * under Node. Keep it that way.
 */

export type ImageUrlProblem = "local_file" | "windows_path" | "relative_path" | "insecure_scheme" | "not_a_url";

/** Absolute non-http(s) schemes that can never work for a remote customer. */
const LOCAL_SCHEMES = /^(file|blob|data|filesystem|about|chrome|chrome-extension|ms-appx|content|resource):/i;
/** `C:\…`, `C:/…`, `\\server\share`. */
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

export interface ImageUrlOptions {
  /**
   * Whether a site-absolute path ("/demo/shirt.webp") is acceptable.
   *
   * TRUE in the browser: the storefront genuinely ships bundled assets under
   * /brand and /demo, and those render fine.
   *
   * FALSE for stored production product data: a product row saved through
   * this function is expected to reference an uploaded image — a Supabase
   * Storage public URL — not a path that only resolves because a particular
   * build happened to bundle it. Accepting one here would let a product point
   * at an asset that can disappear with the next deploy.
   */
  allowSiteRelative?: boolean;
}

/**
 * Returns the problem with an image URL, or undefined when it is usable.
 * An EMPTY string is not an error here — "no image" is a valid state and is
 * handled by the caller.
 */
export function imageUrlProblem(raw: string, options: ImageUrlOptions = {}): ImageUrlProblem | undefined {
  const src = raw.trim();
  if (!src) return undefined;
  if (WINDOWS_PATH.test(src)) return "windows_path";
  if (LOCAL_SCHEMES.test(src)) return "local_file";
  if (src.startsWith("/") && !src.startsWith("//")) {
    return options.allowSiteRelative ? undefined : "relative_path";
  }
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

interface StoredImage {
  src?: unknown;
  role?: unknown;
}

/**
 * Validates every image on a product row: the styled render, the photograph
 * and every gallery extra. Returns the offending entries, most useful first.
 */
export function productImageUrlProblems(images: unknown, options: ImageUrlOptions = {}): { where: string; src: string; problem: ImageUrlProblem }[] {
  if (!Array.isArray(images)) return [];
  const bad: { where: string; src: string; problem: ImageUrlProblem }[] = [];
  images.forEach((entry, index) => {
    const image = (entry ?? {}) as StoredImage;
    const src = typeof image.src === "string" ? image.src : "";
    const problem = imageUrlProblem(src, options);
    if (!problem) return;
    const role = typeof image.role === "string" ? image.role : "";
    const where = role === "styled" ? "styled" : role === "real" ? "real" : `gallery[${index}]`;
    bad.push({ where, src, problem });
  });
  return bad;
}
