/**
 * Framework-free route matching. Kept JSX-free so it can be unit-tested with
 * `node --test` directly. The React bindings live in router.tsx.
 *
 * Pattern syntax (React-Router-like subset):
 *   /:locale/product/:slug   → params
 *   /admin/*                 → wildcard suffix (params["*"])
 *   /                        → exact root
 */
export interface RouteMatch {
  params: Record<string, string>;
  /** Higher = more specific. Static segments beat params beat wildcards. */
  score: number;
}

export function matchPath(pattern: string, pathname: string): RouteMatch | null {
  const patternSegs = split(pattern);
  const pathSegs = split(pathname);
  const params: Record<string, string> = {};
  let score = 0;

  for (let i = 0; i < patternSegs.length; i++) {
    const pat = patternSegs[i];
    if (pat === undefined) return null;

    if (pat === "*") {
      params["*"] = pathSegs.slice(i).map(decodeSegment).join("/");
      return { params, score: score + 1 };
    }

    const seg = pathSegs[i];
    if (seg === undefined) return null;

    if (pat.startsWith(":")) {
      params[pat.slice(1)] = decodeSegment(seg);
      score += 10;
    } else if (pat.toLowerCase() === seg.toLowerCase()) {
      score += 100;
    } else {
      return null;
    }
  }

  if (pathSegs.length !== patternSegs.length) return null;
  return { params, score: score + 1000 };
}

export function matchBest(
  patterns: string[],
  pathname: string,
): { pattern: string; match: RouteMatch } | null {
  let best: { pattern: string; match: RouteMatch } | null = null;
  for (const pattern of patterns) {
    const match = matchPath(pattern, pathname);
    if (match && (!best || match.score > best.match.score)) {
      best = { pattern, match };
    }
  }
  return best;
}

function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Builds a locale-prefixed path: buildPath("ar", "/shop") → "/ar/shop". */
export function localePath(locale: string, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return `/${locale}`;
  return `/${locale}${clean}`;
}

/** Swap the locale prefix of a pathname, preserving the rest of the URL. */
export function swapLocale(pathname: string, nextLocale: string, locales: string[]): string {
  const segs = split(pathname);
  const first = segs[0];
  if (first !== undefined && locales.includes(first)) {
    segs[0] = nextLocale;
    return `/${segs.join("/")}`;
  }
  return `/${nextLocale}${pathname === "/" ? "" : pathname}`;
}
