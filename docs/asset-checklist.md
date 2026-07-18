# Asset Checklist

## Brand

- [ ] Final logo — vector source (AI/EPS/SVG), replacing
      `public/brand/logo.svg` / `logo-white.svg` (currently a hand-built
      approximation of the wordmark shared in chat — see
      `docs/missing-inputs.md`).
- [ ] Brand color confirmation against `tailwind.config.ts`'s `ink`/`gold`/
      `bone`/`neutral` tokens.
- [ ] Favicon / app icons (public/brand/favicon.svg ships; replace with final mark).

## Product photography

- [ ] At least one hero + 2–3 detail shots per SKU, following the project's
      product-editing rules (never alter jersey colors/logos/sponsors/
      patches; only enhance lighting/shadow/depth/composition).
- [ ] Consistent aspect ratio (product grid/gallery assume 4:5).
- [ ] Uploaded to the Supabase Storage `product-images` bucket, referenced
      from `product image URL fields`.
- [ ] Alt text per image, per locale (`per-locale alt text on each image`) —
      required for accessibility, not optional.

## Size charts

- [ ] Confirmed measurements (cm, optional inches) per chart type: fan,
      player, retro, long-sleeve, hoodie, kids — replacing the
      `is_placeholder = true` rows in `supabase/seed.sql`.
- [ ] Optional size-chart reference images.

## Reviews

- [ ] Genuine customer reviews + photos to replace/supplement the single
      `is_demo = true` seed review (which must never reach production).

## Delivery / ops

- [ ] Confirmed shipping zone list, prices (within ₪35–₪55), and estimated
      days per zone (currently reasonable placeholders in `seed.sql`).
- [ ] International eligible countries + rates, if/when enabling
      international selling (`international_settings.eligible_countries`).

## Legal / business

- [ ] Business registration number, tax details (see legal-review-checklist.md).
- [ ] Bank account details for the bank-transfer instructions text.
