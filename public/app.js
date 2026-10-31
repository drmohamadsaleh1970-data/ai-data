import { translator, LANGS, RTL } from './i18n.js';

// ---------------------------------------------------------------------------------
// Core: state, API, formatting
// ---------------------------------------------------------------------------------
const state = {
  me: null,
  cfg: null,
  lang: safeGet('aih_lang') || (navigator.language || 'en').slice(0, 2),
  ih: { filter: {}, results: [], counts: null, cursor: null, selected: new Set(), options: null, transferEnabled: true },
  owner: { filter: {}, results: [], counts: null, cursor: null },
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
  overview: viewOverview, 'investor-history': viewInvestorHistory, 'my-cold': viewMyCold, hot: viewHot, crm: viewCrm,
  team: viewTeam, reports: viewReports, billing: viewBilling, integrations: viewIntegrations, settings: viewSettings,
  onboarding: viewOnboarding, owner: viewOwner, activate: viewActivate,
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
    if (!hasOrg && !['onboarding', 'owner', 'activate', 'settings', 'integrations'].includes(name)) name = isFinance() ? 'owner' : 'onboarding';
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

function shell(name, parts, content) {
  const link = (href, key, ico, active) => `<a class="nav-link ${active ? 'active' : ''}" href="${href}"><span class="ico">${ico}</span>${esc(t(key))}</a>`;
  const m = state.me;
  const org = m.active_org;
  let nav = '';
  if (org) {
    nav += `<div class="nav-group">${esc(org.name)}</div>`;
    nav += link('#/overview', 'overview', '◎', name === 'overview');
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
    nav += link('#/owner', 'owner_dashboard', '◆', name === 'owner' && sub === 'dashboard');
    nav += link('#/owner/finance', 'finance', '$', name === 'owner' && sub === 'finance');
    if (isOwner()) {
      nav += link('#/owner/source', 'data_source', '⇩', name === 'owner' && sub === 'source');
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
  const quota = q ? `<div class="quota-pill" title="${esc(t('resets_midnight'))}">❄ ${fmtNum(q.committed_used)} / ${fmtNum(q.plan_limit)}<span class="bar"><i style="width:${Math.min(100, (q.committed_used / q.plan_limit) * 100)}%"></i></span><span class="hide-sm">${fmtNum(q.remaining)} ${t('remaining')}</span></div>` : '';
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
      <main class="page">${content}</main>
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

async function viewSignIn() {
  const c = state.cfg;
  const personas = [
    ['owner', 'Platform Owner', 'Owner console, unmasked data, XLSX export'], ['finance', 'Finance Admin', 'Verify cash, activation links'],
    ['director', 'Agency Director', 'Agency AED 999 · 999/day shared'], ['leader', 'Team Leader', 'Agency team oversight'],
    ['agent1', 'Agent (Aisha)', 'Agency agent'], ['agent2', 'Agent (Leo)', 'Agency agent'], ['solo', 'Solo Agent', 'Agent AED 99 · 99/day'],
    ['pending', 'Pending cash customer', 'Awaiting offline payment'], ['newuser', 'New visitor', 'Onboarding from scratch'],
  ];
  const pendingActivation = safeGet('aih_pending_activation');
  return `<div class="auth-wrap"><div class="auth-card">
    <div style="text-align:center">${logo()}</div>
    <div class="card grid">
      <h2>${t('sign_in')}</h2>
      ${pendingActivation ? `<div class="banner ok">Sign in with the Google account your activation email was sent to.</div>` : ''}
      ${c.google_client_id ? '<div id="gsi-btn" style="min-height:44px"></div>' : `<button class="btn block" disabled>G&nbsp; ${t('continue_google')}</button><div class="banner warn">Google sign-in is <b>${t('not_connected')}</b> on this deployment. Set GOOGLE_CLIENT_ID.</div>`}
      <p class="small muted">We only use your Google identity (name, email, account ID). We never request access to your inbox.</p>
    </div>
    ${c.demo_mode ? `<div class="card grid"><div class="row"><h3 style="margin:0">Sign in as</h3><span class="badge warn">DEMO · fictional</span></div>
      ${personas.map(([k, n, d]) => `<button class="persona" data-act="demo-login" data-persona="${k}"><span class="avatar">${n[0]}</span><span><b>${n}</b><br><span class="small muted">${d}</span></span></button>`).join('')}</div>` : ''}
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
        try { await POST('/api/auth/google', { credential }); state.cfg = null; go('#/'); } catch (e) { toast(errMsg(e), true); }
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
// Onboarding & activation
// ---------------------------------------------------------------------------------
async function viewOnboarding() {
  const plans = (await GET('/api/public/plans')).plans;
  return `<div class="page-head"><div><div class="kicker">Step 1 of 2</div><h1>${t('create_org')}</h1></div></div>
  <form class="card grid" data-form="create-org" style="max-width:760px">
    <div class="grid g2">${plans.map((p, i) => `<label class="persona" style="cursor:pointer"><input type="radio" name="plan" value="${p.code}" ${i === 0 ? 'checked' : ''}>
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
  DAILY_QUOTA_EXHAUSTED: 'Daily allowance used up', NOT_FOUND: 'Record not found', NO_CHARGE_ALREADY_IN_CRM: 'Already in CRM — not charged',
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

async function viewCrm(parts, query) {
  if (parts[0] === 'lead') return viewLead(parts[1]);
  const view = query.view || 'list';
  const qs = new URLSearchParams(Object.fromEntries(Object.entries({ source: query.source, stage: query.stage, q: query.q }).filter(([, v]) => v))).toString();
  const tabs = `<div class="tabs">${['list', 'pipeline', 'tasks'].map((v) => `<a class="${view === v ? 'on' : ''}" href="#/crm?view=${v}${query.source ? '&source=' + query.source : ''}">${t(v === 'list' ? 'leads' : v)}</a>`).join('')}</div>`;
  let body = '';
  if (view === 'tasks') {
    const tasks = await GET('/api/crm/tasks');
    body = `<div class="table-wrap"><table><thead><tr><th></th><th>${t('name')}</th><th>Task</th><th>${t('due')}</th><th></th></tr></thead><tbody>${tasks.map((x) => `<tr><td>${srcBadge(x.source_type)}</td><td><a href="#/crm/lead/${x.lead_id}"><b>${esc(x.full_name)}</b></a></td><td>${esc(x.title)}</td><td style="${new Date(x.due_at) < new Date() ? 'color:var(--bad);font-weight:700' : ''}">${fmtDT(x.due_at)}</td><td><button class="btn sm" data-act="task-done" data-id="${x.id}">${t('done')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">✓</td></tr>'}</tbody></table></div>`;
  } else if (view === 'pipeline') {
    const leads = await GET('/api/crm/leads' + (qs ? '?' + qs : ''));
    body = `<div class="kanban">${STAGES.map((st) => { const col = leads.filter((l) => l.stage === st); return `<div class="kcol"><h4>${esc(human(st))}<span>${col.length}</span></h4>${col.slice(0, 30).map((l) => `<a class="kcard" href="#/crm/lead/${l.id}"><div class="row">${srcBadge(l.source_type)}</div><b>${esc(l.full_name)}</b><span class="small muted">${esc(l.assignee_name || '—')}</span></a>`).join('')}</div>`; }).join('')}</div>`;
  } else {
    const leads = await GET('/api/crm/leads' + (qs ? '?' + qs : ''));
    body = `<form class="row" data-form="crm-filter" style="margin-bottom:12px">
        <select name="source" style="width:auto"><option value="">${t('all_sources')}</option>${['COLD', 'HOT', 'OWNED', 'MANUAL'].map((s) => `<option ${query.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select name="stage" style="width:auto"><option value="">${t('stage')}: all</option>${STAGES.map((s) => `<option value="${s}" ${query.stage === s ? 'selected' : ''}>${esc(human(s))}</option>`).join('')}</select>
        <input type="text" name="q" value="${esc(query.q || '')}" placeholder="${t('search')}…" style="max-width:240px"><button class="btn">${t('search')}</button>
        ${can('crm.import') ? '<div class="spacer"></div><button type="button" class="btn" data-act="crm-import">Import leads form.xlsx</button>' : ''}</form>
      <div class="table-wrap"><table><thead><tr><th>${t('source')}</th><th>${t('name')}</th><th>${t('phone')}</th><th>${t('stage')}</th><th>${t('assignee')}</th><th>First contact</th><th>${t('created')}</th></tr></thead>
      <tbody>${leads.map((l) => `<tr class="click" data-href="#/crm/lead/${l.id}"><td>${srcBadge(l.source_type)}</td><td><b>${esc(l.full_name)}</b>${l.suppressed ? ' <span class="badge bad">DNC</span>' : ''}<br><span class="small muted">${esc(l.campaign_tag || l.source_detail)}</span></td><td class="small">${esc(l.phone || l.email || '—')}</td><td>${esc(human(l.stage))}</td><td>${esc(l.assignee_name || '—')}</td>
        <td>${l.first_contacted_at ? `<span class="badge ok">${fmtDT(l.first_contacted_at)}</span>` : l.first_contact_due && new Date(l.first_contact_due) < new Date() ? '<span class="badge bad">SLA missed</span>' : `<span class="small muted">${t('due')} ${fmtDT(l.first_contact_due)}</span>`}</td><td class="small">${fmtDT(l.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No leads yet.</td></tr>'}</tbody></table></div>`;
  }
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('crm')}</h1></div><div class="spacer"></div>${tabs}</div>${body}`;
}

async function viewLead(id) {
  const l = await GET(`/api/crm/leads/${id}`);
  const cold = l.source_type === 'COLD';
  const allowed = !l.suppressed && (cold ? l.marketing_permission === 'GRANTED' : l.consent?.contact === true);
  const wa = l.phone ? `https://wa.me/${l.phone.replace(/\D/g, '')}` : null;
  const txns = l.interest?.historical_transactions || [];
  return `<div class="page-head"><div><a href="#/crm" class="small muted">← ${t('crm')}</a><h1>${esc(l.full_name)}</h1><div class="row" style="margin-top:6px">${srcBadge(l.source_type)}<span class="badge">${esc(human(l.stage))}</span><span class="badge ${l.priority === 'HIGH' || l.priority === 'URGENT' ? 'hot' : ''}">${esc(human(l.priority))}</span></div></div></div>
  <div class="banner ${cold ? 'cold' : 'hot'}" style="margin-bottom:10px">${cold ? '❄ ' + t('cold_label') : '🔥 ' + t('hot_label')}</div>
  ${l.suppressed ? `<div class="banner bad" style="margin-bottom:10px">⛔ ${t('suppressed_warning')}</div>` : !allowed ? `<div class="banner warn" style="margin-bottom:10px">⚖ ${t('lawful_basis_warning')}</div>` : ''}
  <div class="grid g3" style="align-items:start">
    <div class="card grid" style="gap:10px"><h3>Contact</h3>
      <div class="kv"><span class="k">${t('phone')}</span><span class="v" dir="ltr">${esc(l.phone || '—')}</span><span class="k">${t('email')}</span><span class="v" style="word-break:break-all">${esc(l.email || '—')}</span>
        ${l.nationality ? `<span class="k">Nationality</span><span class="v">${esc(l.nationality)}</span>` : ''}<span class="k">Marketing permission</span><span class="v">${esc(human(l.marketing_permission))}</span>
        <span class="k">${t('assignee')}</span><span class="v">${esc(l.assignee_name || '—')}</span><span class="k">First contact due</span><span class="v">${fmtDT(l.first_contact_due)}</span></div>
      <div class="row">${l.phone ? `<a class="btn sm" ${allowed ? `href="tel:${esc(l.phone)}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>📞 Call</a>` : ''}${wa ? `<a class="btn sm" target="_blank" rel="noopener noreferrer" ${allowed ? `href="${wa}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>💬 WhatsApp</a>` : ''}${l.email ? `<a class="btn sm" ${allowed ? `href="mailto:${esc(l.email)}"` : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>✉ Email</a>` : ''}</div>
      <p class="small muted">Opening your phone or WhatsApp does not record a contact. Log the actual outcome below.</p>
      <label class="field">${t('stage')}<select data-change="lead-stage" data-id="${l.id}">${STAGES.map((s) => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${esc(human(s))}</option>`).join('')}</select></label>
      ${can('crm.all') ? `<label class="field">${t('assignee')}<select data-change="lead-assign" data-id="${l.id}" data-current="${l.assigned_user_id ?? ''}" id="lead-assign"><option>…</option></select></label>` : ''}
      ${l.interest && !cold ? `<h3 style="margin-top:6px">Requested</h3><div class="kv">${Object.entries(l.interest).filter(([, v]) => v).map(([k, v]) => `<span class="k">${esc(human(k))}</span><span class="v">${esc(k === 'budget_max_aed' ? fmtAED(v) : v)}</span>`).join('')}</div>` : ''}
      ${l.consent ? `<h3 style="margin-top:6px">Consent evidence</h3><div class="kv"><span class="k">Contact</span><span class="v">${l.consent.contact ? '✓' : '—'}</span><span class="k">Marketing</span><span class="v">${l.consent.marketing ? '✓' : '—'}</span><span class="k">Notice</span><span class="v">${esc(l.consent.notice_version)}</span><span class="k">Captured</span><span class="v">${fmtDT(l.consent.captured_at)}</span></div>` : ''}
    </div>
    <div class="card grid" style="gap:10px"><h3>${t('log_activity')}</h3>
      <form class="grid" data-form="lead-activity" data-id="${l.id}" style="gap:8px">
        <select name="type"><option value="NOTE">${t('add_note')}</option><option value="CONTACT_ATTEMPT">Contact attempt (no answer)</option>${!l.suppressed ? '<option value="CALL_LOGGED">Call — conversation held</option><option value="WHATSAPP_LOGGED">WhatsApp — conversation held</option><option value="EMAIL_LOGGED">Email exchanged</option>' : ''}<option value="MEETING">Meeting</option><option value="VIEWING">Viewing</option></select>
        <textarea name="body" rows="3" required maxlength="4000" placeholder="What happened?"></textarea><button class="btn primary">${t('log_activity')}</button></form>
      <h3>${t('schedule_followup')}</h3>
      <form class="grid" data-form="lead-task" data-id="${l.id}" style="gap:8px"><input type="text" name="title" required maxlength="300" placeholder="Follow-up"><input type="datetime-local" name="due_at" required><button class="btn">${t('schedule_followup')}</button></form>
      <h3>${t('tasks')}</h3>${l.tasks.map((x) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:6px 0"><span class="${x.done_at ? 'muted' : ''}">${x.done_at ? '✓ ' : ''}${esc(x.title)}<br><span class="small muted">${fmtDT(x.due_at)}</span></span>${x.done_at ? '' : `<button class="btn sm" data-act="task-done" data-id="${x.id}">${t('done')}</button>`}</div>`).join('') || '<span class="muted">—</span>'}
    </div>
    <div class="card"><h3>${t('timeline')}</h3><div class="timeline">${l.activities.map((a) => `<div class="tl"><div><b>${esc(human(a.type))}</b> <span class="small muted">· ${esc(a.user_name || 'System')} · ${fmtDT(a.created_at)}</span><div class="small">${esc(a.body || '')}</div></div></div>`).join('') || '<span class="muted">—</span>'}</div></div>
  </div>
  ${txns.length ? `<div class="card" style="margin-top:16px"><h3>${t('transaction_history')} (${txns.length})</h3><div class="table-wrap"><table><thead><tr><th>Txn ID</th><th>Role</th><th>Area · Project</th><th>Type</th><th class="num">m²</th><th class="num">Price</th><th>Registered</th></tr></thead><tbody>${txns.map((x) => `<tr><td class="mono">${esc(x.source_txn_id)}</td><td>${esc(human(x.client_role))}</td><td>${esc(x.area)} · ${esc(x.project || '')}</td><td>${esc(x.property_type)}</td><td class="num">${fmtNum(x.size_m2)}</td><td class="num">${fmtAED(x.price_aed)}</td><td>${fmtDate(x.registration_date)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}

async function viewTeam() {
  const m = await GET('/api/org/members');
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('team')}</h1></div><div class="spacer"></div><span class="badge gold">Seats: ${t('unlimited_members')}</span></div>
  <div class="banner cold" style="margin-bottom:16px">❄ ${esc(m.quota_note)}</div>
  <div class="grid g2" style="align-items:start">
    <div class="table-wrap"><table><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th></th></tr></thead><tbody>${m.members.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="small">${esc(x.email)}</td><td><span class="badge">${esc(human(x.role))}</span></td><td>${can('members.manage') && x.role !== 'ORG_OWNER' ? `<button class="btn sm ghost" data-act="remove-member" data-id="${x.user_id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="grid">
      ${can('members.manage') ? `<form class="card grid" data-form="invite" style="gap:10px"><h3>${t('invite')}</h3><p class="small muted">Invitees sign in with Google using this email and join this account — they never get a separate quota.</p>
        <label class="field">${t('email')}<input type="email" name="email" required></label>
        <label class="field">${t('role')}<select name="role">${['AGENT', 'TEAM_LEADER', 'SALES_MANAGER', 'MARKETING_MANAGER', 'ORG_ADMIN', 'AGENCY_DIRECTOR', 'AUDITOR'].map((r) => `<option value="${r}">${esc(human(r))}</option>`).join('')}</select></label>
        <button class="btn primary">${t('invite')}</button></form>` : ''}
      <div class="card"><h3>Pending invitations (${m.invitations.length})</h3>${m.invitations.slice(0, 20).map((i) => `<div class="small" style="padding:4px 0;border-top:1px solid var(--line)">${esc(i.email)} · ${esc(human(i.role))} · expires ${fmtDate(i.expires_at)}</div>`).join('') || '<span class="muted">—</span>'}${m.invitations.length > 20 ? `<div class="small muted">+${m.invitations.length - 20} more</div>` : ''}</div>
    </div>
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
  return `<div class="page-head"><div><div class="kicker">${esc(state.me.active_org.name)}</div><h1>${t('billing')}</h1></div></div>
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
    <p class="small muted">Pay at the AI-DATA office or by bank transfer quoting the reference. Access is activated only after finance verifies receipt; AI-DATA finance then sends you a single-use activation link by WhatsApp or email.</p></div>` : ''}
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
async function viewOwner([sub = 'dashboard']) {
  if (sub === 'finance') return ownerFinance();
  if (!isOwner() && sub !== 'dashboard') return '<div class="banner bad">Platform owner only.</div>';
  if (sub === 'source') return ownerSource();
  if (sub === 'data') return ownerData();
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
    <div class="card"><div class="stat"><span class="l">Pending cash</span><span class="v">${d.pending_cash.length}</span></div><a href="#/owner/finance" class="small">${t('finance')} →</a></div>
    <div class="card"><div class="stat"><span class="l">Overdue / suspended</span><span class="v" style="color:var(--bad)">${d.overdue.length}</span></div></div>
    <div class="card"><div class="stat"><span class="l">Investor records</span><span class="v">${fmtNum(d.data.investors)}</span></div><p class="small muted">${fmtNum(d.data.transactions)} transactions · ${fmtNum(d.data.approved)} approved · ${fmtNum(d.data.pending)} pending review · ${fmtNum(d.data.suppressed)} suppressed</p></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Organizations</h3><div class="table-wrap"><table><thead><tr><th>Organization</th><th>Owner</th><th class="num">Members</th><th>${t('plan')}</th><th>${t('status')}</th><th>${t('renews')}</th></tr></thead><tbody>${d.organizations.map((o) => `<tr><td><b>${esc(o.name)}</b> <span class="badge">${esc(o.kind)}</span></td><td class="small">${esc(o.owner_email)}</td><td class="num">${o.members}</td><td>${esc(human(o.active_plan || '—'))}</td><td><span class="badge ${o.active_plan ? 'ok' : 'warn'}">${esc(human(o.status))}</span> <span class="small muted">${esc(human(o.provider || ''))}</span></td><td>${fmtDate(o.renews_or_ends)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card" style="margin-top:16px"><h3>Cold usage by day</h3><div class="table-wrap"><table><tbody>${d.cold_usage_today.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.local_day)}</td><td class="num">${u.committed_used} / ${u.plan_limit}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table></div></div>`;
}

async function ownerFinance() {
  const d = await GET('/api/owner/dashboard');
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')}</div><h1>${t('finance')}</h1></div></div>
  <div class="banner warn" style="margin-bottom:16px">Verify only money actually received. A customer's screenshot is a claim, not a receipt. Approvals require MFA and are audited.</div>
  <div class="card"><h3>Pending cash / offline payments</h3>${d.pending_cash.map((c) => `<form class="grid" data-form="verify-cash" data-id="${c.id}" style="border-top:1px solid var(--line);padding:12px 0;gap:10px">
      <div class="row"><b class="mono">${esc(c.reference)}</b><span>${esc(c.org_name)}</span><span class="badge">${esc(human(c.plan_code))}</span><span class="badge gold">${fmtMoney(c.amount_cents)}</span><span class="small muted">${esc(c.requested_by_email)} · ${fmtDT(c.created_at)}</span></div>
      ${c.customer_note ? `<div class="small muted">“${esc(c.customer_note)}”</div>` : ''}
      <div class="grid g4" style="gap:8px"><label class="field">Amount received (AED)<input type="number" name="amount_aed" step="0.01" min="0" required></label><label class="field">Paid on<input type="date" name="paid_on" required></label>
        <label class="field">Channel<select name="channel"><option value="CASH_OFFICE">Cash at office</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CHEQUE">Cheque</option></select></label><label class="field">Receipt no.<input type="text" name="receipt_no" required maxlength="60"></label></div>
      <div class="row"><button class="btn gold">Verify receipt & create activation link</button><button type="button" class="btn ghost" data-act="reject-cash" data-id="${c.id}">Reject</button></div></form>`).join('') || '<div class="empty">No pending offline payments.</div>'}</div>
  <div class="card" style="margin-top:16px"><h3>Awaiting activation</h3>${d.awaiting_activation.map((s) => `<div class="row" style="border-top:1px solid var(--line);padding:8px 0"><span>${esc(s.org_name)} · ${esc(human(s.plan_code))} · ${fmtDT(s.created_at)}</span><div class="spacer"></div><button class="btn sm" data-act="reissue" data-id="${s.id}">Reissue link</button></div>`).join('') || '<div class="muted">—</div>'}</div>`;
}

// No email service yet: finance sends the single-use link by WhatsApp or email.
function showActivationLink(r, reissued = false) {
  const text = `Your AI-DATA payment is verified. Sign in with Google as ${r.delivered_to} and open this single-use link to activate your subscription: ${r.activation_link}`;
  openModal(`<h2>${reissued ? 'New activation link' : 'Payment verified ✓'}</h2>
    <p class="small muted">Send this single-use link to <b>${esc(r.delivered_to)}</b>. It only works for that Google account${reissued ? '; the previous link no longer works' : ''}.</p>
    <div class="code" id="act-link">${esc(r.activation_link)}</div>
    <div class="row"><button class="btn primary" data-act="copy-link" data-text="${esc(r.activation_link)}">Copy link</button>
      <a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(text)}">Send by WhatsApp</a>
      <a class="btn" href="mailto:${esc(r.delivered_to)}?subject=${encodeURIComponent('Activate your AI-DATA subscription')}&body=${encodeURIComponent(text)}">Send by email</a>
      <button class="btn ghost" data-act="close-refresh">${t('close')}</button></div>`);
}

async function ownerData() {
  const o = state.owner;
  if (!o.counts) { const r = await POST('/api/owner/cold/search', { filter: o.filter, limit: 50 }); Object.assign(o, { results: r.results, counts: r.counts, cursor: r.next_cursor }); }
  const fields = await GET('/api/owner/export-fields');
  const opts = await GET('/api/owner/cold/filters');
  const sel = (k, label) => `<label class="field">${label}<select multiple name="${k}">${(opts?.[k] || []).map((v) => `<option ${o.filter[k]?.includes(v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  return `<div class="page-head"><div><div class="kicker">${t('owner_console')} · unmasked</div><h1>${t('master_data')}</h1></div></div>
  <div class="banner bad" style="margin-bottom:16px">Owner-only view with full personal data. Every search and export is audited.</div>
  <div class="ih"><form class="card filters" data-form="owner-search">${sel('city', 'City') + sel('area', 'Area') + sel('property_type', 'Type')}
    <label class="field">Client role<select name="client_role"><option value="">All</option><option value="BUYER">Buyer</option><option value="SELLER">Seller</option></select></label>
    <div class="grid g2" style="gap:8px"><label class="field">Year from<input type="number" name="year_from" value="${o.filter.year_from ?? ''}"></label><label class="field">Year to<input type="number" name="year_to" value="${o.filter.year_to ?? ''}"></label></div>
    <button class="btn primary block">${t('search')}</button>
    <details><summary class="small" style="cursor:pointer;font-weight:700">Export fields</summary><div class="grid" style="gap:4px;margin-top:8px">${fields.map((f) => `<label class="check"><input type="checkbox" name="field" value="${f}" checked> ${esc(f)}</label>`).join('')}</div></details>
    <button type="button" class="btn gold block" data-act="owner-export">⬇ ${t('export_xlsx')}</button><div id="export-result"></div></form>
  <div style="min-width:0"><div class="grid g4" style="margin-bottom:12px"><div class="card"><div class="stat"><span class="l">${t('matching')}</span><span class="v">${fmtNum(o.counts.total)}</span></div></div><div class="card"><div class="stat cold"><span class="l">${t('eligible')}</span><span class="v">${fmtNum(o.counts.eligible)}</span></div></div><div class="card"><div class="stat"><span class="l">${t('restricted')}</span><span class="v">${fmtNum(o.counts.restricted)}</span></div></div></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>${t('name')}</th><th>${t('phone')}</th><th>${t('email')}</th><th>Area · Project</th><th class="num">Price</th><th>Rights</th><th></th></tr></thead><tbody>${o.results.map((r) => `<tr><td class="mono">${r.id}</td><td><b>${esc(r.name)}</b><br><span class="small muted">${esc(r.nationality || '')}</span></td><td class="small">${esc(r.phone || '—')}</td><td class="small">${esc(r.email || '—')}</td><td>${esc(r.area)}<br><span class="small muted">${esc(r.project || '')}</span></td><td class="num">${fmtAED(r.price_aed)}</td><td><span class="badge ${r.rights_status === 'APPROVED' ? 'ok' : 'warn'}">${esc(human(r.rights_status))}</span></td><td><button class="btn sm ghost" data-act="suppress" data-id="${r.id}" title="Record a data-subject opt-out">Opt-out</button></td></tr>`).join('')}</tbody></table></div>
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
  <div class="card" style="margin-top:16px"><h3>Import history</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>${t('date')}</th><th>Mode</th><th>File</th><th class="num">Rows</th><th class="num">New investors</th><th class="num">New txns</th><th class="num">Updated</th><th class="num">Rejected</th><th>By</th></tr></thead>
    <tbody>${s.jobs.map((j) => `<tr><td>${j.id}</td><td class="small">${fmtDT(j.started_at)}</td><td><span class="badge">${esc(j.mode)}</span></td><td class="small">${esc(j.file_name || '—')}</td><td class="num">${fmtNum(j.rows_read)}</td><td class="num">${fmtNum(j.investors_created)}</td><td class="num">${fmtNum(j.transactions_created)}</td><td class="num">${fmtNum(j.transactions_updated)}</td><td class="num">${j.rows_rejected ? `<span class="badge warn">${j.rows_rejected}</span>` : 0}</td><td class="small">${esc(j.started_by_email || 'scheduled')}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">No imports yet.</td></tr>'}</tbody></table></div></div>`;
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
    try { await POST('/api/billing/activate', { token: el.dataset.token }); toast('Subscription activated ✓'); go('#/overview'); } catch (e) { toast(errMsg(e), true); }
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
    try { await navigator.clipboard.writeText(el.dataset.text); toast('Link copied ✓'); } catch { window.getSelection().selectAllChildren(document.getElementById('act-link')); toast('Press Ctrl+C to copy'); }
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
  'create-org': async (f) => {
    await POST('/api/organizations', { name: f.name.value, kind: f.plan.value === 'AGENCY_MONTHLY' ? 'AGENCY' : 'AGENT', business_contact: f.business_contact.value, license_no: f.license_no.value, language: f.language.value, timezone: f.timezone.value, terms: f.terms.checked });
    go(`#/billing?plan=${f.plan.value}`);
  },
  'ih-search': async (f) => { state.ih.filter = readFilterForm(f); state.ih.selected.clear(); await runSearch(false); render(); },
  'owner-search': async (f) => { const filter = readFilterForm(f); delete filter.field; state.owner.filter = filter; state.owner.counts = null; render(); },
  'crm-filter': (f) => { const q = new URLSearchParams(Object.fromEntries([...new FormData(f)].filter(([, v]) => v))).toString(); go('#/crm' + (q ? '?' + q : '')); },
  'lead-activity': async (f) => { await POST(`/api/crm/leads/${f.dataset.id}/activities`, { type: f.type.value, body: f.body.value }); toast('✓'); render(); },
  'lead-task': async (f) => { await POST(`/api/crm/leads/${f.dataset.id}/tasks`, { title: f.title.value, due_at: new Date(f.due_at.value).toISOString() }); toast('✓'); render(); },
  invite: async (f) => { await POST('/api/org/invitations', { email: f.email.value, role: f.role.value }); toast('Invitation recorded ✓'); render(); },
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
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  try {
    if (el.dataset.change === 'lang') { setLang(el.value); render(); }
    if (el.dataset.change === 'switch-org') { await POST('/api/me/active-org', { org_id: Number(el.value) }); state.ih.counts = null; state.ih.selected.clear(); go('#/overview'); }
    if (el.dataset.change === 'ih-preset' && el.value) { state.ih.filter = JSON.parse(el.value); await runSearch(false); render(); }
    if (el.dataset.change === 'lead-stage') { await api('PATCH', `/api/crm/leads/${el.dataset.id}`, { stage: el.value }); toast('✓'); render(); }
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
