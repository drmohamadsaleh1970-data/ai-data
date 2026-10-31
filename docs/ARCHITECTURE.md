# Architecture

The portal is standalone. ai-home.world is used only as an upstream **investor-data source**:

```
 ai-home.world ──(XLSX/CSV export upload  |  paged JSON API + bearer token)──▶ server/source-aihome.js
                                                                                 │ map columns · validate · group by phone/email
                                                                                 ▼
                                        investor_contact / investor_transaction (RESTRICTED until rights approved)
```

```
                      ┌──────────────────────── Browser SPA (public/) ────────────────────────┐
                      │ Landing · Pricing · Google sign-in · Onboarding · Billing              │
                      │ Investor History (masked) · CRM · Hot · Team · Reports · Owner console │
                      └───────────────┬──────────────────────────────────────────────────────┘
                                      │ HTTPS · HttpOnly session cookie · X-AIHOME-CSRF header
┌─────────────────────────────────────▼────────────────────────────────────────────────────────┐
│ Express API (server/app.js)                                                                    │
│  auth.js         Google ID-token verify (JWKS, aud, iss, nonce) · sessions · RBAC · TOTP step-up│
│  entitlements.js active subscription → plan → Dubai-day quota account                         │
│  cold.js         validated filters → masked search → estimate → ATOMIC transfer → CRM upsert   │
│  billing.js      PayPal subscriptions + verified webhooks · cash verify · magic links          │
│  crm.js          leads · activities · tasks · pipeline · reports · SLA sweep · xlsx import     │
│  hot.js          first-party intake (site keys) · Hot pool · pricing · allocation ledger       │
│  owner.js        dashboard · streaming XLSX export · provenance review · suppression · flags  │
│  source-aihome.js  ai-home.world investor-data import: file (XLSX/CSV) or paged API sync      │
└─────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                      │ one write transaction per transfer / webhook / verification
                              ┌───────▼────────┐        ┌────────────────────────────┐
                              │ SQLite (dev)   │  →→→   │ PostgreSQL (production)    │
                              │ node:sqlite    │        │ same tables + RLS by org_id│
                              └────────────────┘        └────────────────────────────┘
```

## Cold → CRM transfer (one transaction)

```
POST /api/cold/transfers  (Idempotency-Key)
 BEGIN IMMEDIATE  ← takes the write lock first, so concurrent transfers queue
   1. Same key already used? → return the earlier result, charge 0
   2. Legal gate flag on? Is there an active Cold subscription?
   3. Resolve the selection on the server (ids are re-checked; "filter" mode re-runs the validated filter)
   4. Sort into: already acquired (free) / blocked by rights, suppression or not found / new
   5. Read daily_quota_account(org, Dubai day). If new > remaining, refuse unless allow_partial
   6. For each accepted record: INSERT record_acquisition_grant (PK org+investor)
      → CRM contact upsert (link, never overwrite) → lead → task → notification → quota_ledger
   7. committed_used += accepted;  audit_log
 COMMIT
```

There is no separate outbox, because the CRM lives in the same database: the charge and the CRM record commit together or not at all. If the CRM is ever split into another service, add a reservation row plus an outbox in step 6 and settle the charge when delivery is confirmed.

**PostgreSQL version of step 5:**

```sql
INSERT INTO daily_quota_account (org_id, local_day, plan_code, plan_limit) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING;
SELECT plan_limit, committed_used FROM daily_quota_account WHERE org_id=$1 AND local_day=$2 FOR UPDATE;
```

The unique keys `record_acquisition_grant(org_id, investor_id)` and `cold_transfer_job(org_id, idempotency_key)` block double charging, even if application logic fails.

## API contracts (JSON)

