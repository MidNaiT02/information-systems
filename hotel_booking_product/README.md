# Hotel Booking System

A working information system for a small hotel: guests search and book rooms in the browser,
front-desk staff manage reservations, and the manager sees a dashboard.
Backend (REST API + SQLite database) and frontend (single-page web app) are separate parts of the project.

Team: Akzhigitov Abilkaiyr (24B032188), Kurbanaliyev Alibek (24B030184), Kabizhan Arnur (25B032104)

Problem it solves: guests were double-booked into the same room because staff checked availability by hand.
Now the system checks the dates for you, and the database itself refuses an overlapping booking.

## Run it locally (Python 3.8 or newer)

    py run.py                # Windows. On Mac or Linux: python3 run.py
    # open http://127.0.0.1:8000

The local development mode creates fictional demo data. It does not print passwords to the console.
For production, use `APP_ENV=production`, set unique staff password environment variables on every start, install `requirements.txt`,
and follow `DEPLOYMENT.md`. The published demo passwords are rejected in production mode. Production mode creates an empty database and uses Waitress instead of the development WSGI server.

The first start creates the database with demo data: 161 rooms (Standard 100, Deluxe 50, Suite 10, President 1),
5,000 reservations spread over the 160 bookable rooms (room 105 is under maintenance), about 830 guests and 5,600 payments,
spread evenly over the past 6 years (about 800 a year) and up to 45 days from today. No room is double booked in this data.
Prices per night (KZT): Standard 25,000, Deluxe 40,000, Suite 70,000, President 150,000. The manager can change them (see below).
`py run.py --reset` deletes the database and creates it again. Another size: `py run.py --reset --records 1000`.
For a real hotel start without any demo reservations: `py run.py --reset --empty` (rooms and staff accounts only).
To look at the data: `py tools/check_database.py`, or open `data/hotel.db` in any SQLite viewer.
To add more records to the data you already have: stop the server and run `py tools/add_records.py 5000`
(or `py run.py --add-records 5000`). The new reservations are past stays placed into free gaps of the existing history,
so 5,000 become 10,000. Nothing old is changed or deleted, rooms are never double booked, and the guests,
payments and refunds for the new stays are created too. If a database is already too full, the history is extended further back.
An existing database from an older version is upgraded automatically on start (the locked price per night is added),
but it keeps its old 10 rooms. Use `--reset` to get the 161 rooms.

Local development demo staff accounts only (never use these on a deployed system):

| Role | Email | Password |
|---|---|---|
| Front desk | frontdesk@hotel.example | FrontDesk#2026 |
| Manager | manager@hotel.example | Manager#2026 |

## Guest accounts and visual themes

Guests can create an account from **Sign in / Register** in the top navigation, or sign in to an existing guest account.
Passwords are stored as PBKDF2-HMAC-SHA256 hashes with random salts; guest sessions use a separate HttpOnly cookie,
CSRF token and are isolated from Front desk and Manager permissions. Guest registration creates the account immediately
without an email-verification step. To prevent account takeover, registration will not attach an account to an older
unclaimed reservation merely because the same email is entered; contact the front desk for help with a legacy booking.
Guest password changes are available after sign-in; forgotten-password recovery uses an emailed one-time code and requires SMTP.
Guests must sign in or register before booking. Each new reservation is linked to the signed-in guest account and appears
in **My reservations**, where the owner can view details, manage eligible cancellations and submit a review. The separate
QR check-in pass is shown on the confirmation and reservation details screens for front-desk use.

Every signed-in role (Guest, Front desk and Manager) has a social-profile-inspired **Account** page with a cover banner,
initials avatar, role badge, account stats, editable name and phone number, protected email and role fields, security controls,
and shortcuts for the current role. All users can change their password from this page.


The **Visual style / System interface** selector offers four responsive experiences that share the same application, API, database, accounts and role permissions: **Cyberpunk / NEON OASIS** at `/` (Kazakh-first corporate HUD), **GTA VI Style / THE MARISOL** at `/gta-vi` (Kazakh-first Miami/Vice City promo site with an independent After Dark toggle), **Official & Premium** at `/official` (English-first navy, white and gold corporate design), and **Daltonism-safe / High Accessibility** at `/daltonism` (English-first high-contrast blue/orange design with shape and text cues). All four styles use the same booking, guest, front-desk and manager functions, including the 1–8 guest capacity filter. The interface supports Kazakh, English and Russian, remembers the selected language, localizes dates and numbers, and respects the operating system's reduced-motion preference. Official mode uses a restrained fade/slide transition; the accessibility mode uses a gentle fade and disables decorative particles.

