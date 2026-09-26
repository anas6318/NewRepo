/**
 * Club registry — the single source of truth for football clubs.
 *
 * Clubs are NOT a separate data model: a product belongs to a club when its
 * `tags` contain that club's canonical tag. Matching is case-insensitive and
 * whole-tag only (never a substring, so `ac-milan` cannot match
 * `inter-milan`), and tolerates products whose `tags` are missing.
 *
 * Pure module: no React, no imports from src/services, so it can be mirrored
 * verbatim for a Deno edge function later. Used by the storefront (Shop by
 * Club menu, /shop?club=, catalog filter) and by admin/import club
 * assignment.
 */

/** Same shape as LocalizedText in src/services/types.ts (kept local so this
 * module has no imports). */
export interface ClubLabel {
  ar: string;
  he: string;
  en: string;
}

export interface Club {
  /** Canonical product tag as used by the live catalog (lowercase). Never
   * shown to customers. */
  tag: string;
  /** Localized display name. Display only — it never affects matching. */
  label: ClubLabel;
}

/**
 * Canonical tags are the tags the live catalog puts on each club's products
 * (verified against a live-catalog snapshot taken 2026-09-26). The first five
 * labels are the Shop by Club menu labels, unchanged; the ar/he labels of the
 * last three appear verbatim in their clubs' live product names.
 */
export const CLUBS: readonly Club[] = [
  { tag: "barcelona", label: { ar: "برشلونة", he: "ברצלונה", en: "Barcelona" } },
  { tag: "real-madrid", label: { ar: "ريال مدريد", he: "ריאל מדריד", en: "Real Madrid" } },
  // ar/he use the bare "Milan" form because that is how the catalog's own
  // ar/he product names refer to AC Milan.
  { tag: "ac-milan", label: { ar: "ميلان", he: "מילאן", en: "AC Milan" } },
  { tag: "manunited", label: { ar: "مانشستر يونايتد", he: "מנצ׳סטר יונייטד", en: "Manchester United" } },
  { tag: "liverpool", label: { ar: "ليفربول", he: "ליברפול", en: "Liverpool" } },
  { tag: "inter-milan", label: { ar: "إنتر ميلان", he: "אינטר מילאן", en: "Inter Milan" } },
  { tag: "atc-madrid", label: { ar: "أتلتيكو مدريد", he: "אתלטיקו מדריד", en: "Atlético Madrid" } },
  // he spelling (ASCII apostrophe) is the one the live product names use.
  { tag: "mancity", label: { ar: "مانشستر سيتي", he: "מנצ'סטר סיטי", en: "Manchester City" } },
];

/** Canonical form of a club tag or `?club=` value: trimmed, lowercase.
 * Anything that is not a string normalizes to "". */
export function normalizeClubTag(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The registry club whose canonical tag equals `value` once normalized. */
export function clubForTag(value: unknown): Club | undefined {
  const tag = normalizeClubTag(value);
  return tag ? CLUBS.find((c) => c.tag === tag) : undefined;
}

/** A product's tags, normalized; missing or non-array `tags` gives []. */
function normalizedTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.map(normalizeClubTag).filter(Boolean) : [];
}

/** The canonical registry club tags carried by a product's `tags` (deduped,
 * registry order). Missing or non-array `tags` gives []. */
export function productClubTags(tags: unknown): string[] {
  const own = new Set(normalizedTags(tags));
  return CLUBS.filter((c) => own.has(c.tag)).map((c) => c.tag);
}

/** True when one of the product's tags equals `tag` (whole tag,
 * case-insensitive). Never throws on a product without `tags`. */
export function productHasClub(product: { tags?: unknown } | null | undefined, tag: unknown): boolean {
  const wanted = normalizeClubTag(tag);
  return wanted !== "" && normalizedTags(product?.tags).includes(wanted);
}

/** Locale-less storefront path of a club's landing page. */
export function clubShopPath(tag: string): string {
  return `/shop?club=${encodeURIComponent(tag)}`;
}
