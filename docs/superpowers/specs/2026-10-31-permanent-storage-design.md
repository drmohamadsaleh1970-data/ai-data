# Part 1 of Live Hot Leads: permanent storage — design

Date: 2026-10-31 · Status: awaiting owner review · Research: `reports/Live hot lead sources UAE.md`

## 1. Why this comes first
AI-DATA will receive live Hot Leads from Meta and Google (part 2) and WhatsApp (part 3). Today every Vercel deployment keeps its data in SQLite under `/tmp`. Each function instance has its own copy, and the copy is lost whenever the instance is recycled. A lead, a consent record or a payment written there can vanish. Nothing in part 2 or 3 is safe until data is stored permanently in one shared place.

**Goal:** AI-DATA keeps all data in a managed Postgres database that survives deployments, restarts and parallel instances, with no change to what users see.

## 2. What was agreed
| Decision | Source |
|---|---|
| Live Hot Leads first come from AI-DATA's own campaigns and are sold from the Hot pool | Owner's answer |
| Order: (1) permanent storage, (2) Meta and Google live leads with instant alerts, (3) WhatsApp | Owner approved |
| Method A: connectors built into AI-DATA, not Zapier | Owner approved |
| Stay on free plans for now: Vercel Hobby and Neon Free | Owner's answer |
| Database: Neon Postgres in Frankfurt | Owner had no preference, so I took the recommendation; owner approved section 1 |
| Design sections 2 (code), 3 (going live) and 4 (testing) | Owner approved each |
| First channels Meta and Google, WhatsApp next | Owner had no preference, so I took the research recommendation (applies to part 2) |

## 3. Constraints and accepted risks
- **Vercel Hobby** terms allow non-commercial use only. Vercel may pause the project once it earns money. **Action before selling subscriptions or leads:** upgrade to Pro (about $20 per month). Hobby also limits scheduled jobs, so part 2 runs its 10-minute backup check from a free external scheduler (GitHub Actions).
- **Neon Free** has small storage and compute allowances and a short restore history. It sleeps when idle, so the first request after a pause is slower. The exact limits must be read on Neon's pricing page during setup; this session could not open it. Upgrade when real data grows or longer backups are needed.
- **Data leaves the UAE** (stored in Germany). The consent text and privacy notice will say so (see 6.6).
- **Function region:** move from `iad1` (US East) to `fra1` (Frankfurt), next to the database. If Hobby does not allow choosing a region, keep `iad1` and create the Neon database in its US East region instead.

## 4. Architecture
```
Browser / lead forms / (part 2: webhooks)
        │
Vercel function (fra1) ── api/index.js → Express app (unchanged routes)
        │
server/db.js  ── DATABASE_URL set?  yes → pg Pool → Neon Postgres (Frankfurt, pooled URL)
                                    no  → PGlite (Postgres in-process: tests, local runs, Docker)
```
- **Production driver:** `pg` (node-postgres) with a small pool. It uses Neon's pooled connection string, plus `attachDatabasePool` from `@vercel/functions` so idle connections close cleanly when an instance freezes.
- **Everywhere else:** `@electric-sql/pglite`, a real Postgres engine compiled to WebAssembly. It runs in memory for tests and in a data folder for local or Docker runs, so the same SQL runs everywhere.
- **Neon setup:** one project, `ai-data`, with two branches:
  - **`demo`:** fictional data, used now.
  - **`main`:** real data only, used after go-live.
- **New dependencies** (after plan approval): `pg`, `@electric-sql/pglite` and `@vercel/functions`, plus `embedded-postgres` as a dev dependency for the concurrency test (5.4).

## 5. Code changes
### 5.1 Database module (`server/db.js`, rewritten)
One async interface, used by every module:
- `db.one(sql, ...params)` returns the first row or `undefined`.
- `db.all(sql, ...params)` returns all rows.
- `db.run(sql, ...params)` returns `{ rowCount, rows }`; `rows` holds the `RETURNING` output.
- `tx(async (t) => …)` runs the callback inside `BEGIN … COMMIT`, with the same `one/all/run` methods. It rolls back on any error and returns the callback's value.

