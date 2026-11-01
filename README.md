# AI-DATA Portal

A **standalone** portal. It does not run inside www.ai-home.world. It imports only the **investor history data** from ai-home.world (by file or API; see `DATA_SOURCE.md`) and provides everything else itself:

- **Cold Data subscriptions**: Agency at AED 999/month with 999 records a day, and Agent at AED 99/month with 99 a day. Both have unlimited members sharing one allowance that resets at 00:00 Asia/Dubai. Records move into the CRM only.
- A separately billed **Hot Leads** product.
- A multilingual **CRM** in English, Arabic (RTL), French, Russian and Turkish.

Guides:
- **Import investor data from ai-home.world:** `DATA_SOURCE.md`
- **Get Hot Leads** (website form, Meta/Google/TikTok via Zapier or Make, API): `docs/HOT_LEADS.md`
- **Design and API:** `docs/ARCHITECTURE.md`
- **Before going live:** `docs/COMPLIANCE_CHECKLIST.md`

## Commands

You need Node.js 22.5 or newer. There are no native builds and no external services.

```bash
npm install                  # install
npm run migrate              # create schema + reference data (plans, sources, flags) + owner
npm run dev                  # http://localhost:3000  (watch mode)
npm run build                # syntax-check all modules
npm test                     # 37 acceptance/integration tests (fictional fixtures in test/)
npm run test:e2e             # 9 Playwright browser tests (fresh fictional DB on port 3100)
npm run owner-mfa-secret -- owner@your-domain.com   # new OWNER_TOTP_SECRET + authenticator link
docker compose up --build    # containerized portal
```

To deploy, build the Dockerfile, set `NODE_ENV=production` and the variables in `.env.example`, and mount `/data`. Before real traffic, move to PostgreSQL (see `docs/ARCHITECTURE.md`).

## First-time setup

The portal has no demo mode and no sample data. It starts with plans, settings and lead sources only.

1. **Google sign-in:** create an OAuth 2.0 *Web* client in Google Cloud Console. Add the portal's address (for example `https://ai-data-phi.vercel.app`) under *Authorized JavaScript origins*, and set `GOOGLE_CLIENT_ID`.
2. **Platform owner:** set `OWNER_EMAIL` to your Google address and `OWNER_TOTP_SECRET` to a new secret (`npm run owner-mfa-secret -- you@gmail.com` prints one and an authenticator link). Add the secret to Google Authenticator or a similar app. The owner account is recreated from these settings on every start and linked to your Google account when you sign in.
3. **Investor data:** sign in as owner → *ai-home.world data import* (see `DATA_SOURCE.md`), then approve rights under *Rights & governance*.
4. **Customers:** agencies and agents sign in with Google, create their organization and pay. For cash payments, finance verifies the receipt (MFA) and gets a single-use activation link to send by WhatsApp or email.

The token-based `npm run bootstrap-owner` remains available for servers with a console.

## What the tests prove (`npm test`)

- **ai-home.world import**
  - Real column names are mapped and bad rows are rejected with reasons.
  - Rows are grouped by phone/email only, never by name.
  - Re-import is idempotent, for both XLSX and CSV.
  - Records start restricted until the owner approves rights.
  - API sync pulls every page with a bearer token and shows NOT CONNECTED when unset.

- **Quota**
  - Search and preview are free.
  - 25 selected records are charged exactly once.
  - Retries and re-transfers are free and create no duplicate contacts.
  - Restricted, unknown and over-quota records are rejected without charge.
  - 1,000 invitations leave the quota at 999.
  - The reset happens at 00:00 Asia/Dubai (20:00 UTC).
- **Concurrency**: two threads with separate database connections each try to transfer 70 records against a 99 allowance; exactly 99 are committed.
- **Security**
  - Every guessable export URL returns 403.
  - Forged role parameters don't work.
  - Owner export needs fresh MFA, and finance admins cannot export.
  - The XLSX carries a watermark and manifest.
  - CSRF header is required.
  - Tenants and agents are isolated from each other.
- **Billing**
  - Cash stays pending until a finance admin verifies it.
  - The magic link works only for the right Google identity, only once, and expires.
  - PayPal events are signature-checked, deduplicated, and rejected if they arrive out of order, name the wrong plan, or try to rebind another subscription.
  - A failed renewal blocks new transfers but keeps CRM data.
- **Hot and CRM**
  - A consented web inquiry becomes a HOT lead with no Cold charge.
  - Connectors show NOT CONNECTED until configured.
  - Anonymous searches never become leads.
  - Hot pricing is gated until the owner configures it, and has its own ledger.
  - SLA escalation works.
  - Opt-outs propagate.
  - Fresh CRM phone numbers are never overwritten by historical data.
  - The 38-column xlsx import works.
  - First contact is recorded only when the agent sets a contacted stage.

