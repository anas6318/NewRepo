# Translation Review Checklist

The three storefront dictionaries (`src/lib/i18n/{ar,he,en}.json`)
ship complete, with identical key coverage in all three files (verified
programmatically during this build — see `docs/test-report.md`). Before
launch, a native/fluent speaker of each language should still review:

- [ ] Arabic (`ar.json`) — tone matches the brand voice (premium, confident,
      minimal), no literal/machine-translation artifacts, correct football
      terminology (e.g. "نسخة اللاعب" vs. "نسخة المشجع" reads naturally to a
      football-fan audience in Israel).
- [ ] Hebrew (`he.json`) — same checks; verify gender-neutral phrasing where
      used (e.g. "אני מסכים/ה") reads naturally rather than clunky.
- [ ] English (`en.json`) — final copy tone check against the brand's
      "avoid generic phrases" rule (no "Elevate your style" type filler).
- [ ] Every product's `name_ar`/`name_he`/`name_en` and
      `description_ar`/`description_he`/`description_en` are genuinely
      translated per product — not the same string copy-pasted across
      locales (the seed data intentionally does NOT do this for the demo
      products' `name_ar`/`name_he`/`name_en`, since they're placeholder/demo
      only — real products must have real per-language content).
- [ ] SEO title/description fields are written per-locale, not machine-
      translated duplicates (spec §30: "Do not publish duplicate
      machine-translated pages").
- [ ] Policy text (`policies` table) reviewed in all three languages after
      legal review (see `docs/legal-review-checklist.md`) — the legal review
      should happen on the English/source text first, then the translations
      re-checked against the legally-approved version.
- [ ] Email templates (`src/lib/email/templates/*.ts`) reviewed in context
      (rendered HTML, not just the template strings) in all three languages.
- [ ] RTL rendering check for Arabic and Hebrew: numbers, prices, and the
      order-tracking timeline read in the correct visual order (see
      `docs/security-checklist.md`'s sibling accessibility QA pass, which
      covers direction testing in the same pass).