## What you can do

| Who | Page | What it does |
|---|---|---|
| Guest | Rooms | Search free rooms for two dates, see the total number of free rooms and the number available per type, filter by Standard, Deluxe, Suite or President, book a room, see the reservation number |
| Guest | Rooms, Flexible dates | Under the search results: the same number of nights starting up to 7 days earlier or later, with the price and free rooms per room type. The cheapest option is marked, "Use these dates" searches again |
| Guest | Booking confirmation, My reservations | Reservation history is available only after signing in; a keyed QR check-in pass is shown while Confirmed |
| Guest, front desk, manager | Guide (button at the bottom right) | A small offline helper that explains where things are for the current role, opens the right page and answers a few live questions (free rooms tonight, dirty rooms, price suggestions). Rule based, no internet, nothing leaves the page |
| Guest | My reservations | Signed-in guests see their own reservation history and manage eligible cancellations. Booking requires a guest account |
| Guest | Account | Profile banner and avatar, loyalty stats, editable name and phone, protected email, shortcuts and password controls |
| Front desk, Manager | Account | Profile banner and avatar, staff ID and role, editable name and phone, protected email, role shortcuts and password controls |
| Guest | Loyalty badge in the header | Open a progress view showing the exact number of completed stays needed for the next tier and the discount at each tier |
| Front desk | Staff, Reservations | Works with all 5,000 records page by page (25, 50 or 100 rows). Filter by status, text and check-in dates, sort, change dates, cancel |
| Front desk | Staff, Floor map | All 161 rooms by floor for any date: free, arriving, occupied, departing, maintenance, and an orange dot for dirty rooms. Click a room for its guest, the next booking and quick actions |
| Front desk | Staff, Housekeeping | A room becomes Dirty when the guest checks out (or at 12:00 on the check-out day), then Clean, then Inspected. The board lists what to clean today, rooms with a guest arriving today first |
| Front desk | Staff, Check-in | Scan the guest's QR pass (barcode scanner, or the camera in Chrome/Edge), or type the pass code or reservation number. Check in and check out; a dirty room gives a warning |
| Front desk | Staff, Email outbox | See every confirmation email, and send it again with one click if the guest did not get it |
| Front desk and manager | Account | Change your own password. Until then a warning shows that the demo password is still in use |
| Manager | Staff, Dashboard | Occupancy, revenue, most booked room types, arrivals, blocked double bookings, activity log. Shows the date of the first reservation ever and can be filtered by dates (From, To, "Since first reservation", "All time") |
| Manager | Staff, Reservations, Download CSV | Export all reservations that match the current filters (up to 50,000 rows) for Excel |
| Manager | Staff, Prices | Change the price per night of a room type. It applies to new bookings only |
| Manager | Staff, Prices, Price suggestions | A rule-based hint per room type, for example "Suite is 92% full next weekend, raise by 10%", with an Apply button. Nothing changes by itself |

### Dashboard date filter

Without dates the dashboard shows all time (occupancy: the next 30 days). With dates, every figure covers the period, both days included:
reservations count by check-in date, revenue by payment date (paid minus refunded), occupancy is booked nights divided by
available rooms times the days of the period. Only a start date means "until the last booked day", only an end date means "from the first reservation".
The first reservation date is the earliest check-in date in the database. The arrivals list always shows the next 7 days.

### Price suggestions

Occupancy is booked room-nights divided by available room-nights of a room type (rooms under maintenance are left out). The rules, in order:
the busiest of next weekend (Friday to Sunday) and the next 7 days is 90% full or more: raise 10%; 75% or more: raise 5%; the next 30 days are at least 1.5 times
fuller than the hotel's own last-year average and at least 25% full: raise 5%; at most 0.25 times the average: lower 10%, at most 0.5 times: lower 5%; otherwise keep.
Types with fewer than 5 rooms (the President room) only use the sell-out rules. Prices are rounded to 500 KZT. Applying a suggestion uses the normal price change, so existing reservations keep their price.

### Check-in pass, check-out and housekeeping

