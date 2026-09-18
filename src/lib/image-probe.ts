/**
 * Does this image URL actually resolve?
 *
 * Static URL rules cannot answer that. The Real Product image that broke the
 * live product page was a perfectly well-formed https:// Supabase Storage URL
 * — it simply pointed at an object that does not exist, because a folder
 * segment had been dropped when the URL was assembled by hand. Nothing in the
 * app noticed; the first thing that noticed was a customer.
 *
 * So Admin asks the browser to load it before the product is saved. This is a
 * data-quality gate, not a security boundary: the server-side URL rules in
 * supabase/functions/_shared/image-url.ts remain the boundary.
 */

export interface ProbeResult {
  src: string;
  ok: boolean;
  /** True when the attempt ran out of time rather than clearly failing. */
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Resolves true only when the bytes decode. A 404, a DNS failure, a CORS
 * refusal and a `file:///` URL the browser declines all resolve false.
 */
export function probeImage(src: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  if (!src.trim()) return Promise.resolve({ src, ok: false, timedOut: false });
  if (typeof window === "undefined" || typeof window.Image !== "function") {
    // No browser (SSR, prerender): report success rather than block a save
    // on an environment that simply cannot answer the question.
    return Promise.resolve({ src, ok: true, timedOut: false });
  }
  return new Promise<ProbeResult>((resolve) => {
    const img = new window.Image();
    let settled = false;
    const done = (ok: boolean, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve({ src, ok, timedOut });
    };
    const timer = setTimeout(() => done(false, true), timeoutMs);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
    if (img.complete && img.naturalWidth > 0) done(true);
  });
}

/** Probes several images at once and returns only the ones that failed. */
export async function findUnreachableImages(sources: readonly string[], timeoutMs?: number): Promise<ProbeResult[]> {
  const results = await Promise.all(sources.filter((s) => s.trim()).map((s) => probeImage(s, timeoutMs)));
  return results.filter((r) => !r.ok);
}
