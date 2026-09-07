/**
 * Badge / patch options — pure resolution logic. No I/O, no framework
 * imports, no hard-coded prices: every price, name and availability decision
 * comes from the owner-managed catalog plus per-product settings.
 *
 * The same rules are mirrored (deliberately, since Deno edge functions cannot
 * import from `src/`) in supabase/functions/place-order/index.ts. Any change
 * here must be made there too — tests/unit/badges.test.ts documents the
 * contract both sides implement.
 */
import type { BadgeOption, BadgeSnapshot, LocalizedText, Product, ProductBadgeSetting, ResolvedBadge } from "../services/types.ts";

export type Locale = "ar" | "he" | "en";

/** Reasons a badge selection is refused. Surfaced as `errors.<code>` keys. */
export type BadgeRejection = "unknown_badge" | "badge_inactive" | "badge_not_enabled" | "badge_price_invalid" | "badge_required";

export class BadgeError extends Error {
  readonly reason: BadgeRejection;
  constructor(reason: BadgeRejection) {
    super(reason);
    this.reason = reason;
  }
}

/** Upgrades a stored option to the current shape. Rows written before the
 * 0004 migration have only `{id, name, priceIls, active}`; they keep working
 * with their own stored price — the ₪5 legacy value lives in data, not code. */
export function normalizeBadgeOption(raw: Partial<BadgeOption> & { id: string; name: LocalizedText; priceIls: number }, index = 0): BadgeOption {
  return {
    id: raw.id,
    code: (raw.code ?? raw.id).trim(),
    name: raw.name,
    ...(raw.description ? { description: raw.description } : {}),
    priceIls: raw.priceIls,
    active: raw.active ?? true,
    sortOrder: Number.isFinite(raw.sortOrder) ? (raw.sortOrder as number) : index,
    ...(raw.iconUrl ? { iconUrl: raw.iconUrl } : {}),
    ...(raw.supplierReference ? { supplierReference: raw.supplierReference } : {}),
  };
}

/** Removes the internal supplier reference from a copy of the value, leaving
 * every customer-facing field untouched. The original is never mutated.
 *
 * Written as a delete on a shallow copy rather than a discarded destructure
 * so that excluding the field does not require binding it to a throwaway
 * variable. Both public views below share this one implementation, so there
 * is a single place where the admin/customer boundary is enforced. */
function stripSupplierReference<T extends { supplierReference?: string }>(value: T): T {
  const copy = { ...value };
  delete copy.supplierReference;
  return copy;
}

/** Strips internal fields. Every public/customer-facing read goes through
 * this — the supplier reference must never leave the admin boundary. */
export function toPublicBadge(badge: BadgeOption): BadgeOption {
  return stripSupplierReference(badge);
}

export function sortBadges<T extends { sortOrder?: number; name: LocalizedText }>(badges: T[]): T[] {
  return [...badges].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.en.localeCompare(b.name.en));
}

/** Per-product settings, upgrading legacy `patchIds` when `badges` is absent.
 * A legacy product keeps exactly the options it already had, at the global
 * price — migration behaviour, expressed as data rather than a constant. */
export function productBadgeSettings(product: Pick<Product, "badges" | "patchIds">): ProductBadgeSetting[] {
  if (product.badges) return product.badges;
  return (product.patchIds ?? []).map((badgeId) => ({ badgeId, enabled: true }));
}

/** True unless the owner explicitly required a badge on this product. */
export function allowsNoBadge(product: Pick<Product, "allowNoBadge">): boolean {
  return product.allowNoBadge !== false;
}

/** Resolves the price for one product/badge pair: product override first,
 * otherwise the global default. Never negative. */
function resolvePrice(badge: BadgeOption, setting: ProductBadgeSetting | undefined): number {
  const override = setting?.priceOverrideIls;
  const price = typeof override === "number" && Number.isFinite(override) ? override : badge.priceIls;
  if (!Number.isFinite(price) || price < 0) throw new BadgeError("badge_price_invalid");
  return price;
}

/** Every badge the customer may pick on this product, ordered, with prices
 * already resolved. Inactive options and options the product does not enable
 * are omitted entirely, so they can never be selected. */
export function resolveProductBadges(product: Pick<Product, "badges" | "patchIds">, catalog: BadgeOption[]): ResolvedBadge[] {
  const byId = new Map(catalog.map((b) => [b.id, b]));
  const ordered: (ResolvedBadge & { sortOrder: number })[] = [];
  for (const setting of productBadgeSettings(product)) {
    if (!setting.enabled) continue;
    const badge = byId.get(setting.badgeId);
    if (!badge || !badge.active) continue;
    let priceIls: number;
    try {
      priceIls = resolvePrice(badge, setting);
    } catch {
      continue; // a corrupt price hides the option rather than mispricing it
    }
    ordered.push({
      id: badge.id,
      code: badge.code,
      name: badge.name,
      ...(badge.description ? { description: badge.description } : {}),
      priceIls,
      ...(badge.iconUrl ? { iconUrl: badge.iconUrl } : {}),
      priceSource: typeof setting.priceOverrideIls === "number" ? "override" : "global",
      ...(badge.supplierReference ? { supplierReference: badge.supplierReference } : {}),
      sortOrder: badge.sortOrder,
    });
  }
  return sortBadges(ordered).map(({ sortOrder: _drop, ...badge }) => badge);
}

export type BadgeSelection = { ok: true; badge?: ResolvedBadge } | { ok: false; error: BadgeRejection };

/**
 * Authoritative validation of a customer's badge choice. The caller supplies
 * only an id — never a price — so a fabricated or tampered price in the
 * browser can have no effect on what is charged.
 */
