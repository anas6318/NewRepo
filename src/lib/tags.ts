/**
 * Neutral product-tag helpers: whole-tag, case-insensitive, surrounding
 * spaces ignored. No registry knowledge (clubs, Studio, ...), so any feature
 * that keys off a tag can share them.
 *
 * Pure module: no React, no imports from src/services.
 */

/** A tag normalized for comparison; non-strings give "". */
export function normalizeTag(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Internal management tags: they drive storefront/admin features (exact tag
 * filters such as the homepage Studio section) but are never customer copy,
 * so they must not make a product match a shopper's free-text search. Add
 * future internal tags here. `crowned-studio` mirrors STUDIO_TAG in
 * src/lib/studio.ts (a unit test keeps them in sync).
 */
export const INTERNAL_TAGS: readonly string[] = ["crowned-studio"];

/** True for a reserved internal tag (any case, surrounding spaces ignored). */
export function isInternalTag(value: unknown): boolean {
  const tag = normalizeTag(value);
  return tag !== "" && INTERNAL_TAGS.includes(tag);
}

/** The product tags customer search may match: string tags that are not
 * internal. Missing or non-array `tags` gives []. */
export function searchableTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string" && !isInternalTag(t)) : [];
}

/** True when the product's `tags` carry `tag` as a whole tag. Missing or
 * non-array `tags`, non-string entries and an empty `tag` give false. */
export function productHasTag(product: { tags?: unknown } | null | undefined, tag: unknown): boolean {
  const wanted = normalizeTag(tag);
  const tags = product?.tags;
  return wanted !== "" && Array.isArray(tags) && tags.some((t) => normalizeTag(t) === wanted);
}
