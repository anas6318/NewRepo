/**
 * Shipping-zone rules shared by the admin-actions edge function.
 *
 * Kept in its own Deno-agnostic module (no top-level Deno access, no fetch at
 * import time) so tests/unit/shipping-zones.test.ts exercises THIS code under
 * Node rather than a copy of it.
 *
 * Why the bounds are wide: their only job is to catch a fat-finger entry
 * (a missing decimal point, a price of 0). CROWNED's real zones already span
 * ₪40–₪60 — Nazareth & Surroundings ₪40, Haifa ₪40, North ₪55, Jerusalem &
 * Hebron ₪60, South ₪60 — and the previous ceiling of ₪55 rejected two of
 * them outright. Pricing itself is configuration, not a constant in code, so
 * this range must not be tightened to whatever today's maximum happens to be.
 */

export const ZONE_PRICE_MIN_ILS = 35;
export const ZONE_PRICE_MAX_ILS = 200;

export type ZonePriceProblem = "not_a_number" | "out_of_range";

/**
 * Validates a zone's delivery price. An ABSENT price is not an error — the
 * save-zones action is also used to toggle `active` without touching pricing.
 */
export function zonePriceProblem(raw: unknown): ZonePriceProblem | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const price = Number(raw);
  if (!Number.isFinite(price)) return "not_a_number";
  if (price < ZONE_PRICE_MIN_ILS || price > ZONE_PRICE_MAX_ILS) return "out_of_range";
  return undefined;
}

/**
 * Whether a PostgREST write response means "no row matched".
 *
 * This is the bug that was hot-fixed live and had to come back to source: a
 * successful PATCH returns 204 with an EMPTY body unless representation is
 * requested, so treating an empty body as "row missing" made every successful
 * update trigger a follow-up INSERT — a duplicate-key error on the second
 * save of the same zone. Only an explicit empty ARRAY from a
 * `return=representation` response means nothing matched.
 */
export function patchMatchedNoRows(status: number, body: string): boolean {
  if (status === 204) return false; // success, body intentionally empty
  const trimmed = body.trim();
  if (!trimmed) return false; // empty body is not evidence of a missing row
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}