| Method & path | Who | Notes |
|---|---|---|
| GET `/api/auth/config` | public | Google client ID, nonce cookie, PayPal status |
| POST `/api/auth/google` `{credential}` | public | Verifies the Google ID token. Identity = `sub`. Accepts pending invitations. |
| GET `/api/me` | session | User, memberships, active org, permissions, entitlements |
| POST `/api/organizations` `{name, kind, terms:true,…}` | session | Creator becomes ORG_OWNER. No data access until paid. |
| GET `/api/me/entitlements` | org | Cold `{plan, quota{plan_limit, committed_used, remaining, resets_at}}` and Hot credits, reported separately |
| GET `/api/cold/filters` | cold.search | Distinct values for each filter |
| POST `/api/cold/search` `{filter, cursor, limit≤50}` | cold.search | Masked rows, counts, `next_cursor`. Free. |
| POST `/api/cold/transfers/estimate` `{selection}` | cold.transfer | selected / duplicates / already / blocked / new / deliverable / quota |
| POST `/api/cold/transfers` `{selection, allow_partial, assign_to, campaign_tag}` + `Idempotency-Key` | cold.transfer | Per-record outcomes, CRM links, quota |
| GET `/api/cold/transfers/:jobId` | org | |
| GET `/api/organizations/:id/usage?date=` | usage.view | Own org only. Usage by member, calendar, jobs. |
| GET/PATCH `/api/crm/leads[/:id]` · POST `…/activities` · POST `…/tasks` | crm.own / crm.all | Agents see only their assigned leads |
| POST `/api/crm/import` `{file_base64, commit, rights_confirmed}` | crm.import | `leads form.xlsx` (38 columns) |
| POST `/api/billing/paypal` `{plan}` | billing.manage | Returns 503 `PAYPAL_NOT_CONNECTED` until configured |
| POST `/api/billing/cash` `{plan, note}` | billing.manage | Creates a `PENDING_PAYMENT` request with a reference |
| POST `/api/billing/activate` `{token}` | session | Single use, expires, bound to the issuing user |
| POST `/api/webhooks/paypal` | PayPal | Signature verified through PayPal's API, deduplicated, ordering-safe |
| POST `/api/public/inquiry` + `X-Site-Key` | public, CORS `*` | Consent required, rate limited, honeypot, deduplicated, optional allowed origin per key. Used by `public/lead-form.js` and Zapier/Make (see `docs/HOT_LEADS.md`) |
| POST `/api/public/search-event` | public | Anonymous aggregate only. Needs analytics consent. |
| POST `/api/owner/cold-exports` `{filter, fields}` | OWNER + MFA | Streams an XLSX with watermark and manifest sheet |
| GET `/api/owner/cold-exports/:id` | OWNER + MFA | Download (audited) |
| POST `/api/owner/cash/:id/verify` `{amount_usd, paid_on, channel, receipt_no}` | OWNER/FINANCE + MFA | Issues the magic link |
| POST `/api/owner/hot/pricing` · `/hot/entitlements` · `/hot/pool/:id/allocate` | OWNER (+MFA) | |
| POST `/api/owner/hot/site-keys` `{label, org_id?, allowed_origin?}` · `/hot/site-keys/:key/revoke` | OWNER | Website keys: no org = AI-DATA Hot pool, org = that agency's CRM |
| POST `/api/owner/provenance/:id/review` · `/investors/:id/suppress` · `/flags` | OWNER (+MFA) | |
| GET `/api/owner/source` · POST `/api/owner/source/preview` `{file_base64, file_name}` | OWNER | ai-home.world import status, mapping preview |
| POST `/api/owner/source/import` · POST `/api/owner/source/sync` | OWNER + MFA | Import a file or pull from the API (idempotent) |
| ANY `/api/(investor-history|cold|crm)/(export|download|print|csv|xlsx|dump)…` | everyone | **403** with audit |

Errors use the shape `{error: CODE, message}`, with HTTP 400/401/402/403/404/409/429/503.

## Roles

`PLATFORM_OWNER` and `PLATFORM_FINANCE_ADMIN` are columns on `platform_user`. They are set only by the bootstrap token or by a database admin. Org roles live in `membership`: `ORG_OWNER, AGENCY_DIRECTOR, ORG_ADMIN, SALES_MANAGER, TEAM_LEADER, AGENT, MARKETING_MANAGER, AUDITOR`. The role → permission map is in `server/auth.js`.

## Production hardening still to do

- Move to PostgreSQL with row-level security on `org_id`.
- Encrypt contact columns at rest (pgcrypto or KMS).
- Run the SLA sweep as a separate worker (BullMQ repeatable job).
- Send email through a provider.
- Push live updates over SSE instead of polling.
- Use Redis-backed rate limits.
- Add structured logs with PII redaction.
- Run backups with point-in-time recovery.
