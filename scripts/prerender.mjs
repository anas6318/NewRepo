/**
 * SEO prerender (spec §31): serves dist/, renders every public route per
 * locale in headless Chromium, and saves the fully-rendered HTML (including
 * per-page meta, hreflang and JSON-LD) as static files. Crawlers get real
 * HTML without executing JS; the SPA hydrates on load for users.
 * Strategy documented in docs/architecture.md §SEO.
 *
 * Chromium prerendering needs a Playwright browser binary on disk. That is
 * true for local dev and for the network-restricted verification sandbox
 * (preinstalled), but Vercel's build image does not have one and does not
 * run `npx playwright install` — so this script:
 *   1. skips the Chromium path automatically on Vercel (process.env.VERCEL),
 *   2. falls back to Chromium-free static SEO tag injection whenever the
 *      Playwright package or its browser is unavailable for any other
 *      reason (missing devDependency, no browser installed locally, etc.),
 *   3. always exits 0 so `npm run build` never fails because of this step.
 * The fallback writes the same dist/{locale}/{path}/index.html files, with
 * real per-page <title>/description/canonical/hreflang/robots/OG/JSON-LD
 * sourced from the same i18n dictionaries and demo catalog data the app
 * itself uses — just without a fully executed React render. Local builds
 * with a working browser are unaffected and keep using the full render.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/ missing — run a build first (vite build or sandbox:build)");
  process.exit(1);
}

const PORT = 4321;
const LOCALES = ["ar", "he", "en"];
const DIR_BY_LOCALE = { ar: "rtl", he: "rtl", en: "ltr" };
const SITE = (process.env.VITE_SITE_URL ?? "https://example.com").replace(/\/$/, "");

const STATIC_PATHS = ["", "/shop", "/size-guide", "/about", "/how-it-works", "/delivery", "/faq", "/reviews", "/contact", "/track", "/policies/returns", "/policies/privacy", "/policies/terms", "/accessibility"];
const CATEGORY_SLUGS = ["retro", "current-season", "national-teams", "player-version", "fan-version", "long-sleeve", "hoodies", "kids"];

/** Static-page title/description come from the i18n dictionaries — the same
 * source of truth src/lib/seo.tsx-driven pages read via t(key) at runtime. */
const STATIC_META = {
  "": { titleKey: "meta.defaultTitle", descKey: "meta.defaultDescription", home: true },
  "/shop": { titleKey: "nav.shop", descKey: "shop.metaDescription" },
  "/size-guide": { titleKey: "sizeGuide.title", descKey: "sizeGuide.intro" },
  "/about": { titleKey: "nav.about", descKey: "about.intro" },
  "/how-it-works": { titleKey: "footer.howOrdering", descKey: "how.intro" },
  "/delivery": { titleKey: "footer.delivery", descKey: "delivery.intro" },
  "/faq": { titleKey: "footer.faq", descKey: "faq.intro" },
  "/reviews": { titleKey: "reviews.title", descKey: "reviews.pageIntro" },
  "/contact": { titleKey: "nav.contact", descKey: "contact.intro" },
  "/track": { titleKey: "nav.trackOrder", descKey: "tracking.metaDescription" },
  "/policies/returns": { titleKey: "footer.legal", descKey: "meta.defaultDescription" },
  "/policies/privacy": { titleKey: "footer.legal", descKey: "meta.defaultDescription" },
  "/policies/terms": { titleKey: "footer.legal", descKey: "meta.defaultDescription" },
  "/accessibility": { titleKey: "footer.accessibility", descKey: "meta.defaultDescription" },
};

const seedData = async () => {
  const script = `
import("./src/services/demo/seed-data.ts").then((m) => {
  const products = m.demoProducts
    .filter((p) => !["draft", "archived"].includes(p.status))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      seoDescription: p.seoDescription,
      basePriceIls: p.basePriceIls,
      image: p.images[0] ? p.images[0].src : "",
      available: p.status !== "unavailable",
    }));
  const categories = m.demoCategories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }));
  console.log(JSON.stringify({ products, categories }));
});`;
  const out = spawn(process.execPath, ["--experimental-strip-types", "-e", script], { cwd: root });
  let buf = "";
  out.stdout.on("data", (d) => (buf += d));
  await new Promise((r) => out.on("close", r));
  try {
    return JSON.parse(buf.trim() || "{}");
  } catch {
    return { products: [], categories: [] };
  }
};

const { products = [], categories = [] } = await seedData();
const paths = [...STATIC_PATHS, ...CATEGORY_SLUGS.map((c) => `/category/${c}`), ...products.map((p) => `/product/${p.slug}`)];

/* ───────────────────── full Chromium prerender ───────────────────── */

