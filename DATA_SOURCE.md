# Data source: ai-home.world

AI-DATA is a **standalone application**. It is not embedded in or deployed to www.ai-home.world. It takes only one thing from ai-home.world: the **investor history data** (historical buyer/seller transactions and, where available, contact details). Everything else lives here: accounts, subscriptions, billing, quota, CRM, Hot Leads and the owner console.

## Step by step: import the investor history

**A. Get the data out of ai-home.world**
1. From ai-home.world's admin panel or database, export the investor-history table as **XLSX or CSV**.
2. Keep the column names shown on ai-home.world/investor-history: `Country, City, AreaNameEn, PropertyTypeEn, Client Role, Client name, NATIONALITY, Master Developer, Project Name, Size(M2), Price/ProcedureValue, Registration_Date`.
3. Add these columns too if ai-home.world has them: **transaction ID**, **Email**, **Mobile/Phone**, **WhatsApp**. Without phone or email, subscribers get history but cannot contact anyone.

**B. Import it into AI-DATA**
1. Sign in as the **platform owner**. In the demo this is the *Platform Owner* persona; in production it is your Google account after `npm run bootstrap-owner`.
2. Go to **Owner console → ai-home.world data import**.
3. Choose the file and click **Preview mapping**. Check that every column maps to a field and look at any rejected rows.
4. Click **Import** and enter your MFA code. Importing the same file again is safe: it updates rows and never duplicates them.

**C. Release the data to subscribers** (only with a documented legal basis)
1. Go to **Owner console → Rights & governance**.
2. Click **Approve rights** for *ai-home.world investor-history*.
3. When legal approval for person-level transfers is recorded, enable the **COLD_SUBSCRIBER_TRANSFER** flag.

Until steps C.2 and C.3 are done, subscribers see only restricted, masked records and cannot transfer any.

**Limits on the current Vercel site**
- **File size:** Vercel accepts uploads up to 4.5 MB, and the file is sent base64-encoded (about a third larger). Keep each file under about **3 MB**; split a large export, for example by year.
- **Storage:** the Vercel demo stores data in temporary storage that is wiped whenever Vercel restarts the server. Import real data only after moving to permanent hosting (see *Deploying to Vercel* in `README.md`).

**Automatic sync instead of files**
1. Give ai-home.world a private, read-only JSON endpoint that follows the contract below.
2. In Vercel, go to **Settings → Environment Variables**, add `AIHOME_SOURCE_URL` and `AIHOME_SOURCE_TOKEN`, then redeploy.
3. Click **Sync now** on the import page.

Scheduled sync (`AIHOME_SYNC_MINUTES`) needs an always-on server; Vercel functions do not run timers. Very large syncs may exceed the function's time limit, so run those from an always-on server too.

## How data comes in

| Method | How | When to use |
|---|---|---|
| **File import** | Owner console → *ai-home.world data import* → upload the XLSX/CSV exported from ai-home.world's investor-history page → *Preview mapping* → *Import* (needs MFA) | Works today with no changes to ai-home.world |
| **API sync** | Set `AIHOME_SOURCE_URL` and `AIHOME_SOURCE_TOKEN`, then use *Sync now*, or set `AIHOME_SYNC_MINUTES` for scheduled pulls | When ai-home.world can serve a read-only JSON endpoint |

### Column mapping

Headers are matched without regard to case, spaces or punctuation.

| ai-home.world column | Stored as | Required |
|---|---|---|
| Client name | `investor_contact.full_name` | yes |
| Client Role (Buyer/Seller, also مشتري/بائع) | `investor_transaction.client_role` | yes |
| Registration_Date (ISO, day-first D/M/Y, or Excel date) | `registration_date` | yes |
| Country, City, AreaNameEn, PropertyTypeEn | `country`, `city`, `area`, `property_type` | no (stored as "Unknown" if empty) |
| Master Developer, Project Name | `master_developer`, `project` | no |
| Size(M2), Price/ProcedureValue | `size_m2`, `price_aed` (thousands separators allowed) | no |
| NATIONALITY | `investor_contact.nationality` | no |
| Transaction number / ID (if exported) | `source_txn_id` = `AIH-<id>` | no; if absent, a content hash is used |
| Email, Mobile/Phone, WhatsApp/Phone 2 | `email`, `phone` (normalized to E.164) | no |
| price/sqft | not stored (derived) | — |

### Rules applied on import
- **Idempotent.** Re-importing the same export or re-syncing updates existing transactions and never creates duplicates.
- **Identity.** Rows are grouped into one investor only on an exact phone or email match. Rows that share only a name stay separate and are flagged `AMBIGUOUS` for review.
- **Safe enrichment.** Later imports only fill missing email, phone or nationality. They never change rights status, suppression or marketing permission.
- **Restricted by default.** Every imported record is `RESTRICTED_PENDING_REVIEW`. Subscribers see no names or contacts and cannot transfer it until the owner approves the source under *Rights & governance*.
- **Audited.** Every import is logged with row counts, rejected rows and reasons.

### API contract for the sync endpoint

ai-home.world's real API was not available while building this; adapt `server/source-aihome.js` once it is known.

```
GET {AIHOME_SOURCE_URL}?page=N
Authorization: Bearer {AIHOME_SOURCE_TOKEN}
→ 200 [ {row}, ... ]
  or { "rows": [ {row}, ... ], "has_more": true }
  or { "data": [...], "next": "https://…?cursor=…" }
```

Each `{row}` uses the column names above. The endpoint should be server-to-server only, behind the token, and never public.

## What is still needed from ai-home.world
1. **An export file** of the investor table, including transaction IDs and contact columns where they exist. Alternatively, a read-only API endpoint plus token.
2. **Rights documentation** for the data: its source, licence or contract, and permitted purposes. The owner approves this in *Rights & governance* before subscribers can use the data.

This build environment could not reach www.ai-home.world (blocked by its network policy), so the live page and its data were not inspected. All tests use fictional rows shaped like the columns in the brief.
