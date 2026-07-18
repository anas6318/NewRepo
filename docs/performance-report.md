# Performance Report

Measured on the production sandbox build (identical sources to the Vite
build; Vite output will differ marginally).

| Asset | Raw | Gzip |
|---|---|---|
| app.js (whole app incl. admin) | 588 KB | **149.8 KB** |
| app.css (full design system) | 37 KB | **7.8 KB** |
| Demo imagery (45 webp files) | 580 KB total | — |
| dist/ total incl. 114 prerendered pages + maps | 5.8 MB | — |

Practices in place: single tiny dependency surface (react + react-dom
only); webp imagery with width/height attributes (no CLS) and lazy loading
below the fold; `fetchpriority=high` on the hero; prerendered public HTML
(fast first paint + crawlability); immutable asset caching + SPA-shell
no-cache (`vercel.json`); font loading via `display=swap` with full system
fallback stacks; reduced-motion support; no third-party scripts unless
analytics IDs are configured.

Honest gaps: Lighthouse could not run in the delivery environment (no npm
lighthouse; score therefore **not claimed** — run it in DevTools/CI after
first deploy; the ≥90 mobile target is realistic at these sizes).
Route-level code splitting (admin ≈ third of the bundle) is a worthwhile
follow-up if the score needs headroom: `React.lazy` on `AdminApp` +
storefront page groups. Prerender currently snapshots demo-catalog product
pages; on a live store pass `SITEMAP_SOURCE=supabase` so sitemap/prerender
pull published slugs.