## Browser (E2E) tests (`npm run test:e2e`)

These run in Chromium against a local server seeded with fictional test fixtures and a test-only sign-in that the live portal does not have (`playwright.config.js` starts it on port 3100). Tested journeys:
- **Landing and pricing:** both Cold plans; Hot Leads shown as priced separately.
- **Sign-in:** only Google is offered; a signed-in director sees the shared quota.
- **Investor History:**
  - Results are masked and there's no export button.
  - 3 selected records are transferred, quota +3, and they open in the CRM with the "historical" label.
- **Cash payment:** pending → finance verifies (MFA) and gets the activation link to send → the link activates → the reused link is refused.
- **Owner:** unmasked data; XLSX export after MFA (watermark and manifest checked).
- **ai-home.world import:** preview the column mapping, then import with MFA.
- **Arabic:** the app switches to right-to-left.
- **Raw-export and owner APIs:** refused for a subscriber session.

Not covered in the browser: Google sign-in and PayPal (real third-party services; covered by server tests with verified-webhook fakes) and Hot pool allocation.

## Implemented vs. still needed

**Implemented and tested**
- Investor data import from ai-home.world: file upload (XLSX/CSV) and paged API sync, idempotent, restricted by default.
- Google OIDC sign-in (live once `GOOGLE_CLIENT_ID` is set).
- Organizations, unlimited invitations, roles.
- Owner bootstrap with TOTP MFA.
- Plans and the shared Dubai-day quota with atomic transfer.
- Masked search, owner XLSX export, export denial.
- PayPal subscription checkout and verified webhook lifecycle (live once credentials are set).
- Cash verification and magic links.
- CRM: leads, pipeline, tasks, timeline, assignment, SLA escalation worker, reports and agent score.
- Hot intake, pool, pricing, credits and ledger.
- Provenance review, suppression, audit log.
- The UI in 5 languages.

**Needs the owner's access, credentials or decisions**
- An investor-history export file (or read-only API + token) from ai-home.world, plus rights documentation for that data (see `DATA_SOURCE.md`).
- Real Google and PayPal credentials.
- An email provider.
- Legal approval of data sources.
- Hot pricing.

**Next phases (not built yet)**
- Meta, Google Ads, TikTok, LinkedIn, WhatsApp and portal adapters. Today they are shown as NOT CONNECTED, with no fake data.
- The first-party tracking SDK beyond the anonymous search-event endpoint.
- Property inventory and matching.
- SSE live push.
- PostgreSQL migration files.
- Full translation of secondary screens. Navigation, Investor History, transfer flow, CRM actions and pricing are translated; some secondary labels are still English.

## Deploying to Vercel

The repository is ready to import into Vercel: `vercel.json` plus `api/index.js`, with static files served from `public/`.

1. In Vercel, go to **Add New → Project**, import the GitHub repo `ai-data`, and keep the project name **ai-data**. Framework preset: *Other*. Build and output settings come from `vercel.json`.
2. Add environment variables (Project → Settings → Environment Variables) for the mode you want:

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | Permanent storage (required for real use). A PostgreSQL connection string; for Supabase use the **Transaction pooler** string (port 6543) from Connect → Direct. The Supabase integration for Vercel sets `POSTGRES_URL` instead, which is used when `DATABASE_URL` is absent |
| `GOOGLE_CLIENT_ID` | Signing in (nobody can sign in without it) |
| `OWNER_EMAIL`, `OWNER_TOTP_SECRET` | The platform owner account and its MFA |
| `BASE_URL` (optional) | Address used in activation links; defaults to the address the request came in on |
| PayPal variables (optional) | PayPal checkout; cash/bank payments work without them |

**Database.** With `DATABASE_URL` set, all data (sessions, organizations, CRM, payments, investor history) lives in PostgreSQL and is shared by every function instance. Tables are created automatically on first start. Functions run in Dublin (`dub1`, see `vercel.json`) to sit next to a Supabase project in `eu-west-1`; if your database is in another region, change `regions` to the nearest Vercel region, because every query is a network round trip.

The data layer is synchronous (it was built on SQLite): `server/pg.js` runs each Postgres query in a worker thread and waits for the answer, and `tx()` takes a transaction-wide advisory lock so quota and billing transactions are serialized across instances exactly as SQLite's `BEGIN IMMEDIATE` did.

Without `DATABASE_URL` the app falls back to SQLite in `/tmp`, which is reset on cold starts and not shared between instances (users get signed out, CRM data disappears). Use that only for a quick look.

**Tests against Postgres.** `DATABASE_URL=postgres://... npm test` runs the whole suite against that database; each test file works in its own new schema.
