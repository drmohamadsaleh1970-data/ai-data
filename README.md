# AI-HOME.WORLD Portal

A **standalone** portal. It does not run inside www.ai-home.world. It imports only the **investor history data** from ai-home.world (by file or API; see `DATA_SOURCE.md`) and provides everything else itself:

- **Cold Data subscriptions**: Agency at USD 999/month with 999 records a day, and Agent at USD 99/month with 99 a day. Both have unlimited members sharing one allowance that resets at 00:00 Asia/Dubai. Records move into the CRM only.
- A separately billed **Hot Leads** product.
- A multilingual **CRM** in English, Arabic (RTL), French, Russian and Turkish.

See `DATA_SOURCE.md` for how investor data is imported from ai-home.world, `docs/ARCHITECTURE.md` for the design and API, and `docs/COMPLIANCE_CHECKLIST.md` before going live.

## Commands

You need Node.js 22.5 or newer. There are no native builds and no external services.

```bash
npm install                  # install
npm run migrate              # create schema + reference data (plans, sources, flags)
DEMO_MODE=true npm run seed  # FICTIONAL demo data + personas (never in production)
DEMO_MODE=true npm run dev   # http://localhost:3000  (watch mode)
npm run build                # syntax-check all modules
npm test                     # 30 acceptance/integration tests
npm run bootstrap-owner -- --email owner@your-domain.com   # one-time owner bootstrap token
docker compose up --build    # containerized demo
```

To deploy, build the Dockerfile, set `NODE_ENV=production` and the variables in `.env.example`, and mount `/data`. Before real traffic, move to PostgreSQL (see `docs/ARCHITECTURE.md`).

## Demo tour (DEMO_MODE)

Open `/#/signin` and pick a persona.

| Persona | Try |
|---|---|
| Agency Director | Investor History → filter Dubai Marina buyers → select → **Transfer to My CRM** → open the lead |
| Agent (Aisha/Leo) | Sees only their own assigned leads; logs calls and notes; stage changes |
| Solo Agent | 99/day allowance; a large transfer asks before doing a partial transfer |
| Pending cash customer | Billing shows a pending reference. Then, as Finance Admin, verify it (MFA: "DEMO: fill code"). Back as the customer, Billing → *Show my emails* → activation link. |
| Platform Owner | *ai-home.world data import* (upload an export, preview mapping, import), business dashboard, unmasked master DB, XLSX export (MFA), Hot pricing and pool, rights review, opt-outs, audit log |

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

| Mode | Variables | What you get |
|---|---|---|
| **Public demo** (fictional data) | `DEMO_MODE=true`, `ALLOW_PUBLIC_DEMO=true` | Persona sign-in and the full tour. Data lives in `/tmp`: it resets on cold starts and is not shared between instances. For showing the product only. |
| **Real customers** | `GOOGLE_CLIENT_ID`, PayPal variables, `BASE_URL=https://<your-domain>` | Needs a **persistent database** first (see below). |

**Persistent database for production.** Vercel functions have no persistent disk, so real accounts, payments and CRM data must not live in SQLite on `/tmp`. Before taking real customers on Vercel, move the data layer to PostgreSQL (e.g. Neon from the Vercel Marketplace; `docs/ARCHITECTURE.md` describes the same tables and the locking query). The alternative is to run the Docker image on a host with a persistent volume.
