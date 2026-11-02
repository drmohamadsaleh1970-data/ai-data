import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { getDb, tx } from './db.js';
import { config } from './config.js';
import { HttpError, iso, audit } from './util.js';
import { normalizePhone } from './crm.js';

// ai-home.world is this portal's investor-data SOURCE only. Records arrive either as an
// export file (XLSX/CSV from the investor-history page) or from a JSON API, and land in
// investor_contact / investor_transaction. Every imported record starts as
// RESTRICTED_PENDING_REVIEW until the owner approves the source's rights.
export const SOURCE_NAME = 'ai-home.world investor-history';

// Header aliases, matched case/space/punctuation-insensitively. The first group are the
// columns visible on ai-home.world/investor-history; contact columns are optional.
const FIELD_ALIASES = {
  source_txn_id: ['transactionid', 'transactionnumber', 'transactionno', 'procedureid', 'procedurenumber', 'txnid', 'id'],
  country: ['country'],
  city: ['city', 'emirate'],
  area: ['areanameen', 'area', 'areaname', 'community'],
  property_type: ['propertytypeen', 'propertytype', 'type'],
  client_role: ['clientrole', 'role', 'procedurerole', 'buyerseller'],
  full_name: ['clientname', 'name', 'fullname', 'client'],
  nationality: ['nationality'],
  master_developer: ['masterdeveloper', 'developer'],
  project: ['projectname', 'project', 'building'],
  size_m2: ['sizem2', 'size', 'areasqm', 'sizesqm'],
  price_aed: ['priceprocedurevalue', 'procedurevalue', 'price', 'amount', 'value'],
  registration_date: ['registrationdate', 'date', 'transactiondate'],
  email: ['email', 'emailaddress'],
  phone: ['phone', 'mobile', 'phone1', 'primaryphone', 'mobilenumber'],
  phone2: ['phone2', 'secondaryphone', 'whatsapp', 'whatsappnumber', 'landline'],
};
const IGNORED = new Set(['pricesqft', 'pricepersqft', 'pricesqm']); // derived values, not stored
const key = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function mapHeaders(headers) {
  const mapping = {};
  const unmapped = [];
  for (const h of headers) {
    const k = key(h);
    if (!k || IGNORED.has(k)) continue;
    const field = Object.keys(FIELD_ALIASES).find((f) => FIELD_ALIASES[f].includes(k) && !Object.values(mapping).includes(f));
    if (field) mapping[h] = field; else unmapped.push(h);
  }
  const fields = new Set(Object.values(mapping));
  const missingRequired = ['full_name', 'client_role', 'registration_date'].filter((f) => !fields.has(f));
  return { mapping, unmapped, missing_required: missingRequired, has_contact_columns: fields.has('email') || fields.has('phone') || fields.has('phone2') };
}

const ROLE = { buyer: 'BUYER', buy: 'BUYER', b: 'BUYER', purchaser: 'BUYER', 'مشتري': 'BUYER', seller: 'SELLER', sell: 'SELLER', s: 'SELLER', vendor: 'SELLER', 'بائع': 'SELLER' };

function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : null;
}

// Dates: Date objects, Excel serials, ISO, or day-first D/M/Y (UAE convention).
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

const clean = (v) => {
  if (v == null) return null;
  const s = (typeof v === 'object' && v.text ? v.text : String(v)).trim();
  return s && !/^(n\/?a|null|-|—)$/i.test(s) ? s.slice(0, 200) : null;
};

