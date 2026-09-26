/**
 * Club registry — the SERVER's copy.
 *
 * Edge functions cannot import from `src/`, so this mirrors
 * `src/lib/clubs.ts` exactly (the same pattern as `image-url.ts` mirroring
 * `src/lib/media.ts`). Parity is pinned by tests/unit/club-tags.test.ts,
 * which runs BOTH implementations over the same table of inputs — so the two
 * copies cannot drift without a test failing.
 *
 * Used by admin-actions `save-product` (normalizeProductTags) and
 * `import-products` (parseImportedClub). Runtime: pure, no Deno access, so
 * tests exercise this exact module under Node. Keep it that way.
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

/* ── Club assignment (Admin form, bulk import, server-side save) ──────────
 * A product carries AT MOST ONE registry club tag. These helpers touch only
 * recognized club tags; every other tag (home, away, retro, Retro, …) keeps
 * its exact value, case and position. Mirrored verbatim in
 * supabase/functions/_shared/clubs.ts — keep both copies identical. */

/** True when `tag` is a registry club tag (any case, surrounding spaces). */
export function isClubTag(tag: unknown): boolean {
  return clubForTag(tag) !== undefined;
}

/**
 * Returns a NEW tags array with the product's club set to `club`: every
 * recognized club tag (any case) is removed, every other string tag is kept
 * unchanged and in order, then the canonical tag of `club` is appended.
 * `club` of "" / null / undefined (or only spaces) clears the club.
 *
 * Unknown club: THROWS an Error whose message is `unknown club "<value>"` —
 * an unrecognized club is a caller bug or bad input, never silently dropped.
 * Non-array `tags` is treated as []; non-string entries are dropped.
 */
export function setProductClubTag(tags: unknown, club: unknown): string[] {
  const kept = (Array.isArray(tags) ? tags : []).filter((t): t is string => typeof t === "string" && !isClubTag(t));
  const wanted = normalizeClubTag(club);
  if (!wanted) return kept;
  const found = clubForTag(wanted);
  if (!found) throw new Error(`unknown club "${typeof club === "string" ? club.trim() : String(club)}"`);
  return [...kept, found.tag];
}

export interface NormalizedProductTags {
  tags: string[];
  /** Set when the tags name more than one DISTINCT registry club. */
  error?: "multiple_clubs";
}

/**
 * Server-side normalization of a saved product's `tags`: non-array gives [];
 * non-string entries are dropped; recognized club tags are rewritten to their
 * canonical lowercase tag (a repeat of the same club is kept once, at its
 * first position); every other tag is untouched. More than one distinct
 * club gives `error: "multiple_clubs"` — the caller must refuse the save.
 */
export function normalizeProductTags(tags: unknown): NormalizedProductTags {
  const out: string[] = [];
  const clubs = new Set<string>();
  for (const t of Array.isArray(tags) ? tags : []) {
    if (typeof t !== "string") continue;
    const club = clubForTag(t);
    if (!club) out.push(t);
    else if (!clubs.has(club.tag)) {
      clubs.add(club.tag);
      out.push(club.tag);
    }
  }
  return clubs.size > 1 ? { tags: out, error: "multiple_clubs" } : { tags: out };
}

/**
 * The optional `club` column of a supplier-import row. Blank or missing
 * means no club (`tags: []`); a registry tag in any case, with surrounding
 * spaces, gives `[canonicalTag]`; anything else is a row error naming the
 * value, like an unknown badge code.
 */
export function parseImportedClub(row: Record<string, unknown>): { tags: string[]; errors: string[] } {
  const raw = typeof row.club === "string" ? row.club.trim() : "";
  if (!raw) return { tags: [], errors: [] };
  const club = clubForTag(raw);
  if (!club) return { tags: [], errors: [`unknown club "${raw}" — use one of: ${CLUBS.map((c) => c.tag).join(", ")}`] };
  return { tags: [club.tag], errors: [] };
}
