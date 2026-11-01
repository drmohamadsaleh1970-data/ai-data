import { getDb } from './db.js';
import { iso, now, base32Encode } from './util.js';
import { addMonth } from './billing.js';

// DEMO ("sign in as") data. Loaded only when DEMO_MODE=true (see config.demoMode).
// Everything here is FICTIONAL: demo personas, synthetic investors and payments.

// Deterministic PRNG so demo data and tests are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export const DEMO_TOTP_SECRET = base32Encode(Buffer.from('aihome-demo-owner-mfa'));

// Entirely FICTIONAL people and transactions for local evaluation and tests.
export function seedDemo({ investors = 600 } = {}) {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM platform_user WHERE google_sub = 'demo|owner'").get()) return;
  const ts = iso();
  const rand = rng(20261030);
  const pick = (a) => a[Math.floor(rand() * a.length)];

  db.prepare("UPDATE feature_flag SET enabled = 1, note = 'DEMO: fictional dataset approved for demonstration' WHERE key = 'COLD_SUBSCRIBER_TRANSFER'").run();
  const provDemo = Number(db.prepare("INSERT INTO data_provenance (source_name, license_ref, allows_subscriber_transfer, allows_pii_display, notes, reviewed_at) VALUES (?,?,1,1,?,?)")
    .run('DEMO synthetic dataset', 'DEMO-ONLY', 'Fictional records generated for demonstration. Not real people.', ts).lastInsertRowid);
  const provLegacy = Number(db.prepare("INSERT INTO data_provenance (source_name, license_ref, allows_subscriber_transfer, allows_pii_display, notes) VALUES (?,?,0,0,?)")
    .run('DEMO legacy import (rights unverified)', null, 'Simulates records whose legal basis has not been reviewed.').lastInsertRowid);

  const first = ['Adam', 'Layla', 'Omar', 'Sofia', 'Yusuf', 'Elena', 'Karim', 'Mila', 'Hassan', 'Nora', 'Ivan', 'Aylin', 'Lucas', 'Zara', 'Mehmet', 'Chloe', 'Rami', 'Anya', 'Tariq', 'Ines'];
  const last = ['Testwood', 'Samplefield', 'Demoreau', 'Fictiva', 'Placeholder', 'Mockford', 'Exampleton', 'Synthetica', 'Dummar', 'Trialson', 'Prototyp', 'Specimen'];
  const nat = ['Emirati', 'Indian', 'British', 'Russian', 'French', 'Turkish', 'Egyptian', 'Saudi', 'German', 'Chinese', 'Lebanese', 'Pakistani'];
  const areas = {
    Dubai: [['Dubai Marina', 'Emaar', ['Marina Gate (DEMO)', 'Marina Vista (DEMO)']], ['Downtown Dubai', 'Emaar', ['Boulevard Heights (DEMO)', 'Opera Grand (DEMO)']],
      ['Palm Jumeirah', 'Nakheel', ['Palm Tower (DEMO)', 'Shoreline (DEMO)']], ['Business Bay', 'Damac', ['Canal Views (DEMO)', 'Bay Square (DEMO)']],
      ['Jumeirah Village Circle', 'Nakheel', ['JVC Park (DEMO)', 'Circle Mall Res (DEMO)']], ['Dubai Hills Estate', 'Emaar', ['Park Heights (DEMO)', 'Golf Place (DEMO)']]],
    'Abu Dhabi': [['Saadiyat Island', 'Aldar', ['Saadiyat Grove (DEMO)']], ['Al Reem Island', 'Aldar', ['Reem Hills (DEMO)']], ['Yas Island', 'Aldar', ['Yas Acres (DEMO)']]],
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
      ambiguous ? 'AMBIGUOUS' : 'CONFIRMED', 50 + Math.floor(rand() * 50), legacy ? provLegacy : provDemo, ts).lastInsertRowid);
    const n = rand() < 0.25 ? 2 + Math.floor(rand() * 4) : 1;
    for (let k = 0; k < n; k++) {
      const city = rand() < 0.8 ? 'Dubai' : 'Abu Dhabi';
      const [area, dev, projects] = pick(areas[city]);
      const type = pick(types);
      const size = Math.round((type === 'Apartment' ? 50 + rand() * 150 : 150 + rand() * 600) * 10) / 10;
      const price = Math.round(size * (8000 + rand() * 22000) / 1000) * 1000;
      const y = 2015 + Math.floor(rand() * 11);
      const date = `${y}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
      insT.run(id, `DEMO-TXN-${String(txn++).padStart(6, '0')}`, rand() < 0.6 ? 'BUYER' : 'SELLER', 'UAE', city, area, type, dev, pick(projects), size, price, date, legacy ? provLegacy : provDemo);
    }
  }
  db.exec('COMMIT');

  // Fictional profiles: name + a reserved-looking UAE mobile, so no one is asked to complete a profile.
  let phoneSeq = 0;
  const user = (sub, email, name, role = null, mfa = null) => Number(db.prepare('INSERT INTO platform_user (google_sub, email, name, phone, profile_completed_at, platform_role, mfa_secret, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(`demo|${sub}`, email, name, `+97150000${String(++phoneSeq).padStart(4, '0')}`, ts, role, mfa, ts).lastInsertRowid);
  user('owner', 'owner@demo.ai-data.example', 'Platform Owner (DEMO)', 'PLATFORM_OWNER', DEMO_TOTP_SECRET);
  user('finance', 'finance@demo.ai-data.example', 'Finance Admin (DEMO)', 'PLATFORM_FINANCE_ADMIN', DEMO_TOTP_SECRET);
  const director = user('director', 'director@marinacrest.example', 'Dana Director (DEMO)');
  const leader = user('leader', 'leader@marinacrest.example', 'Tom Teamlead (DEMO)');
  const agent1 = user('agent1', 'agent1@marinacrest.example', 'Aisha Agent (DEMO)');
  const agent2 = user('agent2', 'agent2@marinacrest.example', 'Leo Agent (DEMO)');
  const solo = user('solo', 'solo@example.com', 'Sam Solo (DEMO)');
  const pending = user('pending', 'pending@palmgate.example', 'Paula Pending (DEMO)');
  user('newuser', 'new.user@gmail.example', 'New Visitor (DEMO)');

  const org = (name, kind, ownerId) => {
    const id = Number(db.prepare('INSERT INTO organization (name, kind, owner_user_id, business_contact, license_no, terms_accepted_at, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(name, kind, ownerId, '+971 4 000 0000', kind === 'AGENCY' ? 'RERA-DEMO-0001' : null, ts, ts).lastInsertRowid);
    db.prepare("INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,'ORG_OWNER',?)").run(id, ownerId, ts);
    return id;
  };
  const member = (orgId, userId, role) => db.prepare('INSERT INTO membership (org_id, user_id, role, created_at) VALUES (?,?,?,?)').run(orgId, userId, role, ts);
  const activeSub = (orgId, planCode, cents) => {
    const start = new Date(now().getTime() - 5 * 86_400_000);
    const subId = Number(db.prepare(`INSERT INTO subscription (org_id, plan_code, status, provider, external_id, price_snapshot_cents, current_period_start, current_period_end, effective_at, created_at, updated_at)
      VALUES (?,?,'ACTIVE','CASH',?,?,?,?,?,?,?)`).run(orgId, planCode, `cash-DEMO-${orgId}`, cents, start.toISOString(), addMonth(start).toISOString(), start.toISOString(), ts, ts).lastInsertRowid);
    db.prepare("INSERT INTO payment (org_id, subscription_id, provider, amount_cents, currency, status, external_id, receipt_no, paid_at, created_at) VALUES (?,?,'CASH',?,'AED','COMPLETED',?,?,?,?)")
      .run(orgId, subId, cents, `DEMO-${orgId}`, `RCPT-DEMO-${orgId}`, start.toISOString(), ts);
  };
  const agency = org('Marina Crest Realty (DEMO)', 'AGENCY', director);
  member(agency, leader, 'TEAM_LEADER');
  member(agency, agent1, 'AGENT');
  member(agency, agent2, 'AGENT');
  activeSub(agency, 'AGENCY_MONTHLY', 99900);
  db.prepare("INSERT INTO site_key (key, org_id, label) VALUES ('marinacrest-demo-site', ?, 'marinacrest.example')").run(agency);
  // Demo-only platform key (Hot pool). Real keys are created by the owner under Hot Leads.
  db.prepare("INSERT INTO site_key (key, org_id, label) VALUES ('aihome-public', NULL, 'ai-home.world (DEMO)') ON CONFLICT DO NOTHING").run();
  const soloOrg = org('Sam Solo Properties (DEMO)', 'AGENT', solo);
  activeSub(soloOrg, 'AGENT_MONTHLY', 9900);
  const pendingOrg = org('Palm Gate Homes (DEMO)', 'AGENCY', pending);
  db.prepare("INSERT INTO cash_payment_request (org_id, plan_code, amount_cents, currency, reference, status, requested_by, customer_note, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(pendingOrg, 'AGENCY_MONTHLY', 99900, 'AED', 'AIH-DEMO01', 'PENDING_PAYMENT', pending, 'Will pay at the Business Bay office.', ts);

  const searches = [['Dubai Marina', 'Apartment', 2, 2000000], ['Downtown Dubai', 'Apartment', 1, 1800000], ['Palm Jumeirah', 'Villa', 4, 15000000], ['Dubai Hills Estate', 'Villa', 3, 6000000], ['Jumeirah Village Circle', 'Apartment', 1, 900000]];
  const se = db.prepare("INSERT INTO anonymous_search_event (site, event_type, city, area, property_type, bedrooms, budget_max_aed, purpose, created_at) VALUES ('ai-home.world','search_performed','Dubai',?,?,?,?,'buy',?)");
  for (let i = 0; i < 140; i++) { const s = pick(searches); se.run(s[0], s[1], s[2], s[3], ts); }
  return { agency, soloOrg, pendingOrg };
}