export function normalizeRow(raw, mapping) {
  const r = {};
  for (const [h, f] of Object.entries(mapping)) r[f] = raw[h];
  const errors = [];
  const out = {
    full_name: clean(r.full_name),
    client_role: ROLE[String(clean(r.client_role) || '').toLowerCase()] || null,
    registration_date: parseDate(r.registration_date),
    country: clean(r.country) || 'Unknown',
    city: clean(r.city) || 'Unknown',
    area: clean(r.area) || 'Unknown',
    property_type: clean(r.property_type) || 'Unknown',
    master_developer: clean(r.master_developer),
    project: clean(r.project),
    nationality: clean(r.nationality),
    size_m2: parseNumber(r.size_m2),
    price_aed: parseNumber(r.price_aed) == null ? null : Math.round(parseNumber(r.price_aed)),
    email: (() => { const e = clean(r.email)?.toLowerCase(); return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; })(),
    phone: normalizePhone(clean(r.phone)) || normalizePhone(clean(r.phone2)),
  };
  if (!out.full_name) errors.push('client name missing');
  if (!out.client_role) errors.push(`client role not buyer/seller (${clean(r.client_role) ?? 'empty'})`);
  if (!out.registration_date) errors.push(`registration date unreadable (${clean(r.registration_date) ?? 'empty'})`);
  // Stable ID: the source's own transaction ID when present, otherwise a content hash so
  // re-importing the same export never duplicates transactions.
  const given = clean(r.source_txn_id);
  out.source_txn_id = given
    ? `AIH-${given}`
    : 'AIH-H-' + crypto.createHash('sha1').update(JSON.stringify([out.full_name, out.client_role, out.registration_date, out.country, out.city, out.area, out.property_type, out.project, out.size_m2, out.price_aed])).digest('hex').slice(0, 20);
  return { record: out, errors };
}

// --- File parsing (XLSX from exceljs, or CSV) -------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const cellValue = (v) => {
  if (!v || typeof v !== 'object' || v instanceof Date) return v;
  if (v.richText) return v.richText.map((x) => x.text).join('');
  return v.result ?? v.text ?? v.hyperlink ?? null;
};

export async function parseFile(base64, fileName = '') {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE');
  let table;
  if (/\.csv$/i.test(fileName) || (buf[0] !== 0x50 || buf[1] !== 0x4b)) {
    table = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw new HttpError(400, 'EMPTY_WORKBOOK');
    table = [];
    ws.eachRow((row) => table.push(row.values.slice(1).map(cellValue)));
  }
  // The header row is the first row that maps at least the three required columns.
  const headerIdx = table.findIndex((r) => mapHeaders(r.map(String)).missing_required.length === 0);
  if (headerIdx < 0) throw new HttpError(400, 'HEADER_NOT_FOUND', 'Could not find a header row with Client name, Client Role and Registration_Date.');
  const headers = table[headerIdx].map((h) => String(h ?? '').trim());
  return table.slice(headerIdx + 1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

// --- Sync filter ---------------------------------------------------------------------
// The owner chooses which API rows are worth importing. Contact is mandatory for API sync:
// a record with neither a phone nor an email can never be worked, so it is never imported.
// Area terms also match the project name, and common nicknames map to DLD area names.
const AREA_ALIASES = {
  jvc: ['jumeirah village circle', 'al barsha south fourth'],
  'dubai marina': ['dubai marina', 'marsa dubai'],
  marina: ['dubai marina', 'marsa dubai'],
  downtown: ['downtown', 'burj khalifa'],
  'downtown dubai': ['downtown', 'burj khalifa'],
  'business bay': ['business bay'],
  palm: ['palm jumeirah', 'palm jumeira'],
  'palm jumeirah': ['palm jumeirah', 'palm jumeira'],
};
const CONTACT_RULES = ['ANY', 'PHONE', 'EMAIL', 'BOTH'];
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 50);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));
const day = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

export function normalizeFilter(f = {}) {
  f = f || {};
  return {
    contact: CONTACT_RULES.includes(String(f.contact || '').toUpperCase()) ? String(f.contact).toUpperCase() : 'ANY',
    client_role: ['BUYER', 'SELLER'].includes(String(f.client_role || '').toUpperCase()) ? String(f.client_role).toUpperCase() : null,
    nationalities: list(f.nationalities),
    areas: list(f.areas),
    property_types: list(f.property_types),
    min_price_aed: num(f.min_price_aed),
    max_price_aed: num(f.max_price_aed),
    date_from: day(f.date_from),
    date_to: day(f.date_to),
  };
}