SQL keeps `?` placeholders. The module numbers them (`$1`, `$2` …) and skips `?` inside quoted strings, so the ~270 call sites keep their readable form. A unit test covers this numbering.

### 5.2 Converting the modules
These 12 files become async: `app.js, auth.js, billing.js, cold.js, crm.js, entitlements.js, hot.js, owner.js, seed.js, source-aihome.js, util.js` and `api/index.js`, plus the scripts.

- Every database call gets `await`. Callers of changed functions also become async.
- Express handlers already go through the `ok()` wrapper, which awaits.
- Background work started with `setInterval` (SLA sweep, scheduled import) catches and logs its own errors.

SQLite-specific SQL (42 places) is translated:
| SQLite | Postgres |
|---|---|
| `INSERT OR IGNORE` | `INSERT … ON CONFLICT DO NOTHING` |
| `.lastInsertRowid` | `INSERT … RETURNING id` |
| `SUM(col = 'X')` | `COUNT(*) FILTER (WHERE col = 'X')` |
| `INTEGER PRIMARY KEY` | `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` |
| `BLOB` | `BYTEA` |
| booleans as 0/1, dates as ISO text, JSON as text | kept as they are (no behaviour change; moving to native types is out of scope) |

Postgres returns `int8` and `numeric` values, such as BIGINT ids, `COUNT(*)` and `SUM(…)`, as strings or BigInt. The module converts them to JavaScript numbers for both drivers. This is safe because all money is stored as integer cents, far below 2^53.

### 5.3 Schema and migrations
- The current schema moves to `migrations/001_init.sql`, translated as above, with the same 41 tables, columns, unique constraints and indexes. One new table, `owner_export_file`, is added (5.5).
- On start, a runner applies any file not yet recorded in `schema_migrations`. It runs in one transaction under `pg_advisory_xact_lock`, so two cold starts at the same moment cannot apply a file twice.
- Migrations only move forward; there is no down-migration.

### 5.4 Keeping the money and quota rules exact
SQLite made every transaction exclusive with `BEGIN IMMEDIATE`. Postgres runs transactions in parallel, so each place that reads a value and then decides on it must lock what it reads:

| Flow | Guard |
|---|---|
| Cold transfer (`cold.js`) | Create the org's `daily_quota_account` row for today if missing, then `SELECT … FOR UPDATE`. Two transfers in one agency wait for each other; different agencies never wait. The unique (org, investor) grant and the (org, idempotency key) job key stay. |
| Magic-link activation, cash verification, PayPal events (`billing.js`) | `UPDATE … WHERE used_at IS NULL / status = 'PENDING' RETURNING`, so only one caller wins; provider-event unique keys stay |
| Hot pool allocation (`hot.js`) | `SELECT … FOR UPDATE` on the pool lead and on the entitlement row |
| Lead intake dedupe (`hot.js`) | The unique `webhook_receipt (source_code, provider_event_id)` plus `ON CONFLICT DO NOTHING` |
| Imports (`source-aihome.js`) | Natural-key unique constraints with `ON CONFLICT … DO UPDATE` |

`test/concurrency.test.js` runs on a real Postgres started by `embedded-postgres` (PGlite has only one connection, so it cannot test parallel transactions). It must prove that parallel transfers never exceed 999 a day and never charge the same investor twice.

### 5.5 Owner Excel exports
Exports are no longer written to `/tmp`, where the download could reach a different instance and miss the file. The XLSX is built in memory and stored in `owner_export_file (job_id, bytes BYTEA, created_at, expires_at = +24 h)`. The download route reads it from there, and the existing periodic sweep (`runSlaSweep`, at most once a minute) also deletes expired files. The current exporter writes to a file; it becomes a buffered write. Files stay small because they hold only the filtered records.

## 6. Going live
### 6.1 Seeding
- **Reference data:** plans, Hot lead sources and feature flags are inserted on start with `ON CONFLICT` (insert if missing, refresh names).
- **Demo data:** inserted only when `DEMO_MODE=true` and no demo persona exists yet, so restarts never duplicate it. Demo data is never written while `DATABASE_URL` points at the `main` branch. The Neon branch name is configured in `DATABASE_BRANCH`; if it is `main`, demo seeding refuses to run.

