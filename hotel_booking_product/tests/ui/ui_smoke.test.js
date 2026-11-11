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
  const src = await (await fetch(BASE + '/static/app.js')).text();
  w.eval(src);
  return w;
}
const until = async (fn, label, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(30); } throw new Error('timeout: ' + label); };
const text = (w, sel) => (w.document.querySelector(sel) || {}).textContent || '';
const fire = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const setv = (w, el, v) => { el.value = v; fire(w, el, 'input'); };

(async () => {
  // ---- guest: search, book, confirm, find, cancel
  let w = await newBrowser();
  await until(() => text(w, 'h1').includes('Which nights'), 'home heading');
  check('home page renders the search form', !!w.document.querySelector('#search-form'));
  setv(w, w.document.querySelector('#ci'), plus(450));
  setv(w, w.document.querySelector('#co'), plus(452));
  check('nights counter shows 2 nights', text(w, '#nights') === '2 nights', text(w, '#nights'));
  fire(w, w.document.querySelector('#search-form'), 'submit');
  await until(() => w.document.querySelectorAll('.plaque').length > 0, 'room plaques');
  const plaques = w.document.querySelectorAll('.plaque').length;
  check('free rooms are shown as one plaque per room type (4 expected)', plaques === 4, String(plaques));
  check('the header counts the 160 bookable rooms', text(w, '.count').includes('160 rooms free'), text(w, '.count'));
  click(w, w.document.querySelector('[data-book]'));
  await until(() => w.document.querySelector('#dlg').open && w.document.querySelector('#book-form'), 'booking dialog');
  const f = w.document.querySelector('#book-form');
  f.elements.full_name.value = 'Ui Tester'; f.elements.phone.value = '+77005550000'; f.elements.email.value = 'ui@example.kz';
  fire(w, f, 'submit');
  await until(() => text(w, '#dlg').includes('Booking confirmed'), 'confirmation');
  const rid = (text(w, '.bignum').match(/#(\d+)/) || [])[1];
  check('booking confirmed with a reservation number', !!rid, text(w, '#dlg'));
  check('confirmation mentions the email', text(w, '#dlg').includes('ui@example.kz'));
  click(w, w.document.querySelector('#dlg [data-close]'));
  await until(() => !w.document.querySelector('#dlg').open, 'dialog closed');
  check('booked room disappears from the results', text(w, '.count').includes('159 rooms free'), text(w, '.count'));

  // double booking through the UI: same room and dates from a second visitor
  let w2 = await newBrowser();
  await until(() => w2.document.querySelector('#search-form'), 'second visitor home');
  const roomNumber = (await (await fetch(`${BASE}/api/rooms/search?check_in=${plus(450)}&check_out=${plus(452)}`)).json()).rooms.length;
  check('server also reports 159 free rooms', roomNumber === 159, String(roomNumber));

  // manage booking and cancel
  w.location.hash = '#/manage';
  await until(() => w.document.querySelector('#find-form'), 'manage form');
  const mf = w.document.querySelector('#find-form');
  mf.elements.rid.value = rid; mf.elements.email.value = 'ui@example.kz';
  fire(w, mf, 'submit');
  await until(() => text(w, '#booking').includes('Reservation #' + rid), 'booking found');
  check('booking is found and shows status Confirmed', text(w, '#booking').includes('Confirmed'));
  check('free cancellation is offered', !!w.document.querySelector('#guest-cancel'));
  click(w, w.document.querySelector('#guest-cancel'));
  await until(() => w.document.querySelector('#cd-ok'), 'confirm dialog');
  click(w, w.document.querySelector('#cd-ok'));
  await until(() => text(w, '#booking').includes('Booking cancelled'), 'cancelled message');
  check('cancellation shows the refund', text(w, '#booking').includes('Refund'));
  check('status chip now says Cancelled', text(w, '#booking .chip') === 'Cancelled', text(w, '#booking .chip'));
  mf.elements.email.value = 'wrong@example.kz';
  fire(w, mf, 'submit');
  await until(() => text(w, '#booking').includes('No reservation found'), 'wrong email message');
  check('wrong email gets a clear error', true);

  // ---- front desk
  let s = await newBrowser('#/staff');
  await until(() => s.document.querySelector('#login-form'), 'login form');
  const lf = s.document.querySelector('#login-form');
  lf.elements.email.value = 'frontdesk@hotel.example'; lf.elements.password.value = 'bad';
  fire(s, lf, 'submit');
  await until(() => text(s, '#login-error').includes('Wrong email or password'), 'login error');
  check('wrong password shows an error', true);
  lf.elements.password.value = 'FrontDesk#2026';
  fire(s, lf, 'submit');
  await until(() => s.document.querySelector('#res-table table'), 'reservation table');
  const rows = s.document.querySelectorAll('#res-table tbody tr').length;
  check('front desk sees the first page of 50 reservations', rows === 50, String(rows));
  const clean = t => t.replace(/\u00a0/g, ' ');
  const total = Number((clean(text(s, '#range')).match(/of ([\d ]+) reservations/) || [])[1].replace(/ /g, ''));
  const pages = Math.ceil(total / 50);
  check('pager shows the total (5,000 demo reservations plus the booking made above)', total === 5001, String(total));
  const firstId = s.document.querySelector('#res-table tbody tr td').textContent;
  click(s, s.document.querySelector('[data-page="next"]'));
  await until(() => s.document.querySelector('#range').textContent.includes('Showing 51'), 'page 2');
  check('Next shows the second page with other reservations', s.document.querySelector('#res-table tbody tr td').textContent !== firstId && clean(text(s, '#pager')).includes(`Page 2 of ${pages}`), clean(text(s, '#pager')));
  check('Previous is enabled after moving forward', !s.document.querySelector('[data-page="prev"]').disabled);
  click(s, s.document.querySelector('[data-page="last"]'));
  await until(() => clean(text(s, '#pager')).includes(`Page ${pages} of ${pages}`), 'last page');
  check('Last page opens, Next is disabled and the page is not empty', s.document.querySelector('[data-page="next"]').disabled && s.document.querySelectorAll('#res-table tbody tr').length > 0);
  const sf = s.document.querySelector('#filter-form');
  sf.elements.status.value = 'Cancelled';
  fire(s, sf, 'submit');
  await until(() => /Page 1 of/.test(text(s, '#pager')) && s.document.querySelectorAll('#res-table .chip.Cancelled').length > 0, 'cancelled filter');
  check('status filter works and goes back to page 1', [...s.document.querySelectorAll('#res-table tbody .chip')].every(c => c.textContent === 'Cancelled'));
  click(s, s.document.querySelector('#filter-reset'));
  await until(() => clean(text(s, '#pager')).includes(`Page 1 of ${pages}`), 'filter cleared');
  check('Clear brings back all reservations', true);
  check('front desk has no Dashboard tab', !text(s, '.tabs').includes('Dashboard'), text(s, '.tabs'));
  check('front desk has no Prices tab', !text(s, '.tabs').includes('Prices'), text(s, '.tabs'));
  check('nav shows the staff member and a log out button', text(s, '#nav').includes('Front desk') && !!s.document.querySelector('#logout'));
  s.location.hash = '#/staff/outbox';
  await until(() => s.document.querySelector('.mail'), 'outbox');
  check('outbox lists the confirmation email text', text(s, '.mail').includes('Your booking is confirmed'));
  const mailsBefore = s.document.querySelectorAll('#panel tbody tr').length;
  click(s, s.document.querySelector('[data-resend]'));
  await until(() => s.document.querySelectorAll('#panel tbody tr').length === mailsBefore + 1, 'resent email row');
  check('Send again adds a new row marked (resent) with status Sent', /\(resent\)/.test(text(s, '#panel tbody tr')) && text(s, '#panel tbody tr .chip') === 'Sent', text(s, '#panel tbody tr'));
  check('a toast confirms the email was sent again', text(s, '#toast').includes('sent again'), text(s, '#toast'));
  s.location.hash = '#/staff/reservations';
  await until(() => s.document.querySelector('#res-table table'), 'reservations for banner');
  check('front desk is warned about the demo password', text(s, '.notice').includes('demo password'));
  check('front desk has no CSV download', !s.document.querySelector('#csv-link'));

  // ---- manager
  let m = await newBrowser('#/staff');
  await until(() => m.document.querySelector('#login-form'), 'manager login form');
  const ml = m.document.querySelector('#login-form');
  ml.elements.email.value = 'manager@hotel.example'; ml.elements.password.value = 'Manager#2026';
  fire(m, ml, 'submit');
  await until(() => m.document.querySelector('#res-table table'), 'manager reservations');
  check('manager sees the Dashboard tab', text(m, '.tabs').includes('Dashboard'));
  m.location.hash = '#/staff/dashboard';
  await until(() => m.document.querySelector('.kpis'), 'dashboard');
  check('dashboard shows 5 KPI values', m.document.querySelectorAll('.kpi').length === 5);
  check('dashboard draws charts', m.document.querySelectorAll('svg.chart').length === 3, String(m.document.querySelectorAll('svg.chart').length));
  const recent = [...m.document.querySelectorAll('.panel')].find(p => p.textContent.includes('Recent activity'));
  check('dashboard records the cancellation in recent activity', !!recent && recent.textContent.includes('cancel'), recent ? recent.textContent.slice(0, 200) : 'no panel');

  // ---- dashboard date filter
  check('dashboard shows the first reservation date', text(m, '#dash-period').includes('First reservation:') && !text(m, '#dash-period').includes('none yet'), text(m, '#dash-period'));
  check('dashboard starts with all time', text(m, '#dash-period').includes('all time'));
  const kpis = () => [...m.document.querySelectorAll('.kpi b')].map(x => x.textContent).join('|');
  const allTime = kpis();
  const df = m.document.querySelector('#dash-filter');
  df.elements.from.value = plus(-3); df.elements.to.value = plus(-1);
  fire(m, df, 'submit');
  await until(() => text(m, '#dash-period').includes('Showing:') && !text(m, '#dash-period').includes('all time'), 'filtered dashboard');
  check('date filter changes the figures and says which period is shown', kpis() !== allTime && text(m, '#dash-period').includes('Showing:'), kpis());
  check('filtered dashboard still draws 3 charts', m.document.querySelectorAll('svg.chart').length === 3);
  click(m, m.document.querySelector('#dash-since-first'));
  await until(() => m.document.querySelector('#dash-filter') && m.document.querySelector('#dash-filter').elements.to.value !== plus(-1) && text(m, '#dash-period').includes('Showing:'), 'since first reservation');
  check('Since first reservation fills the start date with the first reservation date', m.document.querySelector('#dash-filter').elements.from.value.length === 10);
  click(m, m.document.querySelector('#dash-reset'));
  await until(() => text(m, '#dash-period').includes('all time') && m.document.querySelectorAll('.kpi').length === 5, 'dashboard reset');
  check('All time brings back the original figures', kpis() === allTime, kpis());

  // ---- manager changes a price: existing reservations keep theirs
  const snapshot = async () => JSON.stringify((await (await m.fetch('/api/staff/reservations?page_size=200&order=asc')).json()).reservations.map(r => [r.reservation_id, r.status, r.total_price]));
  const before = await snapshot();
  m.location.hash = '#/staff/prices';
  await until(() => m.document.querySelector('#price-table'), 'prices panel');
  check('prices panel lists 4 room types', m.document.querySelectorAll('.price-form').length === 4, String(m.document.querySelectorAll('.price-form').length));
  check('prices panel shows 100 standard rooms', text(m, '#price-table').includes('100'));
  const deluxe = [...m.document.querySelectorAll('.price-form')].find(f => f.dataset.name === 'Deluxe');
  deluxe.elements.price.value = '45000';
  fire(m, deluxe, 'submit');
  await until(() => m.document.querySelector('#cd-ok'), 'price confirm dialog');
  check('price change asks for confirmation and explains existing reservations keep their price', text(m, '#dlg').includes('Existing reservations keep their price'));
  click(m, m.document.querySelector('#cd-ok'));
  await until(() => clean(text(m, '#price-table')).includes('45 000 KZT'), 'new price shown');
  check('new Deluxe price is shown', true);
  check('existing reservation prices did not change', (await snapshot()) === before);
  const search = await (await fetch(`${BASE}/api/rooms/search?check_in=${plus(600)}&check_out=${plus(601)}`)).json();
  check('guests see the new price for new bookings', search.rooms.find(r => r.type_name === 'Deluxe').price_per_night === 45000);

  // XSS check: a guest name with markup is shown as text
  await fetch(BASE + '/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 1, check_in: plus(470), check_out: plus(471), full_name: '<img src=x onerror=alert(1)>', phone: '+77001112233', email: 'xss@example.kz', method: 'Cash' }) });
  m.location.hash = '#/staff/reservations';
  await until(() => m.document.querySelector('#res-table table'), 'reservations again');
  const html = m.document.querySelector('#res-table').innerHTML;
  check('markup in a guest name is escaped, not executed', html.includes('&lt;img src=x') && !m.document.querySelector('#res-table img'));

  // ---- CSV link and password change (manager)
  const csvLink = m.document.querySelector('#csv-link');
  check('manager has a Download CSV link that uses the current filters', !!csvLink && csvLink.getAttribute('href').startsWith('/api/manager/export.csv?') && csvLink.getAttribute('href').includes('order=desc'), csvLink ? csvLink.getAttribute('href') : 'none');
  const csvText = await (await m.fetch(csvLink.getAttribute('href'))).text();
  check('the CSV link returns the reservations as CSV', csvText.includes('reservation_id,guest,email') && csvText.split('\n').length > 5000, String(csvText.split('\n').length));
  check('manager is warned about the demo password too', text(m, '.notice').includes('demo password'));
  click(m, m.document.querySelector('#account'));
  await until(() => m.document.querySelector('#dlg').open && m.document.querySelector('#pw-form'), 'password dialog');
  const pf = m.document.querySelector('#pw-form');
  pf.elements.current.value = 'Manager#2026'; pf.elements.next.value = 'Valid-pass-123'; pf.elements.again.value = 'different-123';
  fire(m, pf, 'submit');
  await until(() => text(m, '#pw-error').includes('not the same'), 'mismatch message');
  check('different new passwords are rejected on the page', true);
  pf.elements.again.value = 'Valid-pass-123'; pf.elements.next.value = 'short';
  pf.elements.again.value = 'short';
  fire(m, pf, 'submit');
  await until(() => text(m, '#pw-error').includes('at least 10'), 'weak password message');
  check('a weak password gets the rule from the server', true);
  pf.elements.current.value = 'wrong-current'; pf.elements.next.value = 'Valid-pass-123'; pf.elements.again.value = 'Valid-pass-123';
  fire(m, pf, 'submit');
  await until(() => text(m, '#pw-error').includes('current password is wrong'), 'wrong current message');
  check('a wrong current password is refused', true);
  pf.elements.current.value = 'Manager#2026';
  fire(m, pf, 'submit');
  await until(() => !m.document.querySelector('#dlg').open, 'dialog closed after change');
  await until(() => !m.document.querySelector('.notice'), 'banner gone');
  check('after the change the demo password warning disappears', !m.document.querySelector('.notice'));
  let relog = await newBrowser('#/staff');
  await until(() => relog.document.querySelector('#login-form'), 'login after change');
  const rl = relog.document.querySelector('#login-form');
  rl.elements.email.value = 'manager@hotel.example'; rl.elements.password.value = 'Manager#2026';
  fire(relog, rl, 'submit');
  await until(() => /Wrong email or password/.test(text(relog, '#login-error')), 'old password refused');
  rl.elements.password.value = 'Valid-pass-123';
  fire(relog, rl, 'submit');
  await until(() => relog.document.querySelector('#res-table table'), 'login with the new password');
  check('the old password stops working and the new one logs in', !relog.document.querySelector('.notice'));

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll UI checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
