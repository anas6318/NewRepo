# Legal Review Checklist

Nothing in this codebase should be treated as legal advice. The following
must be reviewed by a qualified lawyer (Israeli consumer protection law, and
international law if/when the international market is enabled) before
launch:

- [ ] Cancellation, Return & Exchange Policy  —
      currently the owner's draft copy from the brief, stored as-is. Must be
      checked against mandatory Israeli consumer-protection rights; nothing
      in it may attempt to waive a right the law doesn't allow waiving.
- [ ] Privacy Policy  — placeholder only, not
      yet drafted. Needs real content covering what's collected (order data,
      accounts, leads/marketing consent, analytics — explicitly NOT PII sent
      to analytics, see `src/lib/analytics.ts`), retention, and any
      third-party processors (Supabase, the eventual payment gateway, Google
      Sheets, the eventual email provider).
- [ ] Terms & Conditions  — placeholder only.
- [ ] Accessibility Statement — drafted to reflect the actual WCAG 2.2 AA
      target and implementation; confirm no over-claiming ("fully
      accessible") beyond what's been verified.
- [ ] Non-affiliation disclosure (footer + About page) — confirm the wording
      satisfies any applicable rules about not implying official/licensed
      status for replica merchandise.
- [ ] Business registration / tax details (`store_settings.legal_entity_*`,
      `tax_note`) — currently empty placeholders; needs the owner's actual
      עוסק מורשה/ח.פ. details and VAT handling confirmed before issuing
      customer-facing invoices.
- [ ] Marketing consent flow (leads table, checkout opt-in) — confirm the
      consent language and record-keeping (`consent_source`, `consent_at`)
      satisfy applicable anti-spam/marketing law for SMS/WhatsApp/email.
- [ ] Product rights review process (`the product rights status field`) — confirm the
      internal review process this gates (draft → cleared before publish) is
      actually followed operationally, not just technically enforced.

None of the draft policy text in this repository should be published
customer-facing until every box above is checked.
