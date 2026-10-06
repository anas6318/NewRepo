/**
 * Checkout idempotency — the pure decision logic behind "one checkout
 * attempt creates at most one order" (A2-S3, shared contract §Idempotency).
 *
 * The browser generates a UUID v4 once per checkout attempt and sends it as
 * `idempotencyKey`. place-order stores it in `orders.idempotency_key` (UNIQUE
 * via `orders_idempotency_key_uidx`, migration 0007) and, together with a
 * hash of the request, in `data.idempotency = { key, requestHash }`.
 *
 * A second request with the same key is then:
 *   - a REPLAY when it is the same order (same request hash) from the same
 *     contact → the stored order is returned (sanitized), no side effects;
 *   - a CONFLICT otherwise → 409, revealing nothing about the stored order.
 * No key at all is the legacy path: the order is created exactly as before.
 *
 * Pure: no Deno, no fetch, no crypto, no database. Hashing is done by the
 * caller (Web Crypto SHA-256 in the edge function); this module
 * only builds the canonical text that is hashed. It runs under Node, so the
 * unit tests and the demo service use it directly.
 */
import { CUSTOMER_KEYS, PERSONALIZATION_KEYS } from "./order-pricing.ts";

/** RFC 4122 version-4 UUID (what the Web Crypto `randomUUID()` produces). */
export const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The unique index F4 created on `orders.idempotency_key`. */
export const IDEMPOTENCY_UNIQUE_INDEX = "orders_idempotency_key_uidx";

/**
 * `undefined`/`null` → no key (legacy path). A well-formed UUID v4 → the key,
 * lower-cased so two spellings of one UUID can never become two orders.
 * Anything else (wrong type, empty, not a v4 UUID) → invalid.
 */
export function parseIdempotencyKey(raw: unknown): { ok: true; key?: string } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(raw)) return { ok: false };
  return { ok: true, key: raw.toLowerCase() };
}

/* ── canonical request ─────────────────────────────────────────────────── */

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const trimmed = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);

export interface CanonicalOrderLine {
  productId: string | null;
  version: string | null;
  sleeve: string | null;
  size: string | null;
  personalization: { name: string | null; number: string | null } | null;
  badgeId: string | null;
  quantity: number | null;
}

export interface CanonicalOrderRequest {
  /** Bumped if the canonical form ever changes (old keys then conflict
   * instead of silently matching a different shape). */
  v: 1;
  locale: string | null;
  customer: Record<(typeof CUSTOMER_KEYS)[number], string | null>;
  zoneId: string | null;
  paymentMethod: string | null;
  lines: CanonicalOrderLine[];
  marketingConsent: boolean;
}

/**
 * The fields that define an order, normalized the way place-order reads
 * them: customer fields allowlisted and trimmed (as `sanitizeCustomer`),
 * personalization allowlisted and trimmed with empties dropped (as
 * `sanitizePersonalization`), `patchId` folded into `badgeId`, the consent
 * flag read by truthiness (as the handler does). Unknown keys — including
 * `idempotencyKey` itself — never contribute. Line order is kept: it is the
 * order the lines are stored in.
 */
export function canonicalOrderRequest(rawBody: unknown): CanonicalOrderRequest {
  const body = isBag(rawBody) ? rawBody : {};
  const rawCustomer = isBag(body.customer) ? body.customer : {};
  const customer = {} as CanonicalOrderRequest["customer"];
  for (const k of CUSTOMER_KEYS) {
    const t = trimmed(rawCustomer[k]);
    // notes: absent, null and "" all mean "no notes" (as in the core).
    customer[k] = k === "notes" && t === "" ? null : t;
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  return {
    v: 1,
    locale: str(body.locale),
    customer,
    zoneId: str(body.zoneId),
    paymentMethod: str(body.paymentMethod),
    lines: lines.map((raw): CanonicalOrderLine => {
      const l = isBag(raw) ? raw : {};
      let personalization: CanonicalOrderLine["personalization"] = null;
      if (isBag(l.personalization)) {
        const p = { name: null, number: null } as { name: string | null; number: string | null };
        for (const k of PERSONALIZATION_KEYS) {
          const t = trimmed(l.personalization[k]);
          p[k] = t === "" ? null : t;
        }
        personalization = p.name === null && p.number === null ? null : p;
      }
      return {
        productId: str(l.productId),
        version: str(l.version),
        sleeve: str(l.sleeve),
        size: str(l.size),
        personalization,
        badgeId: str(l.badgeId) ?? str(l.patchId),
        quantity: typeof l.quantity === "number" && Number.isFinite(l.quantity) ? l.quantity : null,
      };
    }),
    marketingConsent: !!body.marketingConsent,
  };
}

/** JSON with object keys sorted at every level — one text per value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  if (isBag(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The exact text whose SHA-256 is the stored `requestHash`. */
export function requestHashInput(rawBody: unknown): string {
  return canonicalJson(canonicalOrderRequest(rawBody));
}

/* ── decision ──────────────────────────────────────────────────────────── */

export interface IdempotencyRecord {
  /** `data.idempotency.requestHash` of the stored order. */
  requestHash: unknown;
  /** `orders.contact_hash` of the stored order. */
  contactHash: unknown;
}

export type ReplayDecision = "create" | "replay" | "conflict";

/**
 * - no order holds the key → create;
 * - it does, same request AND same contact → replay (return that order);
 * - anything else → conflict. A different contact is always a conflict, so a
 *   key can never be used to read someone else's order; a stored order
 *   without a readable hash is a conflict too (fail closed).
 */
export function decideReplay(input: { existing: IdempotencyRecord | null; requestHash: string; contactHash: string }): ReplayDecision {
  const { existing } = input;
  if (!existing) return "create";
  if (typeof existing.requestHash !== "string" || typeof existing.contactHash !== "string") return "conflict";
  if (existing.requestHash !== input.requestHash) return "conflict";
  if (existing.contactHash !== input.contactHash) return "conflict";
  return "replay";
}

/**
 * Did an insert fail because another request already stored this key? The
 * helpers' `dbInsert` throws `db insert failed: <status> <PostgREST body>`,
 * and PostgREST reports a unique violation (SQLSTATE 23505) with the
 * constraint name in the message. Only THIS index counts — any other
 * failure (including an order-number collision) is re-thrown.
 */
export function isIdempotencyUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return msg.includes(IDEMPOTENCY_UNIQUE_INDEX);
}

/**
 * Small synchronous NON-cryptographic fingerprint (cyrb53 ×2 → 28 hex
 * chars). Used where no secret is involved and an async digest would add
 * an await: the demo service's in-memory request hash (so its placeOrder
 * stays race-free) and the browser's "is this still the same attempt?"
 * check. The edge function uses SHA-256 instead.
 */
export function quickFingerprint(text: string): string {
  const h = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  };
  return `${h(0)}${h(0x9e3779b9)}`;
}