The check-in pass is `HB<reservation number>-<32 hexadecimal characters>`. It is an HMAC derived using a random per-database secret, rather than guest details. Staff may still type a reservation number at the front desk if a legacy QR pass no longer validates after upgrading.
The QR image is made by the server (`backend/qr.py`, standard library only). Check-in is possible from 14:00 rules: on the check-in date up to the day before check-out, only for Confirmed reservations.
Check-out sets the room to Dirty. Rooms whose stay reaches 12:00 on the check-out day without a manual check-out become Dirty automatically.
Order of room states: Dirty, then Clean, then Inspected (a room can be reported Dirty again from Clean or Inspected). Old databases get the new columns when the server starts.

### Changing prices

Only the Manager can change prices (front desk gets 403). Each change is written to the activity log.
Every reservation stores its total price and its price per night when it is booked. A price change updates only the price list,
so Confirmed, Completed and Cancelled reservations (and their payments) never change. If staff change the dates of a Confirmed
reservation later, the new total uses the price per night the guest booked at, not the new price list.

## How the double booking is prevented

1. The search shows only rooms with no Confirmed reservation that overlaps the dates.
2. A booking is one database transaction with a write lock: guest, reservation, payment and confirmation email are saved together or not at all.
3. Database triggers refuse an overlapping Confirmed reservation, also when an existing one is changed.
4. If someone still hits a taken room, the system answers 409 with other free rooms for the same dates.

Two stays overlap when: new check-in < old check-out AND new check-out > old check-in.
Leaving on the day another guest arrives is allowed.

## Requirements covered

| Requirement | State |
|---|---|
| FR-01 reject an overlapping reservation | Done (search, transaction, triggers, alternatives) |
| FR-02 confirmation email within 1 minute | Done. Sent right after the booking. Simulated and shown in the outbox unless SMTP is set |
| FR-03 staff cancel or modify up to 24 hours before check-in without manager approval | Done. Later than that only a manager may, and decides about the refund |
| NFR-01 95% of searches within 2 s at 300 users | Measured on the database: `py tools/measure_search.py` (one computer, no network) |
| NFR-02 99.5% uptime | Not measurable until the system is deployed |
| Business rule enforced in the database | Done (triggers) |

## Security

- Staff passwords are stored as PBKDF2-HMAC-SHA256 hashes with a random salt, never as text.
- Sessions use a random token in an HttpOnly, SameSite=Lax cookie. Only a hash of the token is stored.
- Every staff change needs a CSRF token. After 5 wrong passwords a login is paused for 5 minutes.
- Roles: Front desk and Manager. The server checks the role on every request.
- Passwords: at least 10 characters with letters and a digit. After a change every other login of that account is ended. Guessing the current password is limited like logging in.
- CSV export is for managers only, written to the activity log, and cells that start with = + - or @ get an apostrophe so Excel cannot run them as formulas.
- All SQL uses `?` placeholders (no SQL injection). All text shown in the browser is escaped (no script injection).
- Content-Security-Policy, nosniff and frame protection headers. Guest reservation history and cancellation are available only to the authenticated guest account that owns the reservation. New bookings require a guest account; staff use the separate QR check-in workflow.
- QR check-in passes use a per-database secret and a 128-bit HMAC prefix. The secret is generated locally and stored in the database; do not copy the database into public repositories or shared folders.
- Guest registration does not require email verification. Password recovery still uses an expiring eight-digit emailed code, stored as a salted hash and limited to five attempts; configure SMTP for recovery emails.
- The project still does not integrate a real payment provider. Card numbers are never requested or stored; the Card/Cash/Transfer payment workflow is simulated and must not be used to collect real payments.
- SQLite is appropriate for this small prototype. Its writes are serialized; for a larger multi-property or high-concurrency deployment, migrate to PostgreSQL and run load tests against the full HTTP application before promising a throughput target.

## Files

    run.py                   start the system
    backend/server.py        REST API, login, static files (WSGI)
    backend/db.py            business logic: search, booking, cancel, modify, dashboard
    backend/security.py      password hashing, signed sessions and token digests
    requirements.txt        production WSGI server dependency (Waitress)
    backend/schema.sql       tables, rules, triggers, reference data
    backend/features.py      floor map, housekeeping, pass and check-in, price calendar, price suggestions
    backend/qr.py            QR code encoder (standard library only)
    frontend/index.html, styles.css, app.js    the web app (no build step)
    frontend/assistant.js    the navigation guide
    tests/test_api.py        92 tests (backend, API, security, prices, dashboard filter, 5,000 records and paging)
    tests/test_features.py   25 tests (QR encoder, pass and check-in, housekeeping, floor map, price calendar, price suggestions)
    tests/ui/                browser-style test of the real pages (needs Node.js)
    tools/measure_search.py  speed measurement for NFR-01
    tools/check_database.py  row counts and integrity checks of the database
    tools/add_records.py     add more past reservations to the existing data (default 5,000)
    tools/backup.py         daily backup, verify and restore of the database
    DEPLOYMENT.md            how to run it on a real computer: HTTPS, start at boot, backups, updates

