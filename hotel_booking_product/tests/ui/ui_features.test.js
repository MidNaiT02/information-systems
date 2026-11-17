const { JSDOM } = require('jsdom');
const BASE = process.env.BASE || 'http://127.0.0.1:8124';
const fmt = d => d.toISOString().slice(0, 10);
const plus = n => fmt(new Date(Date.now() + n * 86400000));
let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newBrowser(hash = '') {
  const jar = {};
  const html = await (await fetch(BASE + '/')).text();
  const dom = new JSDOM(html, {
    url: BASE + '/' + hash, runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      window.HTMLDialogElement.prototype.close = function () { if (this.hasAttribute('open')) { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); } };
      Object.defineProperty(window.HTMLDialogElement.prototype, 'open', { get() { return this.hasAttribute('open'); } });
      window.fetch = async (url, opts = {}) => {
        const headers = Object.assign({}, opts.headers || {});
        const cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
        if (cookie) headers.cookie = cookie;
        const res = await fetch(new URL(url, BASE), Object.assign({}, opts, { headers }));
        for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
          const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1);
          if (/Max-Age=0/i.test(c)) delete jar[k]; else jar[k] = v;
        }
        return res;
      };
    },
  });
  const w = dom.window;
  w.eval(await (await fetch(BASE + '/static/app.js')).text());
  w.eval(await (await fetch(BASE + '/static/assistant.js')).text());
  return w;
}
const until = async (fn, label, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(30); } throw new Error('timeout: ' + label); };
const text = (w, sel) => (w.document.querySelector(sel) || {}).textContent || '';
const fire = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const setv = (w, el, v) => { el.value = v; fire(w, el, 'input'); };


const api = async (path, body) => { const r = await fetch(BASE + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); return r.json(); };
const loginAs = async (email, password) => {
  const b = await newBrowser('#/staff');
  await until(() => b.document.querySelector('#login-form'), 'login form');
  const f = b.document.querySelector('#login-form');
  f.elements.email.value = email; f.elements.password.value = password;
  fire(b, f, 'submit');
  await until(() => b.document.querySelector('.tabs'), 'staff tabs');
  return b;
};
const ask = async (w, q) => {
  const before = w.document.querySelectorAll('.hx-msg.bot').length;
  w.document.querySelector('#hx-input').value = q;
  fire(w, w.document.querySelector('#hx-form'), 'submit');
  await until(() => { const m = w.document.querySelectorAll('.hx-msg.bot'); return m.length > before && m[m.length - 1].textContent !== '...'; }, 'answer to ' + q);
  const m = w.document.querySelectorAll('.hx-msg.bot'); return m[m.length - 1];
};

