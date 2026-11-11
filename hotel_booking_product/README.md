# Hotel Booking System

A working information system for a small hotel: guests search and book rooms in the browser,
front-desk staff manage reservations, and the manager sees a dashboard.
Backend (REST API + SQLite database) and frontend (single-page web app) are separate parts of the project.

Team: Akzhigitov Abilkaiyr (24B032188), Kurbanaliyev Alibek (24B030184), Kabizhan Arnur (25B032104)

Problem it solves: guests were double-booked into the same room because staff checked availability by hand.
Now the system checks the dates for you, and the database itself refuses an overlapping booking.

## Run it (Python 3.8 or newer, nothing to install)

    py run.py                # Windows. On Mac or Linux: python3 run.py
    # open http://127.0.0.1:8000

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

Demo staff accounts (change the passwords before any real use, see "Settings"):

| Role | Email | Password |
|---|---|---|
| Front desk | frontdesk@hotel.example | FrontDesk#2026 |
| Manager | manager@hotel.example | Manager#2026 |

## What you can do

| Who | Page | What it does |
|---|---|---|
| Guest | Rooms | Search free rooms for two dates (one card per room type with the number of free rooms), book a room, see the reservation number |
| Guest | My booking | Find a booking with its number and email, cancel it free of charge until 24 hours before check-in |
| Front desk | Staff, Reservations | Works with all 5,000 records page by page (25, 50 or 100 rows). Filter by status, text and check-in dates, sort, change dates, cancel |
| Front desk | Staff, Email outbox | See every confirmation email, and send it again with one click if the guest did not get it |
| Front desk and manager | Account | Change your own password. Until then a warning shows that the demo password is still in use |
| Manager | Staff, Dashboard | Occupancy, revenue, most booked room types, arrivals, blocked double bookings, activity log. Shows the date of the first reservation ever and can be filtered by dates (From, To, "Since first reservation", "All time") |
| Manager | Staff, Reservations, Download CSV | Export all reservations that match the current filters (up to 50,000 rows) for Excel |
| Manager | Staff, Prices | Change the price per night of a room type. It applies to new bookings only |

### Dashboard date filter

Without dates the dashboard shows all time (occupancy: the next 30 days). With dates, every figure covers the period, both days included:
reservations count by check-in date, revenue by payment date (paid minus refunded), occupancy is booked nights divided by
available rooms times the days of the period. Only a start date means "until the last booked day", only an end date means "from the first reservation".
The first reservation date is the earliest check-in date in the database. The arrivals list always shows the next 7 days.

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
- Content-Security-Policy, nosniff and frame protection headers. Guests see a booking only with number and email.
- Card numbers are never asked for or stored. Payment is simulated.

## Files

    run.py                   start the system
    backend/server.py        REST API, login, static files (WSGI)
    backend/db.py            business logic: search, booking, cancel, modify, dashboard
    backend/security.py      password hashing and sessions
    backend/schema.sql       tables, rules, triggers, reference data
    frontend/index.html, styles.css, app.js    the web app (no build step)
    tests/test_api.py        92 tests (backend, API, security, prices, dashboard filter, 5,000 records and paging)
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
| GET /api/manager/room-types | Manager | Room types with number of rooms and price per night |
| POST /api/manager/room-types/{id}/price | Manager | Change the price per night (body: `{"price": 45000}`), new bookings only |

## Tests

    py -m unittest discover -s tests -v          # 92 tests
    py tools/measure_search.py                   # NFR-01 measurement

Browser-style test of the real pages, 54 checks including paging through the 5,000 records, the dashboard date filter, price changes, resending emails, CSV download and changing the password (needs Node.js 18 or newer).
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
- The ID scanner and keycard encoder from the hardware plan are not connected.
- Backups are not encrypted by this program.
- Search speed was measured on the database only, without a network.
- The login pause after wrong passwords is kept in memory and resets when the server restarts.