## API (JSON)

| Method and address | Who | Purpose |
|---|---|---|
| GET /api/rooms/search?check_in=&check_out= | Guest | Free rooms and prices |
| POST /api/bookings | Guest | Book a room |
| POST /api/bookings/lookup, /api/bookings/cancel | Guest | Find or cancel with number and email |
| POST /api/auth/login, /logout, GET /api/auth/me | Staff | Session |
| GET /api/staff/reservations?status=&q=&from=&to=&order=&page=&page_size= | Staff | One page of reservations and the total count |
| GET /api/staff/emails | Staff | Email outbox |
| POST /api/staff/reservations/{id}/cancel, /modify | Staff | Change a reservation |
| GET /api/manager/dashboard?from=&to= | Manager | Dashboard figures, optionally for a period (YYYY-MM-DD), with `first_reservation_date` |
| GET /api/manager/audit | Manager | Activity log |
| GET /api/manager/price-suggestions | Manager | Price suggestions per room type with occupancy figures and the rules |
| GET /api/rooms/price-calendar?check_in=&check_out=&flex= | Guest | Nearby date windows (flex 1 to 7 days) with free rooms and price per room type |
| GET /api/staff/floor-map?date= | Staff | State of every room for one day |
| GET /api/staff/housekeeping | Staff | Housekeeping board for today |
| POST /api/staff/rooms/{id}/housekeeping | Staff | Body `{"status": "Clean"}`: Dirty to Clean to Inspected, or report Dirty |
| GET /api/staff/passes/lookup?code= | Staff | Reservation for a pass code or number, and what can be done now |
| POST /api/staff/reservations/{id}/check-in, /check-out | Staff | Check in (optional `code`) or check out (room becomes Dirty) |
| GET /api/manager/room-types | Manager | Room types with number of rooms and price per night |
| POST /api/manager/room-types/{id}/price | Manager | Change the price per night (body: `{"price": 45000}`), new bookings only |

## Tests

    py -m unittest discover -s tests -v          # 117 tests
    py tools/measure_search.py                   # NFR-01 measurement

Browser-style test of the real pages (`ui_smoke.test.js` 54 checks, `ui_features.test.js` 32 checks for the new pages and the guide; run the second one on a fresh database), including paging through the 5,000 records, the dashboard date filter, price changes, resending emails, CSV download and changing the password (needs Node.js 18 or newer).
Use a throwaway database, because the test makes bookings:

    # terminal 1
    set HOTEL_DB=%TEMP%\ui_test.db & set PORT=8124 & py run.py --reset
    # terminal 2
    cd tests\ui & npm install & set BASE=http://127.0.0.1:8124 & npm test

## Settings (environment variables)

| Variable | Meaning |
|---|---|
| HOST, PORT | Address and port (default 127.0.0.1 and 8000) |
| HOTEL_DB | Path of the database file |
| FRONTDESK_PASSWORD, MANAGER_PASSWORD | Passwords for the demo accounts, used when the database is created |
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM | Send real emails instead of simulated ones |
| COOKIE_SECURE=1 | Mark the session cookie Secure (use with HTTPS) |

## Backup and restore

    py tools/backup.py                         # now, even while the server is running (keeps the newest 14)
    py tools/backup.py --dir D:\\bk --keep 30     # another folder and number
    py tools/backup.py verify FILE             # checksum and integrity check of a backup
    py tools/backup.py restore FILE --force    # put a backup back (stop the server first)

A backup is a consistent compressed copy with a SHA-256 checksum. It is not encrypted: keep the folder on an encrypted disk.
A restore keeps the old database next to it as `.before_restore_<time>`. See DEPLOYMENT.md to run the backup every night.

## Known limits and next steps

