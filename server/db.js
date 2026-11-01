// Database access. Uses Node's built-in SQLite so the portal runs with zero native
// builds. Production target is PostgreSQL (see docs/ARCHITECTURE.md): tables map 1:1
// and the quota transaction keeps the same compare-and-consume semantics
// (SELECT ... FOR UPDATE on daily_quota_account).
//
// With DATABASE_URL set (production, e.g. Supabase) the same tables live in PostgreSQL
// through server/pg.js, which keeps this synchronous API. Without it, SQLite is used
// (local development and the default test run).
import fs from 'node:fs';
import path from 'node:path';
import { PgConnection } from './pg.js';

export const SCHEMA_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

-- Identity -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_user (
  id INTEGER PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  platform_role TEXT CHECK (platform_role IN ('PLATFORM_OWNER','PLATFORM_FINANCE_ADMIN')),
  mfa_secret TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES platform_user(id),
  active_org_id INTEGER,
  mfa_verified_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_bootstrap (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by INTEGER
);

-- Organizations ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('AGENCY','AGENT')),
  owner_user_id INTEGER NOT NULL REFERENCES platform_user(id),
  business_contact TEXT,
  license_no TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  first_contact_sla_minutes_hot INTEGER NOT NULL DEFAULT 15,
  first_contact_sla_minutes_cold INTEGER NOT NULL DEFAULT 1440,
  terms_accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS membership (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organization(id),
  user_id INTEGER NOT NULL REFERENCES platform_user(id),
  role TEXT NOT NULL CHECK (role IN ('ORG_OWNER','AGENCY_DIRECTOR','ORG_ADMIN','SALES_MANAGER','TEAM_LEADER','AGENT','MARKETING_MANAGER','AUDITOR')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REMOVED')),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitation (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organization(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_invitation_email ON invitation(email);

-- Plans, billing ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plan (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd_cents INTEGER,
  cold_daily_limit INTEGER,          -- NULL = unlimited (owner only)
  seats TEXT NOT NULL,               -- 'UNLIMITED'
  raw_export_allowed INTEGER NOT NULL,
  public_purchasable INTEGER NOT NULL,
  hot_included INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscription (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organization(id),
  plan_code TEXT NOT NULL REFERENCES subscription_plan(code),
  status TEXT NOT NULL CHECK (status IN ('PENDING_PAYMENT','AWAITING_ACTIVATION','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','EXPIRED','REFUNDED')),
  provider TEXT NOT NULL CHECK (provider IN ('PAYPAL','CASH','OWNER_GRANT')),
  external_id TEXT,
  price_snapshot_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  current_period_start TEXT,
  current_period_end TEXT,
  effective_at TEXT,
  last_provider_event_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_subscription_org ON subscription(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_external ON subscription(provider, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS payment (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  subscription_id INTEGER,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'COLD_SUBSCRIPTION' CHECK (kind IN ('COLD_SUBSCRIPTION','HOT_LEADS')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETED','FAILED','REFUNDED','REVERSED')),
  external_id TEXT,
  receipt_no TEXT,
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_provider_event (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_time TEXT,
  verified INTEGER NOT NULL,
  outcome TEXT,
  received_at TEXT NOT NULL,
  UNIQUE (provider, event_id)
);
CREATE TABLE IF NOT EXISTS cash_payment_request (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  plan_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING_PAYMENT','VERIFIED','REJECTED')),
  requested_by INTEGER NOT NULL,
  customer_note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_verification (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE REFERENCES cash_payment_request(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  channel TEXT NOT NULL,
  receipt_no TEXT NOT NULL,
  approver_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activation_magic_link (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  subscription_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY,
  to_user_id INTEGER NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  created_at TEXT NOT NULL
);

-- Cold quota ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_quota_account (
  org_id INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  plan_limit INTEGER NOT NULL,
  committed_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, local_day)
);
CREATE TABLE IF NOT EXISTS quota_ledger (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  investor_id INTEGER,
  job_id INTEGER,
  user_id INTEGER,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS record_acquisition_grant (
  org_id INTEGER NOT NULL,
  investor_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  granted_by INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (org_id, investor_id)
);
CREATE TABLE IF NOT EXISTS cold_transfer_job (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  filter_json TEXT,
  assign_to INTEGER,
  campaign_tag TEXT,
  requested INTEGER NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  already_acquired INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  charged INTEGER NOT NULL DEFAULT 0,
  plan_code TEXT,
  local_day TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS cold_transfer_item (
  job_id INTEGER NOT NULL,
  investor_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('TRANSFERRED','ALREADY_ACQUIRED','REJECTED')),
  reason TEXT,
  charged INTEGER NOT NULL DEFAULT 0,
  crm_lead_id INTEGER,
  PRIMARY KEY (job_id, investor_id)
);
CREATE TABLE IF NOT EXISTS cold_filter_preset (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Historical investor master data (platform-owned) ------------------------------
CREATE TABLE IF NOT EXISTS data_provenance (
  id INTEGER PRIMARY KEY,
  source_name TEXT NOT NULL,
  license_ref TEXT,
  allows_subscriber_transfer INTEGER NOT NULL DEFAULT 0,
  allows_pii_display INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS investor_contact (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  nationality TEXT,
  rights_status TEXT NOT NULL DEFAULT 'RESTRICTED_PENDING_REVIEW' CHECK (rights_status IN ('APPROVED','RESTRICTED_PENDING_REVIEW','DENIED')),
  marketing_permission TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (marketing_permission IN ('UNKNOWN','GRANTED','DENIED')),
  suppressed INTEGER NOT NULL DEFAULT 0,
  identity_confidence TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (identity_confidence IN ('CONFIRMED','AMBIGUOUS')),
  quality_score INTEGER,
  provenance_id INTEGER NOT NULL REFERENCES data_provenance(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS investor_transaction (
  id INTEGER PRIMARY KEY,
  investor_id INTEGER NOT NULL REFERENCES investor_contact(id),
  source_txn_id TEXT NOT NULL UNIQUE,
  client_role TEXT NOT NULL CHECK (client_role IN ('BUYER','SELLER')),
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT NOT NULL,
  property_type TEXT NOT NULL,
  master_developer TEXT,
  project TEXT,
  size_m2 REAL,
  price_aed INTEGER,
  registration_date TEXT NOT NULL,
  provenance_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_txn_investor ON investor_transaction(investor_id);
CREATE INDEX IF NOT EXISTS ix_txn_filters ON investor_transaction(city, area, property_type, registration_date);
CREATE INDEX IF NOT EXISTS ix_txn_price ON investor_transaction(price_aed);
CREATE INDEX IF NOT EXISTS ix_investor_phone ON investor_contact(phone);
CREATE INDEX IF NOT EXISTS ix_investor_email ON investor_contact(lower(email));
CREATE INDEX IF NOT EXISTS ix_investor_name ON investor_contact(lower(full_name));

-- Imports from the ai-home.world investor-history source (file upload or API pull).
CREATE TABLE IF NOT EXISTS source_import_job (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('FILE','API')),
  file_name TEXT,
  started_by INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  rows_read INTEGER NOT NULL DEFAULT 0,
  investors_created INTEGER NOT NULL DEFAULT 0,
  transactions_created INTEGER NOT NULL DEFAULT 0,
  transactions_updated INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT
);

-- CRM (tenant scoped) ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_contact (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  phone_verified_at TEXT,
  nationality TEXT,
  preferred_language TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('COLD','HOT','OWNED','MANUAL','OTHER')),
  investor_id INTEGER,
  marketing_permission TEXT NOT NULL DEFAULT 'UNKNOWN',
  suppressed INTEGER NOT NULL DEFAULT 0,
  raw_import_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_contact_investor ON crm_contact(org_id, investor_id) WHERE investor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_contact_org ON crm_contact(org_id);
CREATE TABLE IF NOT EXISTS crm_lead (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES crm_contact(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('COLD','HOT','OWNED','MANUAL','OTHER')),
  source_detail TEXT NOT NULL,
  provenance_note TEXT,
  stage TEXT NOT NULL DEFAULT 'NEW',
  assigned_user_id INTEGER,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  interest_json TEXT,
  consent_json TEXT,
  campaign_tag TEXT,
  first_contact_due TEXT,
  first_contacted_at TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_lead_org ON crm_lead(org_id, stage);
CREATE TABLE IF NOT EXISTS lead_activity (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS follow_up_task (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  assignee_id INTEGER,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  org_id INTEGER,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

-- Hot leads (separate commercial ledger) -----------------------------------------
CREATE TABLE IF NOT EXISTS hot_lead_source (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONNECTED','NOT_CONNECTED','APPROVAL_REQUIRED','DEGRADED','ERROR')),
  allows_resale INTEGER NOT NULL DEFAULT 0,
  isolation_required INTEGER NOT NULL DEFAULT 0,
  requirements TEXT NOT NULL,
  last_event_at TEXT
);
CREATE TABLE IF NOT EXISTS hot_lead_pricing_rule (
  id INTEGER PRIMARY KEY,
  model TEXT NOT NULL CHECK (model IN ('PER_LEAD','PREPAID_CREDITS','MONTHLY_ALLOCATION','CAMPAIGN_BUDGET')),
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  exclusive INTEGER NOT NULL DEFAULT 1,
  approved INTEGER NOT NULL DEFAULT 0,
  configured_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hot_lead_entitlement (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  pricing_rule_id INTEGER NOT NULL,
  credits_total INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  granted_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hot_lead_pool (
  id INTEGER PRIMARY KEY,
  source_code TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  preferred_language TEXT,
  interest_json TEXT,
  consent_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  allocated_org_id INTEGER,
  allocated_at TEXT,
  UNIQUE (source_code, provider_event_id)
);
CREATE TABLE IF NOT EXISTS hot_lead_billing_ledger (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  pool_id INTEGER NOT NULL UNIQUE,
  crm_lead_id INTEGER NOT NULL,
  entitlement_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_key (
  key TEXT PRIMARY KEY,
  org_id INTEGER,                 -- NULL = platform key (goes to the AI-DATA Hot pool)
  label TEXT NOT NULL,
  allowed_origin TEXT
);
CREATE TABLE IF NOT EXISTS webhook_receipt (
  id INTEGER PRIMARY KEY,
  source_code TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  outcome TEXT,
  UNIQUE (source_code, provider_event_id)
);
CREATE TABLE IF NOT EXISTS anonymous_search_event (
  id INTEGER PRIMARY KEY,
  site TEXT NOT NULL,
  event_type TEXT NOT NULL,
  city TEXT, area TEXT, property_type TEXT, bedrooms INTEGER,
  budget_max_aed INTEGER, purpose TEXT,
  created_at TEXT NOT NULL
);

-- Governance ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feature_flag (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  note TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id INTEGER,
  org_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
CREATE TABLE IF NOT EXISTS owner_export_job (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  filter_json TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  row_count INTEGER,
  status TEXT NOT NULL,
  file_name TEXT,
  created_at TEXT NOT NULL
);
`;

let db;

// DATABASE_URL, or POSTGRES_URL as set by the Supabase integration for Vercel (pooler).
export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const usingPostgres = () => !!databaseUrl();

// SQLite DDL -> PostgreSQL DDL. The schema text above is written once for both.
export function pgSchema(sql = SCHEMA) {
  return sql
    .replace(/\bid INTEGER PRIMARY KEY\b/g, 'id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION');
}

// Columns added after the first release. New installs and existing databases both get
// them on start (CREATE TABLE IF NOT EXISTS never alters an existing table).
const ADDED_COLUMNS = [
  ['platform_user', 'phone', 'TEXT'],                 // E.164, entered before Google sign-in
  ['platform_user', 'profile_completed_at', 'TEXT'],  // set once name + phone are confirmed
  ['membership', 'daily_cap', 'INTEGER'],             // per-user Cold cap inside the shared pool; NULL = no cap
  ['invitation', 'full_name', 'TEXT'],
  ['invitation', 'phone', 'TEXT'],
  ['invitation', 'daily_cap', 'INTEGER'],
];

function addColumns(conn, pg) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (pg) { conn.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`); continue; }
    const has = conn.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
    if (!has) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

const ID_TABLES = new Set([...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(\s*id INTEGER PRIMARY KEY/g)].map((m) => m[1]));

export function openDb(file = process.env.DB_FILE || path.resolve('data/aihome.db')) {
  if (usingPostgres()) return openPostgres();
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  conn.exec(SCHEMA);
  addColumns(conn, false);
  const applied = conn.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION);
  if (!applied) conn.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString());
  return conn;
}

function openPostgres() {
  const schema = process.env.DATABASE_SCHEMA || null; // tests use a private schema
  const conn = new PgConnection(databaseUrl(), {
    schema, idTables: ID_TABLES, poolMax: Number(process.env.DATABASE_POOL_MAX || 3),
  });
  // Several server instances may start at once; the lock lets one create the tables.
  conn.exec('BEGIN');
  try {
    if (schema) conn.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"; SET LOCAL search_path TO "${schema}"`);
    conn.exec(pgSchema());
    addColumns(conn, true);
    // Supabase also publishes the public schema through its REST API (anon key). The app
    // connects as the table owner, which row level security does not restrict, so turning
    // it on with no policies closes that side door without affecting the app.
    conn.exec(`DO $$ DECLARE t record; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND NOT rowsecurity LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
      END LOOP; END $$`);
    const applied = conn.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION);
    if (!applied) conn.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString());
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  return conn;
}

export function getDb() {
  if (!db) db = openDb();
  return db;
}

export function setDb(conn) {
  db = conn;
}

// Runs fn inside BEGIN IMMEDIATE: SQLite takes the write lock up front, so two
// concurrent transfers serialize instead of both reading the same remaining quota.
// On Postgres the same guarantee comes from a transaction-wide advisory lock
// (server/pg-worker.js).
export function tx(fn, conn = getDb()) {
  conn.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(conn);
    conn.exec('COMMIT');
    return out;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}
