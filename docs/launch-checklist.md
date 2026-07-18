# Launch Checklist

Ordered path from repo → live store. Each phase links to the detailed doc.

**0 · Verify the toolchain** — `npm install` → `npm run typecheck` → `npm
run test` → `npm run build` (first real Vite build — read the log) → `npm
run test:e2e`. All were green in the delivery environment via the sandbox
pipeline; re-confirm on a normal machine.

**1 · Supabase** — migrations 0001+0002; deploy the six edge functions;
set TRACKING_HASH_SECRET + ALLOWED_ORIGIN; seed **staging only**; create
the owner account. (deployment-guide §1–2, §5)

**2 · Owner inputs** — real product photography (authorized assets only) +
per-locale alt text; final size charts replacing the labeled placeholders;
confirmed zones/prices (₪35–55) + ETAs; WhatsApp number; Instagram handle;
bank details into the transfer instructions; business registration/tax
fields. (asset-checklist.md)

**3 · Legal review (blocking)** — returns policy (owner draft) checked
against Israeli consumer law; privacy + terms drafted (current text is a
labeled placeholder); non-affiliation wording confirmed; consent flow
checked; the operational rights-review process agreed. Nothing ships while
`needs legal review` badges are on. (legal-review-checklist.md)

**4 · Translation review** — native ar/he/en pass over UI strings, product
content, policies (after legal), rendered emails; RTL read-through.
Key parity is machine-enforced; wording quality is human.
(translation-review-checklist.md)

**5 · Payments** — bank transfer live by default; card/PayPal/Bit/PayBox
each: credentials → template wiring → sandbox loop → enable → one small
live charge → test-mode off. (payment-setup.md,
payment-onboarding-checklist.md)

**6 · Sheets + email** — NEW spreadsheet + service account; verify one
order round-trip + the 15-min drain; switch EMAIL_PROVIDER to resend and
review rendered emails in all three languages. (google-sheets-setup.md)

**7 · Deploy + smoke** — Vercel env + deploy; domain + VITE_SITE_URL;
run the full staging smoke list (deployment-guide §6); Lighthouse pass;
cross-browser check (Chromium was tested here; verify Safari/Firefox).

**8 · Hardening** — rate limits, staging RLS spot-check, npm audit,
secrets inventory. (security-checklist.md)

**9 · Go live** — confirm production DB has NO demo rows (never run
seed.sql there; demo reviews/products must not exist); analytics IDs in;
announce; watch /admin/orders + function logs for the first orders.