- It runs on one computer. For real use follow DEPLOYMENT.md (HTTPS reverse proxy, start at boot, nightly backups). The guide was written but has not been tried on a real server yet.
- The booking page is for demo payments only. A real payment provider is not connected.
- The ID scanner and keycard encoder from the hardware plan are not connected. The front-desk camera QR scanner uses `html5-qrcode` from cdnjs, so the browser needs internet access to load the library, camera permission, and localhost or HTTPS.
- Room prices are the same on every date, so the Flexible dates table shows differences only when a room type is sold out on some of the dates. Weekend or season prices would make it more useful.
- The guide is rule based (keywords and typo tolerance), not a language model. It knows the topics listed in `frontend/assistant.js`.
- Backups are not encrypted by this program.
- Search speed was measured on the database only, without a network.
- The login pause after wrong passwords is kept in memory and resets when the server restarts.

## Added hotel features

- **Loyalty:** completed stays determine the tier: Silver (2–4 stays, 5%), Gold (5–9, 8%), Platinum (10+, 12%). Click the signed-in guest's loyalty badge to see the next tier and the exact number of completed stays remaining. The tier and discount amount are stored on each new reservation so later tier changes do not alter old bookings. Staff can view guest counts by tier.
- **Booking extras:** breakfast (6,000 KZT), airport transfer (12,000 KZT), and late check-out (5,000 KZT) can be selected at booking. Each is recorded as a separate revenue category and shown in the manager dashboard.
- **Languages:** Kazakh, English and Russian are available across the shared interface. The language preference persists between sessions; dates, times and numbers follow the selected locale. English is the initial language on Official and Daltonism-safe pages; Kazakh is the initial language on Cyberpunk and GTA VI pages unless a saved preference exists.
- **QR webcam scanner:** the check-in page uses `html5-qrcode` and does not depend on the browser `BarcodeDetector` API. Camera access requires an internet connection for the CDN library, HTTPS or localhost, and browser permission.
- **My reservations:** guests must sign in before booking. Reservations are linked to the guest account and can be viewed, reviewed and cancelled according to the cancellation policy.

- **Maintenance tickets:** staff can create tickets with a reason, start date, expected end date and status. Open/In Progress tickets block overlapping room searches and show a wrench marker on the floor map. Resolving/cancelling a ticket releases the date block.
- **Guest reviews:** after a completed check-out, the signed-in reservation owner can submit a 1–5 rating and comment from My reservations. Room search cards show room average ratings; staff can review comments and see low ratings flagged.

## Loyalty demo accounts

For testing the four guest membership tiers, see [DEMO_CLIENT_ACCOUNTS.md](DEMO_CLIENT_ACCOUNTS.md). The sample profiles are for local demonstration only and should be changed or removed before public deployment.

## Visual themes and loyalty profiles

Choose one of four visual themes from the header: Official & Premium, Daltonism-safe / High Accessibility, GTA VI Style, or Cyberpunk. All themes share one set of booking and role-based application functions. The logged-in guest's loyalty tier (None, Silver, Gold, or Platinum) adds a separate accent and badge shape. The Daltonism-safe theme uses distinct shapes, patterns, labels and icons in addition to color, strong keyboard focus, large touch targets and reduced-motion behavior. All four styles now include a shared, page-wide particle field driven by local MP3 Web Audio metrics: GTA responds to bass hits, Cyberpunk to high-frequency transients, Official to smooth amplitude, and Daltonism uses slow geometric breathing with a Motion On/Off control. When the operating system requests reduced motion, the field freezes as a static pattern.

## Optional The GTA VI Style experience

A Kazakh-first GTA VI Style interface is available at `http://127.0.0.1:8000/gta-vi`. It uses the exact same frontend application, API client, account/session logic and backend routes as the default interface. This means guest booking, My Reservations, loyalty, account management, all front-desk and manager tools, housekeeping, QR check-in, reviews, reports and pricing controls are available in both interfaces. The existing Cyberpunk theme remains unchanged. Choose `GTA VI Style` in the System Interface selector to use the alternate visual skin; its separate `AFTER DARK` button toggles the nighttime palette without changing the selected theme. See `GTA_VI_STYLE.md` for details.

## Music player (GTA VI, Cyberpunk, Official and Daltonism)

The floating music drawer is shared across all four visual styles. It supports the provided local MP3 libraries with beat-responsive visualizers and an optional Spotify Embed tab. Local MP3 visualizers use the Web Audio API; Spotify playback remains inside Spotify's own embed and is not synchronized to visuals.

See [MUSIC_SETUP.md](MUSIC_SETUP.md) for playlist assignments, archive setup, playback controls, browser autoplay behavior and the beat-detection implementation. Install the supplied archives with `py tools/install_music.py ...` before testing local playback.
