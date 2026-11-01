import { translator, LANGS, RTL } from './i18n.js';

// ---------------------------------------------------------------------------------
// Core: state, API, formatting
// ---------------------------------------------------------------------------------
const state = {
  me: null,
  cfg: null,
  lang: safeGet('aih_lang') || (navigator.language || 'en').slice(0, 2),
  ih: { filter: {}, results: [], counts: null, cursor: null, selected: new Set(), options: null, transferEnabled: true },
  owner: { filter: {}, results: [], counts: null, cursor: null, selected: new Set() },
};
if (!LANGS[state.lang]) state.lang = 'en';
let t = translator(state.lang);

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

class ApiError extends Error {
  constructor(status, data) { super(data?.message || data?.error || `HTTP ${status}`); this.status = status; this.data = data || {}; }
}
async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-aihome-csrf': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b = {}, h) => api('POST', u, b, h);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locale = () => ({ en: 'en-GB', ar: 'ar-AE', fr: 'fr-FR', ru: 'ru-RU', tr: 'tr-TR' }[state.lang]);
const TZ = 'Asia/Dubai';
const fmtNum = (n) => (n == null ? '—' : new Intl.NumberFormat(locale()).format(n));
const fmtAED = (n) => (n == null ? '—' : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n));
const fmtMoney = (cents) => (cents == null ? '—' : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'AED', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100));
const fmtDate = (s) => (s ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: TZ }).format(new Date(s)) : '—');
const fmtDT = (s) => (s ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(s)) : '—');
const human = (s) => (s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
const can = (p) => state.me?.permissions?.includes(p);
const isOwner = () => state.me?.user?.platform_role === 'PLATFORM_OWNER';
const isFinance = () => ['PLATFORM_OWNER', 'PLATFORM_FINANCE_ADMIN'].includes(state.me?.user?.platform_role);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast').append(el);
  setTimeout(() => el.remove(), 4200);
}
const errMsg = (e) => (e instanceof ApiError ? `${human(e.data.error)}${e.data.message && e.data.message !== e.data.error ? ' — ' + e.data.message : ''}` : e.message);

function openModal(html) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.id = 'modal';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  document.body.append(back);
  back.querySelector('input, select, button')?.focus();
  return back;
}
function closeModal() { document.getElementById('modal')?.remove(); }

// Owner/finance actions require a fresh TOTP step-up; retry transparently after it.
async function withMfa(fn) {
  try { return await fn(); } catch (e) {
    if (!(e instanceof ApiError) || e.data.error !== 'MFA_REQUIRED') throw e;
    await new Promise((resolve, reject) => {
      openModal(`<h2>${t('verify_identity')}</h2><p class="muted">${t('mfa_prompt')}</p>
        <form id="mfa-form" class="grid"><input type="text" inputmode="numeric" maxlength="6" name="code" autocomplete="one-time-code" required placeholder="123456">
        <div class="row"><button class="btn primary">${t('verify')}</button><button type="button" class="btn ghost" id="mfa-cancel">${t('cancel')}</button>
        ${state.me.demo_mode && state.me.user?.platform_role ? '<button type="button" class="btn sm" id="mfa-demo">DEMO: fill code</button>' : ''}</div></form>`);
      document.getElementById('mfa-cancel').onclick = () => { closeModal(); reject(new Error('MFA cancelled')); };
      document.getElementById('mfa-demo')?.addEventListener('click', async () => { try { document.querySelector('#mfa-form [name=code]').value = (await GET('/api/demo/totp')).code; } catch (err) { toast(errMsg(err), true); } });
      document.getElementById('mfa-form').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await POST('/api/me/mfa/verify', { code: ev.target.code.value }); closeModal(); resolve(); } catch (err) { toast(errMsg(err), true); }
      };
    });
    return fn();
  }
}

// ---------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

async function loadMe() {
  state.me = await GET('/api/me');
  if (state.me.authenticated && state.me.user.locale && !safeGet('aih_lang')) setLang(state.me.user.locale, false);
}

function setLang(l, persist = true) {
  state.lang = l;
  t = translator(l);
  document.documentElement.lang = l;
  document.documentElement.dir = RTL.has(l) ? 'rtl' : 'ltr';
  safeSet('aih_lang', l);
  if (persist && state.me?.authenticated) POST('/api/me/preferences', { locale: l }).catch(() => {});
}

const APP_ROUTES = {
  overview: viewOverview, dashboard: viewDashboard, 'investor-history': viewInvestorHistory, 'my-cold': viewMyCold, hot: viewHot, crm: viewCrm,
  team: viewTeam, reports: viewReports, billing: viewBilling, integrations: viewIntegrations, settings: viewSettings,
  onboarding: viewOnboarding, owner: viewOwner, activate: viewActivate, profile: viewProfile,
};

