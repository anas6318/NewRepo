/**
 * CROWNED Studio product selection.
 *
 * A product is shown in the homepage CROWNED Studio section when its `tags`
 * contain the reserved internal tag `crowned-studio` (whole tag, any case,
 * surrounding spaces ignored). No schema change: the Admin editor toggles the
 * tag; the homepage loads the published catalog once and keeps the products
 * that `filterProducts(..., { tag: STUDIO_TAG })` returns.
 * The tag is internal and never shown to customers.
 *
 * Pure module: no React, no imports from src/services.
 */

import { normalizeTag, productHasTag } from "./tags.ts";

export const STUDIO_TAG = "crowned-studio";

/** Most Studio products the homepage shows. */
export const STUDIO_LIMIT = 4;

/** True when `tags` carries the Studio tag. Missing / non-array gives false. */
export function hasStudioTag(tags: unknown): boolean {
  return productHasTag({ tags }, STUDIO_TAG);
}

/**
 * Returns a NEW tags array: every Studio tag (any case/whitespace) and every
 * non-string entry is removed, every other string tag is kept exactly as it
 * was and in order, then one canonical `crowned-studio` is appended when `on`.
 * Idempotent; non-array gives [] (same contract as setProductClubTag).
 */
export function setStudioTag(tags: unknown, on: boolean): string[] {
  const kept = (Array.isArray(tags) ? tags : []).filter((t): t is string => typeof t === "string" && normalizeTag(t) !== STUDIO_TAG);
  return on ? [...kept, STUDIO_TAG] : kept;
}

/** The products the homepage shows: the first STUDIO_LIMIT, order kept. */
export function studioSelection<T>(products: readonly T[]): T[] {
  return products.slice(0, STUDIO_LIMIT);
}
