/**
 * SEO head management (spec §31). Sets title/description/canonical/hreflang/
 * Open Graph per page and injects JSON-LD. Public pages are prerendered to
 * static HTML at build time (scripts/prerender.mjs), so crawlers receive
 * these tags without executing JavaScript — see docs/architecture.md §SEO.
 */
import { useEffect } from "react";
import { getConfig } from "./env.ts";
import { LOCALES, type Locale } from "./i18n/index.tsx";

export interface PageMeta {
  title: string;
  description?: string;
  /** Path WITHOUT the locale prefix, e.g. "/shop" or "/product/x". */
  path: string;
  locale: Locale;
  ogImage?: string;
  /** Set true on pages that must not be indexed (cart, checkout, account). */
  noindex?: boolean;
  jsonLd?: object[];
}

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string, hreflang?: string): void {
  const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]:not([hreflang])`;
  let el = document.head.querySelector<HTMLLinkElement>(selector);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    if (hreflang) el.hreflang = hreflang;
    document.head.appendChild(el);
  }
  el.href = href;
}

export function usePageMeta(meta: PageMeta): void {
  useEffect(() => {
    const site = getConfig().siteUrl.replace(/\/$/, "");
    const suffix = meta.path === "/" || meta.path === "" ? "" : meta.path;
    document.title = meta.title.includes("CROWNED") ? meta.title : `${meta.title} · CROWNED`;
    if (meta.description) upsertMeta("name", "description", meta.description);
    upsertMeta("name", "robots", meta.noindex ? "noindex, nofollow" : "index, follow");
    upsertLink("canonical", `${site}/${meta.locale}${suffix}`);
    for (const loc of LOCALES) upsertLink("alternate", `${site}/${loc}${suffix}`, loc);
    upsertLink("alternate", `${site}/en${suffix}`, "x-default");
    upsertMeta("property", "og:title", `${meta.title} · CROWNED`);
    if (meta.description) upsertMeta("property", "og:description", meta.description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:url", `${site}/${meta.locale}${suffix}`);
    upsertMeta("property", "og:image", meta.ogImage ? `${site}${meta.ogImage}` : `${site}/brand/og.png`);
    upsertMeta("property", "og:locale", meta.locale === "en" ? "en_US" : meta.locale === "he" ? "he_IL" : "ar_IL");

    document.head.querySelectorAll("script[data-jsonld]").forEach((n) => n.remove());
    for (const obj of meta.jsonLd ?? []) {
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.dataset.jsonld = "1";
      s.textContent = JSON.stringify(obj);
      document.head.appendChild(s);
    }
  }, [meta.title, meta.description, meta.path, meta.locale, meta.ogImage, meta.noindex, JSON.stringify(meta.jsonLd ?? [])]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function organizationJsonLd(): object {
  const site = getConfig().siteUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "CROWNED",
    url: site,
    logo: `${site}/brand/logo.svg`,
  };
}

export function productJsonLd(p: { name: string; description: string; image: string; priceIls: number; slug: string; locale: Locale; available: boolean }): object {
  const site = getConfig().siteUrl.replace(/\/$/, "");
  // NOTE: aggregateRating/review markup is intentionally emitted only from
  // genuine approved review data — never fabricated (spec §31).
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    image: `${site}${p.image}`,
    offers: {
      "@type": "Offer",
      priceCurrency: "ILS",
      price: p.priceIls,
      availability: p.available ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock",
      url: `${site}/${p.locale}/product/${p.slug}`,
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[], locale: Locale): object {
  const site = getConfig().siteUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${site}/${locale}${item.path}`,
    })),
  };
}