export function hasContact(r, rule = 'ANY') {
  if (rule === 'PHONE') return !!r.phone;
  if (rule === 'EMAIL') return !!r.email;
  if (rule === 'BOTH') return !!(r.phone && r.email);
  return !!(r.phone || r.email);
}

// Returns null when the record passes, otherwise the reason it was left out.
export function filterReason(r, f) {
  const has = (value, terms) => { const v = String(value || '').toLowerCase(); return terms.some((t) => v.includes(t)); };
  if (f.client_role && r.client_role !== f.client_role) return 'role';
  if (f.nationalities.length && !has(r.nationality, f.nationalities)) return 'nationality';
  if (f.areas.length) {
    const terms = f.areas.flatMap((a) => AREA_ALIASES[a] || [a]);
    if (!has(r.area, terms) && !has(r.project, terms)) return 'area';
  }
  if (f.property_types.length && !has(r.property_type, f.property_types)) return 'property_type';
  if (f.min_price_aed != null && !(r.price_aed >= f.min_price_aed)) return 'price';
  if (f.max_price_aed != null && !(r.price_aed <= f.max_price_aed)) return 'price';
  if (f.date_from && !(r.registration_date >= f.date_from)) return 'date';
  if (f.date_to && !(r.registration_date <= f.date_to)) return 'date';
  return null;
}

export function describeFilter(f) {
  const parts = [{ ANY: 'phone or email', PHONE: 'phone required', EMAIL: 'email required', BOTH: 'phone and email' }[f.contact]];
  if (f.client_role) parts.push(f.client_role === 'BUYER' ? 'buyers' : 'sellers');
  if (f.nationalities.length) parts.push(`nationality: ${f.nationalities.join(', ')}`);
  if (f.areas.length) parts.push(`area: ${f.areas.join(', ')}`);
  if (f.property_types.length) parts.push(`type: ${f.property_types.join(', ')}`);
  if (f.min_price_aed != null) parts.push(`≥ AED ${f.min_price_aed.toLocaleString('en')}`);
  if (f.max_price_aed != null) parts.push(`≤ AED ${f.max_price_aed.toLocaleString('en')}`);
  if (f.date_from || f.date_to) parts.push(`dates ${f.date_from || '…'} → ${f.date_to || '…'}`);
  return parts.join(' · ');
}

// --- Import --------------------------------------------------------------------------
function provenanceId(conn) {
  const row = conn.prepare('SELECT id FROM data_provenance WHERE source_name = ?').get(SOURCE_NAME);
  if (row) return row.id;
  return Number(conn.prepare('INSERT INTO data_provenance (source_name, license_ref, allows_subscriber_transfer, allows_pii_display, notes) VALUES (?,?,0,0,?)')
    .run(SOURCE_NAME, null, 'Imported from ai-home.world. Rights for subscriber disclosure must be reviewed and approved by the owner.').lastInsertRowid);
}

export function preview(rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const map = mapHeaders(headers);
  const parsed = rows.map((raw, i) => ({ row: i + 1, ...normalizeRow(raw, map.mapping) }));
  return {
    ...map,
    rows: rows.length,
    valid: parsed.filter((p) => !p.errors.length).length,
    rejected: parsed.filter((p) => p.errors.length).length,
    sample_errors: parsed.filter((p) => p.errors.length).slice(0, 10).map((p) => ({ row: p.row, errors: p.errors })),
    parsed,
  };
}

