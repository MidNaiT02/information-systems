/* Navigation helper for guests, front desk and manager.
   A small rule-based assistant: it matches the question to a topic, explains it, and offers a button that opens
   the right page. It runs in the browser, needs no internet and sends nothing anywhere. A few questions
   ("which rooms are dirty?") are answered with live numbers from the hotel's own API. */
(() => {
  'use strict';
  const GUEST = 'guest', FD = 'FrontDesk', MGR = 'Manager';
  let role = GUEST, loggedIn = false;

  const get = async path => {
    const res = await fetch(path, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The request failed.');
    return data;
  };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const money = n => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' KZT';

  // ------------------------------------------------------------ knowledge: what each part of the system does
  // who: roles that may use it (staff = FrontDesk and Manager). keys: words or phrases that point to it.
  const TOPICS = [
    { id: 'book', who: 'all', keys: ['book room', 'booking room', 'reserve', 'reservation new', 'search room', 'free room', 'available room', 'book', 'забронировать', 'бронь', 'номер'],
      text: 'Pick check-in and check-out dates on the Rooms page and press Search rooms. You get one card per room type with the number of free rooms. Press Book this room, enter name, phone, email and a payment method. You get a reservation number and a QR check-in pass.',
      go: ['Open Rooms', '#/'] },
    { id: 'flex', who: 'all', keys: ['flexible', 'flex', 'cheaper', 'cheapest', 'nearby date', 'other date', 'shift date', 'different day', 'sold out', 'дешевле', 'другие даты'],
      text: 'After you search, the Flexible dates table appears under the results. It shows the same number of nights starting a few days earlier or later, the price per room type and how many rooms are free. Press Use these dates on a row to search again.',
      go: ['Search rooms', '#/'] },
    { id: 'manage', who: 'all', keys: ['cancel booking', 'cancel reservation', 'cancel', 'my booking', 'find booking', 'lookup', 'refund', 'отмена', 'отменить'],
      text: 'Open My booking and enter your reservation number and the email you booked with. You can cancel free of charge until 24 hours before check-in (14:00) and the payment is refunded. Later than that, call the front desk.',
      go: ['Open My booking', '#/manage'] },
    { id: 'pass', who: 'all', keys: ['qr', 'pass', 'check in code', 'pass code', 'ticket', 'barcode', 'qr код'],
      text: 'Your QR check-in pass is shown when you book, and again under My booking while the reservation is confirmed. At the front desk, show the QR code or read out the code that looks like HB123-A1B2C3.',
      go: ['Open My booking', '#/manage'] },
    { id: 'times', who: 'all', keys: ['check in time', 'checkin time', 'check out time', 'checkout time', 'arrival time', 'what time', 'late', 'early', 'время заезда', 'время выезда'],
      text: 'Check-in starts at 14:00 on the arrival date. Guests leave by 12:00 on the departure date, and the room then goes to housekeeping.' },
    { id: 'payment', who: 'all', keys: ['pay', 'payment', 'card', 'cash', 'transfer', 'оплата', 'оплатить'],
      text: 'You choose Card, Cash or Transfer when booking. Payment is simulated in this prototype and no card number is asked for or stored.' },
    { id: 'email', who: 'all', keys: ['email not received', 'no email', 'confirmation email', 'mail', 'didnt get email', 'письмо'],
      text: 'A confirmation email is sent right after booking. In this prototype it is written to the Email outbox unless SMTP is configured. Front desk staff can send it again from the Email outbox tab.',
      go: ['Email outbox (staff)', '#/staff/outbox'], staffGo: true },
    { id: 'login', who: 'all', keys: ['login', 'log in', 'sign in', 'staff area', 'staff', 'password', 'account', 'войти', 'пароль'],
      text: 'Staff sign in on the Staff page with their work email and password. After signing in you can change your own password from Account in the top bar.',
      go: ['Open Staff', '#/staff'] },

    // ---- front desk and manager
    { id: 'checkin', who: 'staff', keys: ['check in guest', 'checkin guest', 'check in', 'checkin', 'scan', 'qr scan', 'arrival', 'arrive', 'check out', 'checkout', 'guest arrived', 'заселить', 'заселение'],
      text: 'Open the Check-in tab. Scan the guest QR pass with a scanner or the camera, or type the pass code or reservation number, then press Check in. When the guest leaves, press Check out: the room becomes Dirty and appears on the housekeeping board.',
      go: ['Open Check-in', '#/staff/checkin'] },
    { id: 'floor', who: 'staff', keys: ['floor map', 'map', 'floor', 'room status', 'which room free', 'occupied', 'building', 'rooms today', 'этаж', 'карта'],
      text: 'The Floor map shows every room by floor: free, arriving, occupied, departing or under maintenance, with an orange dot for dirty rooms. Pick any date at the top. Click a room for the guest, the next booking and quick actions.',
      go: ['Open Floor map', '#/staff/floor'] },
    { id: 'housekeeping', who: 'staff', keys: ['housekeeping', 'clean', 'cleaning', 'dirty', 'inspect', 'inspected', 'maid', 'to clean', 'уборка', 'грязный'],
      text: 'The Housekeeping board lists what to clean today. A room becomes Dirty at checkout, then Clean, then Inspected. Rooms with a guest arriving today are listed first.',
      go: ['Open Housekeeping', '#/staff/housekeeping'],
      live: async () => {
        const d = await get('/api/staff/housekeeping');
        const s = d.summary, todo = d.rooms.filter(r => r.housekeeping !== 'Inspected').slice(0, 8).map(r => r.room_number);
        return `Right now: ${s.Dirty} dirty, ${s.Clean} cleaned and waiting for inspection, ${s.Inspected} ready. ${s.priority} priority (guest arrives today).` + (todo.length ? ` First rooms: ${todo.join(', ')}.` : ' Nothing to clean.');
      } },
    { id: 'reservations', who: 'staff', keys: ['reservations', 'modify', 'change dates', 'edit booking', 'find reservation', 'search reservation', 'filter', 'sort', 'cancel for guest', 'изменить'],
      text: 'The Reservations tab lists every reservation page by page. Filter by status, text and check-in dates, sort, change the dates or cancel. Staff can change or cancel until 24 hours before check-in; later only a manager can.',
      go: ['Open Reservations', '#/staff/reservations'] },
    { id: 'calendar', who: 'staff', keys: ['calendar', 'occupancy calendar', 'availability grid', 'guests per night', 'календарь'],
      text: 'The Calendar tab shows all rooms against a range of dates, with booked nights marked, and the number of guests for each night.',
      go: ['Open Calendar', '#/staff/calendar'] },
    { id: 'outbox', who: 'staff', keys: ['outbox', 'resend', 'send again', 'email outbox', 'emails'],
      text: 'The Email outbox shows every confirmation email. If a guest did not get theirs, press resend on that row.',
      go: ['Open Email outbox', '#/staff/outbox'] },
    { id: 'arrivals', who: 'staff', keys: ['arrivals today', 'who arrives', 'arriving today', 'departures today', 'leaving today'],
      text: 'The Floor map for today shows arriving and departing rooms, and the Housekeeping board shows who arrives today.',
      go: ['Open Floor map', '#/staff/floor'],
      live: async () => {
        const c = (await get('/api/staff/floor-map')).counts;
        return `Today: ${c.arriving} arriving and not yet checked in, ${c.occupied} occupied, ${c.departing} leaving, ${c.free} free, ${c.maintenance} under maintenance.`;
      } },

    // ---- manager only
    { id: 'suggest', who: 'manager', keys: ['price suggestion', 'suggest', 'suggestions', 'raise price', 'lower price', 'pricing hint', 'should i change price', 'recommend price', 'цена рекомендации'],
      text: 'The Prices tab starts with price suggestions for each room type, made from weekend, 7-day and 30-day occupancy. Press Apply on a suggestion to change the price for new bookings; nothing changes by itself.',
      go: ['Open Prices', '#/staff/prices'],
      live: async () => {
        const d = await get('/api/manager/price-suggestions');
        const act = d.suggestions.filter(s => s.action !== 'keep');
        return act.length ? 'Suggestions now: ' + act.map(s => `${s.type_name} ${s.change_percent > 0 ? '+' : ''}${s.change_percent}% (${money(s.current_price)} to ${money(s.suggested_price)})`).join('; ') + '.' : 'No change suggested today: demand looks normal for every room type.';
      } },
    { id: 'prices', who: 'manager', keys: ['change price', 'edit price', 'set price', 'update price', 'new price', 'change rate'],
      text: 'On the Prices tab, enter a new price per night for a room type and press Save. It applies to new bookings only; existing reservations keep the price they were booked at.',
      go: ['Open Prices', '#/staff/prices'] },
    { id: 'dashboard', who: 'manager', keys: ['dashboard', 'revenue', 'occupancy', 'statistics', 'report', 'date filter', 'first reservation', 'since first', 'all time', 'отчет', 'доход'],
      text: 'The Dashboard shows occupancy, revenue, most booked room types, arrivals and blocked double bookings. Use From, To, Since first reservation or All time to filter. The date of the very first reservation is shown on top.',
      go: ['Open Dashboard', '#/staff/dashboard'] },
    { id: 'export', who: 'manager', keys: ['export', 'csv', 'excel', 'download', 'скачать'],
      text: 'On the Reservations tab, set your filters and press Download CSV to export the matching reservations (up to 50,000 rows) for Excel.',
      go: ['Open Reservations', '#/staff/reservations'] },
    { id: 'audit', who: 'manager', keys: ['audit', 'log', 'activity', 'history', 'who changed', 'blocked double', 'double booking'],
      text: 'The activity log at the bottom of the Dashboard lists price changes, check-ins, housekeeping changes, exports and blocked double bookings, with who did it and when.',
      go: ['Open Dashboard', '#/staff/dashboard'] },

    // ---- live for everyone
    { id: 'roomprice', who: 'all', keys: ['price', 'prices', 'how much', 'cost', 'rate', 'per night', 'цена', 'цены', 'сколько стоит'],
      text: 'The price is per night and depends on the room type. Search your dates on the Rooms page to see the exact total.', go: ['Open Rooms', '#/'],
      live: async () => {
        const t = new Date(), n = new Date(t.getTime() + 86400000);
        const d = await get(`/api/rooms/search?check_in=${iso(t)}&check_out=${iso(n)}`);
        const seen = {};
        d.rooms.forEach(r => { seen[r.type_name] = r.price_per_night; });
        const parts = Object.keys(seen).map(k => `${k} ${money(seen[k])}`);
        return parts.length ? `Today's prices per night: ${parts.join(', ')}.` : '';
      } },
    { id: 'tonight', who: 'all', keys: ['tonight', 'available tonight', 'free tonight', 'any room tonight', 'сегодня'],
      text: 'Search the Rooms page for tonight to see what is free.', go: ['Open Rooms', '#/'],
      live: async () => {
        const t = new Date(), n = new Date(t.getTime() + 86400000);
        const d = await get(`/api/rooms/search?check_in=${iso(t)}&check_out=${iso(n)}`);
        const by = {};
        d.rooms.forEach(r => { by[r.type_name] = (by[r.type_name] || 0) + 1; });
        const parts = Object.keys(by).map(k => `${by[k]} ${k}`);
        return parts.length ? `Free tonight: ${parts.join(', ')}.` : 'No rooms are free tonight.';
      } },
  ];

  const PAGES = {
    '': ['Rooms', 'Pick your dates and press Search rooms. Under the results, Flexible dates compares nearby days.'],
    manage: ['My booking', 'Enter your reservation number and email to see your QR pass or cancel.'],
    staff: ['Staff', 'Log in, then use the tabs: reservations, floor map, housekeeping, check-in.'],
    'staff/reservations': ['Reservations', 'Filter, sort, change dates or cancel. Managers can also download CSV.'],
    'staff/calendar': ['Calendar', 'Booked nights for every room over a range of dates.'],
    'staff/floor': ['Floor map', 'Click a room tile for its guest and quick actions. Pick any date.'],
    'staff/housekeeping': ['Housekeeping', 'Clean the priority rooms first, then inspect them.'],
    'staff/checkin': ['Check-in', 'Scan or type the pass code, then press Check in.'],
    'staff/outbox': ['Email outbox', 'Resend a confirmation email with one click.'],
    'staff/dashboard': ['Dashboard', 'Use the date filter to look at any period.'],
    'staff/prices': ['Prices', 'Read the suggestions, apply one or type a new price.'],
  };
  const here = () => location.hash.replace(/^#\/?/, '').split('/').slice(0, 2).join('/').replace(/\/$/, '');
  const pageInfo = () => PAGES[here()] || PAGES[here().split('/')[0]] || PAGES[''];

  // ------------------------------------------------------------ matching (small, typo tolerant)
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9\u0400-\u04ff\u0500-\u052f\s]/g, ' ');
  const stem = w => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);
  const words = s => norm(s).split(/\s+/).filter(Boolean).map(stem);
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const allowed = t => t.who === 'all' || (t.who === 'staff' && (role === FD || role === MGR)) || (t.who === 'manager' && role === MGR);
  const visible = t => t.who === 'all' || t.who === 'staff' || t.who === 'manager';
  function score(topic, tokens) {
    let best = 0;
    for (const key of topic.keys) {
      const kw = words(key);
      if (!kw.length) continue;
      const hits = kw.map(k => tokens.some(t => t === k) ? 2 : tokens.some(t => t.length >= 5 && k.length >= 5 && lev(t, k) <= 1) ? 1.4 : 0);
      if (hits.every(h => h > 0)) best = Math.max(best, hits.reduce((a, b) => a + b, 0) * (kw.length > 1 ? 1.6 : 1));
    }
    return best + (best && allowed(topic) ? 0.5 : 0) + (best && topic.who === 'manager' && role === MGR ? 0.3 : 0);
  }
  function match(text) {
    const tokens = words(text);
    return TOPICS.filter(visible).map(t => ({ t, s: score(t, tokens) })).filter(x => x.s >= 2).sort((a, b) => b.s - a.s);
  }

  // ------------------------------------------------------------ answers
  async function answer(text) {
    const q = norm(text).trim();
    if (!q) return { text: 'Type a question, for example: how do I check in a guest?' };
    if (/^(hi|hello|hey|salam|privet|привет|сәлем)\b/.test(q)) return { text: 'Hello! Ask me where something is or how to do it, for example: ' + chipsFor().slice(0, 2).map(c => `"${c}"`).join(' or ') + '.' };
    if (/\b(thanks|thank you|спасибо|рахмет)\b/.test(q)) return { text: 'You are welcome!' };
    if (/\b(help|what can you do|who are you)\b/.test(q)) return { text: 'I am a small helper built into this page. I know where things are for guests, front desk and manager, I can open the right page, and I can answer a few live questions such as which rooms are dirty or free tonight. I do not use the internet.', chips: chipsFor() };
    const found = match(text);
    if (!found.length) return { text: 'I did not find that. Try a few key words, for example "floor map", "cancel booking" or "check in".', chips: chipsFor() };
    const top = found[0].t, wantsGo = /^(go|open|take|show|navigate|bring)\b/.test(q);
    if (!allowed(top)) {
      if (!loggedIn) return { text: `That is in the staff area. ${top.who === 'manager' ? 'It needs the Manager role. ' : ''}Log in first.`, go: ['Open Staff login', '#/staff'] };
      return { text: 'Only the Manager role can open that. Ask your manager, or log in with a manager account.' };
    }
    let extra = '';
    if (top.live) {
      try { extra = await top.live(); } catch (e) { extra = ''; }
    }
    const others = found.slice(1, 3).filter(x => allowed(x.t) && x.s >= top.s - 1.5).map(x => x.t);
    return { text: (extra ? extra + '\n\n' : '') + top.text, go: top.go, auto: wantsGo && top.go, more: others };
  }
  function chipsFor() {
    if (role === MGR) return ['Price suggestions', 'Dashboard date filter', 'Which rooms are dirty?', 'Open the floor map'];
    if (role === FD) return ['Check in a guest', 'Which rooms are dirty?', 'Open the floor map', 'Resend an email'];
    return ['Book a room', 'Show cheaper dates', 'Cancel my booking', 'Where is my QR pass?'];
  }

  // ------------------------------------------------------------ widget
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else n.setAttribute(k, v); }
    kids.forEach(k => n.append(k));
    return n;
  };
  const fab = el('button', { id: 'hx-fab', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'hx-panel' }, 'Ask guide');
  const log = el('div', { id: 'hx-log', role: 'log', 'aria-live': 'polite' });
  const chipBox = el('div', { id: 'hx-chips' });
  const input = el('input', { id: 'hx-input', type: 'text', placeholder: 'Ask where something is...', 'aria-label': 'Your question', autocomplete: 'off', maxlength: '160' });
  const form = el('form', { id: 'hx-form' }, input, el('button', { type: 'submit', class: 'btn small' }, 'Ask'));
  const close = el('button', { type: 'button', id: 'hx-close', 'aria-label': 'Close guide' }, '\u00d7');
  const panel = el('section', { id: 'hx-panel', 'aria-label': 'Navigation guide', hidden: '' },
    el('header', {}, el('b', {}, 'Guide'), el('span', { id: 'hx-role' }), close), log, chipBox, form);
  let opened = false;

  const say = (text, who) => { const m = el('div', { class: 'hx-msg ' + who }); m.textContent = text; log.append(m); log.scrollTop = log.scrollHeight; return m; };
  function setChips(list) {
    chipBox.replaceChildren(...list.map(c => { const b = el('button', { type: 'button', class: 'hx-chip' }, c); b.addEventListener('click', () => ask(c)); return b; }));
  }
  function goButton(go) {
    const b = el('button', { type: 'button', class: 'btn small hx-go' }, go[0] + ' \u2192');
    b.addEventListener('click', () => { location.hash = go[1]; if (innerWidth < 700) toggle(false); });
    return b;
  }
  async function ask(text) {
    say(text, 'me');
    input.value = '';
    const wait = say('...', 'bot');
    let a;
    try { a = await answer(text); } catch (e) { a = { text: 'Something went wrong. Please try again.' }; }
    wait.textContent = a.text;
    if (a.go) wait.append(el('br'), goButton(a.go));
    if (a.more && a.more.length) wait.append(el('div', { class: 'hx-also' }, 'Also related: ' + a.more.map(t => t.id).join(', ')));
    if (a.auto) { location.hash = a.auto[1]; }
    setChips(a.chips || chipsFor());
    log.scrollTop = log.scrollHeight;
  }
  async function refreshRole() {
    try {
      const me = await get('/api/auth/me');
      loggedIn = !!me.user; role = me.user ? me.user.role : GUEST;
    } catch (e) { loggedIn = false; role = GUEST; }
    $role().textContent = loggedIn ? (role === FD ? 'Front desk' : 'Manager') : 'Guest';
    setChips(chipsFor());
  }
  const $role = () => panel.querySelector('#hx-role');
  async function toggle(open) {
    opened = open === undefined ? !opened : open;
    panel.hidden = !opened;
    fab.setAttribute('aria-expanded', String(opened));
    if (!opened) { fab.focus(); return; }
    await refreshRole();
    if (!log.childElementCount) {
      const [name, tip] = pageInfo();
      say(`Hi! You are on: ${name}. ${tip} Ask me where something is, or pick a question below.`, 'bot');
    }
    input.focus();
  }
  fab.addEventListener('click', () => toggle());
  close.addEventListener('click', () => toggle(false));
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
  form.addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if (v) ask(v); });
  window.addEventListener('hashchange', () => { if (opened) refreshRole(); });
  document.body.append(fab, panel);

  // exposed for the tests of the page
  window.hotelGuide = { match, answer, words };
})();
