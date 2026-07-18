/** Shared catalog filtering/sorting — used by both data services. */
import type { CategoryDef, Product, ProductFilters } from "./types.ts";

/** Facet categories are shortcuts over the whole catalog rather than
 * exclusive containers (a player-version current-season shirt appears in
 * both "Current Season" and "Player Version"). */
export function filtersForCategory(slug: string): ProductFilters {
  switch (slug) {
    case "player-version":
      return { version: "player" };
    case "fan-version":
      return { version: "fan" };
    case "national-teams":
      return { national: true };
    case "long-sleeve":
      return { sleeve: "long" };
    default:
      return { category: slug };
  }
}

export function filterProducts(products: Product[], f: ProductFilters, _categories: CategoryDef[]): Product[] {
  let out = products.filter((p) => p.status !== "draft" && p.status !== "archived");

  if (f.category) {
    const derived = filtersForCategory(f.category);
    if (derived.category) out = out.filter((p) => p.categorySlug === derived.category);
    else out = filterProducts(out, { ...derived, category: undefined }, _categories);
  }
  if (f.version) out = out.filter((p) => p.versions.some((v) => v.version === f.version) || (f.version === "retro" && p.categorySlug === "retro"));
  if (f.size) out = out.filter((p) => p.sizes.includes(f.size ?? ""));
  if (f.sleeve) out = out.filter((p) => p.sleeves.includes(f.sleeve ?? "short") || (f.sleeve === "long" && p.categorySlug === "long-sleeve"));
  if (f.audience) out = out.filter((p) => (f.audience === "kids" ? p.kids : !p.kids));
  if (f.era) out = out.filter((p) => p.era === f.era);
  if (f.season) out = out.filter((p) => p.season === f.season);
  if (f.national !== undefined) out = out.filter((p) => p.nationalTeam === f.national);
  if (f.personalizable !== undefined) out = out.filter((p) => p.personalizable === f.personalizable);
  if (f.status) out = out.filter((p) => p.status === f.status);
  if (f.featured !== undefined) out = out.filter((p) => p.featured === f.featured);
  if (f.priceMin !== undefined) out = out.filter((p) => p.basePriceIls >= (f.priceMin ?? 0));
  if (f.priceMax !== undefined) out = out.filter((p) => p.basePriceIls <= (f.priceMax ?? Infinity));

  if (f.query) {
    const terms = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    out = out.filter((p) => {
      const hay = [
        p.name.ar,
        p.name.he,
        p.name.en,
        p.categorySlug,
        p.era ?? "",
        p.season ?? "",
        ...p.tags,
        p.nationalTeam ? "national منتخب נבחרת" : "",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => hay.includes(t) || fuzzyIncludes(hay, t));
    });
  }

  switch (f.sort) {
    case "price_asc":
      out = [...out].sort((a, b) => a.basePriceIls - b.basePriceIls);
      break;
    case "price_desc":
      out = [...out].sort((a, b) => b.basePriceIls - a.basePriceIls);
      break;
    case "newest":
      out = [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    default:
      out = [...out].sort((a, b) => Number(b.featured) - Number(a.featured) || b.createdAt.localeCompare(a.createdAt));
  }
  return out;
}

/** Cheap typo tolerance: allow one missing/extra/wrong character for terms
 * of 4+ letters (e.g. "retor" still finds "retro"). */
function fuzzyIncludes(hay: string, term: string): boolean {
  if (term.length < 4) return false;
  for (let i = 0; i < term.length; i++) {
    const variant = term.slice(0, i) + term.slice(i + 1);
    if (hay.includes(variant)) return true;
  }
  return false;
}
