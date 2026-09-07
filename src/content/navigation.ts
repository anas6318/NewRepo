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

/** Primary categories shown inline in the desktop navigation (after Shop). */
export const PRIMARY_NAV: NavItem[] = [
  { id: "retro", labelKey: "nav.retro", path: "/category/retro" },
  { id: "current-season", labelKey: "nav.currentSeason", path: "/category/current-season" },
  { id: "national-teams", labelKey: "nav.nationalTeams", path: "/category/national-teams" },
  { id: "hoodies", labelKey: "nav.hoodies", path: "/category/hoodies" },
  { id: "kids", labelKey: "nav.kids", path: "/category/kids" },
];

/**
 * The "Shop" dropdown. Every path is an existing, working route:
 * /shop supports ?sort=newest via the shared catalog filter machinery.
 */
export const SHOP_MENU: NavGroup[] = [
  {
    id: "shop",
    labelKey: "nav.shop",
    items: [
      { id: "shop-all", labelKey: "nav.shopAll", path: "/shop" },
      { id: "new-arrivals", labelKey: "nav.newArrivals", path: "/shop?sort=newest" },
    ],
  },
  {
    id: "jerseys",
    labelKey: "nav.jerseys",
    items: [
      { id: "retro", labelKey: "nav.retro", path: "/category/retro" },
      { id: "current-season", labelKey: "nav.currentSeason", path: "/category/current-season" },
      { id: "national-teams", labelKey: "nav.nationalTeams", path: "/category/national-teams" },
      { id: "player-version", labelKey: "nav.playerVersion", path: "/category/player-version" },
      { id: "fan-version", labelKey: "nav.fanVersion", path: "/category/fan-version" },
    ],
  },
  {
    id: "more",
    labelKey: "nav.more",
    items: [
      { id: "hoodies", labelKey: "nav.hoodies", path: "/category/hoodies" },
      { id: "long-sleeve", labelKey: "nav.longSleeve", path: "/category/long-sleeve" },
      { id: "kids", labelKey: "nav.kids", path: "/category/kids" },
    ],
  },
];

/**
 * Customer-service links. Rendered in the slim utility bar on desktop and in
 * the mobile menu's utility section — Track Order lives here so it no longer
 * competes with product categories in the primary navigation.
 */
export const UTILITY_NAV: NavItem[] = [
  { id: "track-order", labelKey: "nav.trackOrder", path: "/track" },
  { id: "size-guide", labelKey: "nav.sizeGuide", path: "/size-guide" },
  { id: "about", labelKey: "nav.about", path: "/about" },
  { id: "contact", labelKey: "nav.contact", path: "/contact" },
];

/** Flat category list for the mobile menu's shopping section. */
export const MOBILE_SHOP_NAV: NavItem[] = [
  { id: "shop-all", labelKey: "nav.shopAll", path: "/shop" },
  { id: "new-arrivals", labelKey: "nav.newArrivals", path: "/shop?sort=newest" },
  ...PRIMARY_NAV,
  { id: "player-version", labelKey: "nav.playerVersion", path: "/category/player-version" },
  { id: "fan-version", labelKey: "nav.fanVersion", path: "/category/fan-version" },
  { id: "long-sleeve", labelKey: "nav.longSleeve", path: "/category/long-sleeve" },
];
