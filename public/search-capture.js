// AI-DATA search capture for property search pages (ai-home.world or any listing site).
//
//   <script src="https://YOUR-AI-DATA-ADDRESS/search-capture.js" defer
//           data-site-key="CAMPAIGN_KEY" data-campaign="campaign-slug"
//           data-lang="en" data-privacy-url="https://www.ai-home.world/privacy"></script>
//
// After each search, call (it can be called before the script has loaded):
//
//   window.aidataSearch = window.aidataSearch || function () { (aidataSearch.q = aidataSearch.q || []).push(arguments); };
//   aidataSearch({ area: 'Dubai Marina', property_type: 'Apartment', bedrooms: 0, budget_max_aed: 1000000, purpose: 'buy', city: 'Dubai' },
//                { analytics: visitorAcceptedAnalyticsCookies });
//
// Two things happen:
//  1. With analytics consent, the search is recorded ANONYMOUSLY (no name, no number, no
//     cookie): it feeds the live "searching now" view and demand reports.
//  2. A small card offers "Get matching homes on WhatsApp". Only if the visitor fills it in
//     and ticks the consent box does an enquiry reach the portal, as a Hot lead with the
//     exact search attached, within seconds.
(() => {
  const script = document.currentScript;
  const cfg = script ? script.dataset : {};
  const base = new URL('.', script ? script.src : location.href);
  const T = {
    en: { title: 'Get matching homes on WhatsApp', lead: 'We’ll send you {what} as soon as they’re available.', name: 'Your name', phone: 'WhatsApp / phone', consent: 'I agree to be contacted about this request and accept the privacy notice.', privacy: 'Privacy notice', send: 'Send me matches', sending: 'Sending…', thanks: 'Thank you! An advisor will send you matching homes shortly.', error: 'Sorry, please try again.', close: 'Close', homes: 'homes', studio: 'studios', br: '{n}-bedroom homes', in: 'in {area}', upto: 'up to AED {n}' },
    ar: { title: 'احصل على العقارات المطابقة عبر واتساب', lead: 'سنرسل لك {what} فور توفرها.', name: 'اسمك', phone: 'واتساب / الهاتف', consent: 'أوافق على التواصل معي بخصوص هذا الطلب وأقبل إشعار الخصوصية.', privacy: 'إشعار الخصوصية', send: 'أرسلوا لي العقارات المطابقة', sending: 'جارٍ الإرسال…', thanks: 'شكرًا لك! سيرسل لك أحد المستشارين العقارات المطابقة قريبًا.', error: 'عذرًا، حاول مرة أخرى.', close: 'إغلاق', homes: 'عقارات', studio: 'استوديوهات', br: 'عقارات بـ {n} غرف نوم', in: 'في {area}', upto: 'حتى {n} درهم' },
    fr: { title: 'Recevez les biens correspondants sur WhatsApp', lead: 'Nous vous enverrons {what} dès qu’ils sont disponibles.', name: 'Votre nom', phone: 'WhatsApp / téléphone', consent: 'J’accepte d’être contacté(e) pour cette demande et j’accepte la politique de confidentialité.', privacy: 'Politique de confidentialité', send: 'Recevoir les biens', sending: 'Envoi…', thanks: 'Merci ! Un conseiller vous enverra les biens correspondants rapidement.', error: 'Désolé, veuillez réessayer.', close: 'Fermer', homes: 'des biens', studio: 'des studios', br: 'des biens {n} chambres', in: 'à {area}', upto: 'jusqu’à {n} AED' },
    ru: { title: 'Получите подходящие варианты в WhatsApp', lead: 'Мы пришлём {what}, как только они появятся.', name: 'Ваше имя', phone: 'WhatsApp / телефон', consent: 'Я согласен(на) на связь по этому запросу и принимаю уведомление о конфиденциальности.', privacy: 'Уведомление о конфиденциальности', send: 'Прислать варианты', sending: 'Отправка…', thanks: 'Спасибо! Консультант скоро пришлёт подходящие варианты.', error: 'Извините, попробуйте ещё раз.', close: 'Закрыть', homes: 'объекты', studio: 'студии', br: 'объекты с {n} спальнями', in: 'в районе {area}', upto: 'до {n} AED' },
    tr: { title: 'Uygun evleri WhatsApp’tan alın', lead: '{what} hazır olur olmaz size gönderelim.', name: 'Adınız', phone: 'WhatsApp / telefon', consent: 'Bu talep hakkında benimle iletişime geçilmesini kabul ediyor ve gizlilik bildirimini onaylıyorum.', privacy: 'Gizlilik bildirimi', send: 'Bana uygun evleri gönder', sending: 'Gönderiliyor…', thanks: 'Teşekkürler! Bir danışman kısa süre içinde uygun evleri gönderecek.', error: 'Üzgünüz, lütfen tekrar deneyin.', close: 'Kapat', homes: 'evler', studio: 'stüdyolar', br: '{n} yatak odalı evler', in: '{area} bölgesinde', upto: 'en fazla {n} AED' },
  };
  const lang = T[cfg.lang] ? cfg.lang : 'en';
  const t = T[lang];
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
  const el = (tag, props = {}, style = {}, children = []) => { const n = Object.assign(document.createElement(tag), props); Object.assign(n.style, style); for (const c of children) if (c) n.append(c); return n; };
  const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* not kept */ } } };
  const utm = () => { const q = new URLSearchParams(location.search); const o = {}; for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) if (q.get(k)) o[k] = q.get(k).slice(0, 100); return o; };
  const newId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function what(c) {
    const kind = Number(c.bedrooms) === 0 && c.bedrooms !== '' && c.bedrooms != null ? t.studio : c.bedrooms ? fill(t.br, { n: c.bedrooms }) : t.homes;
    return [kind, c.area ? fill(t.in, { area: c.area }) : '', c.budget_max_aed ? fill(t.upto, { n: Number(c.budget_max_aed).toLocaleString('en') }) : ''].filter(Boolean).join(' ');
  }
  function describe(c) {
    return [Number(c.bedrooms) === 0 && c.bedrooms !== '' && c.bedrooms != null ? 'studio' : c.bedrooms ? `${c.bedrooms}BR` : null, c.property_type, c.area, c.budget_max_aed ? `up to AED ${Number(c.budget_max_aed).toLocaleString('en')}` : null, c.purpose].filter(Boolean).join(' · ');
  }

  let card = null;
  let current = {};
  function showCard(criteria) {
    current = criteria;
    if (store.get('aidata_sc_closed') || store.get('aidata_sc_sent')) return;
    if (card) { card.querySelector('[data-what]').textContent = fill(t.lead, { what: what(criteria) }); return; }
    const name = el('input', { name: 'full_name', required: true, maxLength: 120, autocomplete: 'name', placeholder: t.name, ariaLabel: t.name }, FIELD);
    const phone = el('input', { name: 'phone', type: 'tel', required: true, maxLength: 30, autocomplete: 'tel', placeholder: t.phone, ariaLabel: t.phone, dir: 'ltr' }, FIELD);
    const consent = el('input', { type: 'checkbox', required: true });
    const consentText = el('span', { textContent: `${t.consent} ` });
    if (cfg.privacyUrl) consentText.append(el('a', { href: cfg.privacyUrl, target: '_blank', rel: 'noopener', textContent: t.privacy }));
    const btn = el('button', { type: 'submit', textContent: t.send }, { padding: '11px 14px', border: '0', borderRadius: '8px', background: cfg.color || '#1f8a4c', color: '#fff', font: 'inherit', fontWeight: '700', cursor: 'pointer' });
    const status = el('div', { role: 'status' }, { fontSize: '13px', minHeight: '1em' });
    const form = el('form', {}, { display: 'grid', gap: '8px' }, [name, phone, el('label', {}, { display: 'flex', gap: '8px', fontSize: '12px', alignItems: 'flex-start' }, [consent, consentText]), btn, status]);
    let eventId = newId();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim() || !phone.value.trim()) return;
      if (!consent.checked) { consent.focus(); return; }
      btn.disabled = true; btn.textContent = t.sending; status.textContent = '';
      const c = current;
      const body = {
        full_name: name.value.trim(), phone: phone.value.trim(), consent_contact: true, consent_marketing: false, notice_version: cfg.noticeVersion || 'search-capture-v1', language: lang, client_event_id: eventId,
        area: c.area || undefined, property_type: c.property_type || undefined, bedrooms: c.bedrooms === '' || c.bedrooms == null ? undefined : Number(c.bedrooms), budget_max_aed: c.budget_max_aed ? Number(c.budget_max_aed) : undefined,
        message: `Asked for matching homes while searching: ${describe(c) || 'any'}`, campaign: cfg.campaign || undefined,
        utm_source: 'ai-home.world search', utm_medium: 'search_match', ...utm(),
      };
      try {
        const res = await fetch(new URL('api/public/inquiry', base).href, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Site-Key': cfg.siteKey }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(String(res.status));
        eventId = newId();
        store.set('aidata_sc_sent', '1');
        form.replaceChildren(el('div', { role: 'status', textContent: t.thanks }, { padding: '12px', borderRadius: '8px', background: '#e8f5ee', color: '#145a32', fontWeight: '600' }));
      } catch { status.textContent = t.error; btn.disabled = false; btn.textContent = t.send; }
    });
    const leadText = el('div', { textContent: fill(t.lead, { what: what(criteria) }) }, { fontSize: '13px', color: '#52627a', marginBottom: '10px' });
    leadText.dataset.what = '1';
    const close = el('button', { type: 'button', textContent: '×', ariaLabel: t.close }, { position: 'absolute', top: '6px', [lang === 'ar' ? 'left' : 'right']: '10px', border: '0', background: 'transparent', fontSize: '20px', cursor: 'pointer', color: '#52627a' });
    close.addEventListener('click', () => { store.set('aidata_sc_closed', '1'); card.remove(); card = null; });
    card = el('aside', { dir: lang === 'ar' ? 'rtl' : 'ltr', role: 'dialog', ariaLabel: t.title }, {
      position: 'fixed', bottom: '16px', [lang === 'ar' ? 'left' : 'right']: '16px', zIndex: '2147483000', width: 'min(340px, calc(100vw - 32px))', boxSizing: 'border-box',
      background: '#fff', color: '#0d1b2a', borderRadius: '14px', boxShadow: '0 12px 40px rgba(0,0,0,.22)', padding: '16px', fontFamily: 'inherit', fontSize: '14px',
    }, [close, el('div', { textContent: `🔔 ${t.title}` }, { fontWeight: '700', marginBottom: '4px', paddingInlineEnd: '18px' }), leadText, form]);
    document.body.append(card);
  }
  const FIELD = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #c9d1dc', borderRadius: '8px', font: 'inherit', background: '#fff', color: '#111' };

  function search(criteria = {}, opts = {}) {
    const c = { area: criteria.area, property_type: criteria.property_type, bedrooms: criteria.bedrooms, budget_max_aed: criteria.budget_max_aed, purpose: criteria.purpose, city: criteria.city };
    const analytics = opts.analytics === true || cfg.analyticsConsent === 'granted';
    if (analytics) {
      fetch(new URL('api/public/search-event', base).href, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: 'search_performed', consent_analytics: true, site: cfg.site || location.hostname, ...c }) }).catch(() => {});
    }
    if (cfg.siteKey && opts.offer !== false) showCard(c);
  }

  const queued = (window.aidataSearch && window.aidataSearch.q) || [];
  window.aidataSearch = search;
  for (const args of queued) search(...args);
})();
