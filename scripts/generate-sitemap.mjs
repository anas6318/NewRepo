/**
 * Generates dist/sitemap.xml (+ robots.txt) for all public routes × locales
 * with hreflang alternates (spec §31). Product slugs come from the canonical
 * demo seed in development; against a live store, set SITEMAP_SOURCE=supabase
 * with SUPABASE_URL/SUPABASE_ANON_KEY env vars to pull published slugs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.CROWNED_SITEMAP_INNER) {
  const res = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, CROWNED_SITEMAP_INNER: "1" },
    cwd: root,
  });
  process.exit(res.status ?? 0);
}

const SITE = (process.env.VITE_SITE_URL ?? "https://example.com").replace(/\/$/, "");
const LOCALES = ["ar", "he", "en"];

const STATIC_PATHS = [
  "",
  "/shop",
  "/search",
  "/size-guide",
  "/about",
  "/how-it-works",
  "/delivery",
  "/faq",
  "/reviews",
  "/contact",
  "/track",
  "/policies/returns",
  "/policies/privacy",
  "/policies/terms",
  "/accessibility",
];

const CATEGORY_SLUGS = ["retro", "current-season", "national-teams", "player-version", "fan-version", "long-sleeve", "hoodies", "kids"];

async function productSlugs() {
  if (process.env.SITEMAP_SOURCE === "supabase" && process.env.SUPABASE_URL) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/products?select=slug&status=not.in.(draft,archived)`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY ?? "", Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY ?? ""}` },
    });
    if (!res.ok) throw new Error(`sitemap: supabase fetch failed ${res.status}`);
    return (await res.json()).map((r) => r.slug);
  }
  const seed = await import("../src/services/demo/seed-data.ts");
  return seed.demoProducts.filter((p) => !["draft", "archived"].includes(p.status)).map((p) => p.slug);
}

const paths = [...STATIC_PATHS, ...CATEGORY_SLUGS.map((c) => `/category/${c}`), ...(await productSlugs()).map((s) => `/product/${s}`)];

const urls = paths
  .map((path) => {
    const alternates = LOCALES.map((loc) => `    <xhtml:link rel="alternate" hreflang="${loc}" href="${SITE}/${loc}${path}"/>`).join("\n");
    return LOCALES.map(
      (loc) => `  <url>
    <loc>${SITE}/${loc}${path}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/en${path}"/>
  </url>`,
    ).join("\n");
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

const outDir = existsSync(join(root, "dist")) ? join(root, "dist") : root;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "sitemap.xml"), xml);
writeFileSync(
  join(outDir, "robots.txt"),
  `User-agent: *
Allow: /
Disallow: /admin
Disallow: /*/cart
Disallow: /*/checkout
Disallow: /*/account
Disallow: /*/wishlist
Disallow: /*/login
Disallow: /*/register

Sitemap: ${SITE}/sitemap.xml
`,
);
console.log(`sitemap.xml: ${paths.length * LOCALES.length} urls → ${outDir}`);
