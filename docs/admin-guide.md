# Admin Guide

`/admin` — English UI managing fully trilingual store content. Demo mode
credentials are shown on the login screen (owner: `admin@crowned.example` /
`admin1234`). In production, staff = any account whose `profiles.role` is:

| Role | Can |
|---|---|
| owner / admin | everything, incl. payments, settings, audit log |
| order_manager | dashboard, orders, customers, reviews, shipping, imports, products, translations |
| content_manager | same as order_manager (payments/settings/audit hidden) |

Server-side enforcement: RLS + edge-function role checks — hiding a menu
item is never the security boundary.

**Dashboard** — orders today, revenue (paid), pending payments, supplier
pipeline counts, AOV, top products/categories, customers.

**Products** — search/filter, edit, duplicate-as-draft, delete. Editor:
core fields, three-language tabs (name/description/details/SEO), variants
(fan/player with ₪ adjustments, long-sleeve option), sizes, image URLs
(owner-authorized assets only), supplier SKU/reference/cost (never shown to
customers), flags (featured, national, kids, personalizable,
counts-toward-free-delivery). **Rights status gates publishing**: a product
cannot leave draft until `cleared` — enforced on save, in the edge
function, and by a DB constraint (spec §30).

**Supplier import** — upload/paste CSV or JSON (`docs/
supplier-import-template.csv`), preview, then import. Every row lands as
**draft + rights pending_review**; duplicates and invalid rows are reported
per-row and skipped. Nothing auto-publishes.

**Orders** — search/filter by payment/fulfillment, CSV export, detail view:
items with personalization exactly as entered, payment status (bank
transfer: verify manually → set *paid*), fulfillment status (each change
appends a timeline event customers see), supplier reference, tracking
number/URL, ETA, internal notes (never customer-visible), WhatsApp-the-
customer button, print, **Resync to Sheets** (reports honestly when Sheets
isn't connected).

**Customers** — directory with roles. **Reviews** — moderation queue:
approve / reject / hide / verified toggle; nothing publishes without
approval; demo entries are labeled.

**Shipping** — zones (trilingual names, ₪35–55 enforced, ETA, active).
**Payments** (admin/owner) — enable/test-mode per method; a method reaches
checkout only when enabled AND its server credentials exist; Bit/PayBox
warn against personal-link misuse. Bank-transfer instructions edited here.
**Translations** — announcement, ETA text, international note,
non-affiliation disclosure, and all four policies in ar/he/en with
legal-review flags. **Settings** (admin/owner) — WhatsApp, Instagram,
free-delivery threshold (quantity-based), international mode, legal-entity
placeholders; demo mode adds a data-reset button. **Audit log** — actor /
action / target for catalog, orders, settings, imports, webhooks.