async function render() {
  const app = document.getElementById('app');
  const { parts, query } = parseHash();
  document.body.classList.remove('nav-open');
  try {
    if (!state.cfg) state.cfg = await GET('/api/auth/config');
    await loadMe();
    const route = parts[0] || '';
    if (!state.me.authenticated) {
      if (route === 'activate' && parts[1]) safeSet('aih_pending_activation', parts[1]);
      app.innerHTML = route === 'signin' || route === 'activate' ? await viewSignIn() : await viewLanding();
      afterSignIn();
      return;
    }
    const pending = safeGet('aih_pending_activation');
    if (pending && route !== 'activate') { safeSet('aih_pending_activation', ''); return go(`#/activate/${pending}`); }
    const hasOrg = !!state.me.active_org;
    let name = route;
    if (!APP_ROUTES[name] || name === '' || name === 'signin') name = hasOrg ? 'overview' : isFinance() ? 'owner' : 'onboarding';
    // Everyone gives a name and mobile number once; until then this is the only page.
    if (!state.me.profile_complete && name !== 'activate') name = 'profile';
    if (!hasOrg && !['onboarding', 'owner', 'activate', 'settings', 'integrations', 'profile'].includes(name)) name = isFinance() ? 'owner' : 'onboarding';
    const html = await APP_ROUTES[name](parts.slice(1), query);
    app.innerHTML = shell(name, parts, html);
    afterRender();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="auth-wrap"><div class="card auth-card"><h2>Something went wrong</h2><p class="muted">${esc(errMsg(e))}</p><a class="btn" href="#/">Home</a></div></div>`;
  }
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------
const logo = (dark) => `<a class="logo" href="#/"><span class="logo-mark">A</span><span>AI-DATA<small${dark ? '' : ''}>Investor Intelligence</small></span></a>`;

// One clear call to action at the top of every page while something needs doing.
function actionBanner(name, parts) {
  const m = state.me;
  if (m.activation_pending && name !== 'billing') {
    return `<a class="banner ok action-banner" href="#/billing" style="display:flex;gap:10px;align-items:center;margin-bottom:16px;text-decoration:none"><b>✓ Payment confirmed.</b> Your activation code is ready — activate your data access now →</a>`;
  }
  if (m.join_requests_waiting && name !== 'team') {
    return `<a class="banner warn action-banner" href="#/team" style="display:flex;gap:10px;align-items:center;margin-bottom:16px;text-decoration:none"><b>${m.join_requests_waiting} agent${m.join_requests_waiting > 1 ? 's' : ''} asked to join your agency.</b> Review on the Team page →</a>`;
  }
  const w = m.approvals_waiting;
  if (w?.to_confirm && !(name === 'owner' && ['approvals', 'finance'].includes(parts[1]))) {
    return `<a class="banner warn action-banner" href="#/owner/approvals" style="display:flex;gap:10px;align-items:center;margin-bottom:16px;text-decoration:none"><b>${w.to_confirm} payment${w.to_confirm > 1 ? 's' : ''} waiting for your confirmation.</b> Open Payment approvals →</a>`;
  }
  return '';
}

function shell(name, parts, content) {
  const link = (href, key, ico, active) => `<a class="nav-link ${active ? 'active' : ''}" href="${href}"><span class="ico">${ico}</span>${esc(t(key))}</a>`;
  const m = state.me;
  const org = m.active_org;
  let nav = '';
  if (org) {
    nav += `<div class="nav-group">${esc(org.name)}</div>`;
    nav += link('#/overview', 'overview', '◎', name === 'overview');
    if (can('crm.all') || can('crm.own')) nav += link('#/dashboard', 'crm_dashboard', '▦', name === 'dashboard');
    if (can('cold.search')) nav += link('#/investor-history', 'investor_history', '❄', name === 'investor-history');
    if (can('cold.search')) nav += link('#/my-cold', 'my_cold', '▤', name === 'my-cold');
    if (can('hot.view')) nav += link('#/hot', 'hot_leads', '🔥', name === 'hot');
    if (can('crm.all') || can('crm.own')) nav += link('#/crm', 'crm', '☰', name === 'crm');
    nav += link('#/team', 'team', '◉', name === 'team');
    if (can('reports.view')) nav += link('#/reports', 'reports', '▲', name === 'reports');
    nav += link('#/billing', 'billing', '◈', name === 'billing');
    nav += link('#/integrations', 'integrations', '⇄', name === 'integrations');
    nav += link('#/settings', 'settings', '⚙', name === 'settings');
  }
  if (isFinance()) {
    const sub = parts[1] || 'dashboard';
    nav += `<div class="nav-group">${t('owner_console')}</div>`;
    const waiting = (m.approvals_waiting?.to_confirm || 0) + (m.approvals_waiting?.awaiting_activation || 0);
    const approvalsActive = name === 'owner' && (sub === 'approvals' || sub === 'finance');
    nav += `<a class="nav-link ${approvalsActive ? 'active' : ''}" href="#/owner/approvals"><span class="ico">✓</span>Payment approvals${waiting ? ` <span class="badge ${m.approvals_waiting.to_confirm ? 'bad' : 'gold'}" style="margin-inline-start:auto" aria-label="${waiting} waiting">${waiting}</span>` : ''}</a>`;
    nav += link('#/owner', 'owner_dashboard', '◆', name === 'owner' && sub === 'dashboard');
    if (isOwner()) {
      nav += link('#/owner/source', 'data_source', '⇩', name === 'owner' && sub === 'source');
      nav += link('#/owner/crm', 'crm_monitor', '▦', name === 'owner' && sub === 'crm');
      nav += link('#/owner/data', 'master_data', '⛁', name === 'owner' && sub === 'data');
      nav += link('#/owner/hot', 'hot_admin', '🔥', name === 'owner' && sub === 'hot');
      nav += link('#/owner/governance', 'governance', '⚖', name === 'owner' && sub === 'governance');
      nav += link('#/owner/audit', 'audit', '≣', name === 'owner' && sub === 'audit');
    }
    if (!org) nav += link('#/settings', 'settings', '⚙', name === 'settings');
  }
  const orgSwitch = m.memberships.length > 1
    ? `<select data-change="switch-org" aria-label="Organization" style="width:auto">${m.memberships.map((x) => `<option value="${x.org_id}" ${org?.org_id === x.org_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
    : '';
  const q = m.entitlements?.cold?.quota;
  const myCap = m.my_quota?.cap != null ? `<span class="hide-sm" title="Your personal daily limit">· you ${fmtNum(m.my_quota.used)}/${fmtNum(m.my_quota.cap)}</span>` : '';
  const quota = q ? `<div class="quota-pill" title="${esc(t('resets_midnight'))}">❄ ${fmtNum(q.committed_used)} / ${fmtNum(q.plan_limit)}<span class="bar"><i style="width:${Math.min(100, (q.committed_used / q.plan_limit) * 100)}%"></i></span><span class="hide-sm">${fmtNum(q.remaining)} ${t('remaining')}</span>${myCap}</div>` : '';
  return `${m.demo_mode ? `<div class="demo-strip">${t('demo_banner')}</div>` : ''}
  <div class="shell">
    <aside class="side">${logo(true)}${nav}
      <div class="spacer"></div>
      <div class="small" style="padding:10px;color:#8193a8">${esc(m.user.name)}<br>${esc(m.user.email)}${m.user.platform_role ? `<br><span class="badge gold" style="margin-top:6px">${esc(human(m.user.platform_role))}</span>` : ''}${org ? `<br><span class="badge" style="margin-top:6px">${esc(human(org.role))}</span>` : ''}</div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="btn ghost menu-btn" data-act="menu" aria-label="Menu">☰</button>
        ${orgSwitch}<div class="spacer"></div>${quota}
        <select data-change="lang" aria-label="${t('language')}" style="width:auto">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === state.lang ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn ghost bell" data-act="notifs" aria-label="${t('notifications')}">🔔${m.unread_notifications ? `<span class="count">${m.unread_notifications}</span>` : ''}</button>
        <button class="btn sm" data-act="logout">${t('sign_out')}</button>
      </header>
      <main class="page">${actionBanner(name, parts)}${content}</main>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------
// Public: landing + sign-in
// ---------------------------------------------------------------------------------
async function viewLanding() {
  const { plans, hot } = await GET('/api/public/plans');
  const langSel = `<select data-change="lang" style="width:auto">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === state.lang ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const card = (p) => `<div class="price-card ${p.code === 'AGENCY_MONTHLY' ? 'featured' : ''}">
      <div class="row"><h3 style="font-size:22px;font-family:var(--display)">${esc(p.name)}</h3>${p.code === 'AGENCY_MONTHLY' ? '<span class="badge gold">Agencies</span>' : '<span class="badge">Independent agents</span>'}</div>
      <div><span class="price">${fmtMoney(p.price_usd_cents)}</span> <span class="muted">${t('per_month')}</span></div>
      <ul><li><b>${fmtNum(p.cold_daily_limit)}</b>&nbsp;${t('cold_per_day')}</li><li>${t('unlimited_members')}</li><li>${t('shared_quota')}</li><li>${t('full_crm')}</li><li>${t('crm_only')}</li><li class="no">${t('hot_not_included')}</li></ul>
      <a class="btn ${p.code === 'AGENCY_MONTHLY' ? 'gold' : 'primary'} block" href="#/signin">${t('continue_google')}</a></div>`;
  return `${state.cfg.demo_mode ? `<div class="demo-strip">${t('demo_banner')}</div>` : ''}
  <nav class="pub-nav">${logo()}<div class="spacer"></div><a href="#pricing" class="hide-sm" style="text-decoration:none;font-weight:600">${t('pricing')}</a>${langSel}<a class="btn primary" href="#/signin">${t('sign_in')}</a></nav>
  <section class="hero">
    <div><div class="kicker">${t('hero_kicker')}</div><h1>${t('hero_title')}</h1><p>${t('hero_sub')}</p>
      <div class="row" style="margin-top:24px"><a class="btn gold" href="#/signin">${t('get_started')}</a><a class="btn" href="#pricing">${t('pricing')}</a></div></div>
    <div class="hero-card" aria-label="Product preview (illustrative)">
      <div class="row" style="margin-bottom:8px"><span class="badge cold">❄ COLD</span><span class="small" style="color:#8ea0b5">Masked preview · illustrative</span></div>
      <div class="mini-row"><span class="masked">K••• P•••</span><span>Dubai Marina · Villa</span></div>
      <div class="mini-row"><span class="masked">+971 ••• ••43</span><span>4 transactions</span></div>
      <div class="mini-row"><span>Rights</span><span class="badge ok">Approved</span></div>
      <div style="margin:16px 0 8px" class="row"><span class="badge hot">🔥 HOT</span><span class="small" style="color:#8ea0b5">New enquiry · consent recorded</span></div>
      <div class="mini-row"><span>2BR · Dubai Marina · ≤ AED 2M</span><span>respond ≤ 15 min</span></div>
    </div>
  </section>
  <section class="section" id="pricing"><h2>${t('pricing')}</h2><p class="muted" style="margin-bottom:22px">${t('shared_quota')} · ${t('resets_midnight')}</p>
    <div class="grid g3">${plans.map(card).join('')}
      <div class="price-card hot"><div class="row"><h3 style="font-size:22px;font-family:var(--display)">${t('hot_priced_separately')}</h3></div>
        <p class="muted" style="margin:0">${t('hot_desc')}</p>
        ${hot.configured ? `<div><span class="price">${fmtMoney(hot.rule.price_cents)}</span> <span class="muted">${human(hot.rule.model)}</span></div>` : `<span class="badge warn">${t('owner_config_required')}</span>`}
        <ul><li>Consent evidence on every lead</li><li>Instant agent alert + response SLA</li><li>Separate ledger — never uses Cold quota</li></ul>
        <a class="btn block" href="#/signin">${t('sign_in')}</a></div>
    </div></section>
  <section class="section"><div class="grid g2">
    <div><h2>${t('how_it_works')}</h2><div class="row" style="margin:12px 0 8px"><span class="badge cold">❄ Cold</span></div>
      <div class="steps"><div class="step">${t('step_search')}</div><div class="step">${t('step_transfer')}</div><div class="step">${t('step_follow')}</div></div>
      <div class="row" style="margin:18px 0 8px"><span class="badge hot">🔥 Hot</span></div>
      <div class="steps"><div class="step">${t('step_hot1')}</div><div class="step">${t('step_hot2')}</div><div class="step">${t('step_hot3')}</div></div></div>
    <div class="card" style="align-self:start"><h3>⚖ ${t('compliance_title')}</h3><p class="muted">${t('compliance_body')}</p>
      <div class="chips"><span class="chip">UAE PDPL-aware controls</span><span class="chip">Opt-out propagation</span><span class="chip">Per-record provenance</span><span class="chip">Audit log</span></div></div>
  </div></section>
  <footer class="footer">© ${new Date().getFullYear()} AI-DATA Portal · Investor history data sourced from ai-home.world · CRM · Hot Leads. Software supports compliance; it does not certify legality.</footer>`;
}

// Step 1: choose how you are signing in. Step 2: Google proves who you are. The choice
// decides how a NEW account is set up; it never grants a role by itself (owner and finance
// access come only from settings / the owner, and team members join by invitation).
const SIGNIN_ROLES = [
  ['director', 'Agency', 'Run an agency · AED 999/month · 999 records a day shared by your team'],
  ['solo', 'Solo agent', 'Work on your own · AED 99/month · 99 records a day'],
  ['member', 'Agent in an agency', 'Work under your agency’s account — your agency approves you and sets your daily limit'],
  ['owner', 'Platform owner', 'AI-DATA owner console (owner’s Google account only)'],
  ['finance', 'Finance admin', 'Verify payments, activation links (approved accounts only)'],
];

// Details typed before Google sign-in live only in this browser tab until sign-in ends.
const SIGNUP_KEY = 'aih_signup_profile';
function signupProfile() { try { return JSON.parse(sessionStorage.getItem(SIGNUP_KEY) || 'null'); } catch { return null; } }
function setSignupProfile(p) { try { p ? sessionStorage.setItem(SIGNUP_KEY, JSON.stringify(p)) : sessionStorage.removeItem(SIGNUP_KEY); } catch { /* private mode */ } }

const ROLE_HINTS = {
  director: 'You will create your agency account next. Your team shares the agency\'s 999 records a day; you can give each member a personal daily limit.',
  solo: 'You will create your agent account next: 99 records a day for you.',
  member: 'Choose your agency below. After you sign in, your agency approves you and sets your role and daily limit. If your agency already invited you, use the email they invited.',
  owner: 'Only the platform owner\'s Google account is accepted.',
  finance: 'Only approved finance accounts are accepted.',
};

// Agency picker: type part of the name, choose from the list (names only).
function agencyField(label = 'Your agency') {
  return `<label class="field">${label}<input type="text" name="agency" required autocomplete="off" list="agency-options" data-agency-search placeholder="Start typing the agency name"><datalist id="agency-options"></datalist>
    <span class="small muted">Your agency must already have an AI-DATA account.</span></label>`;
}
async function resolveAgency(name) {
  const n = String(name || '').trim().toLowerCase();
  const list = await GET(`/api/public/agencies?q=${encodeURIComponent(n)}`);
  const hit = list.find((a) => a.name.toLowerCase() === n) || (list.length === 1 ? list[0] : null);
  if (!hit) throw new Error(list.length ? 'Several agencies match — choose yours from the list.' : 'No agency with that name. Check the spelling, or ask your agency for its exact name on AI-DATA.');
  return hit;
}
document.addEventListener('input', async (e) => {
  const el = e.target.closest?.('[data-agency-search]');
  if (!el || el.value.trim().length < 2) return;
  try {
    const list = await GET(`/api/public/agencies?q=${encodeURIComponent(el.value.trim())}`);
    const dl = document.getElementById('agency-options');
    if (dl) dl.innerHTML = list.map((a) => `<option value="${esc(a.name)}"></option>`).join('');
  } catch { /* typing continues */ }
});

async function viewSignIn() {
  const c = state.cfg;
  const pendingActivation = safeGet('aih_pending_activation');
  const role = pendingActivation ? 'activation' : safeGet('aih_signin_role');
  const chosen = SIGNIN_ROLES.find(([k]) => k === role);
  const profile = signupProfile();
  const returning = state.signinReturning === true;
  const ready = !!role && (pendingActivation || returning || !!profile);
  const google = c.google_client_id ? '<div id="gsi-btn" style="min-height:44px"></div>' : `<button class="btn block" disabled>G&nbsp; ${t('continue_google')}</button><div class="banner warn">Google sign-in is <b>${t('not_connected')}</b> on this deployment. Set GOOGLE_CLIENT_ID.</div>`;
  const step = (n, title, done) => `<div class="row"><span class="badge ${done ? 'ok' : 'gold'}">${done ? '✓' : n}</span><h3 style="margin:0">${title}</h3></div>`;

  const roleCard = pendingActivation ? '' : `<div class="card grid">${step(1, 'Choose your account type', !!role)}
      ${SIGNIN_ROLES.map(([k, n, d]) => `<button class="persona" data-act="pick-role" data-role="${k}" ${k === role ? 'style="border:2px solid var(--gold)" aria-pressed="true"' : 'aria-pressed="false"'}><span class="avatar">${k === role ? '✓' : n[0]}</span><span><b>${n}</b><br><span class="small muted">${d}</span></span></button>`).join('')}</div>`;

  let details = '';
  if (role && !pendingActivation) {
    details = profile && !returning
      ? `<div class="card grid">${step(2, 'Your details', true)}
          <div class="kv"><span class="k">Full name</span><span class="v">${esc(profile.full_name)}</span><span class="k">Mobile</span><span class="v mono">${esc(profile.phone)}</span><span class="k">Email</span><span class="v">${esc(profile.email)}</span>${profile.agency_name ? `<span class="k">Agency</span><span class="v"><b>${esc(profile.agency_name)}</b></span>` : ''}</div>
          <button class="btn sm ghost" data-act="signup-edit" style="justify-self:start">Edit details</button></div>`
      : returning
        ? `<div class="card grid">${step(2, 'Welcome back', true)}<p class="small muted" style="margin:0">Sign in with the Google account you registered with. <a href="#" data-act="signup-new">New here? Enter your details</a></p></div>`
        : `<form class="card grid" data-form="signup-profile" style="gap:12px">${step(2, 'Your details', false)}
            <p class="small muted" style="margin:0">${esc(ROLE_HINTS[role] || '')}</p>
            <label class="field">Full name<input type="text" name="full_name" required minlength="2" maxlength="120" autocomplete="name" placeholder="e.g. Sara Al Mansouri"></label>
            <label class="field">Mobile number<input type="tel" name="phone" required autocomplete="tel" inputmode="tel" placeholder="+971 50 123 4567"></label>
            <label class="field">Email<input type="email" name="email" required autocomplete="email" placeholder="name@company.com"><span class="small muted">Must be the email of the Google account you will sign in with.</span></label>
            ${role === 'member' ? agencyField() : ''}
            <div class="row"><button class="btn primary">Continue</button><a href="#" class="small" data-act="signup-returning">I already have an account</a></div>
          </form>`;
  }

  return `<div class="auth-wrap"><div class="auth-card">
    <div style="text-align:center">${logo()}</div>
    ${roleCard}${details}
    <div class="card grid">
      ${pendingActivation ? `<h2 style="margin:0">${t('sign_in')}</h2>` : step(3, `${t('sign_in')} with Google${chosen ? ` · ${esc(chosen[1])}` : ''}`, false)}
      ${pendingActivation ? `<div class="banner ok">Sign in with the Google account your activation email was sent to.</div>` : ''}
      ${ready ? google : `<p class="muted" style="margin:0">${role ? 'Enter your details above, then continue with Google.' : 'Choose your account type above.'}</p>`}
      <p class="small muted">We only use your Google identity (name, email, account ID) to sign you in. We never request access to your inbox.</p>
    </div>
    <a href="#/" class="small muted" style="text-align:center">← AI-DATA</a>
  </div></div>`;
}

function afterSignIn() {
  const el = document.getElementById('gsi-btn');
  if (!el || !state.cfg.google_client_id) return;
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: state.cfg.google_client_id, nonce: state.cfg.nonce, ux_mode: 'popup',
      callback: async ({ credential }) => {
        try {
          const profile = state.signinReturning ? null : signupProfile();
          await POST('/api/auth/google', { credential, ...(profile ? { profile } : {}) });
          setSignupProfile(null);
          state.signinReturning = false;
          state.cfg = null;
          const role = safeGet('aih_signin_role');
          if (['owner', 'finance'].includes(role)) {
            await loadMe();
            if (!isFinance()) toast(`This Google account (${state.me.user.email}) has no ${role === 'owner' ? 'platform owner' : 'finance'} access.`, true);
          }
          go('#/');
        } catch (e) { toast(errMsg(e), true); }
      },
    });
    window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 360, text: 'continue_with', locale: state.lang });
  };
  if (window.google?.accounts?.id) return init();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = init;
  document.head.append(s);
}

// ---------------------------------------------------------------------------------
// Profile: name + mobile for every account (asked once, editable later)
// ---------------------------------------------------------------------------------
async function viewProfile() {
  const u = state.me.user;
  const first = !state.me.profile_complete;
  return `<div class="page-head"><div><div class="kicker">${first ? 'One more step' : 'Account'}</div><h1>${first ? 'Complete your profile' : 'Your profile'}</h1></div></div>
  ${first ? '<div class="banner cold" style="max-width:640px;margin-bottom:16px">Every account needs a full name and a mobile number before continuing.</div>' : ''}
  <form class="card grid" data-form="profile" style="max-width:640px;gap:12px">
    <label class="field">Full name<input type="text" name="full_name" required minlength="2" maxlength="120" autocomplete="name" value="${esc(u.name || '')}"></label>
    <label class="field">Mobile number<input type="tel" name="phone" required autocomplete="tel" inputmode="tel" placeholder="+971 50 123 4567" value="${esc(u.phone || '')}"></label>
    <label class="field">Email (Google account)<input type="email" value="${esc(u.email)}" disabled></label>
    ${state.me.my_quota ? `<div class="small muted">Your daily limit in ${esc(state.me.active_org?.name || '')}: ${state.me.my_quota.cap == null ? 'shared account allowance (no personal limit)' : `<b>${fmtNum(state.me.my_quota.cap)}</b> records a day`}</div>` : ''}
    <div class="row"><button class="btn primary">${first ? 'Save and continue' : 'Save'}</button></div>
  </form>`;
}

// ---------------------------------------------------------------------------------
// Onboarding & activation
// ---------------------------------------------------------------------------------
async function viewOnboarding(_p, query = {}) {
  const role = safeGet('aih_signin_role');
  const reqs = state.me.join_requests || [];
  const pending = reqs.find((r) => r.status === 'PENDING');
  const declined = reqs.find((r) => r.status === 'DECLINED');
  if (!query.own && (pending || role === 'member')) {
    return `<div class="page-head"><div><div class="kicker">Agent in an agency</div><h1>${pending ? 'Waiting for approval' : 'Join your agency'}</h1></div></div>
    ${pending ? `<div class="card grid" style="max-width:640px;gap:10px"><div class="banner cold">⏳ You asked to join <b>${esc(pending.org_name)}</b> on ${fmtDT(pending.created_at)}. As soon as they approve you, this page opens your agency's workspace.</div>
        <p class="small muted" style="margin:0">Your agency sees your name, email and mobile on its Team page. You can remind them, or cancel and choose another agency.</p>
        <div class="row"><button class="btn" data-act="join-refresh">Check again</button><button class="btn ghost" data-act="join-cancel" data-id="${pending.id}">Cancel request</button></div></div>`
      : `<form class="card grid" data-form="join-agency" style="max-width:640px;gap:12px">
        ${declined ? `<div class="banner warn">${esc(declined.org_name)} did not approve your request. Choose another agency or create your own account.</div>` : ''}
        <p class="small muted" style="margin:0">Type your agency's name and choose it. They will approve you and set your role and daily limit.</p>
        ${agencyField()}<button class="btn primary" style="justify-self:start">Ask to join</button></form>`}
    <p class="small" style="margin-top:16px">Working on your own instead? <a href="#/onboarding?own=1">Create my own account</a></p>`;
  }
  const plans = (await GET('/api/public/plans')).plans;
  const want = role === 'solo' ? 'AGENT_MONTHLY' : 'AGENCY_MONTHLY';
  const pick = plans.some((p) => p.code === want) ? want : plans[0]?.code;
  const memberNote = role === 'member' && !query.own ? `<div class="banner warn" style="max-width:760px;margin-bottom:16px"><b>Joining an agency?</b> Ask your agency director to invite <b>${esc(state.me.user.email)}</b> under Team, then sign in again. You only need the form below if you want your own organization.</div>` : '';
  return `<div class="page-head"><div><div class="kicker">Step 1 of 2</div><h1>${t('create_org')}</h1></div></div>
  ${memberNote}<form class="card grid" data-form="create-org" style="max-width:760px">
    <div class="grid g2">${plans.map((p) => `<label class="persona" style="cursor:pointer"><input type="radio" name="plan" value="${p.code}" ${p.code === pick ? 'checked' : ''}>
      <span><b>${esc(p.name)} · ${fmtMoney(p.price_usd_cents)}${t('per_month')}</b><br><span class="small muted">${fmtNum(p.cold_daily_limit)} ${t('cold_per_day')} · ${t('unlimited_members')}</span></span></label>`).join('')}</div>
    <div class="grid g2">
      <label class="field">${t('org_name')}<input type="text" name="name" required maxlength="120"></label>
      <label class="field">${t('business_contact')}<input type="text" name="business_contact" maxlength="120"></label>
      <label class="field">${t('license_no')}<input type="text" name="license_no" maxlength="60"></label>
      <label class="field">${t('language')}<select name="language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === state.lang ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">${t('timezone')}<select name="timezone"><option>Asia/Dubai</option><option>Asia/Riyadh</option><option>Europe/London</option><option>Europe/Istanbul</option><option>Europe/Moscow</option><option>Europe/Paris</option></select></label>
    </div>
    <label class="check"><input type="checkbox" name="terms" required> ${t('accept_terms')}</label>
    <div class="banner cold">ℹ Your organization is created with <b>no active data access</b>. Access starts only after payment is confirmed.</div>
    <div><button class="btn gold">${t('continue')}</button></div>
  </form>`;
}

const ACTIVATION_ERRORS = {
  LINK_INVALID: 'That activation code is not valid. Check the 8 characters and try again.',
  CODE_INVALID: 'Activation codes have 8 characters, like ABCD-2345.',
  LINK_ALREADY_USED: 'This code was already used — your subscription should be active.',
  LINK_REVOKED: 'A newer code was sent to you. Use the latest code (see your notifications or Billing page).',
  LINK_EXPIRED: 'This code has expired. Ask AI-DATA for a new code.',
  LINK_WRONG_ACCOUNT: 'This code belongs to a different account. Sign in with the Google account that requested the payment.',
};

async function viewActivate([token]) {
  return `<div class="page-head"><h1>${t('activate_title')}</h1></div>
  <div class="card grid" style="max-width:560px">
    <p>Signed in as <b>${esc(state.me.user.email)}</b>. The link only works for the Google account it was issued to, and only once.</p>
    <div><button class="btn gold" data-act="activate" data-token="${esc(token || '')}">${t('activate')}</button></div>
  </div>`;
}

// ---------------------------------------------------------------------------------
// Subscriber views
// ---------------------------------------------------------------------------------
function quotaBlock(q) {
  if (!q) return `<div class="banner warn">${t('no_active_plan')} — <a href="#/billing">${t('billing')}</a></div>`;
  const pct = Math.min(100, (q.committed_used / q.plan_limit) * 100);
  return `<div class="stat cold"><span class="l">❄ ${t('today')}</span><span class="v">${fmtNum(q.committed_used)} / ${fmtNum(q.plan_limit)} <span style="font-size:15px">${t('transferred')}</span></span></div>
    <div class="meter" style="margin:10px 0"><i style="width:${pct}%"></i></div>
    <div class="small muted"><b>${fmtNum(q.remaining)}</b> ${t('remaining')} · ${t('resets_midnight')} (${fmtDT(q.resets_at)})</div>`;
}

async function viewOverview() {
  const e = state.me.entitlements;
  const [tasks, leads] = await Promise.all([GET('/api/crm/tasks').catch(() => []), GET('/api/crm/leads').catch(() => [])]);
  const overdue = tasks.filter((x) => new Date(x.due_at) < new Date());
  const newLeads = leads.filter((l) => l.stage === 'NEW');
  const cold = e.cold;
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('overview')}</h1></div></div>
  <div class="grid g4">
    <div class="card"><div class="stat"><span class="l">${t('plan')}</span><span class="v" style="font-size:22px">${cold.active ? esc(cold.plan_name) : '—'}</span></div>
      <div class="small muted" style="margin-top:6px">${cold.active ? `${t('renews')}: ${fmtDate(cold.period_end)} · ${esc(human(cold.provider))}` : esc(human(cold.latest?.status || 'NO_SUBSCRIPTION'))}</div></div>
    <div class="card" style="grid-column: span 2">${quotaBlock(cold.quota)}</div>
    <div class="card"><div class="stat hot"><span class="l">🔥 ${t('hot_balance')}</span><span class="v">${fmtNum(e.hot.credits_remaining)}</span></div><div class="small muted" style="margin-top:6px">${t('separate_billing')}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${t('my_tasks')} <span class="badge ${overdue.length ? 'bad' : 'ok'}">${overdue.length} ${t('overdue')}</span></h3>
      ${tasks.length ? `<div class="table-wrap"><table><tbody>${tasks.slice(0, 8).map((x) => `<tr class="click" data-href="#/crm/lead/${x.lead_id}"><td>${srcBadge(x.source_type)}</td><td><b>${esc(x.full_name)}</b><br><span class="small muted">${esc(x.title)}</span></td><td class="num ${new Date(x.due_at) < new Date() ? '' : 'muted'}" style="${new Date(x.due_at) < new Date() ? 'color:var(--bad);font-weight:700' : ''}">${fmtDT(x.due_at)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">✓</div>`}</div>
    <div class="card"><h3>${t('get_started')}</h3>
      <div class="row" style="margin-bottom:8px"><span class="badge cold">❄ Cold</span></div>
      <div class="steps"><a class="step" href="#/investor-history">${t('step_search')}</a><a class="step" href="#/investor-history">${t('step_transfer')}</a><a class="step" href="#/crm">${t('step_follow')}</a></div>
      <div class="row" style="margin:14px 0 8px"><span class="badge hot">🔥 Hot</span></div>
      <div class="steps"><a class="step" href="#/hot">${t('step_hot1')}</a><a class="step" href="#/crm?source=HOT">${t('step_hot2')}</a><a class="step" href="#/crm?source=HOT">${t('step_hot3')}</a></div>
      <p class="small muted" style="margin-top:12px">${fmtNum(newLeads.length)} new lead(s) waiting for first contact.</p></div>
  </div>`;
}

const srcBadge = (s) => (s === 'COLD' ? '<span class="badge cold">❄ COLD</span>' : s === 'HOT' ? '<span class="badge hot">🔥 HOT</span>' : `<span class="badge">${esc(s)}</span>`);
const REASON_LABEL = {
  RIGHTS_PENDING_REVIEW: 'Rights pending review', SUPPRESSED_DO_NOT_CONTACT: 'Do-not-contact', TRANSFER_DISABLED_PENDING_LEGAL_APPROVAL: 'Transfers disabled pending legal approval',
  DAILY_QUOTA_EXHAUSTED: 'Daily allowance used up', USER_DAILY_CAP_REACHED: 'Personal daily limit reached', NOT_FOUND: 'Record not found', NO_CHARGE_ALREADY_IN_CRM: 'Already in CRM — not charged',
};

async function viewInvestorHistory() {
  const ih = state.ih;
  if (!ih.options) ih.options = await GET('/api/cold/filters');
  if (!ih.counts) await runSearch(false);
  const presets = await GET('/api/cold/presets');
  const o = ih.options;
  const f = ih.filter;
  const multi = (key, label) => `<label class="field">${label}<select multiple name="${key}">${o[key].map((v) => `<option ${f[key]?.includes(v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  const q = state.me.entitlements?.cold?.quota;
  const chips = Object.entries(f).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `<span class="chip">${esc(human(k))}: ${esc(Array.isArray(v) ? v.join(', ') : v)}</span>`).join('');
  return `<div class="page-head"><div><div class="kicker">❄ Cold data · ${t('investor_history')}</div><h1>${t('investor_history')}</h1></div><div class="spacer"></div>
    <div class="card" style="padding:12px 16px;min-width:280px">${quotaBlock(q)}</div></div>
  ${!ih.transferEnabled ? '<div class="banner warn" style="margin-bottom:12px">⚖ Person-level transfers are disabled until the platform records legal/rights approval. Aggregate search remains available.</div>' : ''}
  <div class="ih">
    <form class="card filters" data-form="ih-search">
      <div class="row"><h3 style="margin:0">${t('filters')}</h3><div class="spacer"></div><button type="button" class="btn sm ghost" data-act="ih-reset">${t('reset')}</button></div>
      ${presets.length ? `<label class="field">${t('saved_searches')}<select data-change="ih-preset"><option value="">—</option>${presets.map((p) => `<option value='${esc(p.filter_json)}'>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field">${t('f_role')}<select name="client_role"><option value="">${t('f_both')}</option><option value="BUYER" ${f.client_role === 'BUYER' ? 'selected' : ''}>${t('f_buyer')}</option><option value="SELLER" ${f.client_role === 'SELLER' ? 'selected' : ''}>${t('f_seller')}</option></select></label>
      ${multi('city', t('f_city'))}${multi('area', t('f_area'))}${multi('property_type', t('f_type'))}${multi('master_developer', t('f_dev'))}${multi('project', t('f_project'))}${multi('nationality', t('f_nat'))}
      <div class="grid g2" style="gap:8px"><label class="field">${t('f_pmin')}<input type="number" name="price_min" value="${f.price_min ?? ''}" min="0"></label><label class="field">${t('f_pmax')}<input type="number" name="price_max" value="${f.price_max ?? ''}" min="0"></label>
      <label class="field">${t('f_smin')}<input type="number" name="size_min" value="${f.size_min ?? ''}" min="0"></label><label class="field">${t('f_smax')}<input type="number" name="size_max" value="${f.size_max ?? ''}" min="0"></label>
      <label class="field">${t('f_yfrom')}<input type="number" name="year_from" value="${f.year_from ?? ''}" min="1990" max="2100"></label><label class="field">${t('f_yto')}<input type="number" name="year_to" value="${f.year_to ?? ''}" min="1990" max="2100"></label></div>
      <label class="field">${t('f_mintx')}<input type="number" name="min_transactions" value="${f.min_transactions ?? ''}" min="1"></label>
      <label class="check"><input type="checkbox" name="has_email" ${f.has_email ? 'checked' : ''}> ${t('f_email')}</label>
      <label class="check"><input type="checkbox" name="has_phone" ${f.has_phone ? 'checked' : ''}> ${t('f_phone')}</label>
      <button class="btn primary block">${t('search')}</button>
      <button type="button" class="btn sm block" data-act="ih-save">${t('save_search')}</button>
      <p class="small muted">${esc(o.coverage_note)} Searching and previews never use quota.</p>
    </form>
    <div style="min-width:0">
      <div class="grid g4" style="margin-bottom:12px">
        <div class="card"><div class="stat"><span class="l">${t('matching')}</span><span class="v">${fmtNum(ih.counts.total)}</span></div></div>
        <div class="card"><div class="stat cold"><span class="l">${t('eligible')}</span><span class="v">${fmtNum(ih.counts.eligible)}</span></div></div>
        <div class="card"><div class="stat"><span class="l">${t('already_in_crm')}</span><span class="v">${fmtNum(ih.counts.already_acquired)}</span></div></div>
        <div class="card"><div class="stat"><span class="l">${t('restricted')}</span><span class="v">${fmtNum(ih.counts.restricted)}</span></div></div>
      </div>
      ${chips ? `<div class="chips" style="margin-bottom:10px">${chips}</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th><input type="checkbox" data-act="ih-page" aria-label="Select page"></th><th>${t('investor')}</th><th>${t('contact')}</th><th>${t('f_role')}</th><th>${t('f_area')} · ${t('f_project')}</th><th>${t('f_type')}</th><th class="num">m²</th><th class="num">${t('price')}</th><th>${t('last_reg')}</th><th class="num">${t('txns')}</th><th>${t('status')}</th></tr></thead>
        <tbody>${ih.results.map((r) => {
          const blocked = r.acquired || r.blocked_reason;
          return `<tr class="${ih.selected.has(r.id) ? 'sel' : ''}"><td><input type="checkbox" data-act="ih-pick" data-id="${r.id}" ${ih.selected.has(r.id) ? 'checked' : ''} ${blocked ? 'disabled' : ''} aria-label="Select"></td>
            <td><span class="masked">${r.name ? esc(r.name) : '<span class="muted">withheld</span>'}</span><br><span class="small muted">${esc(r.nationality || '')}${r.identity_confidence === 'AMBIGUOUS' ? ' · <span class="badge warn">ambiguous ID</span>' : ''}</span></td>
            <td class="small" dir="ltr" style="text-align:start"><span class="masked">${r.phone ? esc(r.phone) : r.has_phone ? '••' : '—'}</span><br><span class="masked muted">${r.email ? esc(r.email) : r.has_email ? '••' : '—'}</span></td>
            <td>${r.client_role === 'BUYER' ? t('f_buyer') : t('f_seller')}</td>
            <td><b>${esc(r.area)}</b><br><span class="small muted">${esc(r.project || '')} · ${esc(r.master_developer || '')}</span></td>
            <td>${esc(r.property_type)}</td><td class="num">${fmtNum(r.size_m2)}</td><td class="num">${fmtAED(r.price_aed)}</td>
            <td>${fmtDate(r.last_registration_date)}</td><td class="num">${r.total_transactions}</td>
            <td>${r.acquired ? `<span class="badge ok">${t('in_crm')}</span>` : r.blocked_reason ? `<span class="badge warn" title="${esc(r.blocked_reason)}">${esc(REASON_LABEL[r.blocked_reason] || human(r.blocked_reason))}</span>` : `<span class="badge cold">${t('eligible')}</span>`}</td></tr>`;
        }).join('') || `<tr><td colspan="11" class="empty">No investors match these filters.</td></tr>`}</tbody>
      </table></div>
      ${ih.cursor ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-act="ih-more">${t('load_more')}</button></div>` : ''}
      <div class="basket">
        <b>${fmtNum(ih.selected.size)}</b> ${t('selected')}<div class="spacer"></div>
        <span class="small" style="opacity:.75">${t('export_disabled')}</span>
        <button class="btn sm" data-act="ih-clear" ${ih.selected.size ? '' : 'disabled'}>${t('reset')}</button>
        <button class="btn sm cold" data-act="ih-transfer-sel" ${ih.selected.size && can('cold.transfer') ? '' : 'disabled'}>${t('transfer_selected')}</button>
        <button class="btn sm gold" data-act="ih-transfer-filter" ${ih.counts.eligible && can('cold.transfer') ? '' : 'disabled'}>${t('transfer_filtered')}</button>
      </div>
    </div>
  </div>`;
}

async function runSearch(append) {
  const ih = state.ih;
  const res = await POST('/api/cold/search', { filter: ih.filter, cursor: append ? ih.cursor : null, limit: 50 });
  ih.results = append ? [...ih.results, ...res.results] : res.results;
  ih.counts = res.counts;
  ih.cursor = res.next_cursor;
  ih.transferEnabled = res.transfer_enabled;
}

function readFilterForm(form) {
  const f = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.multiple) { const v = [...el.selectedOptions].map((o) => o.value); if (v.length) f[el.name] = v; } else if (el.type === 'checkbox') { if (el.checked) f[el.name] = true; } else if (el.value !== '') f[el.name] = el.type === 'number' ? Number(el.value) : el.value;
  }
  return f;
}

async function openTransfer(selection) {
  let est;
  try { est = await POST('/api/cold/transfers/estimate', { selection }); } catch (e) { return toast(errMsg(e), true); }
  const members = can('crm.all') ? (await GET('/api/org/members')).members : [];
  const key = uuid();
  const q = est.quota;
  const short = q && est.new_chargeable > q.remaining;
  openModal(`<h2>❄ ${t('confirm_transfer')}</h2>
    ${!est.entitled ? `<div class="banner bad">${t('no_active_plan')}</div>` : ''}
    <div class="kv">
      <span class="k">Selected records</span><span class="v">${fmtNum(est.selected)}</span>
      ${est.duplicates_in_request ? `<span class="k">Duplicates in request (ignored)</span><span class="v">${fmtNum(est.duplicates_in_request)}</span>` : ''}
      <span class="k">${t('already_in_crm')} (no charge)</span><span class="v">${fmtNum(est.already_acquired)}</span>
      <span class="k">${t('blocked_rights')}</span><span class="v">${fmtNum(est.blocked)}</span>
      <span class="k">${t('new_count_quota')}</span><span class="v" style="color:var(--cold)">${fmtNum(est.new_chargeable)}</span>
      <span class="k total">${t('remaining')} (${q ? esc(q.day) : '—'}, Asia/Dubai)</span><span class="v total">${q ? `${fmtNum(q.remaining)} / ${fmtNum(q.limit)}` : '—'}</span>
      ${q?.my_cap != null ? `<span class="k">Your personal daily limit</span><span class="v">${fmtNum(q.my_used)} / ${fmtNum(q.my_cap)} used</span>` : ''}
      <span class="k">${t('deliverable')}</span><span class="v" style="color:var(--ok)">${fmtNum(est.deliverable_now)}</span>
    </div>
    ${Object.keys(est.blocked_reasons).length ? `<div class="small muted">${Object.entries(est.blocked_reasons).map(([k, v]) => `${esc(REASON_LABEL[k] || human(k))}: ${v}`).join(' · ')}</div>` : ''}
    ${short ? `<div class="banner warn">Only ${fmtNum(q.remaining)} of ${fmtNum(est.new_chargeable)} new records fit today's allowance. Nothing is split unless you agree below.</div>
      <label class="check"><input type="checkbox" id="tr-partial"> ${t('allow_partial')}</label>` : ''}
    <div class="grid g2">
      <label class="field">${t('assign_to')}<select id="tr-assign"><option value="">${t('me')}</option>${members.length ? `<option value="ROUND_ROBIN">${t('round_robin')}</option>${members.map((m) => `<option value="${m.user_id}">${esc(m.name)} · ${esc(human(m.role))}</option>`).join('')}` : ''}</select></label>
      <label class="field">${t('campaign_tag')}<input type="text" id="tr-tag" maxlength="60" placeholder="e.g. marina-q4"></label>
    </div>
    <div class="banner cold">${t('cold_label')}. Transferred records arrive with provenance and contact-permission status; no message is sent automatically.</div>
    <div class="row"><button class="btn cold" id="tr-go" ${est.deliverable_now ? '' : 'disabled'}>${t('confirm_transfer')} (${fmtNum(short ? 0 : Math.min(est.new_chargeable, q?.remaining ?? 0))})</button><button class="btn ghost" data-act="close">${t('cancel')}</button></div>`);
  const partial = document.getElementById('tr-partial');
  const btn = document.getElementById('tr-go');
  if (partial) { btn.disabled = true; partial.onchange = () => { btn.disabled = !partial.checked; btn.textContent = `${t('confirm_transfer')} (${fmtNum(partial.checked ? q.remaining : 0)})`; }; }
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = '…';
    const assign = document.getElementById('tr-assign').value;
    try {
      const r = await POST('/api/cold/transfers', {
        selection, allow_partial: !!partial?.checked, assign_to: assign === '' ? undefined : assign === 'ROUND_ROBIN' ? 'ROUND_ROBIN' : Number(assign),
        campaign_tag: document.getElementById('tr-tag').value || undefined,
      }, { 'idempotency-key': key });
      showTransferResult(r);
      state.ih.selected.clear();
      state.ih.counts = null;
    } catch (e) { btn.disabled = false; btn.textContent = t('confirm_transfer'); toast(errMsg(e), true); }
  };
}

function showTransferResult(r) {
  const rejected = r.items.filter((i) => i.outcome === 'REJECTED');
  const reasons = rejected.reduce((m, i) => ((m[i.reason] = (m[i.reason] || 0) + 1), m), {});
  const links = r.items.filter((i) => i.outcome === 'TRANSFERRED').slice(0, 12);
  openModal(`<h2>✓ ${t('transfer_result')}</h2>
    <div class="grid g3"><div class="stat cold"><span class="l">Transferred & charged</span><span class="v">${fmtNum(r.charged)}</span></div>
      <div class="stat"><span class="l">${t('already_in_crm')}</span><span class="v">${fmtNum(r.already_acquired)}</span></div>
      <div class="stat"><span class="l">Rejected</span><span class="v">${fmtNum(r.rejected)}</span></div></div>
    ${Object.keys(reasons).length ? `<div class="small">${Object.entries(reasons).map(([k, v]) => `<span class="badge warn">${esc(REASON_LABEL[k] || human(k))}: ${v}</span>`).join(' ')}</div>` : ''}
    ${r.quota ? `<div class="banner cold">${t('today')}: ${fmtNum(r.quota.used)} / ${fmtNum(r.quota.limit)} ${t('transferred')} · ${fmtNum(r.quota.remaining)} ${t('remaining')} · ${t('resets_midnight')}</div>` : ''}
    ${links.length ? `<div class="chips">${links.map((i) => `<a class="chip" href="${i.crm_link}">Lead #${i.crm_lead_id}</a>`).join('')}${r.accepted > links.length ? `<span class="chip">+${r.accepted - links.length}</span>` : ''}</div>` : ''}
    <div class="small muted">Job #${r.job_id}${r.idempotent_replay ? ' · replay (no new charge)' : ''}</div>
    <div class="row"><a class="btn primary" href="#/crm?source=COLD" data-act="close-nav">${t('open_in_crm')}</a><button class="btn ghost" data-act="close-refresh">${t('close')}</button></div>`);
}

async function viewMyCold() {
  const rows = await GET('/api/cold/acquired');
  const usage = await GET(`/api/organizations/${state.me.active_org.org_id}/usage`);
  return `<div class="page-head"><div><div class="kicker">❄ Cold</div><h1>${t('my_cold')}</h1></div></div>
  <div class="grid g2" style="margin-bottom:16px">
    <div class="card"><h3>Usage by member · ${esc(usage.day)}</h3><p class="small muted">One shared allowance for the whole account.</p>
      ${usage.by_user.length ? usage.by_user.map((u) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)"><span>${esc(u.name)}</span><b>${fmtNum(u.transferred)}</b></div>`).join('') : '<div class="empty">—</div>'}</div>
    <div class="card"><h3>Activity calendar (Asia/Dubai days)</h3><div class="chips">${usage.calendar.map((d) => `<span class="chip" title="${d.committed_used}/${d.plan_limit}">${esc(d.local_day)} · ${d.committed_used}/${d.plan_limit}</span>`).join('') || '—'}</div>
      <h3 style="margin-top:14px">Recent transfer jobs</h3>${usage.recent_jobs.slice(0, 6).map((j) => `<div class="small" style="padding:4px 0;border-top:1px solid var(--line)">#${j.id} · ${fmtDT(j.created_at)} · ${esc(j.user_name)} · ${j.mode} · <b>${j.charged}</b> charged / ${j.already_acquired} already / ${j.rejected} rejected</div>`).join('') || '<div class="muted">—</div>'}</div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>${t('name')}</th><th>Transferred</th><th>By</th><th class="num">Historical txns</th><th>Marketing permission</th><th></th></tr></thead>
  <tbody>${rows.map((r) => `<tr><td><b>${esc(r.full_name || '—')}</b></td><td>${fmtDT(r.granted_at)}</td><td>${esc(r.granted_by)}</td><td class="num">${r.transactions}</td><td><span class="badge ${r.marketing_permission === 'GRANTED' ? 'ok' : r.marketing_permission === 'DENIED' ? 'bad' : 'warn'}">${esc(human(r.marketing_permission))}</span></td><td>${r.lead_id ? `<a class="btn sm" href="#/crm/lead/${r.lead_id}">${t('open_in_crm')}</a>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">No records transferred yet. <a href="#/investor-history">${t('step_search')}</a></td></tr>`}</tbody></table></div>`;
}

// Drop-in lead form for any website; leads arrive through /api/public/inquiry.
const embedSnippet = (key) => `<div data-ai-data-form data-site-key="${key}" data-lang="en"></div>\n<script src="${location.origin}/lead-form.js" defer></script>`;

async function viewHot() {
  const h = await GET('/api/hot');
  const ent = h.entitlements.reduce((s, e) => s + (e.credits_total - e.credits_used), 0);
  const snippet = h.site_keys[0] ? embedSnippet(h.site_keys[0].key) : '';
  return `<div class="page-head"><div><div class="kicker">🔥 Hot</div><h1>${t('hot_leads')}</h1></div></div>
  <div class="banner hot" style="margin-bottom:16px">🔥 Hot Leads are a separate product with a separate ledger. They never use your Cold allowance, and your Cold plan does not include them.</div>
  <div class="grid g3">
    <div class="card"><div class="stat hot"><span class="l">${t('hot_balance')}</span><span class="v">${fmtNum(ent)}</span></div></div>
    <div class="card"><div class="stat"><span class="l">AI-DATA Hot pricing</span><span class="v" style="font-size:20px">${h.pricing.configured ? `${fmtMoney(h.pricing.rule.price_cents)} · ${esc(human(h.pricing.rule.model))}` : `<span class="badge warn">${t('owner_config_required')}</span>`}</span></div>
      <p class="small muted">${h.pricing.configured ? (h.pricing.rule.exclusive ? 'Exclusive allocation: each lead goes to one agency only.' : 'Shared allocation.') : 'Checkout: Not yet available.'}</p></div>
    <div class="card"><div class="stat"><span class="l">Billed Hot leads</span><span class="v">${fmtNum(h.ledger.length)}</span></div><p class="small muted">${fmtMoney(h.ledger.reduce((s, l) => s + l.amount_cents, 0))} total</p></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Live inquiries</h3><div class="table-wrap"><table><tbody>${h.recent.map((l) => `<tr class="click" data-href="#/crm/lead/${l.id}"><td><b>${esc(l.full_name)}</b><br><span class="small muted">${esc(l.source_detail)}</span></td><td>${esc(human(l.stage))}</td><td class="small">${fmtDT(l.created_at)}${!l.first_contacted_at && new Date(l.first_contact_due) < new Date() ? '<br><span class="badge bad">SLA missed</span>' : ''}</td></tr>`).join('') || '<tr><td class="empty">No Hot leads yet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Capture leads on your own website</h3><p class="small muted">Leads from your own site key go straight to your CRM (free, your own data) with consent evidence. Paste this code into your website where the form should appear.</p>
      ${h.site_keys.length ? `<div class="code">${esc(snippet)}</div>` : '<div class="banner warn">No site key issued yet — ask AI-DATA support to register your domain.</div>'}
      <h3 style="margin-top:14px">Sources</h3>${h.sources.map((s) => `<div class="row" style="justify-content:space-between;padding:5px 0;border-top:1px solid var(--line)"><span>${esc(s.name)}</span>${statusBadge(s.status)}</div>`).join('')}</div>
  </div>`;
}
const statusBadge = (s) => (s === 'CONNECTED' ? `<span class="badge ok"><span class="dot"></span>${t('connected')}</span>` : s === 'APPROVAL_REQUIRED' ? `<span class="badge warn">${t('approval_required')}</span>` : `<span class="badge bad">${t('not_connected')}</span>`);

const STAGES = ['NEW', 'ASSIGNED', 'CONTACT_ATTEMPTED', 'CONTACTED', 'QUALIFIED', 'INTERESTED', 'VIEWING_SCHEDULED', 'VIEWED', 'NEGOTIATION', 'BOOKING', 'CONTRACT', 'CLOSED_WON', 'CLOSED_LOST', 'NO_RESPONSE', 'ON_HOLD'];

const tagChips = (tags) => (tags ? tags.split(',').map((x) => `<span class="badge" style="background:var(--gold-soft)">#${esc(x)}</span>`).join(' ') : '');
const dueLabel = (iso) => { if (!iso) return ''; const d = new Date(iso); const late = d < new Date(); return `<span class="small" style="${late ? 'color:var(--bad);font-weight:600' : ''}">${late ? '⚠ ' : ''}${fmtDT(iso)}</span>`; };

async function viewCrm(parts, query) {
  if (parts[0] === 'lead') return viewLead(parts[1]);
  const view = query.view || 'list';
  const filters = { source: query.source, stage: query.stage, q: query.q, assigned: query.assigned, tag: query.tag, overdue: query.overdue };
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
  const tabNames = { list: t('leads'), pipeline: 'Pipeline', tasks: 'My day', templates: 'Templates' };
  const tabs = `<div class="tabs">${Object.entries(tabNames).map(([v, label]) => `<a class="${view === v ? 'on' : ''}" href="#/crm?view=${v}${query.source ? '&source=' + query.source : ''}">${esc(label)}</a>`).join('')}</div>`;
  const managers = can('crm.all');
  const members = managers && ['list', 'pipeline'].includes(view) ? (await GET('/api/org/members')).members : [];
  let body = '';
  if (view === 'tasks') {
    const tasks = await GET('/api/crm/tasks');
    const now = new Date(); const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
    const groups = [
      ['Overdue', tasks.filter((x) => new Date(x.due_at) < now), 'bad'],
      ['Today', tasks.filter((x) => new Date(x.due_at) >= now && new Date(x.due_at) <= endToday), 'gold'],
      ['Upcoming', tasks.filter((x) => new Date(x.due_at) > endToday), ''],
    ];
    body = `<div class="grid g3" style="margin-bottom:16px">${groups.map(([n, l, c]) => `<div class="card"><div class="stat"><span class="l">${n}</span><span class="v" style="${c === 'bad' && l.length ? 'color:var(--bad)' : ''}">${l.length}</span></div></div>`).join('')}</div>
      ${groups.map(([n, list]) => `<div class="card" style="margin-bottom:16px"><h3>${n} (${list.length})</h3>${list.map((x) => `<div class="row" style="border-top:1px solid var(--line);padding:10px 0;gap:10px;flex-wrap:wrap">
        ${srcBadge(x.source_type)}<div style="flex:1;min-width:200px"><a href="#/crm/lead/${x.lead_id}"><b>${esc(x.full_name)}</b></a> · ${esc(x.title)}<br>${dueLabel(x.due_at)} <span class="badge">${esc(human(x.stage))}</span></div>
        ${x.phone ? `<a class="btn sm" href="#/crm/lead/${x.lead_id}">📞 Open</a>` : ''}
        <button class="btn sm" data-act="task-snooze" data-id="${x.id}">Snooze 1 day</button><button class="btn sm primary" data-act="task-done" data-id="${x.id}">✓ Done</button></div>`).join('') || '<div class="empty">Nothing here.</div>'}</div>`).join('')}`;
  } else if (view === 'templates') {
    const list = await GET('/api/crm/templates');
    body = `<div class="grid g2" style="align-items:start">
      <div class="card"><h3>Message templates</h3><p class="small muted" style="margin-top:0">Use them from a lead's page: {name}, {agent}, {area} and {company} are filled in automatically, then WhatsApp or email opens with the text ready.</p>
        ${list.map((x) => `<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row"><b>${esc(x.name)}</b><span class="badge">${esc(x.channel === 'WHATSAPP' ? 'WhatsApp' : 'Email')}</span><span class="badge">${esc(x.language.toUpperCase())}</span>${x.custom ? '' : '<span class="small muted">built-in</span>'}<div class="spacer"></div>${x.custom && can('members.manage') ? `<button class="btn sm ghost" data-act="template-delete" data-id="${x.id}">Delete</button>` : ''}</div>
          <div class="small" style="white-space:pre-wrap;margin-top:4px" ${x.language === 'ar' ? 'dir="rtl"' : ''}>${esc(x.body)}</div></div>`).join('')}</div>
      ${can('members.manage') ? `<form class="card grid" data-form="template-create" style="gap:10px"><h3>New template</h3>
        <label class="field">Name<input type="text" name="name" required maxlength="80" placeholder="e.g. Off-plan launch invite"></label>
        <div class="grid g2"><label class="field">Channel<select name="channel"><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></select></label>
        <label class="field">Language<select name="language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <label class="field">Text<textarea name="body" rows="5" required maxlength="2000" placeholder="Hello {name}, …"></textarea></label>
        <button class="btn primary" style="justify-self:start">Save template</button></form>` : ''}</div>`;
  } else if (view === 'pipeline') {
    const leads = await GET('/api/crm/leads' + (qs ? '?' + qs : ''));
    const open = leads.filter((l) => !['CLOSED_WON', 'CLOSED_LOST'].includes(l.stage));
    const forecast = open.reduce((s, l) => s + (l.deal_value_aed || 0), 0);
    const won = leads.filter((l) => l.stage === 'CLOSED_WON').reduce((s, l) => s + (l.deal_value_aed || 0), 0);
    body = `<div class="grid g3" style="margin-bottom:12px"><div class="card"><div class="stat"><span class="l">Open leads</span><span class="v">${fmtNum(open.length)}</span></div></div>
        <div class="card"><div class="stat"><span class="l">Open pipeline value</span><span class="v">${fmtAED(forecast)}</span></div></div>
        <div class="card"><div class="stat"><span class="l">Won value</span><span class="v" style="color:var(--ok)">${fmtAED(won)}</span></div></div></div>
      <p class="small muted">Drag a card to another column to change its stage.</p>
      <div class="kanban">${STAGES.map((st) => { const col = leads.filter((l) => l.stage === st); const value = col.reduce((s, l) => s + (l.deal_value_aed || 0), 0); return `<div class="kcol" data-stage="${st}"><h4>${esc(human(st))}<span>${col.length}</span></h4>${value ? `<div class="small muted" style="margin:-4px 0 6px">${fmtAED(value)}</div>` : ''}
        ${col.slice(0, 50).map((l) => `<a class="kcard" draggable="true" data-lead="${l.id}" href="#/crm/lead/${l.id}"><div class="row">${srcBadge(l.source_type)}${l.deal_value_aed ? `<span class="small"><b>${fmtAED(l.deal_value_aed)}</b></span>` : ''}</div><b>${esc(l.full_name)}</b><div class="small muted">${esc(l.assignee_name || '—')}</div>${l.next_task_due ? `<div>${dueLabel(l.next_task_due)}</div>` : ''}${l.tags ? `<div>${tagChips(l.tags)}</div>` : ''}</a>`).join('')}</div>`; }).join('')}</div>`;
  } else {
    const leads = await GET('/api/crm/leads' + (qs ? '?' + qs : ''));
    body = `<form class="row" data-form="crm-filter" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <select name="source" style="width:auto" aria-label="Source"><option value="">${t('all_sources')}</option>${['COLD', 'HOT', 'OWNED', 'MANUAL'].map((s) => `<option ${query.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select name="stage" style="width:auto" aria-label="Stage"><option value="">${t('stage')}: all</option>${STAGES.map((s) => `<option value="${s}" ${query.stage === s ? 'selected' : ''}>${esc(human(s))}</option>`).join('')}</select>
        ${managers ? `<select name="assigned" style="width:auto" aria-label="Agent"><option value="">All agents</option>${members.map((m) => `<option value="${m.user_id}" ${String(query.assigned) === String(m.user_id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}
        <input type="text" name="tag" value="${esc(query.tag || '')}" placeholder="#tag" style="max-width:120px" aria-label="Tag">
        <label class="check small"><input type="checkbox" name="overdue" value="1" ${query.overdue ? 'checked' : ''}> Overdue follow-up</label>
        <input type="text" name="q" value="${esc(query.q || '')}" placeholder="${t('search')}…" style="max-width:220px" aria-label="Search leads"><button class="btn">${t('search')}</button>
        ${can('crm.import') ? '<div class="spacer"></div><button type="button" class="btn" data-act="crm-import">Import leads form.xlsx</button>' : ''}</form>
      <form class="card row" data-form="crm-bulk" style="gap:8px;margin-bottom:12px;padding:10px 14px;flex-wrap:wrap"><b class="small"><span id="bulk-count">0</span> selected</b>
        <select name="stage" style="width:auto" aria-label="Set stage"><option value="">Set stage…</option>${STAGES.map((s) => `<option value="${s}">${esc(human(s))}</option>`).join('')}</select>
        ${managers ? `<select name="assigned_user_id" style="width:auto" aria-label="Assign to"><option value="">Assign to…</option>${members.map((m) => `<option value="${m.user_id}">${esc(m.name)}</option>`).join('')}</select>` : ''}
        <input type="text" name="add_tag" placeholder="Add tag" style="max-width:130px" aria-label="Add tag"><button class="btn sm primary">Apply to selected</button></form>
      <div class="table-wrap"><table><thead><tr><th><input type="checkbox" data-change="lead-pick-all" aria-label="Select all leads"></th><th>${t('source')}</th><th>${t('name')}</th><th>${t('phone')}</th><th>${t('stage')}</th><th>${t('assignee')}</th><th class="num">Deal value</th><th>Next follow-up</th><th>First contact</th></tr></thead>
      <tbody>${leads.map((l) => `<tr class="click" data-href="#/crm/lead/${l.id}"><td><input type="checkbox" class="lead-pick" data-change="lead-pick" value="${l.id}" aria-label="Select ${esc(l.full_name)}"></td><td>${srcBadge(l.source_type)}</td><td><b>${esc(l.full_name)}</b>${l.suppressed ? ' <span class="badge bad">DNC</span>' : ''}<br><span class="small muted">${esc(l.campaign_tag || l.source_detail)}</span> ${tagChips(l.tags)}</td><td class="small" dir="ltr">${esc(l.phone || l.email || '—')}</td>
        <td><span class="badge">${esc(human(l.stage))}</span></td><td class="small">${esc(l.assignee_name || '—')}</td><td class="num small">${l.deal_value_aed ? fmtAED(l.deal_value_aed) : '—'}</td><td>${dueLabel(l.next_task_due) || '<span class="small muted">—</span>'}</td>
        <td>${l.first_contacted_at ? `<span class="badge ok">${fmtDT(l.first_contacted_at)}</span>` : l.first_contact_due && new Date(l.first_contact_due) < new Date() ? '<span class="badge bad">SLA missed</span>' : `<span class="small muted">${t('due')} ${fmtDT(l.first_contact_due)}</span>`}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">No leads match.</td></tr>`}</tbody></table></div>`;
  }
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('crm')}</h1></div><div class="spacer"></div>${tabs}</div>${body}`;
}

async function viewLead(id) {
  const [l, templates] = await Promise.all([GET(`/api/crm/leads/${id}`), GET('/api/crm/templates')]);
  const cold = l.source_type === 'COLD';
  const allowed = !l.suppressed && (cold ? l.marketing_permission === 'GRANTED' : l.consent?.contact === true);
  const wa = l.phone ? `https://wa.me/${l.phone.replace(/\D/g, '')}` : null;
  const txns = l.interest?.historical_transactions || [];
  return `<div class="page-head"><div><a href="#/crm" class="small muted">← ${t('crm')}</a><h1>${esc(l.full_name)}</h1><div class="row" style="margin-top:6px">${srcBadge(l.source_type)}<span class="badge">${esc(human(l.stage))}</span><span class="badge ${l.priority === 'HIGH' || l.priority === 'URGENT' ? 'hot' : ''}">${esc(human(l.priority))}</span></div></div></div>
  <div class="banner ${cold ? 'cold' : 'hot'}" style="margin-bottom:10px">${cold ? '❄ ' + t('cold_label') : '🔥 ' + t('hot_label')}</div>
  ${l.suppressed ? `<div class="banner bad" style="margin-bottom:10px">⛔ ${t('suppressed_warning')}</div>` : !allowed ? `<div class="banner warn" style="margin-bottom:10px">⚖ ${t('lawful_basis_warning')}</div>` : ''}
  ${l.duplicates?.length ? `<div class="banner warn" style="margin-bottom:10px">⚠ Same mobile or email as ${l.duplicates.map((d) => `<a href="#/crm/lead/${d.id}"><b>${esc(d.full_name)}</b></a> (${esc(human(d.stage))}${d.assignee_name ? ', ' + esc(d.assignee_name) : ''})`).join(', ')}. Check before contacting twice.</div>` : ''}
  <div class="grid g3" style="align-items:start">
    <div class="card grid" style="gap:10px"><h3>Contact</h3>
      <div class="kv"><span class="k">${t('phone')}</span><span class="v" dir="ltr">${esc(l.phone || '—')}</span><span class="k">${t('email')}</span><span class="v" style="word-break:break-all">${esc(l.email || '—')}</span>
        ${l.nationality ? `<span class="k">Nationality</span><span class="v">${esc(l.nationality)}</span>` : ''}<span class="k">Marketing permission</span><span class="v">${esc(human(l.marketing_permission))}</span>
        <span class="k">${t('assignee')}</span><span class="v">${esc(l.assignee_name || '—')}</span><span class="k">First contact due</span><span class="v">${fmtDT(l.first_contact_due)}</span></div>
      <div class="row">${l.phone ? `<a class="btn sm" ${allowed ? `href="tel:${esc(l.phone)}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>📞 Call</a>` : ''}${wa ? `<a class="btn sm" target="_blank" rel="noopener noreferrer" ${allowed ? `href="${wa}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>💬 WhatsApp</a>` : ''}${l.email ? `<a class="btn sm" ${allowed ? `href="mailto:${esc(l.email)}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>✉ Email</a>` : ''}</div>
      <p class="small muted">Opening your phone or WhatsApp does not record a contact. Log the actual outcome below.</p>
      <label class="field">${t('stage')}<select data-change="lead-stage" data-id="${l.id}">${STAGES.map((s) => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${esc(human(s))}</option>`).join('')}</select></label>
      ${can('crm.all') ? `<label class="field">${t('assignee')}<select data-change="lead-assign" data-id="${l.id}" data-current="${l.assigned_user_id ?? ''}" id="lead-assign"><option>…</option></select></label>` : ''}
      <form class="grid" data-form="lead-deal" data-id="${l.id}" style="gap:8px;border-top:1px solid var(--line);padding-top:10px"><h3 style="margin:0">Deal</h3>
        <div class="grid g2" style="gap:8px"><label class="field">Deal value (AED)<input type="number" name="deal_value_aed" min="0" step="1000" value="${l.deal_value_aed ?? ''}" placeholder="e.g. 2500000"></label>
        <label class="field">Expected close<input type="date" name="expected_close" value="${esc(l.expected_close || '')}"></label></div>
        <label class="field">Tags<input type="text" name="tags" value="${esc((l.tags || '').split(',').filter(Boolean).join(', '))}" placeholder="investor, off-plan, marina"></label>
        <button class="btn sm" style="justify-self:start">Save deal</button></form>
      <form class="grid" data-form="lead-prefs" data-id="${l.id}" style="gap:8px;border-top:1px solid var(--line);padding-top:10px"><h3 style="margin:0">How to contact</h3>
        <div class="grid g2" style="gap:8px">
          <label class="field">Channel<select name="preferred_channel"><option value="">Not recorded</option>${['WHATSAPP', 'CALL', 'EMAIL', 'SMS'].map((x) => `<option value="${x}" ${l.preferred_channel === x ? 'selected' : ''}>${esc(human(x))}</option>`).join('')}</select></label>
          <label class="field">Best time<select name="best_time"><option value="">Not recorded</option>${['MORNING', 'AFTERNOON', 'EVENING', 'ANY'].map((x) => `<option value="${x}" ${l.best_time === x ? 'selected' : ''}>${esc(human(x))}</option>`).join('')}</select></label>
          <label class="field">Tone<select name="tone"><option value="">Not recorded</option>${['FORMAL', 'FRIENDLY'].map((x) => `<option value="${x}" ${l.tone === x ? 'selected' : ''}>${esc(human(x))}</option>`).join('')}</select></label>
          <label class="field">Client language<select name="preferred_language"><option value="">Not recorded</option>${[['en', 'English'], ['ar', 'Arabic'], ['fr', 'French'], ['ru', 'Russian'], ['tr', 'Turkish'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['zh', 'Chinese'], ['de', 'German'], ['fa', 'Persian']].map(([v, lbl]) => `<option value="${v}" ${l.preferred_language === v ? 'selected' : ''}>${lbl}</option>`).join('')}</select></label>
        </div><button class="btn sm" style="justify-self:start">Save preferences</button></form>
      ${l.interest && !cold ? `<h3 style="margin-top:6px">Requested</h3><div class="kv">${Object.entries(l.interest).filter(([, v]) => v).map(([k, v]) => `<span class="k">${esc(human(k))}</span><span class="v">${esc(k === 'budget_max_aed' ? fmtAED(v) : v)}</span>`).join('')}</div>` : ''}
      ${l.consent ? `<h3 style="margin-top:6px">Consent evidence</h3><div class="kv"><span class="k">Contact</span><span class="v">${l.consent.contact ? '✓' : '—'}</span><span class="k">Marketing</span><span class="v">${l.consent.marketing ? '✓' : '—'}</span><span class="k">Notice</span><span class="v">${esc(l.consent.notice_version)}</span><span class="k">Captured</span><span class="v">${fmtDT(l.consent.captured_at)}</span></div>` : ''}
    </div>
    <div class="card grid" style="gap:10px">
      ${allowed && (l.phone || l.email) ? `<h3>Send a message</h3>
        <div class="row" style="flex-wrap:wrap;gap:6px">${templates.filter((x) => (x.channel === 'WHATSAPP' && l.phone) || (x.channel === 'EMAIL' && l.email)).map((x) => `<button type="button" class="btn sm" data-act="use-template" data-name="${esc(l.full_name.split(' ')[0])}" data-area="${esc(l.interest?.area || txns[0]?.area || '')}" data-tpl="${esc(JSON.stringify(x))}">${esc(x.name)}</button>`).join('')}</div>
        <textarea id="tpl-text" rows="4" placeholder="Pick a template above, edit if needed" aria-label="Message text"></textarea>
        <div class="row"><button type="button" class="btn sm primary" id="tpl-send" data-act="send-template" data-phone="${esc((l.phone || '').replace(/\D/g, ''))}" data-email="${esc(l.email || '')}">Open in WhatsApp</button><span class="small muted">Sending is your action; log the outcome below.</span></div>` : ''}
      <h3>${t('log_activity')}</h3>
      <form class="grid" data-form="lead-activity" data-id="${l.id}" style="gap:8px">
        <select name="type"><option value="NOTE">${t('add_note')}</option><option value="CONTACT_ATTEMPT">Contact attempt (no answer)</option>${!l.suppressed ? '<option value="CALL_LOGGED">Call — conversation held</option><option value="WHATSAPP_LOGGED">WhatsApp — conversation held</option><option value="EMAIL_LOGGED">Email exchanged</option>' : ''}<option value="MEETING">Meeting</option><option value="VIEWING">Viewing</option></select>
        <textarea name="body" rows="3" required maxlength="4000" placeholder="What happened?"></textarea><input type="hidden" name="template_id" value=""><button class="btn primary">${t('log_activity')}</button></form>
      <h3>${t('schedule_followup')}</h3>
      <form class="grid" data-form="lead-task" data-id="${l.id}" style="gap:8px"><input type="text" name="title" required maxlength="300" placeholder="Follow-up"><input type="datetime-local" name="due_at" required><button class="btn">${t('schedule_followup')}</button></form>
      <h3>${t('tasks')}</h3>${l.tasks.map((x) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:6px 0"><span class="${x.done_at ? 'muted' : ''}">${x.done_at ? '✓ ' : ''}${esc(x.title)}<br><span class="small muted">${fmtDT(x.due_at)}</span></span>${x.done_at ? '' : `<button class="btn sm" data-act="task-done" data-id="${x.id}">${t('done')}</button>`}</div>`).join('') || '<span class="muted">—</span>'}
    </div>
    <div class="card"><h3>${t('timeline')}</h3><div class="timeline">${l.activities.map((a) => `<div class="tl"><div><b>${esc(human(a.type))}</b> <span class="small muted">· ${esc(a.user_name || 'System')} · ${fmtDT(a.created_at)}</span><div class="small">${esc(a.body || '')}</div></div></div>`).join('') || '<span class="muted">—</span>'}</div></div>
  </div>
  ${txns.length ? `<div class="card" style="margin-top:16px"><h3>${t('transaction_history')} (${txns.length})</h3><div class="table-wrap"><table><thead><tr><th>Txn ID</th><th>Role</th><th>Area · Project</th><th>Type</th><th class="num">m²</th><th class="num">Price</th><th>Registered</th></tr></thead><tbody>${txns.map((x) => `<tr><td class="mono">${esc(x.source_txn_id)}</td><td>${esc(human(x.client_role))}</td><td>${esc(x.area)} · ${esc(x.project || '')}</td><td>${esc(x.property_type)}</td><td class="num">${fmtNum(x.size_m2)}</td><td class="num">${fmtAED(x.price_aed)}</td><td>${fmtDate(x.registration_date)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}

// ---------------------------------------------------------------------------------
// CRM dashboard (agencies, agents, solo agents) + owner CRM monitor
// ---------------------------------------------------------------------------------
const DASH_DAYS = [7, 30, 90];
const ACT_LABEL = { CALL_LOGGED: '📞 Calls', WHATSAPP_LOGGED: '💬 WhatsApp', EMAIL_LOGGED: '✉ Emails', MEETING: '🤝 Meetings', VIEWING: '🏠 Viewings', CONTACT_ATTEMPT: '↻ No-answer attempts', NOTE: '📝 Notes' };
const fmtMins = (m) => (m == null ? '—' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
const plural = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function hbars(rows, { money = false, max } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span class="l">${esc(r.label)}</span><span class="track"><i style="width:${Math.max(r.value ? 2 : 0, pctOf(r.value, top))}%"></i></span><span class="v">${money ? fmtAED(r.value) : fmtNum(r.value)}${r.extra ? `<span class="small muted"> ${esc(r.extra)}</span>` : ''}</span></div>`).join('')}</div>`;
}

function dashInsights(d) {
  const k = d.kpis, f = d.follow_ups, out = [];
  if (f.overdue) out.push(`<b>${fmtNum(f.overdue)}</b> follow-up${f.overdue > 1 ? 's are' : ' is'} overdue — clear these first.`);
  if (d.sla.breached) out.push(`<b>${fmtNum(d.sla.breached)}</b> lead${d.sla.breached > 1 ? 's' : ''} missed the first-contact time.`);
  if (k.open_without_next_step) out.push(`<b>${fmtNum(k.open_without_next_step)}</b> open lead${k.open_without_next_step > 1 ? 's have' : ' has'} no next follow-up scheduled.`);
  if (k.stale_leads) out.push(`<b>${fmtNum(k.stale_leads)}</b> lead${k.stale_leads > 1 ? 's have' : ' has'} had no contact for 14+ days.`);
  if (k.unassigned_open) out.push(`<b>${fmtNum(k.unassigned_open)}</b> open lead${k.unassigned_open > 1 ? 's are' : ' is'} not assigned to anyone.`);
  if (k.total_leads && d.communication.with_preferences < k.total_leads / 2) out.push(`Only ${pctOf(d.communication.with_preferences, k.total_leads)}% of clients have a saved contact preference — record channel, time and tone on each lead.`);
  return out.length ? `<div class="banner warn dash-insights" style="margin-bottom:16px"><b>Needs attention</b><ul>${out.map((x) => `<li>${x}</li>`).join('')}</ul></div>`
    : d.kpis.total_leads ? '<div class="banner ok" style="margin-bottom:16px">✓ Nothing overdue. Follow-ups and first contacts are on track.</div>' : '';
}

// d: dashboard data; opts.base: hash for filters; opts.leadHref(id) or opts.leadAct for owner.
function dashboardHtml(d, opts = {}) {
  const k = d.kpis, f = d.follow_ups, s = d.sla, c = d.communication;
  const leadLink = (id, name) => (opts.ownerOrg ? `<a href="#" data-act="owner-open-lead" data-org="${opts.ownerOrg}" data-id="${id}">${esc(name)}</a>` : `<a href="#/crm/lead/${id}">${esc(name)}</a>`);
  const stagesShown = d.pipeline.filter((p) => p.count || !['NO_RESPONSE', 'ON_HOLD'].includes(p.stage));
  const actRows = Object.entries(d.activity.by_type).map(([t, v]) => ({ label: ACT_LABEL[t] || human(t), value: v }));
  const trendMax = Math.max(1, ...d.activity.trend.map((x) => x.count));
  const pref = (obj) => Object.entries(obj).filter(([key, v]) => v || key !== 'NOT_SET').map(([key, v]) => ({ label: key === 'NOT_SET' ? 'Not recorded' : human(key), value: v }));
  const langRows = Object.entries(c.language).map(([key, v]) => ({ label: key === 'NOT_SET' ? 'Not recorded' : key.toUpperCase(), value: v })).sort((a, b) => b.value - a.value);
  return `${dashInsights(d)}
  <div class="grid g4">
    <div class="card"><div class="stat"><span class="l">Open leads</span><span class="v">${fmtNum(k.open_leads)}</span></div><div class="small muted">${fmtNum(k.total_leads)} total · ${fmtNum(k.new_in_period)} new in ${d.period_days} days</div></div>
    <div class="card"><div class="stat"><span class="l">Pipeline value (open)</span><span class="v" style="font-size:24px">${fmtAED(k.pipeline_value_aed)}</span></div><div class="small muted">Won: ${fmtAED(k.won_value_aed)}</div></div>
    <div class="card"><div class="stat"><span class="l">Won · win rate</span><span class="v">${fmtNum(k.won)}<span class="small muted" style="font-size:16px"> · ${k.win_rate == null ? '—' : k.win_rate + '%'}</span></span></div><div class="small muted">${fmtNum(k.lost)} lost</div></div>
    <div class="card"><div class="stat"><span class="l">Follow-ups</span><span class="v" style="${f.overdue ? 'color:var(--bad)' : ''}">${fmtNum(f.overdue)} <span class="small" style="font-size:14px">overdue</span></span></div><div class="small muted">${fmtNum(f.due_today)} today · ${fmtNum(f.next_7_days)} next 7 days · ${fmtNum(f.done_on_time_in_period)}/${fmtNum(f.done_in_period)} done on time</div></div>
  </div>
  <div class="grid g4" style="margin-top:16px">
    <div class="card"><div class="stat"><span class="l">Time to first contact (median)</span><span class="v" style="font-size:24px">${fmtMins(s.median_minutes_to_first_contact)}</span></div><div class="small muted">🔥 Hot: ${fmtMins(s.hot_median_minutes)}</div></div>
    <div class="card"><div class="stat"><span class="l">First-contact SLA</span><span class="v" style="font-size:24px">${fmtNum(s.met)} met</span></div><div class="small ${s.breached ? '' : 'muted'}" style="${s.breached ? 'color:var(--bad);font-weight:700' : ''}">${fmtNum(s.breached)} missed · ${fmtNum(s.waiting)} waiting</div></div>
    <div class="card"><div class="stat"><span class="l">No contact for 14+ days</span><span class="v" style="${k.stale_leads ? 'color:var(--bad)' : ''}">${fmtNum(k.stale_leads)}</span></div><div class="small muted">Open leads going cold</div></div>
    <div class="card"><div class="stat"><span class="l">No next step</span><span class="v">${fmtNum(k.open_without_next_step)}</span></div><div class="small muted">Open leads without a scheduled follow-up${k.unassigned_open != null ? ` · ${fmtNum(k.unassigned_open)} unassigned` : ''}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card"><h3>Pipeline</h3>${hbars(stagesShown.map((p) => ({ label: human(p.stage), value: p.count, extra: p.value_aed ? fmtAED(p.value_aed) : '' })))}
      <div class="chips" style="margin-top:10px">${d.by_source.map((x) => `<span class="chip">${esc(human(x.source_type))}: ${fmtNum(x.count)}</span>`).join('') || ''}</div></div>
    <div class="card"><h3>Follow-ups</h3>
      ${f.upcoming.length ? `<div class="table-wrap"><table><tbody>${f.upcoming.map((x) => `<tr><td>${srcBadge(x.source_type)}</td><td>${leadLink(x.lead_id, x.full_name)}<br><span class="small muted">${esc(x.title)}${x.assignee_name ? ' · ' + esc(x.assignee_name) : ''}</span></td><td class="num" style="${x.overdue ? 'color:var(--bad);font-weight:700' : ''}">${fmtDT(x.due_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No open follow-ups</div>'}
      ${f.stale.length ? `<h3 style="margin-top:14px">Going cold (no contact 14+ days)</h3><div class="table-wrap"><table><tbody>${f.stale.map((x) => `<tr><td>${leadLink(x.lead_id, x.full_name)}</td><td><span class="badge">${esc(human(x.stage))}</span></td><td class="num small muted">${fmtDT(x.last_touch)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
  </div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card"><h3>Team communication · last ${d.period_days} days</h3>${hbars(actRows)}
      <div class="small muted" style="margin:12px 0 6px">Contacts logged per day (last ${d.activity.trend.length} days)</div>
      <div class="spark" role="img" aria-label="Contacts per day">${d.activity.trend.map((x) => `<span title="${esc(x.day)}: ${x.count}"><i style="height:${Math.max(x.count ? 6 : 2, pctOf(x.count, trendMax))}%"></i></span>`).join('')}</div>
      ${d.activity.recent.length ? `<h3 style="margin-top:14px">Latest activity</h3><div class="timeline">${d.activity.recent.slice(0, 8).map((a) => `<div class="tl"><div><b>${esc(ACT_LABEL[a.type] || human(a.type))}</b> · ${leadLink(a.lead_id, a.full_name)} <span class="small muted">· ${esc(a.user_name || 'System')} · ${fmtDT(a.created_at)}</span>${a.body ? `<div class="small">${esc(a.body)}</div>` : ''}</div></div>`).join('')}</div>` : ''}</div>
    <div class="card"><h3>How clients want to be contacted</h3>
      <p class="small muted" style="margin-top:0">${fmtNum(c.with_preferences)} of ${fmtNum(k.total_leads)} clients have a saved preference. Set it on each lead page.</p>
      <div class="grid g2" style="gap:14px">
        <div><div class="small muted" style="font-weight:700;margin-bottom:6px">Channel</div>${hbars(pref(c.preferred_channel))}</div>
        <div><div class="small muted" style="font-weight:700;margin-bottom:6px">Best time</div>${hbars(pref(c.best_time))}</div>
        <div><div class="small muted" style="font-weight:700;margin-bottom:6px">Tone</div>${hbars(pref(c.tone))}</div>
        <div><div class="small muted" style="font-weight:700;margin-bottom:6px">Language</div>${hbars(langRows)}</div>
      </div>
      <h3 style="margin-top:14px">Message templates</h3>
      ${c.templates.length ? `<div class="table-wrap"><table><thead><tr><th>Template</th><th>Channel</th><th>Language</th><th class="num">Used (${d.period_days}d)</th></tr></thead><tbody>${c.templates.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(human(x.channel))}</td><td>${esc(String(x.language).toUpperCase())}</td><td class="num">${fmtNum(x.uses_in_period)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty small">No templates yet${opts.ownerOrg ? '' : ' — managers can add them under Settings'}.</div>`}</div>
  </div>
  ${d.team ? `<div class="card" style="margin-top:16px"><h3>Team · last ${d.period_days} days</h3><div class="table-wrap"><table><thead><tr><th>Member</th><th class="num">Leads</th><th class="num">Open</th><th class="num">Won</th><th class="num">Pipeline</th><th class="num">Overdue</th><th class="num">📞</th><th class="num">💬</th><th class="num">✉</th><th class="num">🤝</th><th class="num">1st contact</th><th>Last activity</th></tr></thead>
    <tbody>${d.team.map((m) => `<tr class="click" data-href="${opts.base}${opts.base.includes('?') ? '&' : '?'}agent=${m.user_id}&days=${d.period_days}"><td><b>${esc(m.name)}</b><br><span class="small muted">${esc(human(m.role))}</span></td><td class="num">${fmtNum(m.leads)}</td><td class="num">${fmtNum(m.open)}</td><td class="num">${fmtNum(m.won)}</td><td class="num">${fmtAED(m.pipeline_value_aed)}</td><td class="num" style="${m.overdue_follow_ups ? 'color:var(--bad);font-weight:700' : ''}">${fmtNum(m.overdue_follow_ups)}</td><td class="num">${fmtNum(m.calls)}</td><td class="num">${fmtNum(m.whatsapp)}</td><td class="num">${fmtNum(m.emails)}</td><td class="num">${fmtNum(m.meetings)}</td><td class="num">${fmtMins(m.median_minutes_to_first_contact)}</td><td class="small">${m.last_activity_at ? fmtDT(m.last_activity_at) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Click a member to see their dashboard.</p></div>` : ''}`;
}

function dashControls(d, { base, members }) {
  const agentSel = members ? `<select data-change="dash-agent" data-base="${esc(base)}" data-days="${d.period_days}" aria-label="Show" style="width:auto"><option value="">Whole ${d.org.kind === 'AGENT' ? 'account' : 'agency'}</option>${members.map((m) => `<option value="${m.user_id}" ${d.agent_id === m.user_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '';
  return `${agentSel}<select data-change="dash-days" data-base="${esc(base)}" data-agent="${d.agent_id ?? ''}" aria-label="Period" style="width:auto">${DASH_DAYS.map((n) => `<option value="${n}" ${n === d.period_days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select>`;
}

async function viewDashboard(_p, query) {
  const params = new URLSearchParams();
  if (query.days) params.set('days', query.days);
  if (query.agent && can('crm.all')) params.set('agent', query.agent);
  const d = await GET(`/api/crm/dashboard?${params}`);
  const members = can('crm.all') ? (await GET('/api/org/members')).members : null;
  const who = d.scope === 'agent' ? (d.agent_id === state.me.user.id ? 'Your leads' : `Agent: ${members?.find((m) => m.user_id === d.agent_id)?.name || ''}`) : d.org.kind === 'AGENT' ? 'Your account' : 'Whole agency';
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>CRM dashboard</h1><p class="muted" style="margin:4px 0 0">${esc(who)} · last ${d.period_days} days</p></div>
    <div class="spacer"></div><div class="row">${dashControls(d, { base: '#/dashboard', members })}<a class="btn sm" href="#/crm">Open CRM →</a></div></div>
  ${dashboardHtml(d, { base: '#/dashboard' })}`;
}

async function ownerCrm(rest, query) {
  if (rest[0]) return ownerCrmOrg(rest[0], query);
  const o = await GET(`/api/owner/crm/overview?days=${encodeURIComponent(query.days || 30)}`);
  const t0 = o.totals;
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>CRM monitor</h1><p class="muted" style="margin:4px 0 0">Every agency and solo agent · last ${o.period_days} days</p></div><div class="spacer"></div>
    <select data-change="dash-days" data-base="#/owner/crm" data-agent="" aria-label="Period" style="width:auto">${DASH_DAYS.map((n) => `<option value="${n}" ${n === o.period_days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select></div>
  <div class="grid g4">
    <div class="card"><div class="stat"><span class="l">Accounts</span><span class="v">${fmtNum(t0.agencies + t0.solo_agents)}</span></div><div class="small muted">${plural(t0.agencies, 'agency', 'agencies')} · ${plural(t0.solo_agents, 'solo agent', 'solo agents')}</div></div>
    <div class="card"><div class="stat"><span class="l">Open leads</span><span class="v">${fmtNum(t0.open)}</span></div><div class="small muted">${fmtNum(t0.leads)} total · ${fmtNum(t0.won)} won</div></div>
    <div class="card"><div class="stat"><span class="l">Open pipeline</span><span class="v" style="font-size:24px">${fmtAED(t0.pipeline_value_aed)}</span></div><div class="small muted">${plural(t0.activities_in_period, 'contact', 'contacts')} logged</div></div>
    <div class="card"><div class="stat"><span class="l">Needs attention</span><span class="v" style="${t0.overdue_follow_ups || t0.sla_breached ? 'color:var(--bad)' : ''}">${fmtNum(t0.overdue_follow_ups)}</span></div><div class="small muted">overdue follow-ups · ${plural(t0.sla_breached, 'missed first contact', 'missed first contacts')}</div></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Accounts</h3><div class="table-wrap"><table><thead><tr><th>Account</th><th class="num">Members</th><th class="num">Leads</th><th class="num">Open</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Pipeline</th><th class="num">Overdue</th><th class="num">Missed 1st contact</th><th class="num">Contacts (${o.period_days}d)</th><th>Last activity</th></tr></thead>
    <tbody>${o.organizations.map((x) => `<tr class="click" data-href="#/owner/crm/${x.id}"><td><a href="#/owner/crm/${x.id}"><b>${esc(x.name)}</b></a> <span class="badge ${x.kind === 'AGENT' ? 'gold' : ''}">${x.kind === 'AGENT' ? 'Solo agent' : 'Agency'}</span><br><span class="small muted">${esc(x.owner_email)}</span></td><td class="num">${fmtNum(x.members)}</td><td class="num">${fmtNum(x.leads)}</td><td class="num">${fmtNum(x.open)}</td><td class="num">${fmtNum(x.won)}</td><td class="num">${x.win_rate == null ? '—' : x.win_rate + '%'}</td><td class="num">${fmtAED(x.pipeline_value_aed)}</td><td class="num" style="${x.overdue_follow_ups ? 'color:var(--bad);font-weight:700' : ''}">${fmtNum(x.overdue_follow_ups)}</td><td class="num" style="${x.sla_breached ? 'color:var(--bad);font-weight:700' : ''}">${fmtNum(x.sla_breached)}</td><td class="num">${fmtNum(x.activities_in_period)}</td><td class="small">${x.last_activity_at ? fmtDT(x.last_activity_at) : '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">No accounts yet</td></tr>'}</tbody></table></div>
    <p class="small muted">Open an account to see its dashboard, each member's work and its leads. Contact details stay masked until you open a lead; opening and every change you make are recorded in the audit log.</p></div>`;
}

async function ownerCrmOrg(orgId, query) {
  const params = new URLSearchParams();
  if (query.days) params.set('days', query.days);
  if (query.agent) params.set('agent', query.agent);
  const leadParams = new URLSearchParams();
  if (query.agent) leadParams.set('agent', query.agent);
  if (query.stage) leadParams.set('stage', query.stage);
  const [d, org, leads] = await Promise.all([GET(`/api/owner/orgs/${orgId}/crm/dashboard?${params}`), GET(`/api/owner/orgs/${orgId}`), GET(`/api/owner/orgs/${orgId}/crm/leads?${leadParams}`)]);
  const base = `#/owner/crm/${orgId}`;
  const who = d.scope === 'agent' ? `Member: ${org.members.find((m) => m.user_id === d.agent_id)?.name || ''}` : org.kind === 'AGENT' ? 'Solo agent account' : 'Whole agency';
  return `<div class="page-head"><div><a href="#/owner/crm" class="small muted">← CRM monitor</a><h1>${esc(org.name)} <span class="badge ${org.kind === 'AGENT' ? 'gold' : ''}" style="vertical-align:middle">${org.kind === 'AGENT' ? 'Solo agent' : 'Agency'}</span></h1><p class="muted" style="margin:4px 0 0">${esc(who)} · last ${d.period_days} days · ${esc(org.owner_email)}</p></div>
    <div class="spacer"></div><div class="row">${dashControls(d, { base, members: org.members })}<a class="btn sm" href="#/owner/org/${orgId}">Account settings →</a></div></div>
  <div class="banner cold" style="margin-bottom:16px">👁 You are viewing this account as platform owner. You can move leads between stages and reassign them to members of this account; each change is logged on the lead and in the audit log.</div>
  ${dashboardHtml(d, { base, ownerOrg: orgId })}
  <div class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">Leads (${fmtNum(leads.length)})</h3>
    <select data-change="owner-lead-filter" data-base="${base}" data-agent="${esc(query.agent || '')}" data-days="${d.period_days}" aria-label="Stage" style="width:auto"><option value="">All stages</option>${STAGES.map((s) => `<option value="${s}" ${s === query.stage ? 'selected' : ''}>${esc(human(s))}</option>`).join('')}</select></div>
    <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Client</th><th>Contact (masked)</th><th>Stage</th><th>Assigned to</th><th class="num">Deal</th><th>Next follow-up</th><th></th></tr></thead>
    <tbody>${leads.map((l) => `<tr><td>${srcBadge(l.source_type)} <b>${esc(l.full_name)}</b>${l.preferred_channel ? `<br><span class="small muted">Prefers ${esc(human(l.preferred_channel))}</span>` : ''}</td><td class="small mono">${esc(l.phone || '—')}<br>${esc(l.email || '')}</td><td><span class="badge">${esc(human(l.stage))}</span></td><td>${esc(l.assignee_name || '—')}</td><td class="num">${fmtAED(l.deal_value_aed)}</td><td class="small" style="${l.next_task_due && new Date(l.next_task_due) < new Date() ? 'color:var(--bad);font-weight:700' : ''}">${l.next_task_due ? fmtDT(l.next_task_due) : '<span class="muted">none</span>'}</td><td><button class="btn sm" data-act="owner-open-lead" data-org="${orgId}" data-id="${l.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No leads</td></tr>'}</tbody></table></div></div>`;
}

function ownerLeadModal(orgId, l) {
  return `<div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(l.full_name)}</h2><button class="btn sm ghost" data-act="close-refresh" aria-label="Close">✕</button></div>
  <div class="row" style="margin:6px 0 12px">${srcBadge(l.source_type)}<span class="badge">${esc(human(l.stage))}</span>${l.suppressed ? '<span class="badge bad">Do not contact</span>' : ''}</div>
  <div class="kv"><span class="k">${t('phone')}</span><span class="v" dir="ltr">${esc(l.phone || '—')}</span><span class="k">${t('email')}</span><span class="v" style="word-break:break-all">${esc(l.email || '—')}</span>
    <span class="k">Prefers</span><span class="v">${[l.preferred_channel, l.best_time, l.tone, l.preferred_language && l.preferred_language.toUpperCase()].filter(Boolean).map((x) => esc(human(x))).join(' · ') || '—'}</span>
    <span class="k">Deal</span><span class="v">${fmtAED(l.deal_value_aed)}</span><span class="k">First contact</span><span class="v">${l.first_contacted_at ? fmtDT(l.first_contacted_at) : 'not yet'}</span></div>
  <div class="grid g2" style="gap:10px;margin-top:12px">
    <label class="field">${t('stage')}<select data-change="owner-lead-stage" data-org="${orgId}" data-id="${l.id}">${STAGES.map((s) => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${esc(human(s))}</option>`).join('')}</select></label>
    <label class="field">${t('assignee')}<select data-change="owner-lead-assign" data-org="${orgId}" data-id="${l.id}"><option value="" ${l.assigned_user_id ? '' : 'selected'} disabled>— not assigned —</option>${l.members.map((m) => `<option value="${m.user_id}" ${m.user_id === l.assigned_user_id ? 'selected' : ''}>${esc(m.name)} (${esc(human(m.role))})</option>`).join('')}</select></label>
  </div>
  <h3>Follow-ups</h3>${l.tasks.map((x) => `<div class="small" style="border-top:1px solid var(--line);padding:4px 0">${x.done_at ? '✓ ' : ''}${esc(x.title)} · ${fmtDT(x.due_at)}${x.assignee_name ? ' · ' + esc(x.assignee_name) : ''}</div>`).join('') || '<span class="muted small">none</span>'}
  <h3>${t('timeline')}</h3><div class="timeline" style="max-height:260px;overflow:auto">${l.activities.map((a) => `<div class="tl"><div><b>${esc(human(a.type))}</b> <span class="small muted">· ${esc(a.user_name || 'System')} · ${fmtDT(a.created_at)}</span><div class="small">${esc(a.body || '')}</div></div></div>`).join('') || '<span class="muted">—</span>'}</div>
  <p class="small muted">Opening this lead was recorded in the audit log.</p>`;
}

async function viewTeam() {
  const manage = can('members.manage');
  const [m, joins] = await Promise.all([GET('/api/org/members'), manage ? GET('/api/org/join-requests') : Promise.resolve([])]);
  const limit = m.account_limit;
  const capCell = (x) => {
    const used = `${fmtNum(x.used_today)}${x.daily_cap != null ? ` / ${fmtNum(x.daily_cap)}` : ''}`;
    if (!manage || x.role === 'ORG_OWNER') return `<span class="small">${used}${x.daily_cap == null ? ' <span class="muted">· shared</span>' : ''}</span>`;
    return `<form class="row" data-form="member-cap" data-id="${x.user_id}" style="gap:6px;flex-wrap:nowrap">
      <input type="number" name="daily_cap" min="0" ${limit ? `max="${limit}"` : ''} value="${x.daily_cap ?? ''}" placeholder="No limit" style="width:96px" aria-label="Daily limit for ${esc(x.name)}">
      <button class="btn sm">Save</button><span class="small muted">${fmtNum(x.used_today)} today</span></form>`;
  };
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('team')}</h1></div><div class="spacer"></div><span class="badge gold">Seats: ${t('unlimited_members')}</span>${limit ? `<span class="badge">Account limit: ${fmtNum(limit)} / day</span>` : ''}</div>
  ${joins.length ? `<div class="card" style="margin-bottom:16px;border:2px solid var(--gold)"><h3 style="margin-top:0">Agents asking to join (${joins.length})</h3>
    ${joins.map((j) => `<form class="row" data-form="join-approve" data-id="${j.id}" style="border-top:1px solid var(--line);padding:10px 0;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px"><b>${esc(j.name)}</b><br><span class="small muted">${esc(j.email)}${j.phone ? ` · <span class="mono">${esc(j.phone)}</span>` : ''} · asked ${fmtDT(j.created_at)}</span></div>
      <select name="role" style="width:auto" aria-label="Role for ${esc(j.name)}">${['AGENT', 'TEAM_LEADER', 'SALES_MANAGER', 'MARKETING_MANAGER', 'AUDITOR'].map((r) => `<option value="${r}">${esc(human(r))}</option>`).join('')}</select>
      <input type="number" name="daily_cap" min="0" ${limit ? `max="${limit}"` : ''} placeholder="Daily limit" style="width:120px" aria-label="Daily limit for ${esc(j.name)}">
      <button class="btn sm primary">Approve</button><button type="button" class="btn sm ghost" data-act="join-decline" data-id="${j.id}">Decline</button></form>`).join('')}</div>` : ''}
  <div class="banner cold" style="margin-bottom:16px">❄ ${esc(m.quota_note)}</div>
  <div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>${t('name')}</th><th>Mobile</th><th>${t('email')}</th><th>${t('role')}</th><th>Daily limit (used today)</th><th></th></tr></thead><tbody>${m.members.map((x) => `<tr>
    <td><b>${esc(x.name)}</b></td><td class="small mono">${esc(x.phone || '—')}</td><td class="small">${esc(x.email)}</td><td><span class="badge">${esc(human(x.role))}</span></td>
    <td>${capCell(x)}</td>
    <td>${manage && x.role !== 'ORG_OWNER' ? `<button class="btn sm ghost" data-act="remove-member" data-id="${x.user_id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
  <div class="grid g2" style="align-items:start">
    ${manage ? `<form class="card grid" data-form="invite" style="gap:10px"><h3>${t('invite')}</h3><p class="small muted">The person signs in with Google using this email and joins this account. Leave the daily limit empty to let them use the shared allowance.</p>
      <div class="grid g2">
        <label class="field">Full name<input type="text" name="full_name" required minlength="2" maxlength="120"></label>
        <label class="field">Mobile number<input type="tel" name="phone" inputmode="tel" placeholder="+971 50 123 4567"></label>
        <label class="field">${t('email')}<input type="email" name="email" required></label>
        <label class="field">${t('role')}<select name="role">${['AGENT', 'TEAM_LEADER', 'SALES_MANAGER', 'MARKETING_MANAGER', 'ORG_ADMIN', 'AGENCY_DIRECTOR', 'AUDITOR'].map((r) => `<option value="${r}">${esc(human(r))}</option>`).join('')}</select></label>
        <label class="field">Daily limit (records)<input type="number" name="daily_cap" min="0" ${limit ? `max="${limit}"` : ''} placeholder="No personal limit"></label>
      </div>
      <button class="btn primary" style="justify-self:start">${t('invite')}</button></form>` : ''}
    <div class="card"><h3>Pending invitations (${m.invitations.length})</h3>${m.invitations.slice(0, 20).map((i) => `<div class="small" style="padding:6px 0;border-top:1px solid var(--line)"><b>${esc(i.full_name || i.email)}</b>${i.full_name ? ` · ${esc(i.email)}` : ''}${i.phone ? ` · <span class="mono">${esc(i.phone)}</span>` : ''}<br>${esc(human(i.role))}${i.daily_cap != null ? ` · ${fmtNum(i.daily_cap)}/day` : ''} · expires ${fmtDate(i.expires_at)}</div>`).join('') || '<span class="muted">—</span>'}${m.invitations.length > 20 ? `<div class="small muted">+${m.invitations.length - 20} more</div>` : ''}</div>
  </div>`;
}

async function viewReports() {
  const r = await GET('/api/reports');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('reports')}</h1></div></div>
  <div class="banner warn" style="margin-bottom:16px">${esc(r.note)}</div>
  <div class="card" style="margin-bottom:16px"><h3>Acquisition vs conversion by source</h3><div class="table-wrap"><table><thead><tr><th>${t('source')}</th><th class="num">Leads</th><th class="num">Contacted</th><th class="num">Qualified</th><th class="num">Won</th><th class="num">Contact rate</th><th class="num">Qualification rate</th></tr></thead>
    <tbody>${r.by_source.map((s) => `<tr><td>${srcBadge(s.source_type)}</td><td class="num">${fmtNum(s.leads)}</td><td class="num">${fmtNum(s.contacted)}</td><td class="num">${fmtNum(s.qualified)}</td><td class="num">${fmtNum(s.won)}</td><td class="num">${pct(s.contacted, s.leads)}</td><td class="num">${pct(s.qualified, s.contacted)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Not available yet</td></tr>'}</tbody></table></div></div>
  <div class="card" style="margin-bottom:16px"><h3>${t('agent_score')} (0–100)</h3><p class="small muted">Weights: ${Object.entries(r.weights).map(([k, v]) => `${k} ${v * 100}%`).join(' · ')}. Each part uses its own denominator; parts with no data are excluded, not counted as zero.</p>
    <div class="table-wrap"><table><thead><tr><th>Agent</th><th class="num">Leads</th><th class="num">SLA met</th><th class="num">Follow-ups on time</th><th class="num">Qualified / contacted</th><th>${t('agent_score')}</th></tr></thead>
    <tbody>${r.agents.map((a) => `<tr><td><b>${esc(a.name)}</b><br><span class="small muted">${esc(human(a.role))}</span></td><td class="num">${a.leads}</td><td class="num">${a.sla_met}/${a.sla_due}</td><td class="num">${a.tasks_on_time}/${a.tasks_due}</td><td class="num">${a.qualified}/${a.contacted}</td>
      <td>${a.score == null ? `<span class="small muted">${esc(a.score_note)}</span>` : `<div class="row"><div class="scorebar"><i style="width:${a.score}%"></i></div><b>${a.score}</b></div>`}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><h3>First-party search demand (anonymous, aggregate)</h3><div class="table-wrap"><table><thead><tr><th>Area</th><th>Type</th><th class="num">Beds</th><th class="num">Searches</th><th class="num">Max budget</th></tr></thead><tbody>${r.first_party_search_demand.map((d) => `<tr><td>${esc(d.area || '—')}</td><td>${esc(d.property_type || '—')}</td><td class="num">${d.bedrooms ?? '—'}</td><td class="num">${fmtNum(d.searches)}</td><td class="num">${fmtAED(d.max_budget)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Not available</td></tr>'}</tbody></table></div>
    <p class="small muted">Anonymous searches are never turned into identified leads.</p></div>`;
}

async function viewBilling(_p, query) {
  const [b, plans] = await Promise.all([GET('/api/billing'), GET('/api/public/plans')]);
  const e = state.me.entitlements.cold;
  const manage = can('billing.manage');
  const pre = query.plan;
  const act = b.activation;
  const waiting = b.cash_requests.filter((c) => c.status === 'PENDING_PAYMENT');
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('billing')}</h1></div></div>
  ${act ? `<form class="card grid" data-form="activate-code" style="border:2px solid var(--ok);margin-bottom:16px;gap:12px">
      <h3 style="margin:0">✓ Payment confirmed — activate ${esc(act.plan_name)}</h3>
      <p class="small muted" style="margin:0">Your activation code was sent automatically. It works once, only for your account, until ${fmtDT(act.expires_at)}.</p>
      <div class="row" style="gap:10px;flex-wrap:wrap"><input type="text" name="code" value="${esc(act.code)}" aria-label="Activation code" class="mono" style="font-size:22px;letter-spacing:3px;max-width:220px;text-transform:uppercase"><button class="btn gold">Activate now</button></div>
    </form>` : ''}
  ${!act && waiting.length ? `<div class="banner cold" style="margin-bottom:16px">⏳ <b>Waiting for AI-DATA to confirm your payment.</b> Your payment reference is <b class="mono">${esc(waiting[0].reference)}</b> — quote it when you pay. This is <u>not</u> the activation code: once AI-DATA confirms the money has arrived, an 8-character activation code appears here automatically and in your notifications.</div>` : ''}
  ${!act && !e.active && !waiting.length ? `<form class="card row" data-form="activate-code" style="gap:10px;margin-bottom:16px;flex-wrap:wrap"><span class="small"><b>Have an activation code?</b></span><input type="text" name="code" placeholder="XXXX-XXXX" required aria-label="Activation code" class="mono" style="max-width:180px;text-transform:uppercase"><button class="btn">Activate</button></form>` : ''}
  <div class="grid g2" style="align-items:start">
    <div class="card"><h3>Current Cold subscription</h3>
      ${e.active ? `<div class="kv"><span class="k">${t('plan')}</span><span class="v">${esc(e.plan_name)}</span><span class="k">${t('status')}</span><span class="v"><span class="badge ok">Active</span></span><span class="k">${t('renews')}</span><span class="v">${fmtDate(e.period_end)}</span><span class="k">Method</span><span class="v">${esc(human(e.provider))}</span></div>`
        : `<div class="banner warn">${t('no_active_plan')}${e.latest ? ` · last status: <b>${esc(human(e.latest.status))}</b>` : ''}</div>`}
      <h3 style="margin-top:16px">Policy</h3><ul class="small muted" style="margin:0;padding-inline-start:18px">${Object.values(b.policy).filter((x) => typeof x === 'string').map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="grid">${manage ? plans.plans.map((p) => `<div class="card ${pre === p.code ? '' : ''}" style="${pre === p.code ? 'border:2px solid var(--gold)' : ''}"><div class="row"><h3 style="margin:0">${esc(p.name)} · ${fmtMoney(p.price_usd_cents)}${t('per_month')}</h3></div>
        <p class="small muted">${fmtNum(p.cold_daily_limit)} ${t('cold_per_day')} · ${t('unlimited_members')} · ${t('crm_only')}</p>
        <div class="row"><button class="btn" data-act="pay-paypal" data-plan="${p.code}" ${b.paypal_connected ? '' : 'disabled'}>${t('pay_paypal')}</button>${b.paypal_connected ? '' : `<span class="badge bad">PayPal ${t('not_connected')}</span>`}
        <button class="btn gold" data-act="pay-cash" data-plan="${p.code}">${t('pay_cash')}</button></div></div>`).join('') : `<div class="card muted">Only the account owner or director can change the subscription.</div>`}</div>
  </div>
  ${b.cash_requests.length ? `<div class="card" style="margin-top:16px"><h3>Offline payment requests</h3><div class="table-wrap"><table><thead><tr><th>Reference</th><th>${t('plan')}</th><th class="num">${t('amount')}</th><th>${t('status')}</th><th>${t('date')}</th></tr></thead><tbody>${b.cash_requests.map((c) => `<tr><td class="mono"><b>${esc(c.reference)}</b></td><td>${esc(human(c.plan_code))}</td><td class="num">${fmtMoney(c.amount_cents)}</td><td><span class="badge ${c.status === 'VERIFIED' ? 'ok' : c.status === 'REJECTED' ? 'bad' : 'warn'}">${esc(human(c.status))}</span></td><td>${fmtDT(c.created_at)}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Pay at the AI-DATA office or by bank transfer quoting the reference. Access starts after AI-DATA confirms the money has arrived; you then receive an activation code automatically on this page and in your notifications.</p></div>` : ''}
  <div class="card" style="margin-top:16px"><h3>${t('payments')}</h3><div class="table-wrap"><table><thead><tr><th>${t('date')}</th><th>Method</th><th>Product</th><th class="num">${t('amount')}</th><th>${t('status')}</th><th>Receipt</th></tr></thead><tbody>${b.payments.map((p) => `<tr><td>${fmtDate(p.paid_at)}</td><td>${esc(human(p.provider))}</td><td>${esc(human(p.kind))}</td><td class="num">${fmtMoney(p.amount_cents)}</td><td><span class="badge ${p.status === 'COMPLETED' ? 'ok' : 'bad'}">${esc(human(p.status))}</span></td><td class="mono">${esc(p.receipt_no || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">—</td></tr>'}</tbody></table></div></div>
`;
}

async function viewIntegrations() {
  const i = await GET('/api/integrations');
  return `<div class="page-head"><div><h1>${t('integrations')}</h1><p class="muted">Every connector shows its real state. Nothing is shown as live until credentials, permissions and agreements exist.</p></div></div>
  <div class="grid g3">
    <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Google Sign-In</h3>${statusBadge(i.google_sign_in)}</div><p class="small muted">OpenID Connect via Google Identity Services. Requires GOOGLE_CLIENT_ID.</p></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">PayPal Subscriptions</h3>${statusBadge(i.paypal)}</div><p class="small muted">Billing Plans + verified webhooks. Requires client ID/secret, webhook ID and plan IDs.</p></div>
    ${i.sources.map((s) => `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(s.name)}</h3>${statusBadge(s.status)}</div><div class="row" style="margin:6px 0"><span class="badge">${esc(s.category)}</span>${s.isolation_required ? '<span class="badge warn">Source isolation</span>' : ''}</div><p class="small muted">${esc(s.requirements)}</p>${s.last_event_at ? `<p class="small">Last event: ${fmtDT(s.last_event_at)}</p>` : ''}</div>`).join('')}
  </div>`;
}

async function viewSettings() {
  return `<div class="page-head"><h1>${t('settings')}</h1></div>
  <div class="grid g2" style="align-items:start">
    <div class="card grid"><label class="field">${t('language')}<select data-change="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === state.lang ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">${t('timezone')}<input type="text" value="Asia/Dubai" disabled></label><p class="small muted">Cold quota days always follow Asia/Dubai.</p></div>
    <div class="card"><h3>Privacy</h3><p class="small muted">${t('compliance_body')}</p><p class="small muted">Data-subject requests (access, correction, deletion, opt-out) are handled by AI-DATA and propagate to every CRM copy.</p></div>
  </div>`;
}

// ---------------------------------------------------------------------------------
// Owner console
// ---------------------------------------------------------------------------------
async function viewOwner([sub = 'dashboard', ...rest], query = {}) {
  if (sub === 'finance' || sub === 'approvals') return ownerApprovals();
  if (!isOwner() && sub !== 'dashboard') return '<div class="banner bad">Platform owner only.</div>';
  if (sub === 'source') return ownerSource();
  if (sub === 'data') return ownerData();
  if (sub === 'org') return ownerOrg(rest[0]);
  if (sub === 'crm') return ownerCrm(rest, query);
  if (sub === 'hot') return ownerHot();
  if (sub === 'governance') return ownerGovernance();
  if (sub === 'audit') return ownerAudit();
  const d = await GET('/api/owner/dashboard');
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>${t('owner_dashboard')}</h1></div></div>
  <div class="grid g4">
    <div class="card"><div class="stat"><span class="l">MRR (verified)</span><span class="v">${fmtMoney(d.mrr_cents)}</span></div><p class="small muted">${esc(d.mrr_basis)}</p></div>
    <div class="card"><div class="stat"><span class="l">Active by plan</span><span class="v" style="font-size:20px">${Object.entries(d.active_by_plan).map(([k, v]) => `${esc(human(k))}: ${v}`).join('<br>') || '—'}</span></div></div>
    <div class="card"><div class="stat"><span class="l">Cold revenue this month</span><span class="v">${fmtMoney(d.revenue_this_month.filter((r) => r.kind === 'COLD_SUBSCRIPTION').reduce((s, r) => s + r.collected, 0))}</span></div><p class="small muted">${d.revenue_this_month.map((r) => `${esc(human(r.provider))}: ${fmtMoney(r.collected)}`).join(' · ') || '—'}</p></div>
    <div class="card"><div class="stat hot"><span class="l">Hot revenue this month (separate)</span><span class="v">${fmtMoney(d.hot_revenue_this_month.cents)}</span></div><p class="small muted">${d.hot_revenue_this_month.leads} leads billed</p></div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><div class="stat"><span class="l">Payments to confirm</span><span class="v" style="${d.pending_cash.length ? 'color:var(--bad)' : ''}">${d.pending_cash.length}</span></div><a href="#/owner/approvals" class="small">Payment approvals →</a></div>
    <div class="card"><div class="stat"><span class="l">Overdue / suspended</span><span class="v" style="color:var(--bad)">${d.overdue.length}</span></div></div>
    <div class="card"><div class="stat"><span class="l">Investor records</span><span class="v">${fmtNum(d.data.investors)}</span></div><p class="small muted">${fmtNum(d.data.transactions)} transactions · ${fmtNum(d.data.approved)} approved · ${fmtNum(d.data.pending)} pending review · ${fmtNum(d.data.suppressed)} suppressed</p></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Organizations</h3><div class="table-wrap"><table><thead><tr><th>Organization</th><th>Owner</th><th class="num">Members</th><th>${t('plan')}</th><th>${t('status')}</th><th>${t('renews')}</th></tr></thead><tbody>${d.organizations.map((o) => `<tr class="click" data-href="#/owner/org/${o.id}"><td><a href="#/owner/org/${o.id}"><b>${esc(o.name)}</b></a> <span class="badge">${esc(o.kind)}</span></td><td class="small">${esc(o.owner_email)}</td><td class="num">${o.members}</td><td>${esc(human(o.active_plan || '—'))}</td><td><span class="badge ${o.active_plan ? 'ok' : 'warn'}">${esc(human(o.status))}</span> <span class="small muted">${esc(human(o.provider || ''))}</span></td><td>${fmtDate(o.renews_or_ends)}</td></tr>`).join('')}</tbody></table></div></div>
  <p class="small muted" style="margin-top:6px">Open an organization to set each user's daily limit or delete its CRM data.</p>
  ${isOwner() ? dangerZone([{ act: 'owner-delete-all-crm', title: 'Delete all customers’ CRM data', text: 'Removes every lead, contact, note and follow-up from every customer account (your own owner CRM is kept). Payments, invoices and the audit log are kept.' }]) : ''}
  <div class="card" style="margin-top:16px"><h3>Cold usage by day</h3><div class="table-wrap"><table><tbody>${d.cold_usage_today.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.local_day)}</td><td class="num">${u.committed_used} / ${u.plan_limit}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table></div></div>`;
}

async function ownerApprovals() {
  const d = await GET('/api/owner/approvals');
  const step = (n, title, text) => `<div class="card" style="padding:14px 16px"><div class="row" style="gap:10px;align-items:flex-start"><span class="badge gold">${n}</span><div><b>${title}</b><div class="small muted">${text}</div></div></div></div>`;
  const who = (c) => `${esc(c.requested_by_name || c.requested_by_email)}<br><span class="small muted">${esc(c.requested_by_email)}${c.requested_by_phone ? ` · <span class="mono">${esc(c.requested_by_phone)}</span>` : ''}</span>`;
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>Payment approvals</h1><p class="muted" style="margin:4px 0 0">Confirm payments you have received. The customer then gets an activation code automatically.</p></div>
    <div class="spacer"></div><span class="badge ${d.counts.to_confirm ? 'bad' : 'ok'}">${d.counts.to_confirm} to confirm</span><span class="badge gold">${d.counts.awaiting_activation} waiting for customer</span></div>
  <div class="grid g3" style="margin-bottom:16px">
    ${step(1, 'Customer pays', 'They choose Cash / bank transfer on their Billing page and get a payment reference (AIH-…). It appears below.')}
    ${step(2, 'You confirm the money arrived', 'Check your bank or cash receipt, enter amount, date, channel and receipt number, then press <b>Confirm payment</b>.')}
    ${step(3, 'Customer activates', `They receive an 8-character activation code automatically: in the app (notification + Billing page)${d.email_configured ? ' and by email' : ''}. One click and their data access starts.`)}
  </div>
  ${d.email_configured ? '' : '<div class="banner cold" style="margin-bottom:16px">Email sending is not set up, so codes are delivered inside the app only (customers see them as soon as they sign in). You can also send a code by WhatsApp after confirming.</div>'}
  <div class="card"><h3>1 · Payments to confirm (${d.pending_cash.length})</h3>
    <p class="small muted" style="margin-top:0">Confirm only money actually received. A customer's screenshot is a claim, not a receipt. Every confirmation is recorded in the audit log.</p>
    ${d.pending_cash.map((c) => `<form class="grid" data-form="verify-cash" data-id="${c.id}" style="border-top:1px solid var(--line);padding:14px 0;gap:10px">
      <div class="row" style="gap:12px;flex-wrap:wrap"><b class="mono" style="font-size:16px">${esc(c.reference)}</b><span><b>${esc(c.org_name)}</b></span><span class="badge">${esc(human(c.plan_code))}</span><span class="badge gold">${fmtMoney(c.amount_cents)}</span><span class="small muted">requested ${fmtDT(c.created_at)}</span></div>
      <div class="small">${who(c)}</div>
      ${c.customer_note ? `<div class="small muted">Customer note: “${esc(c.customer_note)}”</div>` : ''}
      <div class="grid g4" style="gap:8px"><label class="field">Amount received (AED)<input type="number" name="amount_aed" step="0.01" min="0" required value="${(c.amount_cents / 100).toFixed(0)}"></label><label class="field">Paid on<input type="date" name="paid_on" required value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="field">Channel<select name="channel"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH_OFFICE">Cash at office</option><option value="CHEQUE">Cheque</option></select></label><label class="field">Receipt / transfer no.<input type="text" name="receipt_no" required maxlength="60"></label></div>
      <div class="row"><button class="btn gold">✓ Confirm payment & send activation code</button><button type="button" class="btn ghost" data-act="reject-cash" data-id="${c.id}">Reject</button></div></form>`).join('') || '<div class="empty">Nothing to confirm right now.</div>'}</div>
  <div class="card" style="margin-top:16px"><h3>2 · Confirmed, waiting for the customer to activate (${d.awaiting_activation.length})</h3>
    <p class="small muted" style="margin-top:0">The customer already has their code. If it expired or they lost it, send a new one (the old code stops working).</p>
    ${d.awaiting_activation.map((s) => `<div class="row" style="border-top:1px solid var(--line);padding:10px 0;gap:12px;flex-wrap:wrap"><span><b>${esc(s.org_name)}</b> · ${esc(human(s.plan_code))}<br><span class="small muted">${esc(s.customer_email || '')}${s.customer_phone ? ` · <span class="mono">${esc(s.customer_phone)}</span>` : ''} · confirmed ${fmtDT(s.created_at)} · ${s.code_expires_at ? `code valid until ${fmtDT(s.code_expires_at)}` : '<b style="color:var(--bad)">code expired</b>'}</span></span><div class="spacer"></div><button class="btn sm" data-act="reissue" data-id="${s.id}">Send new code</button></div>`).join('') || '<div class="empty">No one is waiting.</div>'}</div>`;
}

// After confirming: the code has already reached the customer in the app (and by email
// when configured). WhatsApp is offered as an extra channel.
function showActivationLink(r, reissued = false) {
  const text = `Your AI-DATA payment is confirmed. Activation code: ${r.activation_code}. Sign in with Google as ${r.delivered_to}, open Billing and press Activate, or open this link: ${r.activation_link}`;
  openModal(`<h2>${reissued ? 'New activation code sent' : 'Payment confirmed ✓'}</h2>
    <p>Activation code for <b>${esc(r.delivered_to)}</b>:</p>
    <div class="code" style="font-size:28px;letter-spacing:4px;text-align:center" id="act-link">${esc(r.activation_code)}</div>
    <div class="banner ok">Delivered automatically: in-app notification and on the customer's Billing page${r.emailed ? ', and by email' : ''}.${r.email_configured ? '' : ' (Email is not set up yet.)'}${reissued ? ' The previous code no longer works.' : ''}</div>
    <p class="small muted">The code works once, only for that Google account, until ${fmtDT(r.expires_at)}.</p>
    <div class="row"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(text)}">Also send by WhatsApp</a>
      <button class="btn" data-act="copy-link" data-text="${esc(text)}">Copy message</button>
      <button class="btn primary" data-act="close-refresh">${t('close')}</button></div>`);
}

// Irreversible actions, kept at the bottom of a page in their own red box.
function dangerZone(items) {
  return `<div class="card" style="margin-top:16px;border:1px solid var(--bad)"><h3 style="color:var(--bad);margin-top:0">Danger zone</h3>
    ${items.map((x) => `<div class="row" style="gap:12px;border-top:1px solid var(--line);padding:10px 0;flex-wrap:wrap"><div style="flex:1;min-width:240px"><b>${esc(x.title)}</b><div class="small muted">${esc(x.text)}</div></div>
      <button class="btn" style="border-color:var(--bad);color:var(--bad)" data-act="${x.act}" ${x.data || ''}>${esc(x.title)}</button></div>`).join('')}</div>`;
}

// Typed confirmation for deletions: the exact phrase must be typed, then MFA.
function confirmDelete({ title, text, phrase, run }) {
  openModal(`<h2 style="color:var(--bad)">${esc(title)}</h2><p>${esc(text)}</p><p class="small"><b>This cannot be undone.</b> Type <b class="mono">${esc(phrase)}</b> to confirm.</p>
    <input type="text" id="del-confirm" autocomplete="off" aria-label="Confirmation phrase" class="mono">
    <div class="row"><button class="btn" id="del-go" disabled style="border-color:var(--bad);color:var(--bad)">${esc(title)}</button><button class="btn ghost" data-act="close">${t('cancel')}</button></div>`);
  const input = document.getElementById('del-confirm');
  const go = document.getElementById('del-go');
  input.oninput = () => { go.disabled = input.value.trim().toUpperCase() !== phrase; };
  go.onclick = async () => {
    try {
      const r = await withMfa(() => run(input.value));
      closeModal();
      toast(`Deleted ✓ ${Object.entries(r).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${fmtNum(v)} ${human(k).toLowerCase()}`).join(' · ')}`);
      state.owner.counts = null;
      render();
    } catch (e) { toast(errMsg(e), true); }
  };
}

async function ownerOrg(id) {
  const o = await GET(`/api/owner/orgs/${id}`);
  return `<div class="page-head"><div><a href="#/owner" class="small muted">← ${t('owner_dashboard')}</a><h1>${esc(o.name)}</h1>
      <div class="row" style="margin-top:6px"><span class="badge">${esc(o.kind)}</span><span class="small muted">${esc(o.owner_email)}</span>
      ${o.plan ? `<span class="badge ok">${esc(o.plan.name)} · ${fmtNum(o.plan.daily_limit)} / day</span>` : '<span class="badge warn">No active plan</span>'}</div></div></div>
  <div class="card"><h3>Users and daily limits</h3><p class="small muted" style="margin-top:0">The account's plan limit is shared by all users. A personal limit caps one user inside it; leave empty for no personal limit.</p>
    <div class="table-wrap"><table><thead><tr><th>${t('name')}</th><th>Mobile</th><th>${t('email')}</th><th>${t('role')}</th><th class="num">Leads</th><th>Daily limit (used today)</th><th></th></tr></thead><tbody>
    ${o.members.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td class="small mono">${esc(m.phone || '—')}</td><td class="small">${esc(m.email)}</td><td><span class="badge">${esc(human(m.role))}</span></td><td class="num">${fmtNum(m.leads)}</td>
      <td><form class="row" data-form="owner-cap" data-org="${o.id}" data-id="${m.user_id}" style="gap:6px;flex-wrap:nowrap"><input type="number" name="daily_cap" min="0" ${o.plan ? `max="${o.plan.daily_limit}"` : ''} value="${m.daily_cap ?? ''}" placeholder="No limit" style="width:96px" aria-label="Daily limit for ${esc(m.name)}"><button class="btn sm">Save</button><span class="small muted">${fmtNum(m.used_today)} today</span></form></td>
      <td>${m.leads ? `<button class="btn sm ghost" style="color:var(--bad)" data-act="owner-delete-user-crm" data-org="${o.id}" data-id="${m.user_id}" data-name="${esc(m.name)}" data-count="${m.leads}">Delete this user’s CRM data</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No users</td></tr>'}</tbody></table></div></div>
  ${dangerZone([{ act: 'owner-delete-org-crm', data: `data-org="${o.id}" data-name="${esc(o.name)}" data-count="${o.crm.leads}"`, title: 'Delete this account’s CRM data', text: `Removes all ${fmtNum(o.crm.leads)} leads and ${fmtNum(o.crm.contacts)} contacts of ${o.name}, with their notes and follow-ups. Users, plan and payments are kept.` }])}`;
}

async function ownerData() {
  const o = state.owner;
  if (!o.counts) { const r = await POST('/api/owner/cold/search', { filter: o.filter, limit: 50 }); Object.assign(o, { results: r.results, counts: r.counts, cursor: r.next_cursor }); }
  const fields = await GET('/api/owner/export-fields');
  const opts = await GET('/api/owner/cold/filters');
  const sel = (k, label) => `<label class="field">${label}<select multiple name="${k}">${(opts?.[k] || []).map((v) => `<option ${o.filter[k]?.includes(v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')} · unmasked</div><h1>${t('master_data')}</h1></div></div>
  <div class="banner bad" style="margin-bottom:16px">Owner-only view with full personal data. Every search and export is audited.</div>
  ${dangerZone([{ act: 'owner-delete-investors', title: 'Delete all investor data', text: `Wipes the whole Master Cold database — ${fmtNum(o.counts?.total ?? 0)} investors in the current view, all imported/synced records, their transactions and the import history. Customers keep the copies already in their CRM.` }])}
  <div class="ih"><form class="card filters" data-form="owner-search">${sel('city', 'City') + sel('area', 'Area') + sel('property_type', 'Type')}
    <label class="field">Client role<select name="client_role"><option value="">All</option><option value="BUYER">Buyer</option><option value="SELLER">Seller</option></select></label>
    <div class="grid g2" style="gap:8px"><label class="field">Year from<input type="number" name="year_from" value="${o.filter.year_from ?? ''}"></label><label class="field">Year to<input type="number" name="year_to" value="${o.filter.year_to ?? ''}"></label></div>
    <button class="btn primary block">${t('search')}</button>
    <details><summary class="small" style="cursor:pointer;font-weight:700">Export fields</summary><div class="grid" style="gap:4px;margin-top:8px">${fields.map((f) => `<label class="check"><input type="checkbox" name="field" value="${f}" checked> ${esc(f)}</label>`).join('')}</div></details>
    <button type="button" class="btn gold block" data-act="owner-export">⬇ ${t('export_xlsx')}</button><div id="export-result"></div></form>
  <div style="min-width:0"><div class="grid g4" style="margin-bottom:12px"><div class="card"><div class="stat"><span class="l">${t('matching')}</span><span class="v">${fmtNum(o.counts.total)}</span></div></div><div class="card"><div class="stat cold"><span class="l">${t('eligible')}</span><span class="v">${fmtNum(o.counts.eligible)}</span></div></div><div class="card"><div class="stat"><span class="l">${t('restricted')}</span><span class="v">${fmtNum(o.counts.restricted)}</span></div></div></div>
    <div class="row" style="margin-bottom:10px;gap:8px;flex-wrap:wrap"><button class="btn gold" data-act="owner-to-crm" ${o.selected.size ? '' : 'disabled'}>➕ Add ${o.selected.size ? fmtNum(o.selected.size) + ' selected' : 'selected'} to my CRM</button>${o.selected.size ? '<button class="btn ghost sm" data-act="owner-clear-pick">Clear selection</button>' : ''}<button class="btn sm" data-act="open-owner-crm">Open my CRM →</button><span class="small muted">Tick rows, then add them as leads for your own follow-up.</span></div>
    <div class="table-wrap"><table class="small"><thead><tr><th><input type="checkbox" data-change="owner-pick-all" title="Select all on this page" ${o.results.length && o.results.every((r) => o.selected.has(r.id)) ? 'checked' : ''}></th><th>ID</th><th>Registration date</th><th>Client role</th><th>Client name</th><th>Nationality</th><th>${t('phone')}</th><th>${t('email')}</th><th>Country</th><th>City</th><th>Area</th><th>Property type</th><th>Master developer</th><th>Project</th><th class="num">Size (m²)</th><th class="num">Price</th><th class="num">Price / m²</th><th class="num">Txns</th><th>Rights</th><th></th></tr></thead><tbody>${o.results.map((r) => `<tr><td><input type="checkbox" data-change="owner-pick" data-id="${r.id}" ${o.selected.has(r.id) ? 'checked' : ''}></td><td class="mono">${r.id}</td><td style="white-space:nowrap">${fmtDate(r.last_registration_date)}</td><td>${esc(human(r.client_role || ''))}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.nationality || '—')}</td><td style="white-space:nowrap">${esc(r.phone || '—')}</td><td>${esc(r.email || '—')}</td><td>${esc(r.country || '—')}</td><td>${esc(r.city || '—')}</td><td>${esc(r.area || '—')}</td><td>${esc(r.property_type || '—')}</td><td>${esc(r.master_developer || '—')}</td><td>${esc(r.project || '—')}</td><td class="num">${r.size_m2 == null ? '—' : fmtNum(r.size_m2)}</td><td class="num" style="white-space:nowrap">${fmtAED(r.price_aed)}</td><td class="num" style="white-space:nowrap">${r.size_m2 && r.price_aed ? fmtAED(Math.round(r.price_aed / r.size_m2)) : '—'}</td><td class="num">${fmtNum(r.total_transactions)}</td><td><span class="badge ${r.rights_status === 'APPROVED' ? 'ok' : 'warn'}">${esc(human(r.rights_status))}</span></td><td><button class="btn sm ghost" data-act="suppress" data-id="${r.id}" title="Record a data-subject opt-out">Opt-out</button></td></tr>`).join('')}</tbody></table></div>
    ${o.cursor ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-act="owner-more">${t('load_more')}</button></div>` : ''}</div></div>`;
}

async function ownerSource() {
  const s = await GET('/api/owner/source');
  const tot = s.totals;
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>${t('data_source')}</h1>
    <p class="muted">This portal runs on its own. ai-home.world is used only as the source of investor history data, imported here by file or API.</p></div></div>
  <div class="grid g4">
    <div class="card"><div class="stat"><span class="l">Investors imported</span><span class="v">${fmtNum(tot.investors)}</span></div></div>
    <div class="card"><div class="stat"><span class="l">Transactions</span><span class="v">${fmtNum(tot.transactions)}</span></div></div>
    <div class="card"><div class="stat"><span class="l">Ambiguous identities</span><span class="v">${fmtNum(tot.ambiguous)}</span></div><p class="small muted">Same name, no phone/email. Never auto-merged.</p></div>
    <div class="card"><div class="stat"><span class="l">Subscriber rights</span><span class="v" style="font-size:20px">${s.rights_approved ? '<span class="badge ok">Approved</span>' : '<span class="badge warn">Pending review</span>'}</span></div>
      <p class="small muted">${s.rights_approved ? 'Imported records can be searched (masked) and transferred.' : 'Imported records stay restricted: no PII to subscribers, no transfers.'} <a href="#/owner/governance">${t('governance')} →</a></p></div>
  </div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card grid" style="gap:10px"><h3>Import an export file</h3>
      <p class="small muted">Export the investor table from ai-home.world (XLSX or CSV) and upload it here. Recognised columns: Country, City, AreaNameEn, PropertyTypeEn, Client Role, Client name, NATIONALITY, Master Developer, Project Name, Size(M2), Price/ProcedureValue, Registration_Date, plus optional transaction ID, email, phone/mobile, WhatsApp. Re-importing the same file never creates duplicates.</p>
      <input type="file" id="src-file" accept=".xlsx,.csv" aria-label="ai-home.world export file">
      <div class="row"><button class="btn" data-act="src-preview">Preview mapping</button><button class="btn gold" data-act="src-import">Import</button></div>
      <div id="src-out"></div></div>
    <div class="card grid" style="gap:10px"><div class="row" style="justify-content:space-between"><h3 style="margin:0">API sync</h3>${statusBadge(s.api)}</div>
      ${s.api === 'CONNECTED' ? `<p class="small">Source: <span class="mono">${esc(s.api_url_host)}</span>${s.scheduled_sync_minutes ? ` · every ${s.scheduled_sync_minutes} min` : ' · manual only'}</p><div><button class="btn primary" data-act="src-sync">Sync now</button></div>`
        : '<p class="small muted">Set AIHOME_SOURCE_URL and AIHOME_SOURCE_TOKEN on the server to pull investor data from an ai-home.world endpoint (paged JSON, same column names). Until then, use file import.</p>'}
    </div>
  </div>
  <div class="card" style="margin-top:16px"><div class="row"><h3 style="margin:0">Import history</h3><div class="spacer"></div>${s.jobs.length ? `<button class="btn sm" style="border-color:var(--bad);color:var(--bad)" data-act="import-history-clear" data-count="${s.jobs.length}">Clear import history</button>` : ''}</div>
    <p class="small muted">Deleting history removes the log entries only; the investor records stay. To remove records, use Delete all investor data on Master Cold database.</p>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>${t('date')}</th><th>Mode</th><th>File</th><th class="num">Rows</th><th class="num">New investors</th><th class="num">New txns</th><th class="num">Updated</th><th class="num">Rejected</th><th>By</th><th></th></tr></thead>
    <tbody>${s.jobs.map((j) => `<tr><td>${j.id}</td><td class="small">${fmtDT(j.started_at)}</td><td><span class="badge">${esc(j.mode)}</span></td><td class="small">${esc(j.file_name || '—')}</td><td class="num">${fmtNum(j.rows_read)}</td><td class="num">${fmtNum(j.investors_created)}</td><td class="num">${fmtNum(j.transactions_created)}</td><td class="num">${fmtNum(j.transactions_updated)}</td><td class="num">${j.rows_rejected ? `<span class="badge warn">${j.rows_rejected}</span>` : 0}</td><td class="small">${esc(j.started_by_email || 'scheduled')}</td><td>${j.status === 'RUNNING' ? '' : `<button class="btn sm ghost" data-act="import-job-delete" data-id="${j.id}" aria-label="Delete import ${j.id} from history">Delete</button>`}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">No imports yet.</td></tr>'}</tbody></table></div></div>`;
}

function readUpload(id) {
  return new Promise((res, rej) => {
    const f = document.getElementById(id).files[0];
    if (!f) return rej(new Error('Choose a file first'));
    const r = new FileReader();
    r.onload = () => res({ file_base64: r.result.split(',')[1], file_name: f.name });
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsDataURL(f);
  });
}

async function ownerHot() {
  const h = await GET('/api/owner/hot');
  const orgs = (await GET('/api/owner/dashboard')).organizations;
  const orgSel = (name) => `<select name="${name}" style="width:auto">${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>`;
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>${t('hot_admin')}</h1></div></div>
  <div class="grid g2" style="align-items:start">
    <form class="card grid" data-form="hot-pricing" style="gap:10px"><h3>Pricing</h3>${h.pricing.configured ? `<div class="banner ok">Active: ${fmtMoney(h.pricing.rule.price_cents)} · ${esc(human(h.pricing.rule.model))} · ${h.pricing.rule.exclusive ? 'exclusive' : 'shared'}</div>` : `<div class="banner warn">${t('owner_config_required')} — checkout and allocation are disabled.</div>`}
      <div class="grid g2" style="gap:8px"><label class="field">Model<select name="model"><option value="PER_LEAD">Per lead</option><option value="PREPAID_CREDITS">Prepaid credits</option><option value="MONTHLY_ALLOCATION">Monthly allocation</option><option value="CAMPAIGN_BUDGET">Campaign budget</option></select></label><label class="field">Price (AED)<input type="number" name="price_aed" min="0.01" step="0.01" required></label></div>
      <label class="check"><input type="checkbox" name="exclusive" checked> Exclusive allocation (one agency per lead)</label><button class="btn gold">Save & approve pricing</button></form>
    <form class="card grid" data-form="hot-grant" style="gap:10px"><h3>Grant Hot credits (after Hot payment)</h3><div class="row">${orgSel('org_id')}<input type="number" name="credits" min="1" required placeholder="Credits" style="max-width:140px"><button class="btn">Grant</button></div><p class="small muted">Recorded in the separate Hot ledger; never touches Cold quota.</p></form>
  </div>
  <div class="card" style="margin-top:16px"><h3>Website lead forms</h3>
    <p class="small muted">Every website that sends leads needs a key. A key for the <b>AI-DATA Hot pool</b> collects leads that you allocate to paying agencies; an agency key sends leads straight to that agency's CRM. Paste the code into the website where the form should appear.</p>
    <form class="row" data-form="site-key-create" style="margin-bottom:12px"><input type="text" name="label" required maxlength="120" placeholder="Website name, e.g. ai-home.world" aria-label="Website name" style="max-width:240px"><input type="url" name="allowed_origin" placeholder="https://www.ai-home.world (optional)" aria-label="Allowed website address" style="max-width:280px"><select name="org_id" aria-label="Leads go to" style="width:auto"><option value="">AI-DATA Hot pool</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="btn gold">Create key</button></form>
    ${h.site_keys.map((k) => `<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row"><b>${esc(k.label)}</b><span class="badge ${k.org_id ? '' : 'hot'}">${k.org_id ? esc(k.org_name || `Org #${k.org_id}`) : 'AI-DATA Hot pool'}</span>${k.allowed_origin ? `<span class="small muted">only ${esc(k.allowed_origin)}</span>` : ''}<div class="spacer"></div><button class="btn sm ghost" data-act="site-key-revoke" data-key="${esc(k.key)}">Revoke</button></div>
      <div class="code" style="margin-top:6px">${esc(embedSnippet(k.key))}</div></div>`).join('') || '<div class="empty">No website keys yet.</div>'}</div>
  <div class="card" style="margin-top:16px"><h3>AI-DATA Hot pool</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>${t('name')}</th><th>Interest</th><th>Consent</th><th>Received</th><th>Allocation</th></tr></thead><tbody>${h.pool.map((p) => { const i = JSON.parse(p.interest_json || '{}'); const c = JSON.parse(p.consent_json); return `<tr><td>${p.id}</td><td><b>${esc(p.full_name)}</b></td><td class="small">${esc([i.area, i.property_type, i.bedrooms && i.bedrooms + 'BR'].filter(Boolean).join(' · '))}</td><td class="small">${c.contact ? '✓ contact' : ''} ${c.marketing ? '· ✓ marketing' : ''}</td><td>${fmtDT(p.received_at)}</td><td>${p.allocated_org_id ? `<span class="badge ok">Org #${p.allocated_org_id}</span>` : `<form class="row" data-form="hot-allocate" data-id="${p.id}">${orgSel('org_id')}<button class="btn sm">Allocate</button></form>`}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No pool leads yet.</td></tr>'}</tbody></table></div></div>`;
}

async function ownerGovernance() {
  const [flags, prov] = await Promise.all([GET('/api/owner/flags'), GET('/api/owner/provenance')]);
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>${t('governance')}</h1></div></div>
  <div class="card" style="margin-bottom:16px"><h3>Feature flags (legal gates)</h3>${flags.map((f) => `<div class="row" style="border-top:1px solid var(--line);padding:10px 0"><div><b>${esc(f.key)}</b><br><span class="small muted">${esc(f.note || '')}</span></div><div class="spacer"></div><span class="badge ${f.enabled ? 'ok' : 'warn'}">${f.enabled ? 'ENABLED' : 'DISABLED'}</span><button class="btn sm" data-act="flag" data-key="${f.key}" data-on="${f.enabled ? 0 : 1}">${f.enabled ? 'Disable' : 'Enable'}</button></div>`).join('')}</div>
  <div class="card"><h3>Data provenance & rights review</h3><div class="table-wrap"><table><thead><tr><th>Source</th><th>Licence</th><th class="num">Records</th><th>Subscriber transfer</th><th>Reviewed</th><th></th></tr></thead><tbody>${prov.map((p) => `<tr><td><b>${esc(p.source_name)}</b><br><span class="small muted">${esc(p.notes || '')}</span></td><td>${esc(p.license_ref || '—')}</td><td class="num">${fmtNum(p.records)}</td><td><span class="badge ${p.allows_subscriber_transfer ? 'ok' : 'warn'}">${p.allows_subscriber_transfer ? 'Approved' : 'Restricted pending review'}</span></td><td class="small">${fmtDT(p.reviewed_at)}</td><td><button class="btn sm" data-act="prov" data-id="${p.id}" data-on="${p.allows_subscriber_transfer ? 0 : 1}">${p.allows_subscriber_transfer ? 'Restrict' : 'Approve rights'}</button></td></tr>`).join('')}</tbody></table></div>
  <p class="small muted">Approve a source only with documented legal basis (licence, contract, notices, consent evidence). The software supports compliance; it cannot certify legality.</p></div>`;
}

async function ownerAudit() {
  const rows = await GET('/api/owner/audit?limit=300');
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>${t('audit')}</h1></div></div>
  <div class="table-wrap"><table><thead><tr><th>${t('date')}</th><th>Actor</th><th>Org</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>${rows.map((a) => `<tr><td class="small">${fmtDT(a.at)}</td><td class="small">${esc(a.actor_email || 'system')}</td><td>${a.org_id ?? ''}</td><td><span class="badge ${/DENIED|REJECTED|FAILED/.test(a.action) ? 'bad' : /EXPORT|PII/.test(a.action) ? 'warn' : ''}">${esc(a.action)}</span></td><td class="mono">${esc(a.target || '')}</td><td class="mono small" style="max-width:360px;word-break:break-all">${esc(a.meta_json || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------
// Events (delegated: the CSP forbids inline handlers)
// ---------------------------------------------------------------------------------
const actions = {
  menu: () => document.body.classList.toggle('nav-open'),
  close: () => closeModal(),
  'close-nav': (el) => { closeModal(); go(el.getAttribute('href')); },
  'close-refresh': () => { closeModal(); render(); },
  'owner-clear-pick': () => { state.owner.selected.clear(); render(); },
  'owner-to-crm': async () => {
    const ids = [...state.owner.selected];
    if (!ids.length) return;
    try {
      const r = await withMfa(() => POST('/api/owner/cold/to-crm', { ids }));
      state.owner.selected.clear(); state.owner.crmOrg = r.org_id;
      toast(`✓ ${r.added} added to your CRM${r.already ? ` · ${r.already} already there` : ''}${r.skipped ? ` · ${r.skipped} skipped (opted out)` : ''}`);
      render();
    } catch (e) { toast(errMsg(e), true); }
  },
  'open-owner-crm': async () => {
    try {
      const me = state.me;
      const org = state.owner.crmOrg || (me.organizations || me.memberships || []).find((m) => (m.name || m.org_name) === 'AI-DATA owner CRM')?.org_id;
      if (!org) return toast('Add at least one record to your CRM first.', true);
      await POST('/api/me/active-org', { org_id: Number(org) }); go('#/crm');
    } catch (e) { toast(errMsg(e), true); }
  },
  'pick-role': (el) => { safeSet('aih_signin_role', el.dataset.role); render(); },
  'join-refresh': async () => { await loadMe(); if (state.me.active_org) { toast('Approved ✓ Welcome to your agency.'); go('#/overview'); } else { toast('Still waiting for approval.'); render(); } },
  'join-cancel': async (el) => { if (confirm('Cancel your request to join this agency?')) { await api('DELETE', `/api/me/join-requests/${el.dataset.id}`); await loadMe(); render(); } },
  'join-decline': async (el) => { if (confirm('Decline this request?')) { await POST(`/api/org/join-requests/${el.dataset.id}`, { approve: false }); toast('Declined'); await loadMe(); render(); } },
  'import-job-delete': async (el) => { if (confirm(`Delete import #${el.dataset.id} from the history? Investor records are kept.`)) { await api('DELETE', `/api/owner/source/jobs/${el.dataset.id}`); toast('Removed from history ✓'); render(); } },
  'import-history-clear': (el) => confirmDelete({ title: 'Clear import history', phrase: 'CLEAR IMPORT HISTORY',
    text: `Removes all ${el.dataset.count} entries from the import history. Investor records are kept.`,
    run: (confirm) => POST('/api/owner/source/jobs/clear', { confirm }) }),
  'owner-delete-user-crm': (el) => confirmDelete({ title: 'Delete this user’s CRM data', phrase: 'DELETE CRM DATA',
    text: `Removes the ${el.dataset.count} lead(s) assigned to ${el.dataset.name}, with notes and follow-ups.`,
    run: (confirm) => POST(`/api/owner/orgs/${el.dataset.org}/crm/delete`, { user_id: Number(el.dataset.id), confirm }) }),
  'owner-delete-org-crm': (el) => confirmDelete({ title: 'Delete this account’s CRM data', phrase: 'DELETE CRM DATA',
    text: `Removes all ${el.dataset.count} lead(s) of ${el.dataset.name}, with contacts, notes and follow-ups.`,
    run: (confirm) => POST(`/api/owner/orgs/${el.dataset.org}/crm/delete`, { confirm }) }),
  'owner-delete-all-crm': () => confirmDelete({ title: 'Delete all customers’ CRM data', phrase: 'DELETE ALL CRM DATA',
    text: 'Removes every lead, contact, note and follow-up from every customer account. Your own owner CRM, users, payments and the audit log are kept.',
    run: (confirm) => POST('/api/owner/crm/delete-all', { confirm }) }),
  'owner-delete-investors': () => confirmDelete({ title: 'Delete all investor data', phrase: 'DELETE ALL INVESTOR DATA',
    text: 'Wipes the whole Master Cold database: every imported or synced investor, their transactions and the import history.',
    run: (confirm) => POST('/api/owner/investors/delete-all', { confirm }) }),
  'signup-edit': () => { setSignupProfile(null); state.signinReturning = false; render(); },
  'signup-returning': () => { state.signinReturning = true; render(); },
  'signup-new': () => { state.signinReturning = false; render(); },
  'demo-login': async (el) => { await POST('/api/auth/demo', { persona: el.dataset.persona }); state.ih.counts = null; state.owner.counts = null; go('#/'); },
  logout: async () => { await POST('/api/auth/logout'); state.cfg = null; state.ih = { filter: {}, results: [], counts: null, cursor: null, selected: new Set(), options: null }; go('#/'); },
  notifs: async () => {
    const ex = document.getElementById('notif-dd');
    if (ex) return ex.remove();
    const list = await GET('/api/me/notifications');
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.id = 'notif-dd';
    dd.innerHTML = `<div class="row" style="padding:12px 14px"><b>${t('notifications')}</b><div class="spacer"></div><button class="btn sm" data-act="notifs-read">${t('mark_read')}</button></div>
      ${list.map((n) => `<a class="notif ${n.read_at ? '' : 'unread'}" href="${esc(n.link || '#/')}"><b class="small">${esc(human(n.type))}</b><span>${esc(n.body)}</span><span class="small muted">${fmtDT(n.created_at)}</span></a>`).join('') || '<div class="empty">—</div>'}`;
    document.querySelector('.top').append(dd);
  },
  'notifs-read': async () => { await POST('/api/me/notifications/read'); render(); },
  activate: async (el) => {
    try { await POST('/api/billing/activate', { token: el.dataset.token }); toast('Subscription activated ✓'); go('#/overview'); } catch (e) { toast(ACTIVATION_ERRORS[e.data?.error] || errMsg(e), true); }
  },
  'ih-pick': (el) => { const id = Number(el.dataset.id); el.checked ? state.ih.selected.add(id) : state.ih.selected.delete(id); el.closest('tr').classList.toggle('sel', el.checked); updateBasket(); },
  'ih-page': (el) => { for (const r of state.ih.results) if (!r.acquired && !r.blocked_reason) el.checked ? state.ih.selected.add(r.id) : state.ih.selected.delete(r.id); render(); },
  'ih-clear': () => { state.ih.selected.clear(); render(); },
  'ih-reset': async () => { state.ih.filter = {}; state.ih.selected.clear(); await runSearch(false); render(); },
  'ih-more': async () => { await runSearch(true); render(); },
  'ih-save': async () => { const name = prompt(t('save_search')); if (!name) return; await POST('/api/cold/presets', { name, filter: readFilterForm(document.querySelector('[data-form=ih-search]')) }); toast('Saved ✓'); render(); },
  'ih-transfer-sel': () => openTransfer({ mode: 'ids', ids: [...state.ih.selected] }),
  'ih-transfer-filter': () => openTransfer({ mode: 'filter', filter: state.ih.filter }),
  'task-done': async (el) => { await POST(`/api/crm/tasks/${el.dataset.id}/complete`); toast('✓'); render(); },
  'task-snooze': async (el) => { const r = await POST(`/api/crm/tasks/${el.dataset.id}/snooze`, { days: 1 }); toast(`Moved to ${fmtDT(r.due_at)}`); render(); },
  'template-delete': async (el) => { if (confirm('Delete this template?')) { await api('DELETE', `/api/crm/templates/${el.dataset.id}`); render(); } },
  'use-template': (el) => {
    const tpl = JSON.parse(el.dataset.tpl);
    const text = tpl.body.replace(/\{(\w+)\}/g, (m, k) => ({ name: el.dataset.name, agent: state.me.user.name, area: el.dataset.area || 'Dubai', company: state.me.active_org?.name || 'AI-DATA' }[k] ?? m));
    const box = document.getElementById('tpl-text');
    box.value = text;
    box.dataset.channel = tpl.channel;
    box.dataset.subject = tpl.name;
    const f = document.querySelector('[data-form=lead-activity]');
    if (f) { f.template_id.value = tpl.id; const ty = tpl.channel === 'EMAIL' ? 'EMAIL_LOGGED' : 'WHATSAPP_LOGGED'; if ([...f.type.options].some((o) => o.value === ty)) f.type.value = ty; }
    document.getElementById('tpl-send').textContent = tpl.channel === 'EMAIL' ? 'Open in email' : 'Open in WhatsApp';
  },
  'send-template': (el) => {
    const box = document.getElementById('tpl-text');
    if (!box.value.trim()) return toast('Choose a template first', true);
    const url = box.dataset.channel === 'EMAIL'
      ? `mailto:${el.dataset.email}?subject=${encodeURIComponent(box.dataset.subject || '')}&body=${encodeURIComponent(box.value)}`
      : `https://wa.me/${el.dataset.phone}?text=${encodeURIComponent(box.value)}`;
    window.open(url, '_blank', 'noopener');
  },
  'owner-open-lead': async (el) => { const l = await GET(`/api/owner/orgs/${el.dataset.org}/crm/leads/${el.dataset.id}`); openModal(ownerLeadModal(el.dataset.org, l)); },
  'remove-member': async (el) => { if (confirm('Remove this member?')) { await api('DELETE', `/api/org/members/${el.dataset.id}`); render(); } },
  'pay-paypal': async (el) => { try { const r = await POST('/api/billing/paypal', { plan: el.dataset.plan }); if (r.approve_url) location.href = r.approve_url; } catch (e) { toast(errMsg(e), true); } },
  'pay-cash': async (el) => {
    const note = prompt('Optional note for AI-DATA finance (e.g. where/when you will pay):') ?? '';
    try { const r = await POST('/api/billing/cash', { plan: el.dataset.plan, note }); toast(`Payment reference ${r.reference} — pending verification`); render(); } catch (e) { toast(errMsg(e), true); }
  },
  'site-key-revoke': async (el) => { if (confirm('Revoke this key? Forms using it will stop sending leads.')) { await POST(`/api/owner/hot/site-keys/${encodeURIComponent(el.dataset.key)}/revoke`); render(); } },
  'reject-cash': async (el) => { if (confirm('Reject this payment request?')) { await POST(`/api/owner/cash/${el.dataset.id}/reject`); render(); } },
  reissue: async (el) => { try { showActivationLink(await withMfa(() => POST(`/api/owner/subscriptions/${el.dataset.id}/reissue-link`)), true); } catch (e) { toast(errMsg(e), true); } },
  'copy-link': async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied ✓'); } catch { window.getSelection().selectAllChildren(document.getElementById('act-link')); toast('Press Ctrl+C to copy'); }
  },
  'owner-more': async () => { const o = state.owner; const r = await POST('/api/owner/cold/search', { filter: o.filter, cursor: o.cursor, limit: 50 }); o.results.push(...r.results); o.cursor = r.next_cursor; render(); },
  'owner-export': async () => {
    const form = document.querySelector('[data-form=owner-search]');
    const fields = [...form.querySelectorAll('input[name=field]:checked')].map((x) => x.value);
    try {
      const job = await withMfa(() => POST('/api/owner/cold-exports', { filter: state.owner.filter, fields }));
      document.getElementById('export-result').innerHTML = `<div class="banner ok">Export #${job.job_id}: ${fmtNum(job.rows)} rows. <a href="/api/owner/cold-exports/${job.job_id}">Download XLSX</a></div>`;
    } catch (e) { toast(errMsg(e), true); }
  },
  suppress: async (el) => { const reason = prompt('Reason (e.g. data-subject opt-out reference):'); if (!reason) return; const r = await POST(`/api/owner/investors/${el.dataset.id}/suppress`, { reason }); toast(`Suppressed; propagated to ${r.propagated_to} CRM copies`); state.owner.counts = null; render(); },
  flag: async (el) => { try { await withMfa(() => POST('/api/owner/flags', { key: el.dataset.key, enabled: el.dataset.on === '1' })); render(); } catch (e) { toast(errMsg(e), true); } },
  prov: async (el) => { try { await withMfa(() => POST(`/api/owner/provenance/${el.dataset.id}/review`, { allow_transfer: el.dataset.on === '1' })); render(); } catch (e) { toast(errMsg(e), true); } },
  'src-preview': async () => {
    const p = await POST('/api/owner/source/preview', await readUpload('src-file'));
    document.getElementById('src-out').innerHTML = `<div class="banner ${p.missing_required.length ? 'bad' : p.rejected ? 'warn' : 'ok'}">${fmtNum(p.rows)} rows · ${fmtNum(p.valid)} valid · ${fmtNum(p.rejected)} rejected${p.has_contact_columns ? ' · contact columns found' : ' · no email/phone columns'}</div>
      <div class="table-wrap"><table><thead><tr><th>Column in file</th><th>Mapped to</th></tr></thead><tbody>${Object.entries(p.mapping).map(([h, f]) => `<tr><td>${esc(h)}</td><td class="mono">${esc(f)}</td></tr>`).join('')}${p.unmapped.map((h) => `<tr><td>${esc(h)}</td><td class="muted">not imported</td></tr>`).join('')}</tbody></table></div>
      ${p.sample_errors.length ? `<div class="small">${p.sample_errors.map((e) => `Row ${e.row}: ${esc(e.errors.join('; '))}`).join('<br>')}</div>` : ''}`;
  },
  'src-import': async () => {
    const body = await readUpload('src-file');
    const r = await withMfa(() => POST('/api/owner/source/import', body));
    toast(`Imported: ${r.transactions_created} new transactions, ${r.investors_created} new investors, ${r.transactions_updated} updated, ${r.rejected} rejected`);
    state.ih.counts = null; state.owner.counts = null; render();
  },
  'src-sync': async () => {
    const r = await withMfa(() => POST('/api/owner/source/sync'));
    toast(`Synced: ${r.transactions_created} new, ${r.transactions_updated} updated, ${r.rejected} rejected`);
    state.owner.counts = null; render();
  },
  'crm-import': () => {
    openModal(`<h2>Import leads form.xlsx</h2><p class="small muted">All 38 original columns are preserved. Duplicates by email are left for manual review, never merged.</p>
      <input type="file" id="imp-file" accept=".xlsx" aria-label="leads form.xlsx file"><label class="check"><input type="checkbox" id="imp-rights"> I confirm we hold the rights and lawful basis to import these contacts.</label>
      <div id="imp-out"></div><div class="row"><button class="btn" id="imp-preview">Preview</button><button class="btn primary" id="imp-commit">Import</button><button class="btn ghost" data-act="close">${t('close')}</button></div>`);
    const read = () => new Promise((res, rej) => { const f = document.getElementById('imp-file').files[0]; if (!f) return rej(new Error('Choose a file')); const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
    const run = async (commit) => {
      try {
        const out = await POST('/api/crm/import', { file_base64: await read(), commit, rights_confirmed: document.getElementById('imp-rights').checked });
        document.getElementById('imp-out').innerHTML = `<div class="banner ${out.missing_columns.length ? 'warn' : 'ok'}">${out.rows} rows · ${out.valid} valid${out.created != null ? ` · <b>${out.created} imported</b>` : ''}${out.missing_columns.length ? `<br>Missing columns: ${esc(out.missing_columns.join(', '))}` : ''}</div>
          <div class="small">${out.sample.filter((s) => s.errors.length).slice(0, 5).map((s) => `Row ${s.row}: ${esc(s.errors.join(', '))}`).join('<br>')}</div>`;
      } catch (e) { toast(errMsg(e), true); }
    };
    document.getElementById('imp-preview').onclick = () => run(false);
    document.getElementById('imp-commit').onclick = () => run(true);
  },
};

function updateBasket() {
  const b = document.querySelector('.basket b');
  if (b) b.textContent = fmtNum(state.ih.selected.size);
  const sel = document.querySelector('[data-act=ih-transfer-sel]');
  if (sel) sel.disabled = !state.ih.selected.size || !can('cold.transfer');
  const clr = document.querySelector('[data-act=ih-clear]');
  if (clr) clr.disabled = !state.ih.selected.size;
}

const forms = {
  'join-agency': async (f) => {
    const agency = await resolveAgency(f.agency.value);
    await POST('/api/me/join-requests', { org_id: agency.id });
    await loadMe();
    toast(`Request sent to ${agency.name} ✓`);
    render();
  },
  'join-approve': async (f) => {
    await POST(`/api/org/join-requests/${f.dataset.id}`, { approve: true, role: f.role.value, daily_cap: f.daily_cap.value === '' ? null : Number(f.daily_cap.value) });
    toast('Approved ✓ The agent can start working.');
    await loadMe(); render();
  },
  'signup-profile': async (f) => {
    const agency = f.agency ? await resolveAgency(f.agency.value) : null;
    const p = await POST('/api/auth/check-profile', { full_name: f.full_name.value, phone: f.phone.value, email: f.email.value, ...(agency ? { agency_id: agency.id } : {}) });
    setSignupProfile(p);
    render();
  },
  profile: async (f) => {
    await POST('/api/me/profile', { full_name: f.full_name.value, phone: f.phone.value });
    await loadMe();
    toast('Profile saved ✓');
    go('#/');
  },
  'crm-bulk': async (f) => {
    const ids = [...document.querySelectorAll('.lead-pick:checked')].map((x) => Number(x.value));
    if (!ids.length) return toast('Tick the leads first', true);
    const body = { ids, stage: f.stage.value || undefined, add_tag: f.add_tag.value || undefined, assigned_user_id: f.assigned_user_id?.value ? Number(f.assigned_user_id.value) : undefined };
    const r = await POST('/api/crm/leads/bulk', body);
    toast(`${r.updated} lead(s) updated ✓`); render();
  },
  'template-create': async (f) => { await POST('/api/crm/templates', { name: f.name.value, channel: f.channel.value, language: f.language.value, body: f.body.value }); toast('Template saved ✓'); render(); },
  'lead-deal': async (f) => {
    await api('PATCH', `/api/crm/leads/${f.dataset.id}`, { deal_value_aed: f.deal_value_aed.value === '' ? null : Number(f.deal_value_aed.value), expected_close: f.expected_close.value || null, tags: f.tags.value });
    toast('Saved ✓'); render();
  },
  'owner-cap': async (f) => {
    await api('PATCH', `/api/owner/orgs/${f.dataset.org}/members/${f.dataset.id}`, { daily_cap: f.daily_cap.value === '' ? null : Number(f.daily_cap.value) });
    toast('Daily limit saved ✓'); render();
  },
  'member-cap': async (f) => {
    await api('PATCH', `/api/org/members/${f.dataset.id}`, { daily_cap: f.daily_cap.value === '' ? null : Number(f.daily_cap.value) });
    toast('Daily limit saved ✓'); render();
  },
  'create-org': async (f) => {
    await POST('/api/organizations', { name: f.name.value, kind: f.plan.value === 'AGENCY_MONTHLY' ? 'AGENCY' : 'AGENT', business_contact: f.business_contact.value, license_no: f.license_no.value, language: f.language.value, timezone: f.timezone.value, terms: f.terms.checked });
    go(`#/billing?plan=${f.plan.value}`);
  },
  'ih-search': async (f) => { state.ih.filter = readFilterForm(f); state.ih.selected.clear(); await runSearch(false); render(); },
  'owner-search': async (f) => { const filter = readFilterForm(f); delete filter.field; state.owner.filter = filter; state.owner.counts = null; render(); },
  'crm-filter': (f) => { const q = new URLSearchParams(Object.fromEntries([...new FormData(f)].filter(([, v]) => v))).toString(); go('#/crm' + (q ? '?' + q : '')); },
  'lead-activity': async (f) => { await POST(`/api/crm/leads/${f.dataset.id}/activities`, { type: f.type.value, body: f.body.value, ...(f.template_id?.value ? { template_id: Number(f.template_id.value) } : {}) }); toast('✓'); render(); },
  'lead-prefs': async (f) => { await api('PATCH', `/api/crm/leads/${f.dataset.id}`, { preferences: { preferred_channel: f.preferred_channel.value, best_time: f.best_time.value, tone: f.tone.value, preferred_language: f.preferred_language.value } }); toast('Saved ✓'); render(); },
  'lead-task': async (f) => { await POST(`/api/crm/leads/${f.dataset.id}/tasks`, { title: f.title.value, due_at: new Date(f.due_at.value).toISOString() }); toast('✓'); render(); },
  invite: async (f) => {
    await POST('/api/org/invitations', { full_name: f.full_name.value, phone: f.phone.value || undefined, email: f.email.value, role: f.role.value, daily_cap: f.daily_cap.value === '' ? null : Number(f.daily_cap.value) });
    toast('Invitation recorded ✓'); render();
  },
  'activate-code': async (f) => {
    if (/^\s*AIH-/i.test(f.code.value)) return toast('That is your payment reference, not the activation code. The 8-character code arrives here automatically once AI-DATA confirms your payment.', true);
    try {
      await POST('/api/billing/activate', { code: f.code.value });
      await loadMe();
      toast('Subscription activated ✓ Your data access is live.');
      go('#/overview');
    } catch (e) { toast(ACTIVATION_ERRORS[e.data?.error] || errMsg(e), true); }
  },
  'verify-cash': async (f) => {
    const r = await withMfa(() => POST(`/api/owner/cash/${f.dataset.id}/verify`, { amount_aed: Number(f.amount_aed.value), paid_on: f.paid_on.value, channel: f.channel.value, receipt_no: f.receipt_no.value }));
    showActivationLink(r);
  },
  'hot-pricing': async (f) => { await withMfa(() => POST('/api/owner/hot/pricing', { model: f.model.value, price_aed: Number(f.price_aed.value), exclusive: f.exclusive.checked })); toast('Pricing saved'); render(); },
  'hot-grant': async (f) => { await withMfa(() => POST('/api/owner/hot/entitlements', { org_id: Number(f.org_id.value), credits: Number(f.credits.value) })); toast('Credits granted'); render(); },
  'site-key-create': async (f) => {
    const r = await POST('/api/owner/hot/site-keys', { label: f.label.value, allowed_origin: f.allowed_origin.value || undefined, org_id: f.org_id.value ? Number(f.org_id.value) : null });
    toast(`Website key created: ${r.key}`); render();
  },
  'hot-allocate': async (f) => { await POST(`/api/owner/hot/pool/${f.dataset.id}/allocate`, { org_id: Number(f.org_id.value) }); toast('Allocated'); render(); },
};

document.addEventListener('click', (e) => {
  // Clicking the menu item of the page you are on reloads its data (the hash does not
  // change, so the router would otherwise do nothing).
  const nav = e.target.closest('a[href^="#/"]');
  if (nav && !nav.hasAttribute('data-act') && nav.getAttribute('href') === location.hash) { e.preventDefault(); render(); return; }
  const a = e.target.closest('[data-act]');
  if (a && actions[a.dataset.act]) {
    if (a.tagName !== 'INPUT') e.preventDefault();
    Promise.resolve(actions[a.dataset.act](a, e)).catch((err) => toast(errMsg(err), true));
    return;
  }
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a,button,input,select')) go(row.dataset.href);
  if (!e.target.closest('#notif-dd, .bell')) document.getElementById('notif-dd')?.remove();
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f || !forms[f.dataset.form]) return;
  e.preventDefault();
  Promise.resolve(forms[f.dataset.form](f)).catch((err) => toast(errMsg(err), true));
});
// Pipeline: drag a card onto another stage column.
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('.kcard[data-lead]');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.lead);
  e.dataTransfer.effectAllowed = 'move';
  card.style.opacity = '.5';
});
document.addEventListener('dragend', (e) => { const card = e.target.closest?.('.kcard'); if (card) card.style.opacity = ''; });
document.addEventListener('dragover', (e) => {
  const col = e.target.closest?.('.kcol[data-stage]');
  if (!col) return;
  e.preventDefault();
  document.querySelectorAll('.kcol.drop').forEach((c) => c !== col && c.classList.remove('drop'));
  col.classList.add('drop');
});
document.addEventListener('drop', async (e) => {
  const col = e.target.closest?.('.kcol[data-stage]');
  if (!col) return;
  e.preventDefault();
  col.classList.remove('drop');
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  try { await api('PATCH', `/api/crm/leads/${id}`, { stage: col.dataset.stage }); toast(`Moved to ${human(col.dataset.stage)} ✓`); render(); } catch (err) { toast(errMsg(err), true); }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  try {
    if (el.dataset.change === 'lang') { setLang(el.value); render(); }
    if (el.dataset.change === 'owner-pick') { const id = Number(el.dataset.id); el.checked ? state.owner.selected.add(id) : state.owner.selected.delete(id); render(); }
    if (el.dataset.change === 'owner-pick-all') { state.owner.results.forEach((r) => (el.checked ? state.owner.selected.add(r.id) : state.owner.selected.delete(r.id))); render(); }
    if (el.dataset.change === 'switch-org') { await POST('/api/me/active-org', { org_id: Number(el.value) }); state.ih.counts = null; state.ih.selected.clear(); go('#/overview'); }
    if (el.dataset.change === 'ih-preset' && el.value) { state.ih.filter = JSON.parse(el.value); await runSearch(false); render(); }
    if (el.dataset.change === 'lead-pick-all') { document.querySelectorAll('.lead-pick').forEach((x) => { x.checked = el.checked; }); }
    if (el.dataset.change === 'lead-pick-all' || el.classList.contains('lead-pick')) { const n = document.getElementById('bulk-count'); if (n) n.textContent = document.querySelectorAll('.lead-pick:checked').length; }
    if (el.dataset.change === 'lead-stage') { await api('PATCH', `/api/crm/leads/${el.dataset.id}`, { stage: el.value }); toast('✓'); render(); }
    if (el.dataset.change === 'dash-days' || el.dataset.change === 'dash-agent' || el.dataset.change === 'owner-lead-filter') {
      const q = new URLSearchParams();
      const days = el.dataset.change === 'dash-days' ? el.value : el.dataset.days;
      const agent = el.dataset.change === 'dash-agent' ? el.value : el.dataset.agent;
      if (days) q.set('days', days);
      if (agent) q.set('agent', agent);
      if (el.dataset.change === 'owner-lead-filter' && el.value) q.set('stage', el.value);
      go(`${el.dataset.base}${q.toString() ? '?' + q : ''}`);
    }
    if (el.dataset.change === 'owner-lead-stage' || el.dataset.change === 'owner-lead-assign') {
      const body = el.dataset.change === 'owner-lead-stage' ? { stage: el.value } : { assigned_user_id: Number(el.value) };
      const l = await api('PATCH', `/api/owner/orgs/${el.dataset.org}/crm/leads/${el.dataset.id}`, body);
      openModal(ownerLeadModal(el.dataset.org, l)); toast('Saved ✓ — logged on the lead and in the audit log');
    }
    if (el.dataset.change === 'lead-assign') { await api('PATCH', `/api/crm/leads/${el.dataset.id}`, { assigned_user_id: Number(el.value) }); toast('✓'); render(); }
  } catch (err) { toast(errMsg(err), true); }
});

async function afterRender() {
  const assign = document.getElementById('lead-assign');
  if (assign) {
    const { members } = await GET('/api/org/members');
    assign.innerHTML = members.map((m) => `<option value="${m.user_id}" ${String(m.user_id) === assign.dataset.current ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  }
}

setLang(state.lang, false);
render();