(async () => {
  // ---- guest: flexible dates and QR pass
  const g = await newBrowser();
  await until(() => g.document.querySelector('#search-form'), 'home');
  setv(g, g.document.querySelector('#ci'), plus(500)); setv(g, g.document.querySelector('#co'), plus(502));
  fire(g, g.document.querySelector('#search-form'), 'submit');
  await until(() => g.document.querySelectorAll('.flex-table tbody tr').length > 0, 'flexible dates table');
  check('flexible dates show 7 windows (+-3 days)', g.document.querySelectorAll('.flex-table tbody tr').length === 7, String(g.document.querySelectorAll('.flex-table tbody tr').length));
  check('the chosen dates are marked', g.document.querySelectorAll('.flex-selected').length === 1);
  check('prices of every room type are listed', g.document.querySelectorAll('.flex-table thead th').length === 6);
  click(g, g.document.querySelector('[data-flex-in]'));
  await until(() => g.document.querySelector('#ci').value !== plus(500), 'dates changed by Use these dates');
  check('"Use these dates" moves the search to the other window', g.document.querySelector('#ci').value !== plus(500));
  await until(() => g.document.querySelectorAll('.plaque').length > 0, 'results after shifting');
  click(g, g.document.querySelector('[data-book]'));
  await until(() => g.document.querySelector('#book-form'), 'booking form');
  const bf = g.document.querySelector('#book-form');
  bf.elements.full_name.value = 'Pass Tester'; bf.elements.phone.value = '+77001112233'; bf.elements.email.value = 'pass@example.kz';
  fire(g, bf, 'submit');
  await until(() => text(g, '#dlg').includes('Booking confirmed'), 'confirmation');
  const code = (text(g, '#dlg .pass code').match(/HB\d+-[0-9A-F]{6}/) || [])[0];
  check('confirmation shows a QR image and a pass code', !!code && !!g.document.querySelector('#dlg .qr svg path'), text(g, '#dlg .pass'));
  const rid = (text(g, '.bignum').match(/#(\d+)/) || [])[1];
  const g2 = await newBrowser('#/manage');
  await until(() => g2.document.querySelector('#find-form') || g2.document.querySelector('form'), 'manage form');
  const mf = g2.document.querySelector('#find-form');
  mf.elements.rid.value = rid; mf.elements.email.value = 'pass@example.kz';
  fire(g2, mf, 'submit');
  await until(() => g2.document.querySelector('#booking .pass'), 'pass under My booking');
  check('My booking shows the same pass code', text(g2, '#booking .pass code').includes(code));

  // ---- a booking that starts today, used for check-in, check-out and housekeeping
  const free = await api(`/api/rooms/search?check_in=${plus(0)}&check_out=${plus(1)}`);
  const room = free.rooms.find(r => r.type_name === 'Suite');
  const today = await api('/api/bookings', { room_id: room.room_id, check_in: plus(0), check_out: plus(1), method: 'Card', full_name: 'Today Guest', phone: '+77004445566', email: 'today@example.kz' });
  const todayCode = today.pass.code;
  check('API booking returns a pass', /^HB\d+-[0-9A-F]{6}$/.test(todayCode), JSON.stringify(today.pass));

  // ---- front desk: floor map, check-in, housekeeping
  const s = await loginAs('frontdesk@hotel.example', 'FrontDesk#2026');
  s.location.hash = '#/staff/floor';
  await until(() => s.document.querySelectorAll('.fm-tile').length > 0, 'floor map');
  check('floor map draws all 161 rooms on 9 floors', s.document.querySelectorAll('.fm-tile').length === 161 && s.document.querySelectorAll('.fm-floor').length === 9,
    s.document.querySelectorAll('.fm-tile').length + ' tiles');
  check('the room booked for today is shown as arriving', !!s.document.querySelector(`[data-room="${room.room_id}"].fm-arriving`));
  check('room 105 is shown as maintenance', !!s.document.querySelector('.fm-maintenance'));
  click(s, s.document.querySelector(`[data-room="${room.room_id}"]`));
  await until(() => s.document.querySelector('#dlg').open && text(s, '#dlg').includes('Today Guest'), 'room dialog');
  check('clicking a room shows its guest', text(s, '#dlg').includes('Today Guest'));
  check('the room dialog offers Check in', [...s.document.querySelectorAll('#dlg button')].some(b => b.textContent === 'Check in'));
  click(s, s.document.querySelector('#dlg [data-close]'));

  s.location.hash = '#/staff/checkin';
  await until(() => s.document.querySelector('#pass-form'), 'check-in tab');
  s.document.querySelector('#pass-code').value = 'HB1-000000';
  fire(s, s.document.querySelector('#pass-form'), 'submit');
  await until(() => s.document.querySelector('#pass-result .alert'), 'bad code error');
  check('a wrong pass code is refused', text(s, '#pass-result').includes('not valid'), text(s, '#pass-result'));
  s.document.querySelector('#pass-code').value = code;
  fire(s, s.document.querySelector('#pass-form'), 'submit');
  await until(() => s.document.querySelector('#stay-card'), 'future stay card');
  check('a future booking cannot be checked in yet', text(s, '#stay-card').includes('Check-in opens on') && !s.document.querySelector('[data-stay="check-in"]'), text(s, '#stay-card'));
  s.document.querySelector('#pass-code').value = todayCode;
  fire(s, s.document.querySelector('#pass-form'), 'submit');
  await until(() => s.document.querySelector('[data-stay="check-in"]'), 'check-in button');
  click(s, s.document.querySelector('[data-stay="check-in"]'));
  await until(() => s.document.querySelector('[data-stay="check-out"]'), 'check-out button after check-in');
  check('check-in works and offers Check out', text(s, '#stay-card').includes('Checked in'));
  click(s, s.document.querySelector('[data-stay="check-out"]'));
  await until(() => text(s, '#stay-card').includes('Checked out'), 'checked out');
  check('check-out is recorded', text(s, '#stay-card').includes('Checked out'));

  s.location.hash = '#/staff/housekeeping';
  await until(() => s.document.querySelector('.kpis'), 'housekeeping board');
  const dirtyRow = () => [...s.document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(room.room_number) && r.textContent.includes('Dirty'));
  check('the room left by the guest is Dirty on the board', !!dirtyRow());
  click(s, dirtyRow().querySelector('[data-to="Clean"]'));
  await until(() => [...s.document.querySelectorAll('tbody tr')].some(r => r.textContent.includes(room.room_number) && r.textContent.includes('Mark inspected')), 'room is clean');
  const cleanRow = [...s.document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(room.room_number));
  click(s, cleanRow.querySelector('[data-to="Inspected"]'));
  await until(() => ![...s.document.querySelectorAll('tbody tr')].some(r => r.textContent.includes(room.room_number) && r.textContent.includes('Mark')), 'room inspected');
  check('clean, then inspected, removes the room from the to-do list', true);
  check('front desk has no suggestions on a Prices tab', !text(s, '.tabs').includes('Prices'));

  // ---- guide for the front desk
  click(s, s.document.querySelector('#hx-fab'));
  await until(() => !s.document.querySelector('#hx-panel').hidden && s.document.querySelector('#hx-role').textContent === 'Front desk', 'guide opens');
  check('the guide knows the current page and role', text(s, '#hx-log').includes('Housekeeping') && text(s, '#hx-role') === 'Front desk');
  let a = await ask(s, 'how do I check in a guest?');
  check('guide explains check-in and offers the page', a.textContent.includes('Check-in tab') && !!a.querySelector('.hx-go'), a.textContent);
  a = await ask(s, 'wich rooms are dirty');
  check('guide understands a typo and gives live numbers', a.textContent.includes('Right now:'), a.textContent);
  a = await ask(s, 'open the floor map');
  check('"open ..." takes you to the page', s.location.hash === '#/staff/floor', s.location.hash);
  a = await ask(s, 'show me price suggestions');
  check('front desk is told prices are manager only', a.textContent.includes('Manager'), a.textContent);

  // ---- manager: price suggestions
  const m = await loginAs('manager@hotel.example', 'Manager#2026');
  m.location.hash = '#/staff/prices';
  await until(() => m.document.querySelectorAll('.sugg').length > 0, 'suggestions');
  check('one suggestion card per room type', m.document.querySelectorAll('.sugg').length === 4, String(m.document.querySelectorAll('.sugg').length));
  check('the rules are explained', m.document.querySelectorAll('details li').length >= 5);
  check('the price table is still there', m.document.querySelectorAll('.price-form').length === 4);
  click(m, m.document.querySelector('#hx-fab'));
  await until(() => !m.document.querySelector('#hx-panel').hidden && m.document.querySelector('#hx-role').textContent === 'Manager', 'manager guide');
  a = await ask(m, 'price suggestions');
  check('guide answers with live suggestions for the manager', a.textContent.includes('Suggestions now') || a.textContent.includes('No change suggested'), a.textContent);

  // ---- guest guide
  const gg = await newBrowser();
  await until(() => gg.document.querySelector('#hx-fab'), 'guide button');
  click(gg, gg.document.querySelector('#hx-fab'));
  await until(() => !gg.document.querySelector('#hx-panel').hidden, 'guest guide');
  a = await ask(gg, 'how do I cancel my booking');
  check('guest guide explains cancelling and links to My booking', a.textContent.includes('24 hours') && !!a.querySelector('.hx-go'), a.textContent);
  a = await ask(gg, 'where is the housekeeping board');
  check('guest is sent to the staff login for staff pages', a.textContent.includes('Log in'), a.textContent);
  a = await ask(gg, 'cheaper dates');
  check('guest guide knows the flexible dates table', a.textContent.includes('Flexible dates'), a.textContent);
  a = await ask(gg, 'how much does a room cost');
  check('guest guide gives live prices', a.textContent.includes('per night'), a.textContent);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll feature UI checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
