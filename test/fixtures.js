import { getDb } from '../server/db.js';
import { iso, now, base32Encode } from '../server/util.js';
import { addMonth } from '../server/billing.js';

// Deterministic PRNG so fixtures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export const FIXTURE_TOTP_SECRET = base32Encode(Buffer.from('ai-data-test-owner-mfa'));

// Entirely FICTIONAL people and transactions, used only by the automated tests.
// The product never imports this file.
export function seedFixtures({ investors = 600 } = {}) {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM platform_user WHERE google_sub = 'fixture|owner'").get()) return;
  const ts = iso();
  const rand = rng(20261030);
  const pick = (a) => a[Math.floor(rand() * a.length)];

  db.prepare("UPDATE feature_flag SET enabled = 1, note = 'TEST: fictional dataset approved for automated tests' WHERE key = 'COLD_SUBSCRIBER_TRANSFER'").run();
  const provFixture = Number(db.prepare("INSERT INTO data_provenance (source_name, license_ref, allows_subscriber_transfer, allows_pii_display, notes, reviewed_at) VALUES (?,?,1,1,?,?)")
    .run('TEST synthetic dataset', 'TEST-ONLY', 'Fictional records generated for automated tests. Not real people.', ts).lastInsertRowid);
  const provLegacy = Number(db.prepare("INSERT INTO data_provenance (source_name, license_ref, allows_subscriber_transfer, allows_pii_display, notes) VALUES (?,?,0,0,?)")
    .run('TEST legacy import (rights unverified)', null, 'Simulates records whose legal basis has not been reviewed.').lastInsertRowid);

  const first = ['Adam', 'Layla', 'Omar', 'Sofia', 'Yusuf', 'Elena', 'Karim', 'Mila', 'Hassan', 'Nora', 'Ivan', 'Aylin', 'Lucas', 'Zara', 'Mehmet', 'Chloe', 'Rami', 'Anya', 'Tariq', 'Ines'];
  const last = ['Testwood', 'Samplefield', 'Fixturel', 'Fictiva', 'Placeholder', 'Mockford', 'Exampleton', 'Synthetica', 'Dummar', 'Trialson', 'Prototyp', 'Specimen'];
  const nat = ['Emirati', 'Indian', 'British', 'Russian', 'French', 'Turkish', 'Egyptian', 'Saudi', 'German', 'Chinese', 'Lebanese', 'Pakistani'];
  const areas = {
    Dubai: [['Dubai Marina', 'Emaar', ['Marina Gate (TEST)', 'Marina Vista (TEST)']], ['Downtown Dubai', 'Emaar', ['Boulevard Heights (TEST)', 'Opera Grand (TEST)']],
      ['Palm Jumeirah', 'Nakheel', ['Palm Tower (TEST)', 'Shoreline (TEST)']], ['Business Bay', 'Damac', ['Canal Views (TEST)', 'Bay Square (TEST)']],
      ['Jumeirah Village Circle', 'Nakheel', ['JVC Park (TEST)', 'Circle Mall Res (TEST)']], ['Dubai Hills Estate', 'Emaar', ['Park Heights (TEST)', 'Golf Place (TEST)']]],
    'Abu Dhabi': [['Saadiyat Island', 'Aldar', ['Saadiyat Grove (TEST)']], ['Al Reem Island', 'Aldar', ['Reem Hills (TEST)']], ['Yas Island', 'Aldar', ['Yas Acres (TEST)']]],
  };
  const types = ['Apartment', 'Villa', 'Townhouse', 'Plot', 'Commercial'];
  const insC = db.prepare(`INSERT INTO investor_contact (full_name, email, phone, nationality, rights_status, marketing_permission, suppressed, identity_confidence, quality_score, provenance_id, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insT = db.prepare(`INSERT INTO investor_transaction (investor_id, source_txn_id, client_role, country, city, area, property_type, master_developer, project, size_m2, price_aed, registration_date, provenance_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  let txn = 1;
  for (let i = 1; i <= investors; i++) {
    const name = `${pick(first)} ${pick(last)}`;
    const legacy = i % 9 === 0;
    const ambiguous = i % 37 === 0;
    const id = Number(insC.run(name, rand() < 0.8 ? `${name.toLowerCase().replace(/\s/g, '.')}.${i}@example.invalid` : null,
      rand() < 0.85 ? `+97150${String(1000000 + Math.floor(rand() * 8999999)).slice(0, 7)}` : null, pick(nat),
      legacy ? 'RESTRICTED_PENDING_REVIEW' : 'APPROVED', rand() < 0.25 ? 'GRANTED' : 'UNKNOWN', i % 53 === 0 ? 1 : 0,
      ambiguous ? 'AMBIGUOUS' : 'CONFIRMED', 50 + Math.floor(rand() * 50), legacy ? provLegacy : provFixture, ts).lastInsertRowid);
    const n = rand() < 0.25 ? 2 + Math.floor(rand() * 4) : 1;
    for (let k = 0; k < n; k++) {
      const city = rand() < 0.8 ? 'Dubai' : 'Abu Dhabi';
      const [area, dev, projects] = pick(areas[city]);
      const type = pick(types);
      const size = Math.round((type === 'Apartment' ? 50 + rand() * 150 : 150 + rand() * 600) * 10) / 10;
      const price = Math.round(size * (8000 + rand() * 22000) / 1000) * 1000;
      const y = 2015 + Math.floor(rand() * 11);
      const date = `${y}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
      insT.run(id, `TEST-TXN-${String(txn++).padStart(6, '0')}`, rand() < 0.6 ? 'BUYER' : 'SELLER', 'UAE', city, area, type, dev, pick(projects), size, price, date, legacy ? provLegacy : provFixture);
    }
  }
  db.exec('COMMIT');

  const user = (sub, email, name, role = null, mfa = null) => Number(db.prepare('INSERT INTO platform_user (google_sub, email, name, platform_role, mfa_secret, created_at) VALUES (?,?,?,?,?,?)')
    .run(`fixture|${sub}`, email, name, role, mfa, ts).lastInsertRowid);
  user('owner', 'owner@test.ai-data.example', 'Platform Owner (TEST)', 'PLATFORM_OWNER', FIXTURE_TOTP_SECRET);
  user('finance', 'finance@test.ai-data.example', 'Finance Admin (TEST)', 'PLATFORM_FINANCE_ADMIN', FIXTURE_TOTP_SECRET);
  const director = user('director', 'director@marinacrest.example', 'Dana Director (TEST)');
  const leader = user('leader', 'leader@marinacrest.example', 'Tom Teamlead (TEST)');
  const agent1 = user('agent1', 'agent1@marinacrest.example', 'Aisha Agent (TEST)');
  const agent2 = user('agent2', 'agent2@marinacrest.example', 'Leo Agent (TEST)');
  const solo = user('solo', 'solo@example.com', 'Sam Solo (TEST)');
  const pending = user('pending', 'pending@palmgate.example', 'Paula Pending (TEST)');
  user('newuser', 'new.user@gmail.example', 'New Visitor (TEST)');

  const org = (name, kind, ownerId) => {
    const id = Number(db.prepare('INSERT INTO organization (name, kind, owner_user_id, business_contact, license_no, terms_accepted_at, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(name, kind, ownerId, '+971 4 000 0000', kind === 'AGENCY' ? 'RERA-TEST-0001' : null, ts, ts).lastInsertRowid);
    db.prepare("INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,'ORG_OWNER',?)").run(id, ownerId, ts);
    return id;
  };
  const member = (orgId, userId, role) => db.prepare('INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,?,?)').run(orgId, userId, role, ts);
  const activeSub = (orgId, planCode, cents) => {
    const start = new Date(now().getTime() - 5 * 86_400_000);
    const subId = Number(db.prepare(`INSERT INTO subscription (org_id, plan_code, status, provider, external_id, price_snapshot_cents, current_period_start, current_period_end, effective_at, created_at, updated_at)
      VALUES (?,?,'ACTIVE','CASH',?,?,?,?,?,?,?)`).run(orgId, planCode, `cash-TEST-${orgId}`, cents, start.toISOString(), addMonth(start).toISOString(), start.toISOString(), ts, ts).lastInsertRowid);
    db.prepare("INSERT INTO payment (org_id, subscription_id, provider, amount_cents, currency, status, external_id, receipt_no, paid_at, created_at) VALUES (?,?,'CASH',?,'AED','COMPLETED',?,?,?,?)")
      .run(orgId, subId, cents, `TEST-${orgId}`, `RCPT-TEST-${orgId}`, start.toISOString(), ts);
  };
  const agency = org('Marina Crest Realty (TEST)', 'AGENCY', director);
  member(agency, leader, 'TEAM_LEADER');
  member(agency, agent1, 'AGENT');
  member(agency, agent2, 'AGENT');
  activeSub(agency, 'AGENCY_MONTHLY', 99900);
  db.prepare("INSERT INTO site_key (key, org_id, label) VALUES ('marinacrest-test-site', ?, 'marinacrest.example')").run(agency);
  db.prepare("INSERT INTO site_key (key, org_id, label) VALUES ('pool-test-site', NULL, 'ai-home.world (TEST)') ON CONFLICT DO NOTHING").run();
  const soloOrg = org('Sam Solo Properties (TEST)', 'AGENT', solo);
  activeSub(soloOrg, 'AGENT_MONTHLY', 9900);
  const pendingOrg = org('Palm Gate Homes (TEST)', 'AGENCY', pending);
  db.prepare("INSERT INTO cash_payment_request (org_id, plan_code, amount_cents, currency, reference, status, requested_by, customer_note, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(pendingOrg, 'AGENCY_MONTHLY', 99900, 'AED', 'AIH-TEST01', 'PENDING_PAYMENT', pending, 'Will pay at the Business Bay office.', ts);

  const searches = [['Dubai Marina', 'Apartment', 2, 2000000], ['Downtown Dubai', 'Apartment', 1, 1800000], ['Palm Jumeirah', 'Villa', 4, 15000000], ['Dubai Hills Estate', 'Villa', 3, 6000000], ['Jumeirah Village Circle', 'Apartment', 1, 900000]];
  const se = db.prepare("INSERT INTO anonymous_search_event (site, event_type, city, area, property_type, bedrooms, budget_max_aed, purpose, created_at) VALUES ('ai-home.world','search_performed','Dubai',?,?,?,?,'buy',?)");
  for (let i = 0; i < 140; i++) { const s = pick(searches); se.run(s[0], s[1], s[2], s[3], ts); }
  return { agency, soloOrg, pendingOrg };
}
