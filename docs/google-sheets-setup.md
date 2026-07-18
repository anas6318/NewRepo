# Google Sheets Order Sync

Postgres is the source of truth; the sheet is a **one-way mirror** for
day-to-day ops (spec §24). The sync never connects to any existing
spreadsheet — create a NEW one.

1. Google Cloud console → new project → enable **Google Sheets API**.
2. Create a **service account**; create a JSON key.
3. Create a brand-new spreadsheet; share it (Editor) with the service
   account's email.
4. Secrets:
   ```bash
   supabase secrets set \
     GOOGLE_SHEET_ID=<the long id from the sheet URL> \
     GOOGLE_SERVICE_ACCOUNT_EMAIL=<sa>@<project>.iam.gserviceaccount.com \
     GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…"
   ```
5. Redeploy `sheets-sync`. It writes the header row automatically and
   upserts one row per order (duplicate-prevented by order number), with
   items joined by ` | ` in the multi-value columns listed in the spec.

Triggers: after order creation, payment webhook events and admin order
updates a sync is queued (`sheets_sync_log`) and attempted immediately;
failures stay queued with the error recorded. Schedule the drain (every
15 min) per deployment-guide §2. Manual "Resync to Sheets" exists on every
admin order. Until credentials exist the log rows are marked `disabled`
with an honest message — nothing pretends to have synced.