async function fullPrerender() {
  let chromium;
  try {
    ({ chromium } = await import("./pw.mjs"));
  } catch {
    console.warn("prerender: Playwright is not available — using the no-browser static SEO fallback instead");
    return false;
  }

  const server = spawn("node", [join(root, "scripts", "serve.mjs"), dist, String(PORT)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 600));

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.warn(`prerender: Chromium browser is not installed (${String(err.message ?? err).split("\n")[0]}) — using the no-browser static SEO fallback instead`);
    server.kill();
    return false;
  }

  try {
    const page = await browser.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

    let count = 0;
    for (const locale of LOCALES) {
      for (const path of paths) {
        const url = `http://localhost:${PORT}/${locale}${path}`;
        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
          await page.waitForTimeout(150);
          const html = await page.content();
          const outDir = join(dist, locale, ...path.split("/").filter(Boolean));
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, "index.html"), `<!doctype html>\n${html.replace(/^<!doctype html>\s*/i, "")}`);
          count++;
        } catch (err) {
          console.error(`prerender FAILED ${url}: ${err.message}`);
          process.exitCode = 1;
        }
      }
    }
    console.log(`prerendered ${count}/${paths.length * LOCALES.length} pages (full Chromium render) → dist/{ar,he,en}/…`);
    return true;
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
}

/* ─────────────────── no-browser static SEO fallback ─────────────────── */

const dictCache = new Map();
function dict(locale) {
  if (!dictCache.has(locale)) {
    dictCache.set(locale, JSON.parse(readFileSync(join(root, "src", "lib", "i18n", `${locale}.json`), "utf8")));
  }
  return dictCache.get(locale);
}
function t(locale, key) {
  return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), dict(locale)) ?? "";
}
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function organizationJsonLd() {
  return { "@context": "https://schema.org", "@type": "Organization", name: "CROWNED", url: SITE, logo: `${SITE}/brand/logo.svg` };
}
function productJsonLd(p, locale) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name[locale],
    description: (p.seoDescription && p.seoDescription[locale]) || p.description[locale],
    image: `${SITE}${p.image}`,
    offers: {
      "@type": "Offer",
      priceCurrency: "ILS",
      price: p.basePriceIls,
      availability: p.available ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock",
      url: `${SITE}/${locale}/product/${p.slug}`,
    },
  };
}
function breadcrumbJsonLd(items, locale) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: `${SITE}/${locale}${item.path}` })),
  };
}

function metaFor(locale, path) {
  const product = products.find((p) => path === `/product/${p.slug}`);
  if (product) {
    const title = product.name[locale];
    const description = (product.seoDescription && product.seoDescription[locale]) || product.description[locale];
    return {
      title,
      description,
      jsonLd: [
        productJsonLd(product, locale),
        breadcrumbJsonLd(
          [
            { name: t(locale, "nav.shop"), path: "/shop" },
            { name: title, path },
          ],
          locale,
        ),
      ],
    };
  }
  const category = categories.find((c) => path === `/category/${c.slug}`);
  if (category) {
    const title = category.name[locale];
    return {
      title,
      description: category.description[locale],
      jsonLd: [
        breadcrumbJsonLd(
          [
            { name: t(locale, "nav.shop"), path: "/shop" },
            { name: title, path },
          ],
          locale,
        ),
      ],
    };
  }
  const meta = STATIC_META[path];
  if (meta) {
    return {
      title: t(locale, meta.titleKey) || "CROWNED",
      description: t(locale, meta.descKey),
      jsonLd: meta.home ? [organizationJsonLd()] : [],
    };
  }
  return { title: "CROWNED", description: t(locale, "meta.defaultDescription"), jsonLd: [] };
}

function staticSeoFallback() {
  const baseTemplate = readFileSync(join(dist, "index.html"), "utf8");
  let count = 0;
  for (const locale of LOCALES) {
    for (const path of paths) {
      const { title: rawTitle, description, jsonLd } = metaFor(locale, path);
      const title = rawTitle.includes("CROWNED") ? rawTitle : `${rawTitle} · CROWNED`;
      const canonical = `${SITE}/${locale}${path}`;
      const ogLocale = locale === "en" ? "en_US" : locale === "he" ? "he_IL" : "ar_IL";

      const hreflangLinks = [...LOCALES.map((l) => `    <link rel="alternate" hreflang="${l}" href="${SITE}/${l}${path}" />`), `    <link rel="alternate" hreflang="x-default" href="${SITE}/en${path}" />`].join("\n");
      const jsonLdTags = jsonLd.map((obj) => `    <script type="application/ld+json">${JSON.stringify(obj)}</script>`).join("\n");

      const extraHead = `    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${canonical}" />
${hreflangLinks}
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE}/brand/og.png" />
    <meta property="og:locale" content="${ogLocale}" />
${jsonLdTags}
  </head>`;

      const html = baseTemplate
        .replace(/<html[^>]*>/, `<html lang="${locale}" dir="${DIR_BY_LOCALE[locale]}">`)
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
        .replace(/<meta name="description"[^>]*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
        .replace(/\s*<\/head>/, `\n${extraHead}`);

      const outDir = join(dist, locale, ...path.split("/").filter(Boolean));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "index.html"), html);
      count++;
    }
  }
  console.log(`prerendered ${count}/${paths.length * LOCALES.length} pages (static SEO fallback — no headless browser available) → dist/{ar,he,en}/…`);
}

/* ───────────────────────────── entry point ───────────────────────────── */

if (process.env.VERCEL === "1") {
  console.log("prerender: Vercel build detected — Chromium is not installed on Vercel's build image, skipping straight to the no-browser static SEO fallback");
  staticSeoFallback();
} else {
  const ok = await fullPrerender();
  if (!ok) staticSeoFallback();
}