// Hosted campaign landing page (/c/<slug>). Reads the campaign, shows its headline and
// mounts the AI-DATA lead form with the campaign's own key. utm_* tags in the address
// (e.g. ?utm_source=instagram) travel with the enquiry.
(() => {
  const T = {
    en: { get: 'Get details and prices', sub: 'Leave your details and an advisor will contact you shortly.', closed: 'This campaign is closed.', closedSub: 'It is no longer taking enquiries.', missing: 'Page not found.', trust: ['Free, no obligation', 'Fast reply', 'Contacted only about this enquiry'] },
    ar: { get: 'احصل على التفاصيل والأسعار', sub: 'اترك بياناتك وسيتواصل معك مستشار قريبًا.', closed: 'انتهت هذه الحملة.', closedSub: 'لم تعد تستقبل استفسارات.', missing: 'الصفحة غير موجودة.', trust: ['مجاني وبدون التزام', 'رد سريع', 'نتواصل معك بخصوص هذا الاستفسار فقط'] },
    fr: { get: 'Recevoir détails et prix', sub: 'Laissez vos coordonnées, un conseiller vous contactera rapidement.', closed: 'Cette campagne est terminée.', closedSub: 'Elle ne reçoit plus de demandes.', missing: 'Page introuvable.', trust: ['Gratuit et sans engagement', 'Réponse rapide', 'Contact uniquement pour cette demande'] },
    ru: { get: 'Узнать детали и цены', sub: 'Оставьте контакты, и консультант скоро свяжется с вами.', closed: 'Эта кампания завершена.', closedSub: 'Заявки больше не принимаются.', missing: 'Страница не найдена.', trust: ['Бесплатно и без обязательств', 'Быстрый ответ', 'Свяжемся только по этому запросу'] },
    tr: { get: 'Detayları ve fiyatları alın', sub: 'Bilgilerinizi bırakın, bir danışman kısa sürede size ulaşsın.', closed: 'Bu kampanya sona erdi.', closedSub: 'Artık talep kabul etmiyor.', missing: 'Sayfa bulunamadı.', trust: ['Ücretsiz, yükümlülük yok', 'Hızlı yanıt', 'Yalnızca bu talep için iletişim'] },
  };
  const page = document.getElementById('page');
  const el = (tag, props = {}, children = []) => { const n = Object.assign(document.createElement(tag), props); for (const c of children) if (c) n.append(c); return n; };
  const slug = decodeURIComponent((location.pathname.split('/c/')[1] || '').split('/')[0]);

  fetch(`/api/public/campaigns/${encodeURIComponent(slug)}`).then(async (res) => {
    if (!res.ok) { page.replaceChildren(el('div', { className: 'msg' }, [el('h2', { textContent: T.en.missing })])); return; }
    const c = await res.json();
    const t = T[c.language] || T.en;
    document.documentElement.lang = c.language || 'en';
    document.documentElement.dir = c.language === 'ar' ? 'rtl' : 'ltr';
    document.title = `${c.headline} · ${c.brand}`;
    const chips = [c.area, c.property_type].filter(Boolean).map((x) => el('span', { className: 'chip', textContent: x }));
    const hero = el('header', { className: 'hero' }, [el('div', { className: 'wrap' }, [
      el('div', { className: 'brand' }, [el('i', { textContent: '◆' }), el('span', { textContent: c.brand })]),
      el('h1', { textContent: c.headline }),
      c.description ? el('p', { className: 'lead', textContent: c.description }) : null,
      chips.length ? el('div', { className: 'chips' }, chips) : null,
    ])]);
    if (!c.active) {
      page.replaceChildren(hero, el('section', { className: 'card' }, [el('h2', { textContent: t.closed }), el('p', { className: 'sub', textContent: t.closedSub })]));
      return;
    }
    const host = el('div');
    Object.assign(host.dataset, { aiDataForm: '', siteKey: c.site_key, lang: c.language || 'en', campaign: c.slug, color: '#b0843a', noticeVersion: `campaign-${c.slug}` });
    if (c.area) host.dataset.area = c.area;
    if (c.privacy_url) host.dataset.privacyUrl = c.privacy_url;
    page.replaceChildren(hero,
      el('section', { className: 'card' }, [el('h2', { textContent: t.get }), el('p', { className: 'sub', textContent: t.sub }), host]),
      el('div', { className: 'trust' }, t.trust.map((x) => el('span', { textContent: `✓ ${x}` }))));
    document.body.append(el('script', { src: '/lead-form.js', defer: true }));
  }).catch(() => { page.replaceChildren(el('div', { className: 'msg' }, [el('h2', { textContent: 'Please try again in a moment.' })])); });
})();
