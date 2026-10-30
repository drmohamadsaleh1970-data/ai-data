// AI-DATA lead form: a drop-in enquiry form for any website (ai-home.world, agency sites,
// landing pages). Paste where the form should appear:
//
//   <div data-ai-data-form data-site-key="YOUR_KEY" data-lang="en"
//        data-privacy-url="https://example.com/privacy"></div>
//   <script src="https://YOUR-AI-DATA-ADDRESS/lead-form.js" defer></script>
//
// Optional attributes: data-lang (en, ar, fr, ru, tr), data-privacy-url, data-notice-version,
// data-color (button colour), data-area (pre-filled area). Submissions go to
// POST /api/public/inquiry with the person's consent recorded; the site key decides whether
// the lead lands in the AI-DATA Hot pool or an agency's CRM.
(() => {
  const script = document.currentScript;
  const api = new URL('/api/public/inquiry', script ? script.src : location.href).href;
  const TYPES = ['Apartment', 'Villa', 'Townhouse', 'Penthouse', 'Plot', 'Office'];
  const T = {
    en: { name: 'Full name', phone: 'Phone / WhatsApp', email: 'Email', area: 'Preferred area', type: 'Property type', beds: 'Bedrooms', studio: 'Studio', budget: 'Max budget (AED)', message: 'Message', any: 'Any',
      consent: 'I agree to be contacted about this enquiry and accept the privacy notice.', marketing: 'Send me news and offers (optional).', privacy: 'Privacy notice',
      send: 'Send enquiry', sending: 'Sending…', thanks: 'Thank you! An agent will contact you shortly.', error: 'Sorry, something went wrong. Please try again.', need: 'Please enter your name and a phone number or email.',
      types: ['Apartment', 'Villa', 'Townhouse', 'Penthouse', 'Plot', 'Office'] },
    ar: { name: 'الاسم الكامل', phone: 'الهاتف / واتساب', email: 'البريد الإلكتروني', area: 'المنطقة المفضلة', type: 'نوع العقار', beds: 'غرف النوم', studio: 'استوديو', budget: 'الميزانية القصوى (درهم)', message: 'رسالتك', any: 'أي',
      consent: 'أوافق على التواصل معي بخصوص هذا الاستفسار وأقبل إشعار الخصوصية.', marketing: 'أرسلوا لي الأخبار والعروض (اختياري).', privacy: 'إشعار الخصوصية',
      send: 'إرسال الاستفسار', sending: 'جارٍ الإرسال…', thanks: 'شكرًا لك! سيتواصل معك أحد الوكلاء قريبًا.', error: 'عذرًا، حدث خطأ. يرجى المحاولة مرة أخرى.', need: 'يرجى إدخال اسمك ورقم هاتف أو بريد إلكتروني.',
      types: ['شقة', 'فيلا', 'تاون هاوس', 'بنتهاوس', 'أرض', 'مكتب'] },
    fr: { name: 'Nom complet', phone: 'Téléphone / WhatsApp', email: 'E-mail', area: 'Quartier souhaité', type: 'Type de bien', beds: 'Chambres', studio: 'Studio', budget: 'Budget max (AED)', message: 'Message', any: 'Indifférent',
      consent: 'J’accepte d’être contacté(e) au sujet de cette demande et j’accepte la politique de confidentialité.', marketing: 'Recevoir des actualités et offres (facultatif).', privacy: 'Politique de confidentialité',
      send: 'Envoyer la demande', sending: 'Envoi…', thanks: 'Merci ! Un agent vous contactera rapidement.', error: 'Désolé, une erreur est survenue. Veuillez réessayer.', need: 'Indiquez votre nom et un téléphone ou un e-mail.',
      types: ['Appartement', 'Villa', 'Maison de ville', 'Penthouse', 'Terrain', 'Bureau'] },
    ru: { name: 'Полное имя', phone: 'Телефон / WhatsApp', email: 'Эл. почта', area: 'Желаемый район', type: 'Тип недвижимости', beds: 'Спальни', studio: 'Студия', budget: 'Макс. бюджет (AED)', message: 'Сообщение', any: 'Любой',
      consent: 'Я согласен(на) на связь по этому запросу и принимаю уведомление о конфиденциальности.', marketing: 'Присылать новости и предложения (необязательно).', privacy: 'Уведомление о конфиденциальности',
      send: 'Отправить запрос', sending: 'Отправка…', thanks: 'Спасибо! Агент скоро свяжется с вами.', error: 'Извините, произошла ошибка. Попробуйте ещё раз.', need: 'Укажите имя и телефон или эл. почту.',
      types: ['Квартира', 'Вилла', 'Таунхаус', 'Пентхаус', 'Участок', 'Офис'] },
    tr: { name: 'Ad soyad', phone: 'Telefon / WhatsApp', email: 'E-posta', area: 'Tercih edilen bölge', type: 'Mülk tipi', beds: 'Yatak odası', studio: 'Stüdyo', budget: 'Maks. bütçe (AED)', message: 'Mesaj', any: 'Fark etmez',
      consent: 'Bu talep hakkında benimle iletişime geçilmesini kabul ediyor ve gizlilik bildirimini onaylıyorum.', marketing: 'Bana haber ve fırsatlar gönderin (isteğe bağlı).', privacy: 'Gizlilik bildirimi',
      send: 'Talebi gönder', sending: 'Gönderiliyor…', thanks: 'Teşekkürler! Bir danışman kısa süre içinde sizinle iletişime geçecek.', error: 'Üzgünüz, bir hata oluştu. Lütfen tekrar deneyin.', need: 'Lütfen adınızı ve bir telefon veya e-posta girin.',
      types: ['Daire', 'Villa', 'Sıra ev', 'Çatı katı', 'Arsa', 'Ofis'] },
  };

  // Styles are set through the DOM (not a <style> tag) so strict host CSPs still render it.
  const el = (tag, props = {}, style = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    Object.assign(node.style, style);
    for (const c of children) node.append(c);
    return node;
  };
  const FIELD = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #c9d1dc', borderRadius: '8px', font: 'inherit', background: '#fff', color: '#111' };
  const field = (label, input) => el('label', {}, { display: 'grid', gap: '4px', fontSize: '14px' }, [label, input]);
  const newEventId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function mount(host) {
    if (host.dataset.aiDataReady) return;
    host.dataset.aiDataReady = '1';
    const key = host.dataset.siteKey;
    if (!key) { console.warn('AI-DATA lead form: data-site-key is missing'); return; }
    const lang = T[host.dataset.lang] ? host.dataset.lang : 'en';
    const t = T[lang];
    let eventId = newEventId();

    const name = el('input', { name: 'full_name', required: true, maxLength: 120, autocomplete: 'name' }, FIELD);
    const phone = el('input', { name: 'phone', type: 'tel', maxLength: 30, autocomplete: 'tel', dir: 'ltr' }, FIELD);
    const email = el('input', { name: 'email', type: 'email', maxLength: 160, autocomplete: 'email', dir: 'ltr' }, FIELD);
    const area = el('input', { name: 'area', maxLength: 80, value: host.dataset.area || '' }, FIELD);
    const type = el('select', { name: 'property_type' }, FIELD, [el('option', { value: '', textContent: t.any }), ...TYPES.map((v, i) => el('option', { value: v, textContent: t.types[i] }))]);
    const beds = el('select', { name: 'bedrooms' }, FIELD, [el('option', { value: '', textContent: t.any }), el('option', { value: '0', textContent: t.studio }), ...[1, 2, 3, 4, 5].map((n) => el('option', { value: String(n), textContent: n === 5 ? '5+' : String(n) }))]);
    const budget = el('input', { name: 'budget_max_aed', type: 'number', min: 0, step: 50000, dir: 'ltr' }, FIELD);
    const message = el('textarea', { name: 'message', rows: 3, maxLength: 1000 }, FIELD);
    // Honeypot: invisible to people, filled in by bots; the server rejects it.
    const trap = el('input', { name: 'website', tabIndex: -1, autocomplete: 'off', ariaHidden: 'true' }, { position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: '0' });
    const consent = el('input', { type: 'checkbox', name: 'consent_contact', required: true });
    const marketing = el('input', { type: 'checkbox', name: 'consent_marketing' });
    const privacyUrl = host.dataset.privacyUrl;
    const consentText = el('span', { textContent: t.consent + ' ' });
    if (privacyUrl) consentText.append(el('a', { href: privacyUrl, target: '_blank', rel: 'noopener', textContent: t.privacy }));
    const button = el('button', { type: 'submit', textContent: t.send }, { padding: '12px 16px', border: '0', borderRadius: '8px', background: host.dataset.color || '#0b2545', color: '#fff', font: 'inherit', fontWeight: '700', cursor: 'pointer' });
    const status = el('div', { role: 'status' }, { fontSize: '14px', minHeight: '1em' });
    const check = (input, text) => el('label', {}, { display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px' }, [input, text]);

    const form = el('form', { dir: lang === 'ar' ? 'rtl' : 'ltr' }, { display: 'grid', gap: '10px', maxWidth: '520px', position: 'relative', fontFamily: 'inherit' }, [
      field(t.name, name), field(t.phone, phone), field(t.email, email), field(t.area, area),
      el('div', {}, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }, [field(t.type, type), field(t.beds, beds)]),
      field(t.budget, budget), field(t.message, message), trap,
      check(consent, consentText), check(marketing, el('span', { textContent: t.marketing })), button, status,
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim() || (!phone.value.trim() && !email.value.trim())) { status.textContent = t.need; return; }
      if (!consent.checked) { consent.focus(); return; }
      button.disabled = true;
      button.textContent = t.sending;
      status.textContent = '';
      const body = {
        full_name: name.value.trim(), phone: phone.value.trim() || undefined, email: email.value.trim() || undefined,
        area: area.value.trim() || undefined, property_type: type.value || undefined, bedrooms: beds.value === '' ? undefined : Number(beds.value),
        budget_max_aed: budget.value ? Number(budget.value) : undefined, message: message.value.trim() || undefined, website: trap.value || undefined,
        consent_contact: consent.checked, consent_marketing: marketing.checked, notice_version: host.dataset.noticeVersion || 'v1', language: lang, client_event_id: eventId,
      };
      try {
        const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Site-Key': key }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(String(res.status));
        eventId = newEventId();
        form.replaceChildren(el('div', { role: 'status', textContent: t.thanks }, { padding: '16px', borderRadius: '8px', background: '#e8f5ee', color: '#145a32', fontWeight: '600' }));
      } catch {
        status.textContent = t.error;
        button.disabled = false;
        button.textContent = t.send;
      }
    });
    host.replaceChildren(form);
  }

  const start = () => document.querySelectorAll('[data-ai-data-form]').forEach(mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