export function resolveBadgeSelection(product: Pick<Product, "badges" | "patchIds" | "allowNoBadge">, catalog: BadgeOption[], badgeId?: string): BadgeSelection {
  if (!badgeId) {
    return allowsNoBadge(product) ? { ok: true } : { ok: false, error: "badge_required" };
  }
  const known = catalog.find((b) => b.id === badgeId);
  if (!known) return { ok: false, error: "unknown_badge" };
  if (!known.active) return { ok: false, error: "badge_inactive" };
  const setting = productBadgeSettings(product).find((s) => s.badgeId === badgeId);
  if (!setting?.enabled) return { ok: false, error: "badge_not_enabled" };
  let priceIls: number;
  try {
    priceIls = resolvePrice(known, setting);
  } catch {
    return { ok: false, error: "badge_price_invalid" };
  }
  return {
    ok: true,
    badge: {
      id: known.id,
      code: known.code,
      name: known.name,
      ...(known.description ? { description: known.description } : {}),
      priceIls,
      ...(known.iconUrl ? { iconUrl: known.iconUrl } : {}),
      priceSource: typeof setting.priceOverrideIls === "number" ? "override" : "global",
      ...(known.supplierReference ? { supplierReference: known.supplierReference } : {}),
    },
  };
}

/** Freezes what was sold into the order item. Later catalog edits cannot
 * reach back into this. */
export function badgeSnapshot(badge: ResolvedBadge, locale: Locale): BadgeSnapshot {
  return {
    badgeId: badge.id,
    code: badge.code,
    name: badge.name,
    label: badge.name[locale] || badge.name.en,
    priceIls: badge.priceIls,
    ...(badge.supplierReference ? { supplierReference: badge.supplierReference } : {}),
  };
}

/** Customer-facing view of an order/cart snapshot. */
export function toPublicBadgeSnapshot(snapshot: BadgeSnapshot): BadgeSnapshot {
  return stripSupplierReference(snapshot);
}

/** Formats the adjustment for inclusion in a plain text summary line. The
 * isolate characters keep "+₪10" reading left-to-right inside Arabic and
 * Hebrew sentences without needing a `<bdi>` element. */
export function formatBadgeAdjustment(priceIls: number): string {
  return priceIls > 0 ? `⁦+₪${priceIls}⁩` : "";
}

/** Whether a badge option can be deleted without corrupting order history.
 * Orders keep their own snapshot, so history is never rewritten — but an
 * option still referenced by an open order stays visible to the owner. */
export function badgeDeletionBlockers(badgeId: string, orders: { orderNumber: string; items: { badge?: BadgeSnapshot; patchId?: string }[] }[]): string[] {
  return orders.filter((o) => o.items.some((i) => i.badge?.badgeId === badgeId || i.patchId === badgeId)).map((o) => o.orderNumber);
}

/**
 * Supplier-import columns. `badge_codes` is a `|`-separated list of internal
 * codes; `badge_price_overrides` is `code:price` pairs. Imports may only
 * reference options the owner already created — untrusted supplier text
 * never creates a global badge, and unknown codes are reported rather than
 * silently dropped.
 */
export function parseImportedBadges(row: Record<string, string>, catalog: BadgeOption[]): { settings: ProductBadgeSetting[]; errors: string[] } {
  const errors: string[] = [];
  const byCode = new Map(catalog.map((b) => [b.code.toLowerCase(), b]));
  const codes = (row.badge_codes ?? "")
    .split(/[|,]/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  const overrides = new Map<string, number>();
  for (const pair of (row.badge_price_overrides ?? "").split(/[|,]/).map((p) => p.trim()).filter(Boolean)) {
    const [rawCode, rawPrice] = pair.split(":");
    const code = (rawCode ?? "").trim().toLowerCase();
    const priceText = (rawPrice ?? "").trim();
    const price = Number(priceText);
    if (!code || priceText === "" || !Number.isFinite(price)) {
      errors.push(`invalid badge price override "${pair}" — expected code:price`);
      continue;
    }
    if (price < 0) {
      errors.push(`negative badge price override for "${code}"`);
      continue;
    }
    if (!codes.includes(code)) {
      errors.push(`badge price override for "${code}" which is not in badge_codes`);
      continue;
    }
    overrides.set(code, price);
  }

  const settings: ProductBadgeSetting[] = [];
  for (const code of codes) {
    const badge = byCode.get(code);
    if (!badge) {
      errors.push(`unknown badge code "${code}" — create it under Badge / patch options first`);
      continue;
    }
    const override = overrides.get(code);
    settings.push({ badgeId: badge.id, enabled: true, ...(override === undefined ? {} : { priceOverrideIls: override }) });
  }
  return { settings, errors };
}

/** Validation shared by Admin and the server before a catalog is stored. */
export function validateBadgeCatalog(badges: BadgeOption[]): string[] {
  const errors: string[] = [];
  const seenId = new Set<string>();
  const seenCode = new Set<string>();
  for (const b of badges) {
    if (!b.id?.trim()) errors.push("Every badge needs an id.");
    if (!b.code?.trim()) errors.push(`Badge "${b.id}" needs an internal code.`);
    if (!b.name?.en?.trim() || !b.name?.ar?.trim() || !b.name?.he?.trim()) errors.push(`Badge "${b.code || b.id}" needs a name in all three languages.`);
    if (!Number.isFinite(b.priceIls) || b.priceIls < 0) errors.push(`Badge "${b.code || b.id}" needs a price of ₪0 or more.`);
    if (seenId.has(b.id)) errors.push(`Duplicate badge id "${b.id}".`);
    if (seenCode.has(b.code)) errors.push(`Duplicate badge code "${b.code}".`);
    seenId.add(b.id);
    seenCode.add(b.code);
  }
  return errors;
}
