(() => {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app'), nav = $('#nav'), dlg = $('#dlg'), toastEl = $('#toast');
  const state = { user: null, csrf: null, search: null, filter: { status: '', q: '', from: '', to: '', order: 'desc', size: 50, page: 1 }, dash: { from: '', to: '' }, cal: { from: '', to: '' }, refreshAfterClose: false };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' KZT';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const nightsBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
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

  function renderNav() {
    const active = route()[0];
    const link = (href, label, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
    nav.innerHTML = link('#/', 'Rooms', '') + link('#/manage', 'My booking', 'manage') + link('#/staff', 'Staff', 'staff') +
      (state.user ? `<span class="who">${esc(state.user.name)}, ${esc(roleLabel(state.user.role))}</span><button type="button" id="account">Account</button><button type="button" id="logout">Log out</button>` : '');
  }
  nav.addEventListener('click', async e => {
    if (e.target.id === 'account') { openPasswordDialog(); return; }
    if (e.target.id !== 'logout') return;
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (err) { /* ignore */ }
    state.user = null; state.csrf = null;
    toast('You are logged out.');
    if (route()[0] === 'staff') render(); else renderNav();
  });

  async function render(focus = false) {
    const [a, b] = route();
    renderNav();
    if (dlg.open) dlg.close();
    if (a === 'manage') viewManage();
    else if (a === 'staff') await viewStaff(b || 'reservations');
    else viewHome();
    if (focus) app.focus();
  }
  window.addEventListener('hashchange', () => render(true));

  // ---------------------------------------------------------------- guest: search and book
  function viewHome() {
    const s = state.search;
    const today = new Date();
    const ci = s ? s.ci : iso(addDays(today, 1));
    const co = s ? s.co : iso(addDays(today, 3));
    app.innerHTML = `
      <section class="hero">
        <h1>Which nights do you need?</h1>
        <p>Pick your dates and see the rooms that are free. Booking takes about a minute.</p>
        <form class="searchbar" id="search-form" novalidate>
          <label class="field"><span>Check-in</span><input type="date" id="ci" required value="${ci}" min="${iso(today)}"></label>
          <label class="field"><span>Check-out</span><input type="date" id="co" required value="${co}" min="${iso(addDays(today, 1))}"></label>
          <div class="nights" id="nights" aria-live="polite"></div>
          <button class="btn" type="submit">Search rooms</button>
        </form>
      </section>
      <div id="results"></div>`;
    const updateNights = () => {
      const a = $('#ci').value, b = $('#co').value;
      const n = a && b ? nightsBetween(a, b) : 0;
      $('#nights').textContent = n > 0 ? plural(n, 'night') : '';
    };
    $('#ci').addEventListener('input', updateNights);
    $('#co').addEventListener('input', updateNights);
    updateNights();
    $('#search-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
    $('#results').addEventListener('click', e => {
      const btn = e.target.closest('[data-book]');
      if (!btn || !state.search) return;
      const room = state.search.rooms.find(r => String(r.room_id) === btn.dataset.book);
      if (room) openBooking(room);
    });
    if (s) showResults();
  }

  async function doSearch() {
    const ci = $('#ci').value, co = $('#co').value, box = $('#results');
    if (!ci || !co) { box.innerHTML = alertHtml('Choose both dates.'); return; }
    box.innerHTML = '<div class="notice">Looking for free rooms...</div>';
    try {
      const d = await api(`/api/rooms/search?check_in=${encodeURIComponent(ci)}&check_out=${encodeURIComponent(co)}`);
      state.search = { ci: d.check_in, co: d.check_out, nights: d.nights, rooms: d.rooms };
      showResults();
    } catch (err) {
      state.search = null;
      box.innerHTML = alertHtml(err.message);
    }
  }

  function plaqueHtml(r, nights, free) {
    return `<li class="plaque">
      <div class="door"><b>${esc(r.room_number)}</b><span>Floor ${esc(r.floor)}</span></div>
      <div class="info"><h3>${esc(r.type_name)}</h3><div class="meta">Sleeps ${esc(r.capacity)}, ${plural(free, 'room')} free</div>
        <div class="price"><div><strong>${money(r.total_price)}</strong><br>
          <small>${plural(nights, 'night')}, ${money(r.price_per_night)} per night</small></div>
          <button class="btn" type="button" data-book="${esc(r.room_id)}">Book this room</button></div></div></li>`;
  }

  function showResults() {
    const s = state.search, box = $('#results');
    if (!s || !box) return;
    if (!s.rooms.length) {
      box.innerHTML = '<div class="notice"><b>No rooms are free for these dates.</b> Try other dates, or a shorter stay.</div>';
      return;
    }
    const groups = [];                    // one card per room type, showing one free room of that type
    for (const r of s.rooms) {
      const g = groups.find(x => x.room.type_name === r.type_name);
      if (g) g.free++; else groups.push({ room: r, free: 1 });
    }
    box.innerHTML = `<p class="meta count">${plural(s.rooms.length, 'room')} free from ${fmtDate(s.ci)} to ${fmtDate(s.co)}. Pick a room type; one free room of that type is shown.</p>
      <ul class="plaques">${groups.map(g => plaqueHtml(g.room, s.nights, g.free)).join('')}</ul>`;
  }

  let lastAlternatives = [];
  function alternativesHtml(list) {
    lastAlternatives = list || [];
    if (!lastAlternatives.length) return '';
    return `<div class="notice"><b>These rooms are free for the same dates:</b><ul>${lastAlternatives.map(r =>
      `<li><button type="button" class="link" data-alt="${esc(r.room_id)}">Room ${esc(r.room_number)}, ${esc(r.type_name)}, ${money(r.total_price)}</button></li>`).join('')}</ul></div>`;
  }

  function openBooking(room) {
    const s = state.search;
    openDialog(`Book room ${room.room_number}`, `
      <div class="summary"><dl>
        <dt>Room</dt><dd>${esc(room.room_number)}, ${esc(room.type_name)}</dd>
        <dt>Stay</dt><dd>${fmtDate(s.ci)} to ${fmtDate(s.co)}</dd>
        <dt>Nights</dt><dd>${s.nights}</dd>
        <dt>Total</dt><dd>${money(room.total_price)}</dd></dl></div>
      <div id="book-error"></div>
      <form id="book-form" class="form-grid" novalidate>
        <label class="field"><span>Full name</span><input name="full_name" autocomplete="name" required maxlength="100"></label>
        <div class="row2">
          <label class="field"><span>Phone</span><input name="phone" type="tel" autocomplete="tel" required maxlength="20"></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="100"></label>
        </div>
        <label class="field"><span>Payment method</span><select name="method"><option>Card</option><option>Cash</option><option>Transfer</option></select></label>
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
        room_id: room.room_id, check_in: state.search.ci, check_out: state.search.co,
        full_name: f.elements.full_name.value, phone: f.elements.phone.value, email: f.elements.email.value,
        method: f.elements.method.value, simulate_payment_failure: f.elements.simulate.checked } });
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
      <p class="bignum" aria-label="Reservation number ${esc(d.reservation_id)}">#${esc(d.reservation_id)}</p>
      <p>Keep this reservation number. You need it with your email to manage the booking.</p>
      <div class="summary"><dl>
        <dt>Room</dt><dd>${esc(d.room_number)}, ${esc(d.type_name)}</dd>
        <dt>Stay</dt><dd>${fmtDate(d.check_in)} to ${fmtDate(d.check_out)} (${plural(d.nights, 'night')})</dd>
        <dt>Paid</dt><dd>${money(d.total_price)}</dd></dl></div>
      <p>${esc(mailText)}</p>
      <p class="meta">Free cancellation until 24 hours before check-in (14:00).</p>
      <div class="actions"><a class="btn" href="#/manage">Manage this booking</a>
        <button class="btn secondary" type="button" data-close>Close</button></div>`);
  }

  // ---------------------------------------------------------------- guest: manage a booking
  function viewManage() {
    app.innerHTML = `
      <section class="hero">
        <h1>Manage your booking</h1>
        <p>Enter the reservation number from your confirmation and the email you booked with.</p>
        <form class="searchbar" id="find-form" novalidate>
          <label class="field"><span>Reservation number</span><input name="rid" inputmode="numeric" required autocomplete="off"></label>
          <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
          <button class="btn" type="submit">Find booking</button>
        </form>
      </section>
      <div id="booking"></div>`;
    $('#find-form').addEventListener('submit', e => {
      e.preventDefault();
      findBooking(e.target.elements.rid.value, e.target.elements.email.value);
    });
  }

  async function findBooking(rid, email, message = '') {
    const box = $('#booking');
    box.innerHTML = '<div class="notice">Looking for your booking...</div>';
    try {
      const d = await api('/api/bookings/lookup', { method: 'POST', body: { reservation_id: rid, email } });
      let action = '';
      if (d.status === 'Confirmed' && d.free_cancellation) {
        action = `<p>You can cancel free of charge until 24 hours before check-in. You will be refunded ${money(d.paid)}.</p>
          <button class="btn danger" type="button" id="guest-cancel">Cancel booking</button>`;
      } else if (d.status === 'Confirmed') {
        action = '<div class="notice">Check-in is less than 24 hours away, so online cancellation is closed. Please call the front desk.</div>';
      }
      box.innerHTML = `${message ? `<div class="okbox" role="status">${esc(message)}</div>` : ''}
        <div class="panel stack"><h2>Reservation #${esc(d.reservation_id)} <span class="chip ${esc(d.status)}">${esc(d.status)}</span></h2>
        <div class="summary"><dl>
          <dt>Guest</dt><dd>${esc(d.full_name)}</dd>
          <dt>Room</dt><dd>${esc(d.room_number)}, ${esc(d.type_name)}</dd>
          <dt>Stay</dt><dd>${fmtDate(d.check_in)} to ${fmtDate(d.check_out)} (${plural(d.nights, 'night')})</dd>
          <dt>Price</dt><dd>${money(d.total_price)}</dd>
          <dt>Paid</dt><dd>${money(d.paid)}</dd></dl></div>${action}</div>`;
      const cancel = $('#guest-cancel');
      if (cancel) cancel.addEventListener('click', async () => {
        const r = await confirmDialog({ title: `Cancel reservation #${d.reservation_id}?`, message: `Your stay on ${fmtDate(d.check_in)} will be cancelled and ${money(d.paid)} refunded.`, confirm: 'Cancel booking', danger: true });
        if (!r.ok) return;
        try {
          const res = await api('/api/bookings/cancel', { method: 'POST', body: { reservation_id: rid, email } });
          await findBooking(rid, email, `Booking cancelled. Refund: ${money(res.refunded)}.`);
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) {
      box.innerHTML = alertHtml(err.message);
    }
  }

  // ---------------------------------------------------------------- staff area
  async function viewStaff(sub) {
    if (!state.user) return viewLogin();
    const manager = state.user.role === 'Manager';
    if ((sub === 'dashboard' || sub === 'prices') && !manager) sub = 'reservations';
    if (!['reservations', 'calendar', 'outbox', 'dashboard', 'prices'].includes(sub)) sub = 'reservations';
    const tab = (key, label) => `<a href="#/staff/${key}"${sub === key ? ' aria-current="page"' : ''}>${label}</a>`;
    app.innerHTML = `<h1>Staff area</h1>
      ${state.user.default_password ? '<div class="notice" role="alert"><b>You are using the demo password.</b> Anyone who has read the README can log in as you. <button type="button" class="link" id="change-now">Change it now</button></div>' : ''}
      <nav class="tabs" aria-label="Staff sections">${tab('reservations', 'Reservations')}${tab('calendar', 'Calendar')}${tab('outbox', 'Email outbox')}${manager ? tab('dashboard', 'Dashboard') + tab('prices', 'Prices') : ''}</nav>
      <div id="panel"></div>`;
    const changeNow = $('#change-now');
    if (changeNow) changeNow.addEventListener('click', openPasswordDialog);
    if (sub === 'reservations') await panelReservations();
    else if (sub === 'calendar') await panelCalendar();
    else if (sub === 'outbox') await panelOutbox();
    else if (sub === 'prices') await panelPrices();
    else await panelDashboard();
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

  function viewLogin() {
    app.innerHTML = `<section class="hero login"><h1>Staff log in</h1>
      <p>Front desk and manager accounts only.</p>
      <div id="login-error"></div>
      <form class="form-grid" id="login-form" novalidate>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div class="actions"><button class="btn" type="submit">Log in</button></div>
      </form></section>`;
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
            actions = (r.free_cancellation || isManager)
              ? `<div class="rowactions"><button class="btn small secondary" data-act="modify" data-id="${r.reservation_id}">Change dates</button>
                 <button class="btn small danger" data-act="cancel" data-id="${r.reservation_id}">Cancel</button></div>`
              : '<button class="btn small secondary" disabled title="Less than 24 hours before check-in: manager approval needed">Manager needed</button>';
          }
          return `<tr><td class="num">${r.reservation_id}</td>
            <td>${esc(r.full_name)}<div class="sub">${esc(r.email)}</div></td>
            <td>${esc(r.room_number)}<div class="sub">${esc(r.type_name)}</div></td>
            <td>${fmtDate(r.check_in)} to ${fmtDate(r.check_out)}<div class="sub">${plural(r.nights, 'night')}</div></td>
            <td><span class="chip ${esc(r.status)}">${esc(r.status)}</span></td>
            <td class="num">${money(r.paid)}<div class="sub">of ${money(r.total_price)}</div></td><td>${actions}</td></tr>`;
        }).join('')}</tbody></table></div>`;
      const from = (d.page - 1) * d.page_size + 1, to = from + currentRows.length - 1;
      const n = v => Number(v).toLocaleString('ru-RU');
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
    const late = !r.free_cancellation;
    const answer = await confirmDialog(late
      ? { title: `Late cancellation #${r.reservation_id}`, message: `Check-in is less than 24 hours away. As manager you can still cancel. Guest paid ${money(r.paid)}.`, confirm: 'Cancel reservation', danger: true, checkbox: 'Refund the guest' }
      : { title: `Cancel reservation #${r.reservation_id}?`, message: `${r.full_name} will be refunded ${money(r.paid)}.`, confirm: 'Cancel reservation', danger: true });
    if (!answer.ok) return;
    try {
      const res = await staffCall(() => api(`/api/staff/reservations/${r.reservation_id}/cancel`, { method: 'POST', body: { refund: answer.checked } }));
      if (!res) return;
      toast(`Reservation #${r.reservation_id} cancelled. Refunded ${money(res.refunded)}.`);
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

  // ---- prices (manager)
  async function panelPrices() {
    const panel = $('#panel');
    panel.innerHTML = '<div class="empty">Loading prices...</div>';
    try {
      const d = await staffCall(() => api('/api/manager/room-types'));
      if (!d) return;
      panel.innerHTML = `<p class="meta">Change the price per night of a room type. The new price is used for new bookings only.
        Confirmed, completed and cancelled reservations keep the price they were booked at, also when their dates are changed.</p>
        <div class="table-wrap"><table id="price-table"><caption class="sr">Room prices</caption>
        <thead><tr><th>Room type</th><th class="num">Rooms</th><th class="num">Sleeps</th><th class="num">Price per night</th><th>New price (KZT)</th></tr></thead><tbody>
        ${d.room_types.map(t => `<tr><td>${esc(t.type_name)}</td>
          <td class="num">${esc(t.rooms)}${t.in_maintenance ? `<div class="sub">${esc(t.in_maintenance)} under maintenance</div>` : ''}</td>
          <td class="num">${esc(t.capacity)}</td><td class="num">${esc(money(t.price_per_night))}</td>
          <td><form class="price-form" data-id="${esc(t.room_type_id)}" data-name="${esc(t.type_name)}" data-old="${esc(t.price_per_night)}" novalidate>
            <input type="number" name="price" min="1" max="10000000" step="1" value="${esc(t.price_per_night)}" aria-label="New price for ${esc(t.type_name)}" required>
            <button class="btn small" type="submit">Save</button></form></td></tr>`).join('')}</tbody></table></div>`;
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
    render();
  })();
})();