export function importRows({ rows, actor, mode, fileName, filter = null, requireContact = false }) {
  const pv = preview(rows);
  const f = filter ? normalizeFilter(filter) : null;
  // Decide up front which valid rows are kept, so counts are exact and the transaction
  // below only ever sees rows that passed the contact rule and the owner's filter.
  const skipped = { no_contact: 0, by_filter: 0, reasons: {} };
  for (const p of pv.parsed) {
    if (p.errors.length) continue;
    if (requireContact && !hasContact(p.record, f?.contact || 'ANY')) { p.skip = true; skipped.no_contact++; continue; }
    const why = f && filterReason(p.record, f);
    if (why) { p.skip = true; skipped.by_filter++; skipped.reasons[why] = (skipped.reasons[why] || 0) + 1; }
  }
  if (pv.missing_required.length) throw new HttpError(400, 'MISSING_REQUIRED_COLUMNS', pv.missing_required.join(', '));
  const db = getDb();
  const jobId = Number(db.prepare("INSERT INTO source_import_job (source, mode, file_name, started_by, started_at, status, rows_read) VALUES (?,?,?,?,?,'RUNNING',?)")
    .run(SOURCE_NAME, mode, fileName ?? null, actor?.id ?? null, iso(), rows.length).lastInsertRowid);
  const stats = tx((conn) => {
    const prov = provenanceId(conn);
    const ts = iso();
    const s = { investors_created: 0, transactions_created: 0, transactions_updated: 0 };
    const ambiguousNames = new Set();
    for (const { record: r, errors, skip } of pv.parsed) {
      if (errors.length || skip) continue;
      const existingTxn = conn.prepare('SELECT id, investor_id FROM investor_transaction WHERE source_txn_id = ?').get(r.source_txn_id);
      let investorId = existingTxn?.investor_id;
      if (!investorId) {
        // Identity: only an exact phone or email links rows to one person. Names alone
        // never merge; same-name records are flagged AMBIGUOUS for manual review.
        const match = (r.phone && conn.prepare('SELECT id FROM investor_contact WHERE phone = ? AND provenance_id = ?').get(r.phone, prov))
          || (r.email && conn.prepare('SELECT id FROM investor_contact WHERE lower(email) = ? AND provenance_id = ?').get(r.email, prov));
        if (match) investorId = match.id;
        else {
          investorId = Number(conn.prepare(`INSERT INTO investor_contact (full_name, email, phone, nationality, rights_status, marketing_permission, identity_confidence, provenance_id, updated_at)
            VALUES (?,?,?,?,'RESTRICTED_PENDING_REVIEW','UNKNOWN','CONFIRMED',?,?)`).run(r.full_name, r.email, r.phone, r.nationality, prov, ts).lastInsertRowid);
          s.investors_created++;
          const sameName = conn.prepare('SELECT COUNT(*) AS n FROM investor_contact WHERE lower(full_name) = lower(?) AND provenance_id = ?').get(r.full_name, prov).n;
          if (sameName > 1) ambiguousNames.add(r.full_name.toLowerCase());
        }
      }
      // Fill gaps only; never touch rights, suppression or marketing permission.
      conn.prepare('UPDATE investor_contact SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), nationality = COALESCE(nationality, ?), updated_at = ? WHERE id = ?')
        .run(r.email, r.phone, r.nationality, ts, investorId);
      const vals = [r.client_role, r.country, r.city, r.area, r.property_type, r.master_developer, r.project, r.size_m2, r.price_aed, r.registration_date];
      if (existingTxn) {
        conn.prepare(`UPDATE investor_transaction SET client_role=?, country=?, city=?, area=?, property_type=?, master_developer=?, project=?, size_m2=?, price_aed=?, registration_date=? WHERE id = ?`).run(...vals, existingTxn.id);
        s.transactions_updated++;
      } else {
        conn.prepare(`INSERT INTO investor_transaction (investor_id, source_txn_id, client_role, country, city, area, property_type, master_developer, project, size_m2, price_aed, registration_date, provenance_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(investorId, r.source_txn_id, ...vals, prov);
        s.transactions_created++;
      }
    }
    for (const n of ambiguousNames) {
      conn.prepare("UPDATE investor_contact SET identity_confidence = 'AMBIGUOUS' WHERE lower(full_name) = ? AND provenance_id = ? AND phone IS NULL AND email IS NULL").run(n, prov);
    }
    return s;
  });
  const filterText = f || requireContact ? describeFilter(f || normalizeFilter()) : null;
  db.prepare(`UPDATE source_import_job SET finished_at = ?, status = 'COMPLETED', investors_created = ?, transactions_created = ?, transactions_updated = ?, rows_rejected = ?, errors_json = ?,
      rows_skipped_no_contact = ?, rows_skipped_filter = ?, filter_text = ? WHERE id = ?`)
    .run(iso(), stats.investors_created, stats.transactions_created, stats.transactions_updated, pv.rejected, JSON.stringify(pv.sample_errors),
      skipped.no_contact, skipped.by_filter, filterText, jobId);
  audit({ actor: actor?.id, action: 'AIHOME_SOURCE_IMPORT', target: `import:${jobId}`, meta: { mode, fileName, rows: rows.length, ...stats, rejected: pv.rejected, skipped_no_contact: skipped.no_contact, skipped_by_filter: skipped.by_filter, filter: filterText } });
  return { job_id: jobId, rows: rows.length, rejected: pv.rejected, ...stats, skipped_no_contact: skipped.no_contact, skipped_by_filter: skipped.by_filter, skipped_reasons: skipped.reasons, filter: filterText, sample_errors: pv.sample_errors };
}

// --- API pull ----------------------------------------------------------------------
// Expected contract (configure ai-home.world to serve it, or adapt here once its real API
// is known): GET {AIHOME_SOURCE_URL}?page=N with "Authorization: Bearer {token}" returns
// either an array of row objects, or { rows|data|items: [...], next?: url, has_more?: bool }.
// Row keys use the same column names as the investor-history table.
const MAX_PAGES = 500;
async function fetchApiRows() {
  const { url, token } = config.aihomeSource;
  if (!url) throw new HttpError(503, 'AIHOME_SOURCE_NOT_CONNECTED', 'Set AIHOME_SOURCE_URL (and AIHOME_SOURCE_TOKEN) to pull investor data from ai-home.world.');
  const rows = [];
  let next = url;
  for (let page = 1; next && page <= MAX_PAGES; page++) {
    const res = await fetch(next, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!res.ok) throw new HttpError(502, 'AIHOME_SOURCE_ERROR', `ai-home.world answered HTTP ${res.status} on page ${page}`);
    const type = res.headers.get('content-type') || '';
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch {
      const hint = /html/i.test(type) || /^\s*</.test(text)
        ? 'a web page instead of data — the feed address is probably not live yet, or it redirected to a normal page'
        : 'something that is not valid JSON';
      throw new HttpError(502, 'AIHOME_SOURCE_NOT_JSON', `ai-home.world returned ${hint} (HTTP ${res.status}, ${type || 'no content type'}, page ${page}, from ${new URL(res.url || next).host}${new URL(res.url || next).pathname}).`);
    }
    const batch = Array.isArray(body) ? body : body.rows || body.data || body.items || [];
    rows.push(...batch);
    if (!Array.isArray(body) && body.next) next = new URL(body.next, next).href;
    else if (!Array.isArray(body) && body.has_more && batch.length) {
      const u = new URL(url);
      u.searchParams.set('page', String(page + 1));
      next = u.href;
    } else next = null;
  }
  return rows;
}

export function savedSyncFilter() {
  const row = getDb().prepare('SELECT sync_filter_json FROM data_provenance WHERE source_name = ?').get(SOURCE_NAME);
  try { return normalizeFilter(row?.sync_filter_json ? JSON.parse(row.sync_filter_json) : {}); } catch { return normalizeFilter(); }
}

function saveSyncFilter(f, actor) {
  tx((conn) => {
    const prov = provenanceId(conn);
    conn.prepare('UPDATE data_provenance SET sync_filter_json = ? WHERE id = ?').run(JSON.stringify(f), prov);
  });
  audit({ actor: actor?.id, action: 'AIHOME_SYNC_FILTER_SAVED', target: SOURCE_NAME, meta: { filter: describeFilter(f) } });
}

// API sync. Rows without a phone or email are never imported. `filter` (optional, else the
// saved one) narrows what is kept; `dryRun` fetches and counts without writing anything.
export async function syncFromApi({ actor, filter, save = false, dryRun = false } = {}) {
  const f = filter ? normalizeFilter(filter) : savedSyncFilter();
  if (save && !dryRun) saveSyncFilter(f, actor);
  const rows = await fetchApiRows();
  if (dryRun) {
    const pv = preview(rows);
    const out = { rows: rows.length, rejected: pv.rejected, skipped_no_contact: 0, skipped_by_filter: 0, skipped_reasons: {}, would_import: 0, filter: describeFilter(f), sample: [] };
    for (const p of pv.parsed) {
      if (p.errors.length) continue;
      if (!hasContact(p.record, f.contact)) { out.skipped_no_contact++; continue; }
      const why = filterReason(p.record, f);
      if (why) { out.skipped_by_filter++; out.skipped_reasons[why] = (out.skipped_reasons[why] || 0) + 1; continue; }
      out.would_import++;
      if (out.sample.length < 5) {
        const r = p.record;
        out.sample.push({ name: r.full_name, role: r.client_role, nationality: r.nationality, area: r.area, project: r.project, price_aed: r.price_aed, date: r.registration_date, has_phone: !!r.phone, has_email: !!r.email });
      }
    }
    return out;
  }
  return importRows({ rows, actor, mode: 'API', filter: f, requireContact: true });
}

export function sourceStatus() {
  const db = getDb();
  const prov = db.prepare('SELECT * FROM data_provenance WHERE source_name = ?').get(SOURCE_NAME);
  return {
    source: SOURCE_NAME,
    api: config.aihomeSource.url ? 'CONNECTED' : 'NOT_CONNECTED',
    api_url_host: config.aihomeSource.url ? new URL(config.aihomeSource.url).host : null,
    scheduled_sync_minutes: config.aihomeSource.syncMinutes || null,
    sync_filter: savedSyncFilter(),
    suggestions: prov ? {
      nationalities: db.prepare('SELECT nationality AS v FROM investor_contact WHERE provenance_id = ? AND nationality IS NOT NULL GROUP BY nationality ORDER BY COUNT(*) DESC LIMIT 60').all(prov.id).map((x) => x.v),
      areas: db.prepare("SELECT area AS v FROM investor_transaction WHERE provenance_id = ? AND area <> 'Unknown' GROUP BY area ORDER BY COUNT(*) DESC LIMIT 80").all(prov.id).map((x) => x.v),
      property_types: db.prepare("SELECT property_type AS v FROM investor_transaction WHERE provenance_id = ? AND property_type <> 'Unknown' GROUP BY property_type ORDER BY COUNT(*) DESC LIMIT 30").all(prov.id).map((x) => x.v),
    } : { nationalities: [], areas: [], property_types: [] },
    rights_approved: !!prov?.allows_subscriber_transfer,
    totals: prov
      ? db.prepare(`SELECT COUNT(*) AS investors, SUM(CASE WHEN rights_status='APPROVED' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN identity_confidence='AMBIGUOUS' THEN 1 ELSE 0 END) AS ambiguous,
          (SELECT COUNT(*) FROM investor_transaction WHERE provenance_id = ?) AS transactions FROM investor_contact WHERE provenance_id = ?`).get(prov.id, prov.id)
      : { investors: 0, approved: 0, ambiguous: 0, transactions: 0 },
    jobs: db.prepare('SELECT j.*, u.email AS started_by_email FROM source_import_job j LEFT JOIN platform_user u ON u.id = j.started_by ORDER BY j.id DESC LIMIT 20').all(),
  };
}