### 6.2 Vercel settings now (demo stays)
| Setting | Production and Preview |
|---|---|
| `DATABASE_URL` | Neon `demo` branch, pooled connection string |
| `DATABASE_BRANCH` | `demo` |
| `DEMO_MODE`, `ALLOW_PUBLIC_DEMO` | `true` (as today) |
| Function region | `fra1` |

### 6.3 Go-live checklist (settings only, no code)
1. Create a Google OAuth client ID and set `GOOGLE_CLIENT_ID`.
2. Set `OWNER_BOOTSTRAP_EMAIL` to the owner's Google address.
3. Point Production's `DATABASE_URL` at the `main` branch, set `DATABASE_BRANCH=main`, and remove `DEMO_MODE` and `ALLOW_PUBLIC_DEMO`.
4. Redeploy, sign in with Google as the owner, set up MFA (6.4), and check that everything works.
5. Before selling: upgrade Vercel to Pro (section 3).

### 6.4 First owner without a server console
`npm run bootstrap-owner` needs a console that Vercel does not have. New rule in `POST /api/owner/bootstrap`: if no owner exists yet, `OWNER_BOOTSTRAP_EMAIL` is set, and the signed-in Google email matches it (ignoring case), the request succeeds without a token. The user becomes `PLATFORM_OWNER` and receives the authenticator secret. The rule is ignored for good once any owner exists, and every attempt is audited. The token method stays for Docker installs.

UI: when such a user signs in, the onboarding page shows **"Set up platform owner"**. It displays the secret key and an `otpauth:` link to add in Google Authenticator, and the owner confirms with a 6-digit code before owner pages unlock.

### 6.5 Backups and restore
Neon's restore history (point-in-time restore) is the backup; the free plan's window is short. `docs/OPERATIONS.md` will explain:
- how to restore a branch to an earlier time;
- how to take a manual export before risky changes;
- that the window gets longer on paid plans.

### 6.6 Consent wording
`lead-form.js` (all 5 languages) and the agency form text add one sentence: details are stored securely with AI-DATA's service providers, which may be outside the UAE. `notice_version` becomes `v2`, so leads record which wording they saw.

## 7. Testing and rollout
- **Unchanged tests:** all 33 server tests and 9 browser tests pass on PGlite.
- **Parallel transfers:** the concurrency test passes on real Postgres.
- **New tests:**
  - placeholder numbering;
  - migrations apply once, and a second start is a no-op;
  - demo seeding runs only when empty and never when `DATABASE_BRANCH=main`;
  - an owner export can be downloaded through a second app instance on the same database;
  - email owner bootstrap works, is refused for a different email, and is refused once an owner exists;
  - data survives an app restart (stop the server, start it again on the same database, and data is still there).
- **Rollout:**
  1. The owner adds Neon from the Vercel Marketplace (free) and creates the `demo` branch.
  2. I set the environment variables and region.
  3. I push to a branch, which gives a Preview link on the `demo` database. I check it: sign in, transfer, send a lead form, redeploy, and confirm the data is still there.
  4. I merge to `main`, which deploys Production.
- **Rollback:** Vercel Instant Rollback returns to the previous build, which uses `/tmp` SQLite again. That is safe because nothing real has been stored yet.

## 8. Out of scope (later parts)
- Meta and Google webhooks, the queue, backfill pollers and instant alerts (part 2).
- WhatsApp (part 3).
- Replacing the in-memory rate limiter with `@vercel/firewall` (part 2).
- Native timestamp, boolean and JSON column types.
- Moving to Vercel Pro (owner's choice, before commercial launch).

## 9. Success criteria
1. A lead submitted on the live site is still there after a redeploy and after the instance sleeps.
2. All existing tests pass, and the new tests in section 7 pass.
3. Parallel transfers on real Postgres never exceed the daily limit and never double-charge.
4. Owner exports always download.
5. The owner can be created by Google sign-in with `OWNER_BOOTSTRAP_EMAIL` and MFA, with no console needed.
