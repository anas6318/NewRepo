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
 * A club entry. Clubs are NOT a data model — they are saved searches over the
 * existing catalog index, which already matches product names (ar/he/en),
 * category, era, season and tags. `/shop?q=barcelona` is a real, working
 * route today; nothing new has to be stored.
 */
export interface NavClub {
  id: string;
  /**
   * Query string passed to /shop?q=. Deliberately kept in ENGLISH even on the
   * Arabic and Hebrew menus: it is matched against the catalog index, and
   * product names are far more reliably English than transliterated. The
   * label the customer reads is localized; the query behind it is not.
   */
  query: string;
  /** Localized display name — an Arabic menu must not sprout Latin text. */
  label: LocalizedText;
}

/**
 * CURATED CLUB LIST — EDIT THIS TO MATCH THE LIVE CATALOG.
 *
 * Kept short on purpose: a wall of clubs is worse than six good ones. Each
 * entry must correspond to products that genuinely exist, or the link leads
 * to an empty result page. Verify against the live catalog before launch and
 * remove anything that returns nothing — `tests/e2e/26-navigation-media.e2e.mjs`
 * asserts every club link resolves to a working page, but it cannot know
 * which clubs YOUR catalog stocks.
 */
export const SHOP_BY_CLUB: NavClub[] = [
  { id: "barcelona", query: "barcelona", label: { ar: "برشلونة", he: "ברצלונה", en: "Barcelona" } },
  { id: "real-madrid", query: "real madrid", label: { ar: "ريال مدريد", he: "ריאל מדריד", en: "Real Madrid" } },
  // Full club names: "milan" also matches Inter, "manchester" also matches City.
  { id: "ac-milan", query: "ac milan", label: { ar: "إيه سي ميلان", he: "מילאן", en: "AC Milan" } },
  { id: "manchester-united", query: "manchester united", label: { ar: "مانشستر يونايتد", he: "מנצ׳סטר יונייטד", en: "Manchester United" } },
  { id: "liverpool", query: "liverpool", label: { ar: "ليفربول", he: "ליברפול", en: "Liverpool" } },
];

/** Where "All Clubs & Teams" goes — the full catalog, unfiltered. */
export const ALL_CLUBS_PATH = "/shop";

/**
 * The FOOTBALL menu: the primary shopping hierarchy.
 *
 * Every path is an existing route — /shop supports ?sort= and ?q= through the
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
  return SHOP_BY_CLUB.map((c) => ({ id: c.id, label: c.label, path: `/shop?q=${encodeURIComponent(c.query)}` }));
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
