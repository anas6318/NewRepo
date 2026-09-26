/**
 * Navigation content — the single typed source of truth consumed by both
 * DesktopNavigation and MobileNavigation (no duplicated menu data).
 *
 * `labelKey` values are i18n dictionary keys (src/lib/i18n/{ar,he,en}.json)
 * so every rendered label is fully translated in all three languages.
 * `path` values are locale-less; components prefix the active locale.
 *
 * Future Supabase compatibility: this module mirrors the intended
 * `navigation_items` / `navigation_groups` tables. Replacing these constants
 * with fetched rows requires no changes to the presentation components,
 * which receive plain `NavItem[]` / `NavGroup[]` data.
 */

import type { LocalizedText } from "../services/types.ts";
import { clubForTag, clubShopPath } from "../lib/clubs.ts";

export interface NavItem {
  /** Stable identifier (doubles as React key). */
  id: string;
  /** i18n dictionary key for the visible label. */
  labelKey: string;
  /** Locale-less route path (must exist in StorefrontApp's route table). */
  path: string;
}

export interface NavGroup {
  id: string;
  /** i18n dictionary key for the group heading. */
  labelKey: string;
  items: NavItem[];
}

/** Primary links shown inline in the desktop bar, beside the FOOTBALL menu.
 * Deliberately short: the shopping hierarchy lives inside FOOTBALL now, so
 * individual categories no longer compete with each other for attention. */
export const PRIMARY_NAV: NavItem[] = [
  { id: "hoodies", labelKey: "nav.hoodies", path: "/category/hoodies" },
  { id: "kids", labelKey: "nav.kids", path: "/category/kids" },
];

/**
 * A Shop by Club menu entry. Clubs are NOT a data model — they are tag
 * filters over the existing catalog: `/shop?club=<tag>` keeps only products
 * whose `tags` include that club tag (src/services/catalog.ts). Tag and label
 * come from the club registry (src/lib/clubs.ts).
 */
export interface NavClub {
  id: string;
  /**
   * The club's canonical product tag (registry), passed to /shop?club=. This
   * alone decides which products match; it is never shown to customers.
   */
  tag: string;
  /** Localized display name only — it never affects matching. An Arabic menu
   * must not sprout Latin text. */
  label: LocalizedText;
}

/**
 * CURATED MENU — which registry clubs appear under Shop by Club, in order.
 *
 * Kept short on purpose: a wall of clubs is worse than six good ones. Tags
 * and labels live in the club registry (src/lib/clubs.ts, verified against a
 * live-catalog snapshot taken 2026-09-26); a tag listed here that is missing
 * from the registry fails at module load. `tests/e2e/26-navigation-media.e2e.mjs`
 * asserts every club link resolves to a working page, but it cannot know
 * which clubs YOUR catalog stocks.
 */
const MENU_CLUBS: [id: string, tag: string][] = [
  ["barcelona", "barcelona"],
  ["real-madrid", "real-madrid"],
  ["ac-milan", "ac-milan"],
  ["manchester-united", "manunited"],
  ["liverpool", "liverpool"],
];

export const SHOP_BY_CLUB: NavClub[] = MENU_CLUBS.map(([id, tag]) => {
  const club = clubForTag(tag);
  if (!club) throw new Error(`navigation: club tag "${tag}" is not in the club registry`);
  return { id, tag: club.tag, label: club.label };
});

/** Where "All Clubs & Teams" goes — the full catalog, unfiltered. */
export const ALL_CLUBS_PATH = "/shop";

/**
 * The FOOTBALL menu: the primary shopping hierarchy.
 *
 * Every path is an existing route — /shop supports ?sort=, ?q= and ?club= through the
 * shared catalog filter machinery, and each /category/… slug is already in
 * StorefrontApp's route table.
 */
export const SHOP_MENU: NavGroup[] = [
  {
    id: "football",
    labelKey: "nav.football",
    items: [
      { id: "shop-all", labelKey: "nav.shopAll", path: "/shop" },
      { id: "current-season", labelKey: "nav.currentSeason", path: "/category/current-season" },
      { id: "retro", labelKey: "nav.retro", path: "/category/retro" },
      { id: "national-teams", labelKey: "nav.nationalTeams", path: "/category/national-teams" },
      { id: "fan-version", labelKey: "nav.fanVersion", path: "/category/fan-version" },
      { id: "player-version", labelKey: "nav.playerVersion", path: "/category/player-version" },
    ],
  },
  {
    id: "more",
    labelKey: "nav.more",
    items: [
      { id: "hoodies", labelKey: "nav.hoodies", path: "/category/hoodies" },
      { id: "long-sleeve", labelKey: "nav.longSleeve", path: "/category/long-sleeve" },
      { id: "kids", labelKey: "nav.kids", path: "/category/kids" },
      { id: "new-arrivals", labelKey: "nav.newArrivals", path: "/shop?sort=newest" },
    ],
  },
];

/** Club links as ordinary items, for the menus that render flat lists. */
export function clubNavItems(): { id: string; label: LocalizedText; path: string }[] {
  return SHOP_BY_CLUB.map((c) => ({ id: c.id, label: c.label, path: clubShopPath(c.tag) }));
}

/** The menu club whose tag matches `tag` once registry-normalized (trimmed,
 * case-insensitive), for showing its localized label. */
export function clubByTag(tag: string | null | undefined): NavClub | undefined {
  const club = clubForTag(tag);
  return club ? SHOP_BY_CLUB.find((c) => c.tag === club.tag) : undefined;
}

/**
 * Customer Care. Secondary to shopping by design: rendered in the slim
 * utility bar on desktop and in a visually quieter section of the mobile
 * menu. Every route already exists — nothing here is rebuilt.
 */
export const UTILITY_NAV: NavItem[] = [
  { id: "track-order", labelKey: "nav.trackOrder", path: "/track" },
  { id: "size-guide", labelKey: "nav.sizeGuide", path: "/size-guide" },
  { id: "delivery", labelKey: "nav.delivery", path: "/delivery" },
  { id: "faq", labelKey: "nav.faq", path: "/faq" },
  { id: "contact", labelKey: "nav.contact", path: "/contact" },
  { id: "about", labelKey: "nav.about", path: "/about" },
];

/** Flat shopping list for the mobile menu, mirroring the FOOTBALL group. */
export const MOBILE_SHOP_NAV: NavItem[] = [
  { id: "shop-all", labelKey: "nav.shopAll", path: "/shop" },
  { id: "current-season", labelKey: "nav.currentSeason", path: "/category/current-season" },
  { id: "retro", labelKey: "nav.retro", path: "/category/retro" },
  { id: "national-teams", labelKey: "nav.nationalTeams", path: "/category/national-teams" },
  { id: "fan-version", labelKey: "nav.fanVersion", path: "/category/fan-version" },
  { id: "player-version", labelKey: "nav.playerVersion", path: "/category/player-version" },
  { id: "hoodies", labelKey: "nav.hoodies", path: "/category/hoodies" },
  { id: "long-sleeve", labelKey: "nav.longSleeve", path: "/category/long-sleeve" },
  { id: "kids", labelKey: "nav.kids", path: "/category/kids" },
];
