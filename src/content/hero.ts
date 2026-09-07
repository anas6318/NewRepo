/**
 * Hero content — temporary, editable configuration for the homepage hero.
 *
 * All visible copy lives in the i18n dictionaries (referenced by key here)
 * so the hero is fully translated in ar/he/en. Edit the copy in
 * src/lib/i18n/{ar,he,en}.json under home.hero* ; edit routes, images,
 * alignment and overlay strength here.
 *
 * Future Supabase compatibility: this shape mirrors the intended
 * `hero_banners` table. `HeroSection` receives a `HeroBanner` via props and
 * performs no data fetching, so swapping this constant for a fetched row
 * requires no changes to the component.
 */

export type HeroAlignment = "start" | "center";
export type HeroOverlay = "soft" | "medium" | "strong";

export interface HeroCta {
  /** i18n dictionary key for the button label. */
  labelKey: string;
  /** Locale-less route path (prefixed with the active locale at render). */
  path: string;
}

export interface HeroImageSources {
  /** Image used at desktop/tablet widths. */
  desktopSrc: string;
  /** Image used at narrow (mobile) widths. */
  mobileSrc: string;
  /** i18n key for the accessible image description. */
  altKey: string;
  /** Intrinsic size of the desktop asset — reserves space (no CLS). */
  width: number;
  height: number;
}

export interface HeroBanner {
  id: string;
  eyebrowKey: string;
  headlineKey: string;
  descriptionKey: string;
  primaryCta: HeroCta;
  secondaryCta?: HeroCta;
  image: HeroImageSources;
  /** Horizontal placement of the text block. */
  align: HeroAlignment;
  /** Strength of the dark overlay that guarantees text contrast. */
  overlay: HeroOverlay;
}

/**
 * Temporary hero content until final photography is supplied.
 * The image is the existing local placeholder asset — swap
 * desktopSrc/mobileSrc for the final files when they exist.
 */
export const HOME_HERO: HeroBanner = {
  id: "home-hero",
  eyebrowKey: "home.heroEyebrow",
  headlineKey: "home.heroHeadline",
  descriptionKey: "home.heroDescription",
  primaryCta: { labelKey: "home.heroPrimaryCta", path: "/category/retro" },
  secondaryCta: { labelKey: "home.heroSecondaryCta", path: "/shop" },
  image: {
    desktopSrc: "/demo/hero.webp",
    mobileSrc: "/demo/hero.webp",
    altKey: "home.heroImageAlt",
    width: 1920,
    height: 1080,
  },
  align: "start",
  overlay: "medium",
};
