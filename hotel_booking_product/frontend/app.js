(() => {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const themeOptions = [['cyberpunk','Cyberpunk Style'],['gta','GTA VI Style'],['official','Official & Premium'],['accessible','Daltonism-safe']];
  const themeRoutes = { cyberpunk: '/', gta: '/gta-vi', official: '/official', accessible: '/daltonism' };
  function setTheme(theme) {
    if (!themeOptions.some(x => x[0] === theme)) return;
    localStorage.setItem('hotel-theme', theme);
    if (theme !== forcedTheme) { window.location.assign(themeRoutes[theme]); return; }
    state.theme = theme; document.documentElement.dataset.theme = theme; refreshAmbient(); renderNav(); animatePage();
    toast('Visual style: ' + themeOptions.find(x => x[0] === theme)[1]);
  }
  function setAfterDark(enabled) { state.afterDark = Boolean(enabled); localStorage.setItem('gta-after-dark', state.afterDark ? '1' : '0'); document.documentElement.dataset.afterDark = state.afterDark ? 'true' : 'false'; }
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app'), nav = $('#nav'), dlg = $('#dlg'), toastEl = $('#toast');
  const forcedTheme = document.documentElement.dataset.fixedTheme || '';
  const initialTheme = forcedTheme || localStorage.getItem('hotel-theme') || document.documentElement.dataset.theme || 'official';
  const state = { user: null, csrf: null, theme: initialTheme, afterDark: localStorage.getItem('gta-after-dark') === '1', search: null, filter: { status: '', q: '', from: '', to: '', order: 'desc', size: 50, page: 1 }, dash: { from: '', to: '' }, cal: { from: '', to: '' }, refreshAfterClose: false };
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.afterDark = state.afterDark ? 'true' : 'false';
 
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => ({ kz: 'kk-KZ', ru: 'ru-RU', en: 'en-US' }[window.hotelCurrentLanguage ? window.hotelCurrentLanguage() : 'kz'] || 'kk-KZ');
  const money = n => Math.round(Number(n) || 0).toLocaleString(locale()) + ' KZT';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const nightsBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const plural = (n, word) => {
    const count = Math.max(0, Math.trunc(Number(n) || 0));
    const formattedCount = count.toLocaleString(locale());
    const language = window.hotelCurrentLanguage ? window.hotelCurrentLanguage() : 'kz';
    const ruForms = {
      room: ['номер', 'номера', 'номеров'],
      night: ['ночь', 'ночи', 'ночей'],
      stay: ['проживание', 'проживания', 'проживаний'],
      reservation: ['бронирование', 'бронирования', 'бронирований'],
      day: ['день', 'дня', 'дней']
    };
    const kzForms = { room: 'бөлме', night: 'түн', stay: 'тұру', reservation: 'брондау', day: 'күн' };
    if (language === 'ru' && ruForms[word]) {
      const mod100 = count % 100, mod10 = count % 10;
      const form = mod100 >= 11 && mod100 <= 14 ? 2 : mod10 === 1 ? 0 : mod10 >= 2 && mod10 <= 4 ? 1 : 2;
      return `${formattedCount} ${ruForms[word][form]}`;
    }
    if (language === 'kz' && kzForms[word]) return `${formattedCount} ${kzForms[word]}`;
    return `${formattedCount} ${word}${count === 1 ? '' : 's'}`;
  };
  const roleLabel = r => (r === 'FrontDesk' ? 'Front desk' : r);
  const alertHtml = msg => `<div class="alert" role="alert">${esc(msg)}</div>`;

  let toastTimer = null;
  function toast(message, kind = '') {
    toastEl.textContent = message;
    toastEl.className = 'show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, 4500);
  }

  class ApiError extends Error {
    constructor(data, status) { super(data.error || 'The request failed.'); this.data = data; this.status = status; this.code = data.code; }
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'POST' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
    let res;
    try {
      res = await fetch(path, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new ApiError({ error: 'Cannot reach the server. Check the connection and try again.', code: 'network' }, 0);
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      if (data.code === 'login_required') { state.user = null; state.csrf = null; renderNav(); }
      throw new ApiError(data, res.status);
    }
    return data;
  }

  // ---------------------------------------------------------------- dialog
  function openDialog(title, bodyHtml) {
    dlg.innerHTML = `<div class="dlg-head"><h2 id="dlg-title">${esc(title)}</h2>
      <button type="button" data-close aria-label="Close">&times;</button></div><div class="dlg-body">${bodyHtml}</div>`;
    if (!dlg.open) dlg.showModal();
    return $('.dlg-body', dlg);
  }
  dlg.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    if (!(state.user && state.user.role === 'Guest')) pendingBookingRoom = null;
    if (state.refreshAfterClose && state.search && $('#results')) { state.refreshAfterClose = false; showResults(); }
  });

  function confirmDialog({ title, message, confirm, danger = false, checkbox = '' }) {
    return new Promise(resolve => {
      openDialog(title, `<p>${esc(message)}</p>
        ${checkbox ? `<label class="field"><span><input type="checkbox" id="cd-check"> ${esc(checkbox)}</span></label>` : ''}
        <div class="actions"><button class="btn${danger ? ' danger' : ''}" type="button" id="cd-ok">${esc(confirm)}</button>
        <button class="btn secondary" type="button" data-close>Keep it</button></div>`);
      let answered = false;
      $('#cd-ok').addEventListener('click', () => {
        answered = true;
        const checked = $('#cd-check') ? $('#cd-check').checked : false;
        dlg.close();
        resolve({ ok: true, checked });
      });
      dlg.addEventListener('close', () => { if (!answered) resolve({ ok: false, checked: false }); }, { once: true });
    });
  }

  // ---------------------------------------------------------------- routing and navigation
  const route = () => location.hash.replace(/^#\/?/, '').split('/');

  const loyaltyMeta = {
    None: { icon: '○', discount: 0 },
    Silver: { icon: '◇', discount: 5 },
    Gold: { icon: '✦', discount: 8 },
    Platinum: { icon: '✧', discount: 12 }
  };
  function currentTier() {
    return state.user && state.user.role === 'Guest' && loyaltyMeta[state.user.loyalty_tier]
      ? state.user.loyalty_tier : 'None';
  }
  function openLoyaltyProgressDialog() {
    if (!state.user || state.user.role !== 'Guest') return;
    const user = state.user;
    const progress = user.loyalty_progress || {};
    const tier = currentTier();
    const next = progress.next_tier;
    const percent = Math.max(0, Math.min(100, Number(progress.progress_percent || 0)));
    const message = next
      ? `${Number(progress.stays_to_next || 0)} more completed ${Number(progress.stays_to_next) === 1 ? 'stay' : 'stays'} to unlock ${next}.`
      : 'You have reached the highest loyalty level. Enjoy your 12% discount.';
    const p = openDialog('Your loyalty progress', `
      <div class="loyalty-progress-head tier-${esc(tier.toLowerCase())}">
        <span class="loyalty-progress-symbol" aria-hidden="true">${loyaltyMeta[tier].icon}</span>
        <div><b>${esc(tier)} member</b><p class="meta">${Number(user.loyalty_discount || 0)}% discount on eligible room bookings</p></div>
      </div>
      <div class="loyalty-progress-copy"><strong>${esc(message)}</strong>
        <p class="meta">${Number(user.completed_stays || 0)} completed ${Number(user.completed_stays) === 1 ? 'stay' : 'stays'}${next ? ` · next level: ${esc(next)} at ${Number(progress.next_threshold)} stays` : ' · maximum level achieved'}</p>
      </div>
      <div class="loyalty-progress-track" role="progressbar" aria-label="Progress toward next loyalty level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
      <div class="loyalty-levels">
        <div class="${tier === 'None' ? 'current' : ''}"><b>None</b><span>0 stays · 0%</span></div>
        <div class="${tier === 'Silver' ? 'current' : ''}"><b>Silver</b><span>2 stays · 5%</span></div>
        <div class="${tier === 'Gold' ? 'current' : ''}"><b>Gold</b><span>5 stays · 8%</span></div>
        <div class="${tier === 'Platinum' ? 'current' : ''}"><b>Platinum</b><span>10+ stays · 12%</span></div>
      </div>
      <div class="actions"><button class="btn secondary" type="button" data-close>Close</button></div>`);
    return p;
  }
  function refreshAmbient() {
    document.documentElement.dataset.loyalty = currentTier();
    if (window.hotelAmbientRefresh) window.hotelAmbientRefresh();
  }

  let navClockTimer = null;
  function updateNavClock() {
    const clock = $('#system-time');
    if (clock) clock.textContent = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  }
  function renderNav() {
    const active = route()[0];
    const link = (href, label, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
    const styleCaption = 'Visual style';
    const styleOptions = themeOptions.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const loyalty = state.user && state.user.role === 'Guest'
      ? `<button type="button" id="loyalty-progress" class="loyalty-pill tier-${esc(currentTier().toLowerCase())}" title="Open loyalty progress" aria-label="${esc(currentTier())} loyalty tier, ${Number(state.user.loyalty_discount || 0)} percent off. Open progress."><span aria-hidden="true">${loyaltyMeta[currentTier()].icon}</span>${esc(currentTier())} · ${Number(state.user.loyalty_discount || 0)}% OFF</button>`
      : `<span class="platinum-ticket">PLATINUM · 12% OFF</span>`;
    nav.innerHTML = `<label class="theme-switch"><span class="sr-only">${styleCaption}</span><select id="ui-theme" aria-label="${styleCaption}">${styleOptions}</select></label>` +
      (state.theme === 'gta' ? `<button type="button" id="after-dark-toggle" class="after-dark-toggle" aria-pressed="${state.afterDark}" aria-label="Toggle After Dark mode"><span class="after-dark-dot" aria-hidden="true"></span><span>AFTER DARK</span><b>${state.afterDark ? 'ON' : 'OFF'}</b></button>` : '') +
      `<label class="lang-switch"><span class="sr-only">Language</span><select id="ui-language" aria-label="Language"><option value="kz">KZ · Қазақша</option><option value="en">EN · English</option><option value="ru">RU · Русский</option></select></label>` +
      `<span class="system-status"><i aria-hidden="true"></i><span>LIVE</span><time id="system-time">--:--</time></span>` +
      link('#/', 'Rooms', '') + (state.user && state.user.role !== 'Guest' ? '' : link('#/manage', ['official','accessible'].includes(state.theme) ? 'My bookings' : 'My reservations', 'manage')) +
      (!state.user || state.user.role !== 'Guest' ? link('#/staff', 'Staff', 'staff') : '') +
      (state.user ? `<span class="who">${esc(state.user.name)}, ${esc(roleLabel(state.user.role))}</span>${loyalty}${link('#/account', 'Account', 'account')}<button type="button" id="logout">Log out</button>` : `${loyalty}<button type="button" id="signin">Sign in / Register</button>`);
    refreshAmbient();
    const theme = $('#ui-theme'); if (theme) { theme.value = state.theme; theme.addEventListener('change', () => setTheme(theme.value)); }
    const afterDark = $('#after-dark-toggle'); if (afterDark) { afterDark.addEventListener('click', () => { setAfterDark(!state.afterDark); renderNav(); toast(state.afterDark ? 'After Dark enabled' : 'After Dark disabled'); }); }
    const lang = $('#ui-language'); if (lang) { lang.value = ['kz','en','ru'].includes(localStorage.getItem('hotel-lang')) ? localStorage.getItem('hotel-lang') : (document.documentElement.dataset.defaultLang || 'kz'); lang.addEventListener('change', () => { const selected = lang.value; if (window.hotelSetLanguage) window.hotelSetLanguage(selected); else { localStorage.setItem('hotel-lang', selected); document.documentElement.lang = selected === 'kz' ? 'kk' : selected; } toast('Interface language changed'); }); }
    updateNavClock();
    if (navClockTimer) clearInterval(navClockTimer);
    navClockTimer = setInterval(updateNavClock, 30000);
  }
  nav.addEventListener('click', async e => {
    if (e.target.closest('#loyalty-progress')) { openLoyaltyProgressDialog(); return; }
    if (e.target.id === 'signin') { openGuestAuthDialog(); return; }
    if (e.target.id !== 'logout') return;
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (err) { /* ignore */ }
    state.user = null; state.csrf = null;
    refreshAmbient();
    toast('You are logged out.');
    if (route()[0] === 'staff') render(); else renderNav();
  });

  async function render(focus = false) {
    const [a, b] = route();
    renderNav();
    if (dlg.open) dlg.close();
    if (a === 'manage') viewManage();
    else if (a === 'account') await viewAccount();
    else if (a === 'staff') await viewStaff(b || 'reservations');
    else viewHome();
    animatePage();
    if (focus) app.focus();
  }
  // Re-render the current view after a language change so localized dates,
  // numeric grouping, and computed labels update together with translated copy.
  window.hotelOnLanguageChange = () => {
    if (dlg.open) { updateNavClock(); return; }
    render();
  };
  window.addEventListener('hashchange', () => {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wipe = $('#route-wipe');
    const theme = document.documentElement.dataset.theme || 'cyberpunk';
    if (reduced || theme === 'official' || theme === 'accessible' || !wipe) { render(true); return; }
    app.classList.add('page-exit');
    wipe.classList.remove('active'); void wipe.offsetWidth; wipe.classList.add('active');
    window.setTimeout(() => { app.classList.remove('page-exit'); render(true); }, 180);
    window.setTimeout(() => wipe.classList.remove('active'), 720);
  });


  // ---------------------------------------------------------------- QR pass and flexible dates (guest)
  const dayLabel = s => new Date(s + 'T00:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  // The QR image is an SVG made by our own server (only squares, no scripts), so it is inserted as is.
  function passHtml(p) {
    if (!p) return '';
    return `<div class="pass"><div class="qr">${p.qr_svg}</div><div><b>Check-in pass</b><br><code>${esc(p.code)}</code>
      <p class="meta">Show this QR code, or read the code out, at the front desk to check in faster.</p></div></div>`;
  }

  async function loadFlex(ci, co, flex = 3) {
    const box = $('#flex');
    if (!box) return;
    box.innerHTML = '<div class="empty">Comparing nearby dates...</div>';
    try {
      const d = await api(`/api/rooms/price-calendar?check_in=${encodeURIComponent(ci)}&check_out=${encodeURIComponent(co)}&flex=${flex}`);
      if (!$('#flex')) return;
      const cell = c => c.total_price == null
        ? '<td class="flex-sold">Sold out</td>'
        : `<td class="num"><b>${esc(money(c.total_price))}</b><div class="sub">${plural(c.free, 'room')} free</div></td>`;
      box.innerHTML = `<div class="panel stack"><div class="flex-head"><h3>Flexible dates</h3>
        <label class="field inline"><span>Shift by</span><select id="flex-range" aria-label="Days to shift">${[1, 3, 5, 7].map(n => `<option value="${n}"${n === d.flex ? ' selected' : ''}>&plusmn;${n} days</option>`).join('')}</select></label></div>
        <p class="meta">Same ${plural(d.nights, 'night')}, started on a different day. ${d.prices_vary
          ? 'The cheapest option is marked.'
          : 'Room prices are the same on every date, so shifting helps only when your room type is sold out.'}</p>
        <div class="table-wrap"><table class="flex-table"><caption class="sr">Prices for nearby dates</caption>
        <thead><tr><th>Stay</th>${d.types.map(t => `<th class="num">${esc(t)}</th>`).join('')}<th></th></tr></thead><tbody>
        ${d.windows.map(w => `<tr class="${w.selected ? 'flex-selected' : ''}${w.tag ? ' flex-' + w.tag : ''}">
          <td>${esc(dayLabel(w.check_in))} to ${esc(dayLabel(w.check_out))}${w.selected ? ' <span class="chip Confirmed">Your dates</span>' : ''}${w.tag === 'cheapest' ? ' <span class="chip Pending">Cheapest</span>' : ''}</td>
          ${w.cells.map(cell).join('')}
          <td>${w.selected || w.tag === 'sold_out' ? '' : `<button class="btn small" type="button" data-flex-in="${esc(w.check_in)}" data-flex-out="${esc(w.check_out)}">Use these dates</button>`}</td></tr>`).join('')}
        </tbody></table></div></div>`;
      $('#flex-range').addEventListener('change', e => loadFlex(ci, co, Number(e.target.value)));
      box.onclick = e => {
        const b = e.target.closest('[data-flex-in]');
        if (!b) return;
        $('#ci').value = b.dataset.flexIn; $('#co').value = b.dataset.flexOut;
        $('#ci').dispatchEvent(new Event('input'));
        doSearch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    } catch (err) { box.innerHTML = alertHtml(err.message); }
  }

  // ---------------------------------------------------------------- guest: search and book
  function viewHome() {
    const s = state.search;
    const today = new Date();
    const ci = s ? s.ci : iso(addDays(today, 1));
    const co = s ? s.co : iso(addDays(today, 3));
    const premiumTheme = state.theme === 'official' || state.theme === 'accessible';
    const heroHeadline = premiumTheme ? 'Reserve your stay' : 'Which nights do you need?';
    const eyebrowText = state.theme === 'cyberpunk'
      ? 'NEON OASIS // NIGHT CITY CORPORATE HOSPITALITY'
      : state.theme === 'gta' ? 'THE MARISOL / VICE CITY BEACH CLUB / EST. 1986' : '';
    const heroEyebrow = eyebrowText ? `<p class="hero-eyebrow">${eyebrowText}</p>` : '';
    const announcements = premiumTheme
      ? ['OFFICIAL HOTEL SITE · SECURE BOOKING · PLATINUM MEMBERS SAVE 12%']
      : state.theme === 'gta'
        ? ['OCEAN VIEW FROM 25,000 KZT', 'VICE CITY · THE SUN NEVER SETS', 'VACATION AT YOUR OWN RISK']
        : ['OCEAN VIEW FROM 25,000 KZT', 'SYSTEM NOTICE: ROOMS AVAILABLE', 'SECTOR 4 · SECURE CHECK-IN'];
    const ticker = [...announcements, ...announcements].map((item, i) => `<span>${item}</span>${i === announcements.length * 2 - 1 ? '' : '<b aria-hidden="true">✦</b>'}`).join('');
    app.innerHTML = `
      <section class="hero">
        ${heroEyebrow}
        <h1>${heroHeadline}</h1>
        <p>Pick your dates and see the rooms that are free. Booking takes about a minute.</p>
        <button type="button" class="btn mobile-search-trigger" id="mobile-search-toggle" aria-expanded="false">Search panel</button>
        <form class="searchbar" id="search-form" novalidate>
          <label class="field"><span>Check-in</span><input type="date" id="ci" aria-label="Check-in date" required value="${ci}" min="${iso(today)}"></label>
          <label class="field"><span>Check-out</span><input type="date" id="co" aria-label="Check-out date" required value="${co}" min="${iso(addDays(today, 1))}"></label>
          <label class="field guest-stepper"><span>Guests</span><input type="number" id="guest-count" name="guest_count" aria-label="Number of guests" min="1" max="8" step="1" value="${s ? (s.guestCount || 1) : 1}"></label>
          <div class="nights" id="nights" aria-live="polite"></div>
          <button class="btn" type="submit">Search rooms</button>
        </form>
      </section>
      <div class="marquee" aria-label="Hotel announcements"><div class="marquee-track">${ticker}</div></div>
      <div id="results" role="region" aria-live="polite" aria-label="Room search results"></div>`;
    const updateNights = () => {
      const a = $('#ci').value, b = $('#co').value;
      const n = a && b ? nightsBetween(a, b) : 0;
      $('#nights').textContent = n > 0 ? plural(n, 'night') : '';
    };
    $('#ci').addEventListener('input', updateNights);
    $('#co').addEventListener('input', updateNights);
    updateNights();
    $('#search-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
    const mobileSearchToggle = $('#mobile-search-toggle');
    if (mobileSearchToggle) mobileSearchToggle.addEventListener('click', () => { const opened = $('#search-form').classList.toggle('is-open'); mobileSearchToggle.setAttribute('aria-expanded', String(opened)); mobileSearchToggle.textContent = opened ? 'Close' : 'Search panel'; });
    $('#results').addEventListener('click', e => {
      const btn = e.target.closest('[data-book]');
      if (!btn || !state.search) return;
      const room = state.search.rooms.find(r => String(r.room_id) === btn.dataset.book);
      if (room) openBooking(room);
    });
    if (s) showResults();
  }

  async function doSearch() {
    const ci = $('#ci').value, co = $('#co').value, guestCount = Number($('#guest-count')?.value || 1), box = $('#results');
    if (!ci || !co) { box.innerHTML = alertHtml('Choose both dates.'); return; }
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 8) { box.innerHTML = alertHtml('Choose between 1 and 8 guests.'); return; }
    box.innerHTML = '<div class="notice">Looking for free rooms...</div>';
    $('#search-form')?.classList.remove('is-open');
    $('#mobile-search-toggle')?.setAttribute('aria-expanded', 'false');
    try {
      const d = await api(`/api/rooms/search?check_in=${encodeURIComponent(ci)}&check_out=${encodeURIComponent(co)}&guests=${guestCount}`);
      state.search = { ci: d.check_in, co: d.check_out, nights: d.nights, rooms: d.rooms, guestCount: d.guest_count || guestCount, typeFilter: 'All' };
      showResults();
    } catch (err) {
      state.search = null;
      box.innerHTML = alertHtml(err.message);
    }
  }

  function plaqueHtml(r, nights, free) {
    const imageName = ({ Standard: 'standard', Deluxe: 'deluxe', Suite: 'suite', President: 'president' })[r.type_name] || 'standard';
    const artFolder = state.theme === 'cyberpunk' ? 'cyberpunk' : 'rooms';
    const artLabel = `${r.type_name} hotel room illustration`;
    return `<li class="plaque">
      <div class="room-image"><img src="/static/assets/${artFolder}/${imageName}.svg" alt="${esc(artLabel)}" loading="lazy"></div>
      <div class="door"><b>${esc(r.room_number)}</b><span>Floor ${esc(r.floor)}</span></div>
      <div class="info"><h3>${esc(r.type_name)}</h3><div class="meta">Sleeps ${esc(r.capacity)}, ${plural(free, 'room')} free${r.average_rating ? ` · ★ ${r.average_rating} (${r.review_count} reviews)` : ''}</div>
        <div class="amenities">Ocean view · Wi-Fi · Climate control</div>
        <div class="price"><div><strong>${money(r.total_price)}</strong><br>
          <small>${plural(nights, 'night')}, ${money(r.price_per_night)} per night</small></div>
          <button class="btn" type="button" data-book="${esc(r.room_id)}">Book this room</button></div></div></li>`;
  }

  function showResults() {
    const s = state.search, box = $('#results');
    if (!s || !box) return;

    // Keep the total from the complete search result, even when one type is selected.
    const totalFree = s.rooms.length;
    if (!s.typeFilter) s.typeFilter = 'All';

    if (!totalFree) {
      box.innerHTML = `<div class="notice"><b>0 rooms are free for these dates.</b> Try other dates, or a shorter stay.</div><div id="flex"></div>`;
      loadFlex(s.ci, s.co);
      return;
    }

    const groups = [];                    // one card per room type, with the number of free rooms
    for (const r of s.rooms) {
      const g = groups.find(x => x.room.type_name === r.type_name);
      if (g) g.free++; else groups.push({ room: r, free: 1 });
    }

    const types = ['Standard', 'Deluxe', 'Suite', 'President'];
    const selectedGroups = s.typeFilter === 'All'
      ? groups
      : groups.filter(g => g.room.type_name === s.typeFilter);
    const selectedFree = selectedGroups.reduce((sum, g) => sum + g.free, 0);
    const options = types.map(type => {
      const group = groups.find(g => g.room.type_name === type);
      const count = group ? group.free : 0;
      return `<option value="${esc(type)}"${s.typeFilter === type ? ' selected' : ''}>${esc(type)} (${count})</option>`;
    }).join('');

    const filteredContent = selectedGroups.length
      ? `<ul class="plaques">${selectedGroups.map(g => plaqueHtml(g.room, s.nights, g.free)).join('')}</ul>`
      : `<div class="notice"><b>No ${esc(s.typeFilter)} rooms are free for these dates.</b> Choose another room type or change your dates.</div>`;

    box.innerHTML = `
      <h2>Rooms</h2>
      <div class="results-tools">
        <div>
          <p class="meta count">${plural(totalFree, 'room')} free in total from ${fmtDate(s.ci)} to ${fmtDate(s.co)}.</p>
          <p class="meta filter-count" aria-live="polite">Showing ${selectedFree} of ${totalFree} free rooms${s.typeFilter === 'All' ? '' : ` — ${esc(s.typeFilter)}`}.</p>
        </div>
        <label class="field room-type-filter"><span>Filter by room type</span>
          <select id="room-type-filter" aria-label="Filter rooms by type">
            <option value="All"${s.typeFilter === 'All' ? ' selected' : ''}>All room types (${totalFree})</option>
            ${options}
          </select>
        </label>
      </div>
      ${filteredContent}<div id="flex"></div>`;

    $('#room-type-filter').addEventListener('change', e => {
      s.typeFilter = e.target.value;
      showResults();
    });
    loadFlex(s.ci, s.co);
  }

  let lastAlternatives = [];
  let pendingBookingRoom = null;
  function alternativesHtml(list) {
    const requiredGuests = state.search && state.search.guestCount || 1;
    lastAlternatives = (list || []).filter(room => Number(room.capacity || 1) >= requiredGuests);
    if (!lastAlternatives.length) return '';
    return `<div class="notice"><b>These rooms are free for the same dates:</b><ul>${lastAlternatives.map(r =>
      `<li><button type="button" class="link" data-alt="${esc(r.room_id)}">Room ${esc(r.room_number)}, ${esc(r.type_name)}, ${money(r.total_price)}</button></li>`).join('')}</ul></div>`;
  }

  function openBooking(room) {
    if (!state.user || state.user.role !== 'Guest') {
      pendingBookingRoom = room;
      openGuestAuthDialog();
      return;
    }
    const s = state.search;
    openDialog(`Book room ${room.room_number}`, `
      <div class="booking-steps"><span class="done">01 · GUEST DETAILS</span><span class="active">02 · PAYMENT</span><span>03 · CONFIRMATION</span></div>
      <div class="summary"><dl>
        <dt>Room</dt><dd>${esc(room.room_number)}, ${esc(room.type_name)}</dd>
        <dt>Stay</dt><dd>${fmtDate(s.ci)} to ${fmtDate(s.co)}</dd>
        <dt>Nights</dt><dd>${s.nights}</dd><dt>Guests</dt><dd>${s.guestCount || 1}</dd>
        <dt>Total</dt><dd>${money(room.total_price)}</dd></dl></div>
      <div class="profile-booking-owner"><span class="profile-mini-avatar">${esc(profileInitials(state.user.name))}</span><span>Booking for <b>${esc(state.user.name)}</b><small>${esc(state.user.email)}</small></span><a href="#/account" data-close>Account</a></div>
      <div id="book-error"></div>
      <form id="book-form" class="form-grid" novalidate>
        <label class="field"><span>Payment method</span><select name="method"><option>Card</option><option>Cash</option><option>Transfer</option></select></label>
        <fieldset class="field"><legend>Optional extras</legend>
          <label><input type="checkbox" name="addon" value="breakfast"> Breakfast — 6,000 KZT</label>
          <label><input type="checkbox" name="addon" value="airport_transfer"> Airport transfer — 12,000 KZT</label>
          <label><input type="checkbox" name="addon" value="late_checkout"> Late check-out — 5,000 KZT</label>
        </fieldset>
        <p class="meta">Guest details verified: <b>${esc(state.user.name)}</b> · ${s.guestCount || 1} guest(s). Your reservation will be saved to your account.</p>
        <p class="meta">Payment is simulated in this prototype. No card number is asked for or stored.</p>
        <details class="demo"><summary>Demo tools</summary>
          <label><input type="checkbox" name="simulate"> Simulate a payment failure (nothing is saved)</label></details>
        <div class="actions"><button class="btn" type="submit">Confirm and pay ${money(room.total_price)}</button>
          <button class="btn secondary" type="button" data-close>Back</button></div>
      </form>`);
    $('#book-form').addEventListener('submit', e => submitBooking(e, room));
  }
  dlg.addEventListener('click', e => {
    const alt = e.target.closest('[data-alt]');
    if (!alt) return;
    const room = lastAlternatives.find(r => String(r.room_id) === alt.dataset.alt);
    if (room) { state.search.rooms = lastAlternatives.concat(state.search.rooms.filter(r => !lastAlternatives.some(a => a.room_id === r.room_id))); openBooking(room); }
  });

  async function submitBooking(e, room) {
    e.preventDefault();
    const f = e.target, btn = $('button[type=submit]', f), errBox = $('#book-error');
    errBox.innerHTML = '';
    btn.disabled = true;
    try {
      const d = await api('/api/bookings', { method: 'POST', body: {
        room_id: room.room_id, check_in: state.search.ci, check_out: state.search.co, guest_count: state.search.guestCount || 1,
        method: f.elements.method.value, simulate_payment_failure: f.elements.simulate.checked,
        add_ons: [...f.querySelectorAll('input[name="addon"]:checked')].map(x => x.value) } });
      state.search.rooms = state.search.rooms.filter(r => r.room_id !== room.room_id);
      state.refreshAfterClose = true;
      showConfirmation(d);
    } catch (err) {
      btn.disabled = false;
      errBox.innerHTML = alertHtml(err.message) + alternativesHtml(err.data && err.data.alternatives);
      errBox.scrollIntoView && errBox.scrollIntoView({ block: 'nearest' });
    }
  }

  function showConfirmation(d) {
    const mail = d.email || {};
    const mailText = mail.status === 'Sent'
      ? (mail.channel === 'simulated'
        ? `A confirmation email for ${d.to_email} was written to the outbox (email sending is simulated in this prototype).`
        : `A confirmation email was sent to ${d.to_email}.`)
      : 'The confirmation email could not be sent. The front desk can send it again.';
    openDialog('Booking confirmed', `
      <div class="booking-steps"><span class="done">01 · GUEST DETAILS</span><span class="done">02 · PAYMENT</span><span class="active">03 · CONFIRMATION</span></div>
      <p class="bignum" aria-label="Reservation number ${esc(d.reservation_id)}">#${esc(d.reservation_id)}</p>
      <p>Your reservation has been saved to your guest account. Open <b>My reservations</b> at any time to view or manage it.</p>
      <div class="summary"><dl>
        <dt>Room</dt><dd>${esc(d.room_number)}, ${esc(d.type_name)}</dd>
        <dt>Stay</dt><dd>${fmtDate(d.check_in)} to ${fmtDate(d.check_out)} (${plural(d.nights, 'night')})</dd>
        <dt>Paid</dt><dd>${money(d.total_price)}</dd></dl></div>
      ${passHtml(d.pass)}
      <p>${esc(mailText)}</p>
      <p class="meta">Cancellation refunds are calculated automatically from the days remaining before check-in.</p>
      <div class="actions"><a class="btn" href="#/manage" data-close>My reservations</a>
        <button class="btn secondary" type="button" data-close>Close</button></div>`);
  }

  // ---------------------------------------------------------------- guest: manage a booking
  function viewManage() {
    if (state.user && state.user.role === 'Guest') {
      app.innerHTML = `
        <section class="hero">
          <h1>My reservations</h1>
          <p>All reservations saved to <b>${esc(state.user.email)}</b> appear here automatically.</p>
          <div class="actions"><button class="btn secondary" type="button" id="history-refresh">Refresh history</button><a class="btn" href="#/">Book another stay</a></div>
        </section>
        <div id="booking-history" aria-live="polite"><div class="empty">Loading your reservations...</div></div>`;
      $('#history-refresh').addEventListener('click', loadMyReservations);
      loadMyReservations();
      return;
    }
    app.innerHTML = `
      <section class="profile-gate panel stack">
        <div class="profile-gate-icon" aria-hidden="true">▣</div>
        <h1>My reservations</h1>
        <p>${state.user ? 'Reservation self-service is available through a guest account. Staff accounts can use the Staff area.' : 'Sign in or create a guest account to keep all your reservations together in one private place.'}</p>
        <div class="actions">
          <button type="button" class="btn" id="manage-guest-signin">Guest sign in / Register</button>
          ${state.user && state.user.role !== 'Guest' ? '<a class="btn secondary" href="#/staff">Open staff area</a>' : ''}
        </div>
      </section>`;
    $('#manage-guest-signin').addEventListener('click', openGuestAuthDialog);
  }

  async function loadMyReservations() {
    const box = $('#booking-history');
    if (!box) return;
    box.innerHTML = '<div class="empty">Loading your reservations...</div>';
    try {
      const d = await api('/api/guest/reservations');
      if (d.user) {
        state.user = d.user;
        refreshAmbient();
        renderNav();
      }
      if (!d.reservations.length) {
        box.innerHTML = `<div class="panel stack"><h2>No reservations yet</h2><p>Your future bookings will be saved to this account automatically.</p><a class="btn" href="#/">Search available rooms</a></div>`;
        return;
      }
      box.innerHTML = `<section class="panel stack"><div class="row between"><h2>Reservation history</h2><span class="chip">${d.count} total</span></div>
        ${d.reservations.map(r => `<article class="reservation-history-item">
          <div class="reservation-history-main"><b>${esc(r.type_name)} · Room ${esc(r.room_number)}</b><span class="chip ${esc(r.status)}">${esc(r.status)}</span></div>
          <p>${fmtDate(r.check_in)} – ${fmtDate(r.check_out)} · ${plural(r.nights, 'night')}</p>
          <div class="row between"><span class="meta">${money(r.total_price)}</span><button type="button" class="btn small secondary" data-account-reservation="${esc(r.reservation_id)}">View details</button></div>
        </article>`).join('')}</section>`;
      box.querySelectorAll('[data-account-reservation]').forEach(button => {
        button.addEventListener('click', () => {
          const item = d.reservations.find(r => String(r.reservation_id) === button.dataset.accountReservation);
          if (item) renderGuestReservation(item, box);
        });
      });
    } catch (err) {
      box.innerHTML = alertHtml(err.message);
    }
  }

  function renderGuestReservation(d, box) {
    let action = '';
    if (d.status === 'Completed') { action = `<form id="review-form" class="stack"><h3>Review your stay</h3><label class="field">Rating<select name="rating"><option value="5">5 – Excellent</option><option value="4">4 – Good</option><option value="3">3 – Average</option><option value="2">2 – Poor</option><option value="1">1 – Very poor</option></select></label><label class="field">Comment<textarea name="comment"></textarea></label><button class="btn">Submit review</button></form>`; }
    if (d.status === 'Confirmed') {
      const pct = d.refund_percent == null ? 100 : d.refund_percent;
      action = `<p>Cancellation refund: <b>${pct}%</b> (${d.days_left} day(s) before check-in). Estimated refund: ${money(Number(d.paid) * pct / 100)}.</p>
        <p class="meta">Only the signed-in account that owns this reservation can cancel it.</p>
        <button class="btn danger" type="button" id="guest-cancel">Cancel booking</button>`;
    }
    box.innerHTML = `<button type="button" class="link history-back" id="history-back">← Back to all reservations</button>
      <div class="panel stack"><h2>Reservation #${esc(d.reservation_id)} <span class="chip ${esc(d.status)}">${esc(d.status)}</span></h2>
      <div class="summary"><dl>
        <dt>Guest</dt><dd>${esc(d.full_name)}</dd>
        <dt>Room</dt><dd>${esc(d.room_number)}, ${esc(d.type_name)}</dd>
        <dt>Stay</dt><dd>${fmtDate(d.check_in)} to ${fmtDate(d.check_out)} (${plural(d.nights, 'night')})</dd>
        <dt>Price</dt><dd>${money(d.total_price)}</dd>
        <dt>Paid</dt><dd>${money(d.paid)}</dd></dl></div>${passHtml(d.pass)}${action}</div>`;
    const historyBack = $('#history-back'); if (historyBack) historyBack.addEventListener('click', loadMyReservations);
    const reviewForm=$('#review-form'); if(reviewForm) reviewForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/reviews',{method:'POST',body:{reservation_id:d.reservation_id,rating:reviewForm.elements.rating.value,comment:reviewForm.elements.comment.value}});reviewForm.innerHTML='<p class="okbox">Thank you for your review.</p>';}catch(x){toast(x.message,'error')}});
    const cancel = $('#guest-cancel');
    if (cancel) cancel.addEventListener('click', async () => {
      const r = await confirmDialog({ title: `Cancel reservation #${d.reservation_id}?`, message: `Your stay on ${fmtDate(d.check_in)} will be cancelled. Estimated refund: ${money(Number(d.paid) * (d.refund_percent == null ? 100 : d.refund_percent) / 100)} (${d.refund_percent == null ? 100 : d.refund_percent}%).`, confirm: 'Cancel booking', danger: true });
      if (!r.ok) return;
      try {
        const res = await api('/api/bookings/cancel', { method: 'POST', body: { reservation_id: d.reservation_id } });
        loadMyReservations();
        toast(`Booking cancelled. Refund: ${money(res.refunded)}.`);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // ---------------------------------------------------------------- staff area
  async function viewStaff(sub) {
    if (!state.user || state.user.role === 'Guest') return viewLogin();
    const manager = state.user.role === 'Manager';
    if ((sub === 'dashboard' || sub === 'prices') && !manager) sub = 'reservations';
    if (!['reservations', 'calendar', 'floor', 'housekeeping', 'checkin', 'outbox', 'dashboard', 'prices', 'loyalty', 'maintenance', 'reviews'].includes(sub)) sub = 'reservations';
    const tab = (key, label) => `<a href="#/staff/${key}"${sub === key ? ' aria-current="page"' : ''}>${label}</a>`;
    app.innerHTML = `<h1>Staff area</h1>
      ${state.user.default_password ? '<div class="notice" role="alert"><b>You are using the demo password.</b> Anyone who has read the README can log in as you. <button type="button" class="link" id="change-now">Change it now</button></div>' : ''}
      <nav class="tabs" aria-label="Staff sections">${tab('reservations', 'Reservations')}${tab('calendar', 'Calendar')}${tab('floor', 'Floor map')}${tab('housekeeping', 'Housekeeping')}${tab('checkin', 'Check-in')}${tab('loyalty', 'Loyalty')}${tab('maintenance', 'Maintenance')}${tab('reviews', 'Reviews')}${tab('outbox', 'Email outbox')}${manager ? tab('dashboard', 'Dashboard') + tab('prices', 'Prices') : ''}</nav>
      <div id="panel"></div>`;
    const changeNow = $('#change-now');
    if (changeNow) changeNow.addEventListener('click', openPasswordDialog);
    if (sub === 'reservations') await panelReservations();
    else if (sub === 'calendar') await panelCalendar();
    else if (sub === 'floor') await panelFloor();
    else if (sub === 'housekeeping') await panelHousekeeping();
    else if (sub === 'checkin') await panelCheckin();
    else if (sub === 'outbox') await panelOutbox();
    else if (sub === 'loyalty') await panelLoyalty();
    else if (sub === 'maintenance') await panelMaintenance();
    else if (sub === 'reviews') await panelReviews();
    else if (sub === 'prices') await panelPrices();
    else await panelDashboard();
  }

  async function panelLoyalty() {
    const p=$('#panel'); p.innerHTML='<div class="empty">Loading loyalty statistics...</div>';
    try { const d=await staffCall(()=>api('/api/staff/loyalty')); if(!d)return;
      p.innerHTML=`<h2>Loyalty membership</h2><p class="meta">Tier is calculated from completed stays: Silver 2–4 (5%), Gold 5–9 (8%), Platinum 10+ (12%).</p><div class="grid2">${Object.entries(d.members).map(([k,v])=>`<div class="panel"><h3>${k}</h3><strong>${v}</strong><p class="meta">Guests</p></div>`).join('')}</div><p>Total guest accounts: ${d.total_guests}</p>`;
    } catch(e){p.innerHTML=alertHtml(e.message)}
  }
  async function panelMaintenance() {
    const p=$('#panel');
    try { const d=await staffCall(()=>api('/api/staff/maintenance')); if(!d)return;
      p.innerHTML=`<h2>Maintenance tickets</h2><form id="ticket-form" class="toolbar"><label class="field">Room number<input name="room_id" type="text" required placeholder="105"></label><label class="field">Reason<input name="reason" required></label><label class="field">Start<input name="start_date" type="date" required></label><label class="field">Expected end<input name="expected_end_date" type="date" required></label><button class="btn">Create ticket</button></form><div class="table-wrap"><table><thead><tr><th>Room</th><th>Reason</th><th>Dates</th><th>Status</th><th>Update</th></tr></thead><tbody>${d.tickets.map(t=>`<tr><td>${esc(t.room_number)}</td><td>${esc(t.reason)}</td><td>${esc(t.start_date)} – ${esc(t.expected_end_date)}</td><td>${esc(t.status)}</td><td><select data-ticket="${t.ticket_id}"><option ${t.status==='Open'?'selected':''}>Open</option><option ${t.status==='In Progress'?'selected':''}>In Progress</option><option ${t.status==='Resolved'?'selected':''}>Resolved</option><option ${t.status==='Cancelled'?'selected':''}>Cancelled</option></select></td></tr>`).join('')}</tbody></table></div>`;
      $('#ticket-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;try{await staffCall(()=>api('/api/staff/maintenance',{method:'POST',body:Object.fromEntries(new FormData(f))}));panelMaintenance()}catch(x){toast(x.message,'error')}});
      p.querySelectorAll('[data-ticket]').forEach(sel=>sel.addEventListener('change',async()=>{try{await staffCall(()=>api(`/api/staff/maintenance/${sel.dataset.ticket}`,{method:'POST',body:{status:sel.value}}));toast('Ticket updated.')}catch(e){toast(e.message,'error')}}));
    } catch(e){p.innerHTML=alertHtml(e.message)}
  }
  async function panelReviews() {
    const p=$('#panel');p.innerHTML='<div class="empty">Loading reviews...</div>';
    try{const d=await staffCall(()=>api('/api/staff/reviews'));if(!d)return;p.innerHTML=`<h2>Guest reviews</h2><p class="notice">Low ratings (1–2 stars): ${d.low_rating_count}</p>${d.reviews.map(r=>`<article class="panel"><b>${esc(r.full_name)} · Room ${esc(r.room_number)}</b><p>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)} ${r.rating<=2?'<span class="chip Cancelled">Needs attention</span>':''}</p><p>${esc(r.comment)}</p></article>`).join('')||'<p>No reviews yet.</p>'}`;}catch(e){p.innerHTML=alertHtml(e.message)}
  }

  function animatePage() {
    const parts = route();
    const routeName = (parts[0] || 'home').replace(/[^a-z0-9_-]/gi, '') || 'home';
    const panelName = (parts[1] || 'overview').replace(/[^a-z0-9_-]/gi, '') || 'overview';
    document.documentElement.dataset.route = routeName;
    document.documentElement.dataset.panel = panelName;
    app.classList.remove('page-enter');
    // Each route and staff tab gets a fresh, theme-specific entrance sequence.
    void app.offsetWidth;
    app.classList.add('page-enter');
    if (window.hotelAmbientBurst) window.hotelAmbientBurst({ route: routeName, panel: panelName });
  }

  function openGuestAuthDialog() {
    openDialog('Guest account', `
      <div class="auth-switch"><button type="button" class="btn small" data-auth-mode="login" aria-pressed="true">Sign in</button><button type="button" class="btn small secondary" data-auth-mode="register" aria-pressed="false">Create account</button></div>
      <div id="guest-auth-error" aria-live="polite"></div>
      <form id="guest-auth-form" class="form-grid" novalidate>
        <div id="guest-register-fields" hidden>
          <label class="field"><span>Full name</span><input name="full_name" autocomplete="name" maxlength="100"></label>
          <label class="field"><span>Phone</span><input name="phone" type="tel" autocomplete="tel" maxlength="20"></label>
        </div>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="100"></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required minlength="10"></label>
        <p class="meta" id="guest-password-hint" hidden>Use at least 10 characters, including letters and a number. Your account will be created immediately; no email verification is required.</p>
        <div class="actions"><button class="btn" type="submit" id="guest-auth-submit">Sign in</button><button class="btn secondary" type="button" data-close>Close</button></div>
      </form>
      <button type="button" class="link" id="guest-forgot-password">Forgot password?</button>
      <details class="demo loyalty-demo"><summary>Try the four loyalty demo accounts</summary>
        <div class="demo-account"><b>None</b><span>demo.none@hotel.test</span><code>NoneTier#2026</code><small>0 stays · 0% discount</small></div>
        <div class="demo-account"><b>Silver</b><span>demo.silver@hotel.test</span><code>SilverTier#2026</code><small>2 stays · 5% discount</small></div>
        <div class="demo-account"><b>Gold</b><span>demo.gold@hotel.test</span><code>GoldTier#2026</code><small>5 stays · 8% discount</small></div>
        <div class="demo-account"><b>Platinum</b><span>demo.platinum@hotel.test</span><code>PlatinumTier#2026</code><small>10 stays · 12% discount</small></div>
      </details>`);
    let mode = 'login';
    const setMode = next => {
      mode = next;
      const form = $('#guest-auth-form');
      $('#guest-register-fields').hidden = mode !== 'register';
      $('#guest-password-hint').hidden = mode !== 'register';
      form.elements.password.closest('.field').hidden = false;
      form.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      form.elements.full_name.required = mode === 'register';
      form.elements.phone.required = mode === 'register';
      $('#guest-auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
      dlg.querySelectorAll('[data-auth-mode]').forEach(b => {
        b.disabled = false;
        b.setAttribute('aria-pressed', String(b.dataset.authMode === mode));
        b.classList.toggle('secondary', b.dataset.authMode !== mode);
      });
      $('#guest-auth-error').innerHTML = '';
    };
    dlg.querySelectorAll('[data-auth-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.authMode)));
    $('#guest-forgot-password').addEventListener('click', openGuestPasswordResetDialog);
    $('#guest-auth-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target; $('#guest-auth-error').innerHTML = '';
      try {
        const d = mode === 'register'
          ? await api('/api/auth/register', { method: 'POST', body: {
              full_name: f.elements.full_name.value, phone: f.elements.phone.value,
              email: f.elements.email.value, password: f.elements.password.value
            } })
          : await api('/api/auth/guest-login', { method: 'POST', body: {
              email: f.elements.email.value, password: f.elements.password.value
            } });
        state.user = d.user; state.csrf = d.csrf || null; dlg.close(); renderNav(); refreshAmbient();
        toast(`Welcome, ${d.user.name}. ${d.user.loyalty_tier || 'None'} loyalty tier.`);
        if (pendingBookingRoom) {
          const room = pendingBookingRoom;
          pendingBookingRoom = null;
          openBooking(room);
        } else if (route()[0] === 'staff') { location.hash = '#/'; } else { render(); }
      } catch (err) { $('#guest-auth-error').innerHTML = alertHtml(err.message); }
    });
  }

  function openGuestPasswordResetDialog() {
    openDialog('Reset guest password', `
      <p class="meta">We will email an eight-digit recovery code. It expires in 10 minutes.</p>
      <div id="reset-error" aria-live="polite"></div>
      <form id="reset-form" class="form-grid" novalidate>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="100"></label>
        <label class="field" id="reset-code-field" hidden><span>Recovery code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label>
        <label class="field" id="reset-password-field" hidden><span>New password</span><input name="new_password" type="password" autocomplete="new-password" minlength="10"></label>
        <label class="field" id="reset-confirm-field" hidden><span>Confirm new password</span><input name="confirm_password" type="password" autocomplete="new-password" minlength="10"></label>
        <div class="actions"><button class="btn" type="submit" id="reset-submit">Send recovery code</button><button class="btn secondary" type="button" data-close>Close</button></div>
      </form>`);
    let codeRequested = false;
    $('#reset-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target.elements; $('#reset-error').innerHTML = '';
      try {
        if (!codeRequested) {
          const d = await api('/api/auth/guest-password-reset/request', { method: 'POST', body: { email: f.email.value } });
          codeRequested = true; f.email.readOnly = true;
          $('#reset-code-field').hidden = false; $('#reset-password-field').hidden = false; $('#reset-confirm-field').hidden = false;
          $('#reset-submit').textContent = 'Reset password';
          $('#reset-error').textContent = d.message || 'Enter the recovery code from your email.';
          f.code.focus();
          return;
        }
        if (f.new_password.value !== f.confirm_password.value) { $('#reset-error').innerHTML = alertHtml('The new passwords do not match.'); return; }
        const d = await api('/api/auth/guest-password-reset/confirm', { method: 'POST', body: {
          email: f.email.value, code: f.code.value.trim(), new_password: f.new_password.value
        } });
        dlg.close(); openGuestAuthDialog(); toast(d.message || 'Password reset. Sign in with your new password.');
      } catch (err) { $('#reset-error').innerHTML = alertHtml(err.message); }
    });
  }

  function openGuestPasswordDialog() {
    openDialog('Change guest password', `
      <p class="meta">Use at least 10 characters, including letters and a number. Other guest sessions will be signed out.</p>
      <div id="guest-pw-error"></div>
      <form id="guest-pw-form" class="form-grid" novalidate>
        <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" required minlength="10"></label>
        <label class="field"><span>Confirm new password</span><input name="again" type="password" autocomplete="new-password" required minlength="10"></label>
        <div class="actions"><button class="btn" type="submit">Change password</button><button class="btn secondary" type="button" data-close>Cancel</button></div>
      </form>`);
    $('#guest-pw-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target.elements;
      if (f.next.value !== f.again.value) { $('#guest-pw-error').innerHTML = alertHtml('The new passwords do not match.'); return; }
      try {
        await api('/api/auth/guest-password', { method: 'POST', body: { current: f.current.value, new: f.next.value } });
        dlg.close(); toast('Guest password changed.');
      } catch (err) { $('#guest-pw-error').innerHTML = alertHtml(err.message); }
    });
  }

  function openPasswordDialog() {
    openDialog('Change password', `
      <p class="meta">At least 10 characters, with letters and at least one digit. Other devices that are logged in with this account are logged out.</p>
      <div id="pw-error"></div>
      <form id="pw-form" class="form-grid" novalidate>
        <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" required minlength="10"></label>
        <label class="field"><span>New password again</span><input name="again" type="password" autocomplete="new-password" required></label>
        <div class="actions"><button class="btn" type="submit">Change password</button><button class="btn secondary" type="button" data-close>Back</button></div>
      </form>`);
    $('#pw-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target.elements;
      $('#pw-error').innerHTML = '';
      if (f.next.value !== f.again.value) { $('#pw-error').innerHTML = alertHtml('The two new passwords are not the same.'); return; }
      try {
        await api('/api/auth/password', { method: 'POST', body: { current: f.current.value, new: f.next.value } });
        state.user.default_password = false;
        dlg.close();
        toast('Password changed.');
        if (route()[0] === 'staff') render();
      } catch (err) { $('#pw-error').innerHTML = alertHtml(err.message); }
    });
  }

  function profileInitials(name) {
    return String(name || 'Guest').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'G';
  }

  function profileDate(value) {
    if (!value) return 'Hotel team';
    const parsed = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    return Number.isNaN(parsed.getTime()) ? 'Hotel member' : parsed.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  }

  async function viewAccount() {
    if (!state.user) {
      app.innerHTML = `<section class="profile-gate panel stack"><div class="profile-gate-icon" aria-hidden="true">◉</div><h1>Your profile</h1><p>Sign in to open your personal profile, update your contact details and manage your account security.</p><div class="actions"><button type="button" class="btn" id="account-signin">Guest sign in / Register</button><a class="btn secondary" href="#/staff">Staff sign in</a></div></section>`;
      $('#account-signin').addEventListener('click', () => openGuestAuthDialog());
      return;
    }
    app.innerHTML = '<section class="profile-page"><div id="account-panel" class="empty">Loading your profile...</div></section>';
    const panel = $('#account-panel');
    try {
      const d = await api('/api/auth/account');
      const u = d.user;
      const guest = u.role === 'Guest';
      const roleName = roleLabel(u.role);
      const initials = profileInitials(u.name);
      const title = guest ? 'Guest profile' : (u.role === 'Manager' ? 'Management profile' : 'Front desk profile');
      const joined = guest ? profileDate(u.created_at) : 'Hotel team account';
      const statCards = guest
        ? `<div class="profile-stat"><span class="profile-stat-icon">✦</span><span class="profile-stat-value">${Number(u.completed_stays || 0)}</span><span class="profile-stat-label">Completed stays</span></div><div class="profile-stat"><span class="profile-stat-icon">◇</span><span class="profile-stat-value">${esc(u.loyalty_tier || 'None')}</span><span class="profile-stat-label">Loyalty status</span></div><div class="profile-stat"><span class="profile-stat-icon">％</span><span class="profile-stat-value">${Number(u.loyalty_discount || 0)}%</span><span class="profile-stat-label">Member discount</span></div>`
        : `<div class="profile-stat"><span class="profile-stat-icon">#</span><span class="profile-stat-value">${esc(u.account_id)}</span><span class="profile-stat-label">Staff ID</span></div><div class="profile-stat"><span class="profile-stat-icon">▤</span><span class="profile-stat-value">${esc(roleName)}</span><span class="profile-stat-label">Access level</span></div><div class="profile-stat"><span class="profile-stat-icon">✓</span><span class="profile-stat-value">Active</span><span class="profile-stat-label">Account status</span></div>`;
      const quickLinks = guest
        ? `<a class="profile-shortcut" href="#/manage"><span>▤</span><span><b>My reservations</b><small>View stays and booking details</small></span><i>→</i></a><a class="profile-shortcut" href="#/"><span>⌂</span><span><b>Find a room</b><small>Plan your next stay</small></span><i>→</i></a>`
        : `<a class="profile-shortcut" href="#/staff/reservations"><span>▤</span><span><b>Reservations</b><small>Open the front desk workspace</small></span><i>→</i></a>${u.role === 'Manager' ? '<a class="profile-shortcut" href="#/staff/dashboard"><span>▥</span><span><b>Manager dashboard</b><small>View hotel performance</small></span><i>→</i></a>' : '<a class="profile-shortcut" href="#/staff/housekeeping"><span>⌂</span><span><b>Housekeeping</b><small>Open room status board</small></span><i>→</i></a>'}`;
      panel.outerHTML = `<section id="account-panel" class="profile-page">
        <header class="profile-cover">
          <div class="profile-cover-art" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="profile-cover-top"><span class="profile-overline">PERSONAL SPACE</span><span class="profile-live"><i></i> ACCOUNT ACTIVE</span></div>
          <div class="profile-identity">
            <div class="profile-avatar" aria-label="${esc(u.name)} initials">${esc(initials)}</div>
            <div class="profile-identity-copy"><span class="profile-eyebrow">${esc(title)}</span><h1>${esc(u.name)}</h1><p>${esc(u.email)}</p></div>
            <span class="profile-role-badge">${esc(roleName)}</span>
          </div>
        </header>
        <div class="profile-stats">${statCards}</div>
        <div class="profile-content-grid">
          <section class="profile-card profile-details-card">
            <div class="profile-card-heading"><div><span class="profile-eyebrow">YOUR DETAILS</span><h2>Profile information</h2><p>Keep your contact information up to date.</p></div><span class="profile-card-symbol">✎</span></div>
            ${u.default_password ? '<div class="notice" role="alert"><b>Demo password detected.</b> Change it before using this account outside a demonstration.</div>' : ''}
            <form id="account-form" class="profile-form" novalidate>
              <label class="field"><span>Full name</span><input name="full_name" autocomplete="name" maxlength="100" required value="${esc(u.name)}"></label>
              <div class="row2"><label class="field"><span>Phone number</span><input name="phone" type="tel" autocomplete="tel" maxlength="20" value="${esc(u.phone || '')}" ${guest ? 'required' : ''} placeholder="${guest ? 'Your contact number' : 'Add a work contact number'}"></label>
              <label class="field"><span>Account role</span><input value="${esc(roleName)}" readonly></label></div>
              <label class="field"><span>Email address</span><input type="email" value="${esc(u.email)}" readonly aria-describedby="account-email-help"></label>
              <p class="profile-help" id="account-email-help">Your email is a protected sign-in identifier. Contact the hotel administrator if it needs to be changed.</p>
              <div class="profile-form-footer"><span class="profile-help">Member since ${esc(joined)}</span><button class="btn" type="submit">Save profile</button></div>
              <div id="account-error" aria-live="polite"></div>
            </form>
          </section>
          <aside class="profile-side-column">
            <section class="profile-card profile-security-card"><div class="profile-side-heading"><span class="profile-card-symbol">⌑</span><div><span class="profile-eyebrow">PROTECTION</span><h3>Account security</h3></div></div><p>Keep your account protected with a strong, unique password. Your role and email are not editable from this page.</p><button class="btn secondary" type="button" id="account-change-password">Change password</button></section>
            <section class="profile-card"><div class="profile-side-heading"><span class="profile-card-symbol">↗</span><div><span class="profile-eyebrow">QUICK ACCESS</span><h3>Shortcuts</h3></div></div><div class="profile-shortcuts">${quickLinks}</div></section>
            <section class="profile-member-note"><span>✦</span><div><b>${guest ? `${esc(u.loyalty_tier || 'None')} member` : `${esc(roleName)} workspace`}</b><p>${guest ? `${Number(u.loyalty_discount || 0)}% loyalty discount on eligible stays.` : 'Your permissions are based on your assigned hotel role.'}</p></div></section>
          </aside>
        </div>
      </section>`;
      $('#account-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        const body = { full_name: f.full_name.value, phone: f.phone.value };
        $('#account-error').innerHTML = '';
        try {
          const saved = await api('/api/auth/account', { method: 'POST', body });
          state.user = { ...state.user, ...saved.user };
          renderNav();
          toast('Profile updated.');
          viewAccount();
        } catch (err) { $('#account-error').innerHTML = alertHtml(err.message); }
      });
      $('#account-change-password').addEventListener('click', () => guest ? openGuestPasswordDialog() : openPasswordDialog());
    } catch (err) {
      panel.innerHTML = alertHtml(err.message);
    }
  }

  function viewLogin() {
    app.innerHTML = `<section class="hero login"><h1>Staff log in</h1>
      <p>Front desk and manager accounts only.</p>
      <div id="login-error"></div>
      <form class="form-grid" id="login-form" novalidate>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div class="actions"><button class="btn" type="submit">Log in</button></div>
      </form><p class="meta">Booking a room? <button type="button" class="link" id="guest-auth-open">Create a guest account or sign in</button></p></section>`;
    $('#guest-auth-open').addEventListener('click', openGuestAuthDialog);
    $('#login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      $('#login-error').innerHTML = '';
      try {
        const d = await api('/api/auth/login', { method: 'POST', body: { email: f.elements.email.value, password: f.elements.password.value } });
        state.user = d.user; state.csrf = d.csrf;
        toast(`Welcome, ${d.user.name}.`);
        const target = '#/staff/reservations';
        if (location.hash === target) render(); else location.hash = target;
      } catch (err) {
        $('#login-error').innerHTML = alertHtml(err.message);
      }
    });
  }

  async function staffCall(fn) {
    try { return await fn(); } catch (err) {
      if (err.code === 'login_required') { toast('Your session ended. Log in again.', 'error'); render(); return null; }
      throw err;
    }
  }

  // ---- reservations
  async function panelReservations() {
    const f = state.filter;
    const opts = (list, current) => list.map(([v, label]) => `<option value="${v}"${String(current) === String(v) ? ' selected' : ''}>${label}</option>`).join('');
    $('#panel').innerHTML = `
      <form class="toolbar" id="filter-form">
        <label class="field"><span>Status</span><select name="status">${opts([['', 'All'], ['Confirmed', 'Confirmed'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled']], f.status)}</select></label>
        <label class="field"><span>Search</span><input name="q" placeholder="Name, email, room or number" value="${esc(f.q)}"></label>
        <label class="field"><span>Check-in from</span><input type="date" name="from" value="${esc(f.from)}"></label>
        <label class="field"><span>Check-in to</span><input type="date" name="to" value="${esc(f.to)}"></label>
        <label class="field"><span>Order</span><select name="order">${opts([['desc', 'Latest check-in first'], ['asc', 'Earliest check-in first']], f.order)}</select></label>
        <label class="field"><span>Rows per page</span><select name="size">${opts([[25, '25'], [50, '50'], [100, '100']], f.size)}</select></label>
        <button class="btn" type="submit">Apply</button>
        <button class="btn secondary" type="button" id="filter-reset">Clear</button>
        ${state.user.role === 'Manager' ? '<a class="btn secondary" id="csv-link" href="#" download>Download CSV</a>' : ''}
      </form>
      <div id="res-table" aria-live="polite"><div class="empty">Loading reservations...</div></div>
      <nav class="pager" id="pager" aria-label="Pages"></nav>`;
    $('#filter-form').addEventListener('submit', e => {
      e.preventDefault();
      const el = e.target.elements;
      state.filter = { status: el.status.value, q: el.q.value.trim(), from: el.from.value, to: el.to.value, order: el.order.value, size: Number(el.size.value), page: 1 };
      loadReservations();
    });
    $('#filter-reset').addEventListener('click', () => {
      state.filter = { status: '', q: '', from: '', to: '', order: 'desc', size: state.filter.size, page: 1 };
      panelReservations();
    });
    $('#res-table').addEventListener('click', onReservationAction);
    $('#pager').addEventListener('click', e => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      const f2 = state.filter, last = Number(btn.dataset.last);
      f2.page = { first: 1, prev: f2.page - 1, next: f2.page + 1, last }[btn.dataset.page];
      loadReservations();
    });
    await loadReservations();
  }

  let currentRows = [];
  async function loadReservations() {
    const box = $('#res-table'), pager = $('#pager');
    if (!box) return;
    const f = state.filter;
    const csv = $('#csv-link');
    if (csv) csv.href = `/api/manager/export.csv?status=${encodeURIComponent(f.status)}&q=${encodeURIComponent(f.q)}&from=${encodeURIComponent(f.from)}&to=${encodeURIComponent(f.to)}&order=${f.order}`;
    try {
      const q = `status=${encodeURIComponent(f.status)}&q=${encodeURIComponent(f.q)}&from=${encodeURIComponent(f.from)}&to=${encodeURIComponent(f.to)}` +
        `&order=${f.order}&page=${f.page}&page_size=${f.size}`;
      const d = await staffCall(() => api('/api/staff/reservations?' + q));
      if (!d) return;
      if (!d.reservations.length && d.total > 0 && f.page > 1) { f.page = d.pages; return loadReservations(); }
      currentRows = d.reservations;
      if (!currentRows.length) { box.innerHTML = '<div class="empty">No reservations match this filter.</div>'; pager.innerHTML = ''; return; }
      const isManager = state.user.role === 'Manager';
      box.innerHTML = `<div class="table-wrap"><table><caption class="sr">Reservations</caption>
        <thead><tr><th class="num">No.</th><th>Guest</th><th>Room</th><th>Stay</th><th>Status</th><th class="num">Paid</th><th>Actions</th></tr></thead><tbody>
        ${currentRows.map(r => {
          let actions = '';
          if (r.status === 'Confirmed') {
            actions = `<div class="rowactions"><button class="btn small secondary" data-act="modify" data-id="${r.reservation_id}">Change dates</button>
                 <button class="btn small danger" data-act="cancel" data-id="${r.reservation_id}">Cancel</button></div>`;
          }
          return `<tr><td class="num">${r.reservation_id}</td>
            <td>${esc(r.full_name)}<div class="sub">${esc(r.email)}</div></td>
            <td>${esc(r.room_number)}<div class="sub">${esc(r.type_name)}</div></td>
            <td>${fmtDate(r.check_in)} to ${fmtDate(r.check_out)}<div class="sub">${plural(r.nights, 'night')}</div></td>
            <td><span class="chip ${esc(r.status)}">${esc(r.status)}</span></td>
            <td class="num">${money(r.paid)}<div class="sub">of ${money(r.total_price)}</div></td><td>${actions}</td></tr>`;
        }).join('')}</tbody></table></div>`;
      const from = (d.page - 1) * d.page_size + 1, to = from + currentRows.length - 1;
      const n = v => Number(v).toLocaleString(locale());
      pager.innerHTML = `<button class="btn small secondary" type="button" data-page="first" data-last="${d.pages}"${d.page <= 1 ? ' disabled' : ''}>First</button>
        <button class="btn small secondary" type="button" data-page="prev" data-last="${d.pages}"${d.page <= 1 ? ' disabled' : ''}>Previous</button>
        <span>Page ${n(d.page)} of ${n(d.pages)}</span>
        <button class="btn small secondary" type="button" data-page="next" data-last="${d.pages}"${d.page >= d.pages ? ' disabled' : ''}>Next</button>
        <button class="btn small secondary" type="button" data-page="last" data-last="${d.pages}"${d.page >= d.pages ? ' disabled' : ''}>Last</button>
        <span class="meta" id="range">Showing ${n(from)} to ${n(to)} of ${n(d.total)} reservations</span>`;
    } catch (err) {
      box.innerHTML = alertHtml(err.message);
    }
  }

  async function onReservationAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const r = currentRows.find(x => String(x.reservation_id) === btn.dataset.id);
    if (!r) return;
    if (btn.dataset.act === 'cancel') await cancelFlow(r); else modifyFlow(r);
  }

  async function cancelFlow(r) {
    const pct = r.refund_percent == null ? 100 : r.refund_percent;
    const days = r.days_left == null ? Math.ceil(r.hours_until_checkin / 24) : r.days_left;
    const estimate = Number(r.paid) * pct / 100;
    const answer = await confirmDialog({ title: `Cancel reservation #${r.reservation_id}?`,
      message: `${r.full_name}. ${days} day(s) until check-in. Automatic refund: ${pct}% (${money(estimate)} of ${money(r.paid)}).`,
      confirm: 'Cancel reservation', danger: true });
    if (!answer.ok) return;
    try {
      const res = await staffCall(() => api(`/api/staff/reservations/${r.reservation_id}/cancel`, { method: 'POST', body: {} }));
      if (!res) return;
      toast(`Reservation #${r.reservation_id} cancelled. Refunded ${money(res.refunded)} (${res.refund_percent}%).`);
      loadReservations();
    } catch (err) { toast(err.message, 'error'); }
  }

  function modifyFlow(r) {
    openDialog(`Change dates for #${r.reservation_id}`, `
      <div class="summary"><dl><dt>Guest</dt><dd>${esc(r.full_name)}</dd><dt>Room</dt><dd>${esc(r.room_number)}, ${esc(r.type_name)}</dd>
        <dt>Now</dt><dd>${fmtDate(r.check_in)} to ${fmtDate(r.check_out)}</dd></dl></div>
      <div id="mod-error"></div>
      <form id="mod-form" class="form-grid" novalidate>
        <div class="row2">
          <label class="field"><span>New check-in</span><input type="date" name="ci" value="${esc(r.check_in)}" required></label>
          <label class="field"><span>New check-out</span><input type="date" name="co" value="${esc(r.check_out)}" required></label>
        </div>
        <p class="meta">If the price changes, the difference is charged or refunded to the guest.</p>
        <div class="actions"><button class="btn" type="submit">Save changes</button><button class="btn secondary" type="button" data-close>Back</button></div>
      </form>`);
    $('#mod-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      $('#mod-error').innerHTML = '';
      try {
        const res = await staffCall(() => api(`/api/staff/reservations/${r.reservation_id}/modify`, { method: 'POST', body: { check_in: f.elements.ci.value, check_out: f.elements.co.value } }));
        if (!res) return;
        dlg.close();
        const diff = res.difference;
        toast(`Dates changed. ${diff > 0 ? 'Extra payment ' + money(diff) : diff < 0 ? 'Refund ' + money(-diff) : 'No price change'}.`);
        loadReservations();
      } catch (err) { $('#mod-error').innerHTML = alertHtml(err.message); }
    });
  }

  // ---- outbox
  async function panelOutbox() {
    const panel = $('#panel');
    panel.innerHTML = '<div class="empty">Loading emails...</div>';
    try {
      const d = await staffCall(() => api('/api/staff/emails'));
      if (!d) return;
      if (!d.emails.length) { panel.innerHTML = '<div class="empty">No emails yet. A confirmation email appears here after each booking.</div>'; return; }
      panel.innerHTML = `<p class="meta">Every booking creates a confirmation email. It is sent right after the booking is saved. Without an SMTP server, sending is simulated and the text is kept here.</p>
        <div class="table-wrap"><table><thead><tr><th>Created</th><th>To</th><th>Subject</th><th>Status</th><th>Channel</th><th></th></tr></thead><tbody>
        ${d.emails.map(m => `<tr><td>${esc(m.created_at)}</td><td>${esc(m.to_email)}</td>
          <td><details><summary>${esc(m.subject)}</summary><pre class="mail">${esc(m.body)}</pre></details></td>
          <td><span class="chip ${esc(m.status)}">${esc(m.status)}</span></td><td>${esc(m.channel || '')}</td>
          <td><button class="btn small secondary" type="button" data-resend="${esc(m.email_id)}">Send again</button></td></tr>`).join('')}</tbody></table></div>`;
      panel.addEventListener('click', async e => {
        const btn = e.target.closest('[data-resend]');
        if (!btn) return;
        btn.disabled = true;
        try {
          const r = await staffCall(() => api(`/api/staff/emails/${btn.dataset.resend}/resend`, { method: 'POST', body: {} }));
          if (!r) return;
          toast(r.status === 'Sent' ? `Email sent again to ${r.to}.` : `The email to ${r.to} could not be sent.`, r.status === 'Sent' ? '' : 'error');
          panelOutbox();
        } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
      });
    } catch (err) { panel.innerHTML = alertHtml(err.message); }
  }

  // ---- dashboard
  function hBars(items, labelKey, valueKey, fmt, label, alt) {
    const max = Math.max(1, ...items.map(i => i[valueKey])), rowH = 34, left = 92, barMax = 290;
    const rows = items.map((it, i) => {
      const w = Math.round(it[valueKey] / max * barMax), y = i * rowH + 6;
      return `<text x="0" y="${y + 16}">${esc(it[labelKey])}</text><rect class="bar${alt ? ' alt' : ''}" x="${left}" y="${y}" width="${w}" height="22"></rect>
        <text class="muted" x="${left + w + 6}" y="${y + 16}">${esc(fmt(it[valueKey]))}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 520 ${items.length * rowH + 8}" role="img" aria-label="${esc(label)}">${rows}</svg>`;
  }

  function dailyBars(days) {
    const max = Math.max(1, ...days.map(d => d.revenue)), h = 150, bw = 26, gap = 10;
    const bars = days.map((d, i) => {
      const bh = Math.round(Math.max(0, d.revenue) / max * h), x = i * (bw + gap) + 4;
      return `<rect class="bar" x="${x}" y="${h - bh + 8}" width="${bw}" height="${bh}"><title>${esc(d.date)}: ${esc(money(d.revenue))}</title></rect>
        <text class="muted" x="${x + bw / 2}" y="${h + 26}" text-anchor="middle">${esc(d.date.slice(8))}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${days.length * (bw + gap) + 4} ${h + 34}" role="img" aria-label="Net revenue per day"><line class="axis" x1="0" x2="100%" y1="${h + 8}" y2="${h + 8}"></line>${bars}</svg>`;
  }

  async function panelCalendar() {
    const panel = $('#panel');
    const today = new Date();
    const fromStr = state.cal.from || iso(today);
    const toStr = state.cal.to || iso(addDays(today, 14));
    panel.innerHTML = `
      <form class="toolbar" id="cal-filter">
        <label class="field"><span>From</span><input type="date" name="from" value="${fromStr}"></label>
        <label class="field"><span>To</span><input type="date" name="to" value="${toStr}"></label>
        <button class="btn" type="submit">Show</button>
      </form>
      <div id="cal-content"><div class="empty">Loading calendar...</div></div>`;
    $('#cal-filter').addEventListener('submit', e => {
      e.preventDefault();
      state.cal = { from: e.target.elements.from.value, to: e.target.elements.to.value };
      panelCalendar();
    });
    try {
      const d = await staffCall(() => api(`/api/staff/calendar?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`));
      if (!d) return;
      const days = [];
      let dt = new Date(fromStr + 'T00:00:00');
      const endDt = new Date(toStr + 'T00:00:00');
      while (dt < endDt) { days.push(iso(dt)); dt.setDate(dt.getDate() + 1); }

      let guestsHtml = `<div class="panel gap"><h3>Guests per night</h3><div class="guests-bar-grid">`;
      d.daily_guests.forEach(dg => {
        guestsHtml += `<div class="guest-day-item"><span class="g-count">${dg.guests}</span><span class="g-date">${esc(dg.date.slice(5))}</span></div>`;
      });
      guestsHtml += `</div></div>`;

      let gridHtml = `<div class="table-wrap"><table class="calendar-table"><thead><tr><th>Room</th><th>Type</th>`;
      days.forEach(day => { gridHtml += `<th>${esc(day.slice(8))}</th>`; });
      gridHtml += `</tr></thead><tbody>`;
      d.rooms.forEach(room => {
        gridHtml += `<tr><td><b>${esc(room.room_number)}</b></td><td><small>${esc(room.type_name)}</small></td>`;
        days.forEach(day => {
          const booked = d.reservations.find(r => r.room_id === room.room_id && r.check_in <= day && r.check_out > day);
          gridHtml += booked
            ? `<td class="cell-booked" title="${esc(booked.full_name)} (#${esc(booked.reservation_id)})">&#9679;</td>`
            : `<td class="cell-free" title="Free"></td>`;
        });
        gridHtml += `</tr>`;
      });
      gridHtml += `</tbody></table></div>`;
      $('#cal-content').innerHTML = guestsHtml + gridHtml;
    } catch (err) {
      $('#cal-content').innerHTML = alertHtml(err.message);
    }
  }

  async function panelDashboard() {
    const panel = $('#panel'), f = state.dash;
    panel.innerHTML = '<div class="empty">Loading dashboard...</div>';
    try {
      const qs = new URLSearchParams();
      if (f.from) qs.set('from', f.from);
      if (f.to) qs.set('to', f.to);
      const [d, a] = await Promise.all([staffCall(() => api('/api/manager/dashboard' + (qs.toString() ? '?' + qs : ''))), staffCall(() => api('/api/manager/audit'))]);
      if (!d || !a) return;
      const p = d.period, first = d.first_reservation_date;
      const days = d.daily_revenue.length;
      panel.innerHTML = `
        <form class="toolbar" id="dash-filter">
          <label class="field"><span>From</span><input type="date" name="from" value="${esc(f.from)}"${first ? ` min="${esc(first)}"` : ''}></label>
          <label class="field"><span>To</span><input type="date" name="to" value="${esc(f.to)}"${first ? ` min="${esc(first)}"` : ''}></label>
          <button class="btn" type="submit">Apply</button>
          <button class="btn secondary" type="button" id="dash-since-first">Since first reservation</button>
          <button class="btn secondary" type="button" id="dash-reset">All time</button>
        </form>
        <p class="meta" id="dash-period">First reservation: ${first ? esc(fmtDate(first)) + ' (check-in date)' : 'none yet'}.
          Showing: ${p.filtered ? esc(fmtDate(p.from)) + ' to ' + esc(fmtDate(p.to)) : 'all time, occupancy for the next 30 days'}.
          Reservations count by check-in date, revenue by payment date.</p>
        <p class="meta" id="dash-status">${plural(Object.values(d.status_counts).reduce((x, y) => x + y, 0), 'reservation')} in this view:
          ${['Completed', 'Confirmed', 'Cancelled'].map(k => `${esc(d.status_counts[k] || 0)} ${k}`).join(', ')}.
          A reservation is Confirmed until its stay ends, then it becomes Completed. Net revenue includes both Completed and Confirmed reservations (paid minus refunded).</p>
        <div class="kpis">
          <div class="kpi"><b>${esc(d.occupancy)}%</b><span>${p.filtered ? 'Occupancy in the period' : 'Occupancy, next 30 days'}</span></div>
          <div class="kpi"><b>${esc(money(d.revenue_net))}</b><span>Net revenue (paid minus refunded)</span></div>
          <div class="kpi"><b>${esc(d.upcoming_bookings)}</b><span>Confirmed bookings (stay not finished yet)</span></div>
          <div class="kpi"><b>${esc(d.cancellation_rate)}%</b><span>Cancellation rate</span></div>
          <div class="kpi"><b>${esc(d.double_bookings_blocked)}</b><span>Double bookings blocked</span></div>
        </div>
        <div class="grid2">
          <div class="panel"><h3>Net revenue by room type</h3>${hBars(d.revenue_by_type, 'type_name', 'revenue', money, 'Net revenue by room type', false)}</div>
          <div class="panel"><h3>Most booked room types</h3>${hBars(d.most_booked_types, 'type_name', 'reservations', n => String(n), 'Reservations by room type', true)}</div>
        </div>
        <div class="panel"><h3>Add-on revenue by category</h3>${d.addon_revenue_by_type && d.addon_revenue_by_type.length ? hBars(d.addon_revenue_by_type, 'category', 'revenue', money, 'Add-on revenue', true) : '<p class="meta">No add-on sales in this period.</p>'}</div>
        <div class="panel gap"><h3>Net revenue per day, ${days === 14 ? 'last 14 days' : 'last ' + plural(days, 'day')}${p.filtered ? ' of the period up to today' : ''} (day of month)</h3>${dailyBars(d.daily_revenue)}</div>
        <div class="panel gap"><h3>Arrivals in the next 7 days</h3>
          ${d.arrivals_next_7_days.length ? `<div class="table-wrap"><table><thead><tr><th class="num">No.</th><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th></tr></thead><tbody>
          ${d.arrivals_next_7_days.map(x => `<tr><td class="num">${x.reservation_id}</td><td>${esc(x.full_name)}</td><td>${esc(x.room_number)} (${esc(x.type_name)})</td><td>${fmtDate(x.check_in)}</td><td>${fmtDate(x.check_out)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="meta">No arrivals in the next 7 days.</p>'}</div>
        <div class="panel"><h3>Recent activity</h3>
          ${a.audit.length ? `<div class="table-wrap"><table><thead><tr><th>Time (UTC)</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
          ${a.audit.map(x => `<tr><td>${esc(x.ts)}</td><td>${esc(x.actor)}</td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="meta">Nothing recorded yet.</p>'}</div>`;
      $('#dash-filter').addEventListener('submit', e => {
        e.preventDefault();
        const from = e.target.elements.from.value, to = e.target.elements.to.value;
        if (from && to && to < from) { toast('The end date must not be before the start date.', 'error'); return; }
        state.dash = { from, to };
        panelDashboard();
      });
      $('#dash-since-first').addEventListener('click', () => {
        state.dash = { from: first || '', to: '' };      // empty end = until the last booked day, upcoming bookings included
        panelDashboard();
      });
      $('#dash-reset').addEventListener('click', () => { state.dash = { from: '', to: '' }; panelDashboard(); });
    } catch (err) { panel.innerHTML = alertHtml(err.message); }
  }


  // ---- stay actions shared by the floor map, the check-in tab and the housekeeping board
  const HK_NEXT = { Dirty: ['Clean', 'Mark clean'], Clean: ['Inspected', 'Mark inspected'] };
  async function hkSet(roomId, status) {
    const res = await staffCall(() => api(`/api/staff/rooms/${roomId}/housekeeping`, { method: 'POST', body: { status } }));
    if (res) toast(`Room ${res.room_number} is now ${res.new}.`);
    return res;
  }
  const hkChip = h => `<span class="chip hk-${esc(h)}">${esc(h)}</span>`;

  function stayCardHtml(d) {
    const note = d.checked_out_at ? `Checked out ${esc(d.checked_out_at.slice(0, 16))}.`
      : d.checked_in_at ? `Checked in ${esc(d.checked_in_at.slice(0, 16))}.` : esc(d.check_in_blocked || 'Ready for check-in.');
    return `<div class="panel stack" id="stay-card" data-id="${esc(d.reservation_id)}"><h3>Reservation #${esc(d.reservation_id)} <span class="chip ${esc(d.status)}">${esc(d.status)}</span></h3>
      <div class="summary"><dl>
        <dt>Guest</dt><dd>${esc(d.full_name)}</dd>
        <dt>Room</dt><dd>${esc(d.room_number)}, ${esc(d.type_name)} ${hkChip(d.housekeeping)}</dd>
        <dt>Stay</dt><dd>${fmtDate(d.check_in)} to ${fmtDate(d.check_out)} (${plural(d.nights, 'night')})</dd>
        <dt>Status</dt><dd>${note}</dd></dl></div>
      ${d.can_check_in && !d.room_ready ? `<div class="notice">Room ${esc(d.room_number)} is still dirty. Check-in is possible, but tell housekeeping first.</div>` : ''}
      <div class="actions">${d.can_check_in ? '<button class="btn" type="button" data-stay="check-in">Check in</button>' : ''}
        ${d.can_check_out ? '<button class="btn secondary" type="button" data-stay="check-out">Check out (room becomes dirty)</button>' : ''}</div></div>`;
  }
  async function stayAction(root, id, action, code, done) {
    try {
      const res = await staffCall(() => api(`/api/staff/reservations/${id}/${action}`, { method: 'POST', body: code ? { code } : {} }));
      if (!res) return;
      toast(action === 'check-in' ? `Checked in ${res.full_name}.` : `Checked out. Room ${res.room_number} is now dirty.`);
      if (res.warning) toast(res.warning, 'error');
      done(res);
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---- floor map
  async function panelFloor(day) {
    const panel = $('#panel');
    day = day || state.floorDay || iso(new Date());
    state.floorDay = day;
    panel.innerHTML = '<div class="empty">Loading floor map...</div>';
    try {
      const d = await staffCall(() => api(`/api/staff/floor-map?date=${encodeURIComponent(day)}`));
      if (!d) return;
      const L = { free: 'Free', arriving: 'Arriving', occupied: 'Occupied', departing: 'Departing', maintenance: 'Maintenance' };
      const tile = r => `<button type="button" class="fm-tile fm-${esc(r.state)}${r.dirty ? ' fm-dirty' : ''}${r.turnover ? ' fm-turn' : ''}" data-room="${esc(r.room_id)}"
        title="${esc(r.room_number)} ${esc(r.type_name)}: ${esc(L[r.state])}${r.stay ? ', ' + esc(r.stay.full_name) : ''}${r.dirty ? ', dirty' : ''}"
        aria-label="Room ${esc(r.room_number)}, ${esc(r.type_name)}, ${esc(L[r.state])}${r.dirty ? ', dirty' : ''}"><b>${esc(r.room_number)}${r.maintenance_ticket ? ' 🔧' : ''}</b><small>${esc(r.type_name.slice(0, 3))}</small></button>`;
      panel.innerHTML = `<form class="toolbar" id="fm-form">
          <button class="btn small secondary" type="button" data-shift="-1" aria-label="Previous day">&larr;</button>
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(d.date)}"></label>
          <button class="btn small secondary" type="button" data-shift="1" aria-label="Next day">&rarr;</button>
          <button class="btn small" type="button" data-shift="0">Today</button></form>
        <div class="fm-legend" role="list">${Object.keys(L).map(k => `<span role="listitem"><i class="fm-key fm-${k}"></i>${L[k]} <b>${d.counts[k]}</b></span>`).join('')}
          ${d.is_today ? `<span role="listitem"><i class="fm-key fm-dirty-key"></i>Dirty <b>${d.counts.dirty}</b></span>` : ''}</div>
        <div class="fm-building">${d.floors.map(f => `<div class="fm-floor"><div class="fm-label">Floor ${esc(f.floor)}</div><div class="fm-rooms">${f.rooms.map(tile).join('')}</div></div>`).join('')}</div>`;
      const rooms = {};
      d.floors.forEach(f => f.rooms.forEach(r => { rooms[r.room_id] = r; }));
      $('#fm-form').addEventListener('change', e => panelFloor(e.target.value));
      $('#fm-form').addEventListener('click', e => {
        const b = e.target.closest('[data-shift]');
        if (!b) return;
        const n = Number(b.dataset.shift);
        panelFloor(n === 0 ? iso(new Date()) : iso(addDays(new Date(d.date + 'T00:00:00'), n)));
      });
      panel.querySelector('.fm-building').addEventListener('click', e => {
        const b = e.target.closest('[data-room]');
        if (b) openRoomDialog(rooms[b.dataset.room], d);
      });
    } catch (err) { panel.innerHTML = alertHtml(err.message); }
  }

  function openRoomDialog(r, map) {
    const stayLine = (label, s) => s ? `<dt>${label}</dt><dd>${esc(s.full_name)}, ${fmtDate(s.check_in)} to ${fmtDate(s.check_out)} (#${esc(s.reservation_id)})${s.checked_in_at ? ' <span class="chip Confirmed">in house</span>' : ''}</dd>` : '';
    const L = { free: 'Free', arriving: 'Arriving', occupied: 'Occupied', departing: 'Departing', maintenance: 'Under maintenance' };
    const hk = map.is_today && r.housekeeping ? `<dt>Housekeeping</dt><dd>${hkChip(r.housekeeping)}</dd>` : '';
    const body = openDialog(`Room ${r.room_number}, ${r.type_name}`, `<div class="summary"><dl>
        <dt>${esc(fmtDate(map.date))}</dt><dd><b>${esc(L[r.state])}</b>${r.turnover ? ' (guest leaves, another arrives)' : ''}</dd>
        ${stayLine(r.state === 'departing' ? 'Leaving' : 'Guest', r.stay)}${stayLine('Next guest', r.next)}${hk}</dl></div>
      <div class="actions" id="room-actions"></div>`);
    const box = $('#room-actions', body);
    const buttons = [];
    if (map.is_today && r.stay && r.stay.status === 'Confirmed' && !r.stay.checked_in_at && r.stay.check_in <= map.date && r.state !== 'departing') buttons.push(['check-in', 'Check in', r.stay.reservation_id]);
    if (map.is_today && r.stay && r.stay.checked_in_at && !r.stay.checked_out_at) buttons.push(['check-out', 'Check out', r.stay.reservation_id]);
    if (map.is_today && HK_NEXT[r.housekeeping]) buttons.push(['hk', HK_NEXT[r.housekeeping][1], HK_NEXT[r.housekeeping][0]]);
    if (map.is_today && r.housekeeping && r.housekeeping !== 'Dirty') buttons.push(['hk-dirty', 'Report dirty', 'Dirty']);
    box.innerHTML = buttons.map((b, i) => `<button class="btn small${i ? ' secondary' : ''}" type="button" data-i="${i}">${esc(b[1])}</button>`).join('') + '<button class="btn small secondary" type="button" data-close>Close</button>';
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const [kind, , arg] = buttons[Number(b.dataset.i)];
      if (kind === 'check-in' || kind === 'check-out') await stayAction(box, arg, kind, null, () => { dlg.close(); panelFloor(map.date); });
      else if (await hkSet(r.room_id, arg)) { dlg.close(); panelFloor(map.date); }
    });
  }

  // ---- housekeeping board
  async function panelHousekeeping() {
    const panel = $('#panel');
    panel.innerHTML = '<div class="empty">Loading housekeeping board...</div>';
    try {
      const d = await staffCall(() => api('/api/staff/housekeeping'));
      if (!d) return;
      const s = d.summary;
      const row = r => {
        const next = HK_NEXT[r.housekeeping];
        const note = r.priority ? `<b class="hot">Guest ${esc(r.arriving_guest)} arrives today. Ready by 14:00.</b>`
          : r.arriving_today ? `Arrival today: ${esc(r.arriving_guest)}` : r.departing_today ? 'Guest leaves today (12:00)' : '';
        return `<tr><td><b>${esc(r.room_number)}</b></td><td class="num">${esc(r.floor)}</td><td>${esc(r.type_name)}</td><td>${hkChip(r.housekeeping)}</td><td>${note}</td>
          <td>${next ? `<button class="btn small" type="button" data-room="${esc(r.room_id)}" data-to="${esc(next[0])}">${esc(next[1])}</button>` : ''}</td></tr>`;
      };
      const group = (title, list, hint) => list.length ? `<h3>${title} <span class="meta">(${list.length})</span></h3>${hint ? `<p class="meta">${hint}</p>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Room</th><th class="num">Floor</th><th>Type</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : '';
      const priority = d.rooms.filter(r => r.priority);
      const dirty = d.rooms.filter(r => !r.priority && r.housekeeping === 'Dirty');
      const toInspect = d.rooms.filter(r => !r.priority && r.housekeeping === 'Clean');
      const leaving = d.rooms.filter(r => r.departing_today && r.housekeeping === 'Inspected');
      panel.innerHTML = `<p class="meta">A room becomes <b>Dirty</b> when the guest checks out (or at 12:00 on the check-out day). Then: clean, then inspect. Today is ${esc(fmtDate(d.date))}.</p>
        <div class="kpis"><div class="kpi"><b>${s.priority}</b><span>Priority (arrival today)</span></div><div class="kpi"><b>${s.Dirty}</b><span>To clean</span></div>
          <div class="kpi"><b>${s.Clean}</b><span>To inspect</span></div><div class="kpi"><b>${s.Inspected}</b><span>Ready</span></div>
          <div class="kpi"><b>${s.departing_today}</b><span>Leaving today</span></div></div>
        ${d.rooms.length ? group('Priority: guest arrives today', priority, 'Clean these first.') + group('To clean', dirty) + group('To inspect', toInspect) + group('Leaving today (will become dirty)', leaving)
          : '<div class="okbox">Nothing to clean right now. Every room is inspected and ready.</div>'}`;
      panel.onclick = async e => {
        const b = e.target.closest('[data-to]');
        if (!b) return;
        b.disabled = true;
        try { if (await hkSet(b.dataset.room, b.dataset.to)) panelHousekeeping(); else b.disabled = false; } catch (err) { b.disabled = false; toast(err.message, 'error'); }
      };
    } catch (err) { panel.innerHTML = alertHtml(err.message); }
  }

  // ---- check-in with QR pass (camera scanner works without BarcodeDetector)
  async function panelCheckin() {
    const panel = $('#panel');
    panel.innerHTML = `<p class="meta">Scan the guest's QR pass with a barcode scanner, use the camera, or type the pass code or reservation number.</p>
      <form class="toolbar" id="pass-form" novalidate><label class="field"><span>Pass code / reservation number</span><input name="code" id="pass-code" placeholder="HB123-A1B2C3 or 123" autocomplete="off" autofocus></label>
        <button class="btn" type="submit">Find</button>
        <button class="btn secondary" type="button" id="scan-cam">Scan with camera</button></form>
      <div id="scan-reader" class="scan-video" hidden></div><div id="pass-result"></div>`;
    const result = $('#pass-result');
    let scanner = null, scanning = false;
    async function stopCam() {
      if (scanner && scanning) { try { await scanner.stop(); } catch (_) {} }
      if (scanner) { try { scanner.clear(); } catch (_) {} }
      scanner = null; scanning = false;
      const reader = $('#scan-reader'); if (reader) { reader.hidden = true; reader.innerHTML = ''; }
    }
    async function find(code) {
      code = code.trim();
      if (!code) return;
      result.innerHTML = '<div class="empty">Looking...</div>';
      try {
        const d = await staffCall(() => api(`/api/staff/passes/lookup?code=${encodeURIComponent(code)}`));
        if (!d) return;
        result.innerHTML = stayCardHtml(d);
        $('#stay-card').addEventListener('click', e => {
          const b = e.target.closest('[data-stay]');
          if (b) stayAction(result, d.reservation_id, b.dataset.stay, /^HB/i.test(code) ? code : null, () => find(String(d.reservation_id)));
        });
      } catch (err) { result.innerHTML = alertHtml(err.message); }
    }
    $('#pass-form').addEventListener('submit', e => { e.preventDefault(); find($('#pass-code').value); });
    $('#scan-cam').addEventListener('click', async () => {
      if (typeof Html5Qrcode === 'undefined') { toast('QR scanner library did not load. Check your internet connection, then refresh.', 'error'); return; }
      const reader = $('#scan-reader'); reader.hidden = false;
      try {
        scanner = new Html5Qrcode('scan-reader');
        scanning = true;
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async decodedText => {
          $('#pass-code').value = decodedText;
          await stopCam();
          find(decodedText);
        }, () => {});
      } catch (err) {
        scanning = false; reader.hidden = true;
        toast('Could not open the camera. Allow camera access and use localhost or HTTPS.', 'error');
      }
    });
    window.addEventListener('hashchange', stopCam, { once: true });
  }

  // ---- price suggestions (manager, shown on the Prices tab)
  async function suggestionsHtml() {
    const d = await staffCall(() => api('/api/manager/price-suggestions'));
    if (!d) return '';
    const card = x => `<div class="panel sugg sugg-${esc(x.action)}"><h3>${esc(x.type_name)} <span class="chip ${x.action === 'raise' ? 'Pending' : x.action === 'lower' ? 'Cancelled' : 'Completed'}">${x.action === 'keep' ? 'Keep' : (x.change_percent > 0 ? '+' : '') + x.change_percent + '%'}</span></h3>
      <p>${esc(x.reason)}</p>
      <p class="meta">Full next weekend: ${Math.round(x.occupancy.weekend * 100)}%, next 7 days: ${Math.round(x.occupancy.next_7_days * 100)}%, next 30 days: ${Math.round(x.occupancy.next_30_days * 100)}%, last-year average: ${Math.round(x.occupancy.last_year_average * 100)}%.</p>
      ${x.action === 'keep' ? '' : `<button class="btn small" type="button" data-apply="${esc(x.room_type_id)}" data-name="${esc(x.type_name)}" data-old="${esc(x.current_price)}" data-new="${esc(x.suggested_price)}">Apply: ${esc(money(x.current_price))} to ${esc(money(x.suggested_price))}</button>`}</div>`;
    return `<h2>Price suggestions</h2><p class="meta">Rule-based hints from bookings for the weekend ${esc(fmtDate(d.weekend[0]))} to ${esc(fmtDate(d.weekend[1]))}, the next 7 and 30 days. Nothing changes until you apply a suggestion.</p>
      <div class="grid2" id="sugg-grid">${d.suggestions.map(card).join('')}</div>
      <details class="gap"><summary>How are suggestions made?</summary><ul>${d.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details><h2>Change prices</h2>`;
  }

  // ---- prices (manager)
  async function panelPrices() {
    const panel = $('#panel');
    panel.innerHTML = '<div class="empty">Loading prices...</div>';
    try {
      const d = await staffCall(() => api('/api/manager/room-types'));
      if (!d) return;
      let sugg = '';
      try { sugg = await suggestionsHtml(); } catch (err) { sugg = ''; }
      panel.innerHTML = `${sugg}<p class="meta">Change the price per night of a room type. The new price is used for new bookings only.
        Confirmed, completed and cancelled reservations keep the price they were booked at, also when their dates are changed.</p>
        <div class="table-wrap"><table id="price-table"><caption class="sr">Room prices</caption>
        <thead><tr><th>Room type</th><th class="num">Rooms</th><th class="num">Sleeps</th><th class="num">Price per night</th><th>New price (KZT)</th></tr></thead><tbody>
        ${d.room_types.map(t => `<tr><td>${esc(t.type_name)}</td>
          <td class="num">${esc(t.rooms)}${t.in_maintenance ? `<div class="sub">${esc(t.in_maintenance)} under maintenance</div>` : ''}</td>
          <td class="num">${esc(t.capacity)}</td><td class="num">${esc(money(t.price_per_night))}</td>
          <td><form class="price-form" data-id="${esc(t.room_type_id)}" data-name="${esc(t.type_name)}" data-old="${esc(t.price_per_night)}" novalidate>
            <input type="number" name="price" min="1" max="10000000" step="1" value="${esc(t.price_per_night)}" aria-label="New price for ${esc(t.type_name)}" required>
            <button class="btn small" type="submit">Save</button></form></td></tr>`).join('')}</tbody></table></div>`;
      const grid = $('#sugg-grid');
      if (grid) grid.addEventListener('click', async e => {
        const b = e.target.closest('[data-apply]');
        if (!b) return;
        const { name, old, new: nw } = b.dataset;
        const answer = await confirmDialog({ title: `Apply the ${name} suggestion?`, message: `${name}: ${money(old)} to ${money(nw)} per night. New bookings use the new price. Existing reservations keep their price.`, confirm: 'Change price' });
        if (!answer.ok) return;
        try {
          const res = await staffCall(() => api(`/api/manager/room-types/${b.dataset.apply}/price`, { method: 'POST', body: { price: Number(nw) } }));
          if (!res) return;
          toast(`${res.type_name} now costs ${money(res.new_price)} per night.`);
          panelPrices();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#price-table').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, name = f.dataset.name, old = Number(f.dataset.old), price = Number(f.elements.price.value);
        if (!f.elements.price.value || !(price > 0)) { toast('Enter a price above 0.', 'error'); return; }
        if (price === old) { toast(`${name} already costs ${money(old)} per night.`); return; }
        const answer = await confirmDialog({ title: `Change the ${name} price?`,
          message: `${name}: ${money(old)} to ${money(price)} per night. New bookings use the new price. Existing reservations keep their price.`,
          confirm: 'Change price' });
        if (!answer.ok) return;
        try {
          const res = await staffCall(() => api(`/api/manager/room-types/${f.dataset.id}/price`, { method: 'POST', body: { price } }));
          if (!res) return;
          toast(`${res.type_name} now costs ${money(res.new_price)} per night.`);
          panelPrices();
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) { panel.innerHTML = alertHtml(err.message); }
  }

  // ---------------------------------------------------------------- start
  (async function init() {
    try {
      const me = await api('/api/auth/me');
      if (me.user) { state.user = me.user; state.csrf = me.csrf; }
    } catch (e) { /* the pages show their own errors */ }
    refreshAmbient();
    render();
  })();
})();
