# Security Checklist

## Implemented and tested in this delivery

- [x] Deny-by-default RLS on every table (`0002_rls.sql`); role helpers are
      SECURITY DEFINER; role escalation blocked by trigger.
- [x] Server-side authorization on every privileged path (edge-function
      `requireStaff`/`requireAdminOrOwner`; demo service mirrors it) —
      e2e-verified that a customer account cannot enter admin.
- [x] Orders only enter via `place-order`, which **recomputes all prices,
      adjustments, patches and delivery server-side** and validates
      options/sizes/personalization.
- [x] Guest tracking = order number + contact hash (secret-salted SHA-256,
      constant-time compare); generic failures — e2e-verified
      anti-enumeration; unguessable CR-XXXXXX numbers from a DB function.
- [x] Webhooks: signature verification before any write; idempotent on
      unique (provider, provider_event_id); unverifiable events rejected
      and audited. Simulated payments cannot mark orders paid.
- [x] Product-rights publishing gate enforced in app + edge function + DB
      CHECK constraint — e2e-verified.
- [x] Draft/archived products excluded from all public reads (RLS + query
      + service filter) — e2e-verified.
- [x] Supplier SKU/cost/reference never rendered in any customer-facing
      component (admin-only screens).
- [x] Reviews: moderation-only publishing; server-side validation; photo
      type/size limits client + function side.
- [x] Input validation on every form (local schema lib, unit-tested) +
      length caps in edge functions.
- [x] No secrets in the frontend: VITE_ vars are public-only; service
      keys/provider secrets live in Supabase function secrets.
- [x] CSP, X-Frame-Options DENY, nosniff, referrer + permissions policies
      (`vercel.json`); no inline scripts in index.html.
- [x] Audit log for catalog/order/settings/import/webhook actions.
- [x] Marketing consent never preselected; consent source+time recorded.

## Deploy-time items (cannot be exercised without live services)

- [ ] Run the two-account RLS spot-check on staging (deployment-guide §6).
- [ ] Rate limiting on place-order/track-order/submit-review — use
      Supabase's per-function rate limits or a WAF rule; add Turnstile if
      abuse appears (report-issue/contact are the likely targets).
- [ ] Supabase Storage bucket policies (MIME/size) when image upload UI is
      added; until then images are owner-supplied URLs.
- [ ] `npm audit` + Dependabot once a lockfile exists (registry was
      blocked here; surface is small: react, react-dom + dev tooling).
- [ ] Rotate `TRACKING_HASH_SECRET`/keys into a password manager; enable
      Supabase MFA for staff accounts.
- [ ] Tighten CSP further once the final analytics set is known (current
      policy already omits unsafe-inline for scripts).
