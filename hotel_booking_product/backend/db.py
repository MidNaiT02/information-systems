"""Business logic and database access for the Hotel Booking System (SQLite, standard library only)."""
import math
import os
import random
import re
import smtplib
import sqlite3
from datetime import date, datetime, timedelta
from email.message import EmailMessage

import security

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
DB_PATH = os.environ.get("HOTEL_DB", os.path.join(ROOT, "data", "hotel.db"))
SCHEMA = os.path.join(BASE, "schema.sql")

METHODS = ("Card", "Cash", "Transfer")
FREE_CANCEL_HOURS = 24      # FR-03: staff may change a booking up to 24 hours before check-in
CHECK_IN_HOUR = 14          # check-in time is 14:00 on the check-in date

DEMO_RESERVATIONS = int(os.environ.get("HOTEL_RECORDS", "5000"))   # reservations created with the demo data
HISTORY_YEARS = 6           # the demo reservations are spread over this many past years (plus 45 days ahead)

STAFF_SEED = [
    ("Front Desk Demo", "FrontDesk", "frontdesk@hotel.example",
     os.environ.get("FRONTDESK_PASSWORD", "FrontDesk#2026")),
    ("Manager Demo", "Manager", "manager@hotel.example",
     os.environ.get("MANAGER_PASSWORD", "Manager#2026")),
]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^[0-9+()\- ]{6,20}$")


class BookingError(Exception):
    """A problem that can be shown to the user."""

    def __init__(self, message, status=400, code="bad_request", extra=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.extra = extra or {}


# ---------------------------------------------------------------- connection and setup
def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH, isolation_level=None, timeout=10)  # we control transactions
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def init_db(path=None, reset=False, demo_data=True, today=None, records=None):
    """Create the database on first run. Returns True if a new database was created."""
    path = path or DB_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if reset:
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(path + suffix):
                os.remove(path + suffix)
    if os.path.exists(path):
        migrate(path)
        return False
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        with open(SCHEMA, encoding="utf-8") as f:
            conn.executescript(f.read())
        for name, role, email, password in STAFF_SEED:
            salt, digest = security.hash_password(password)
            conn.execute("INSERT INTO staff(full_name, role, email, salt, password_hash) VALUES (?,?,?,?,?)",
                         (name, role, email, salt, digest))
        if demo_data:
            seed_demo_data(conn, today or date.today(), records)
    finally:
        conn.close()
    return True


def migrate(path):
    """Bring a database made by an older version up to date (adds the locked nightly rate and date indexes)."""
    conn = connect(path)
    try:
        columns = [r[1] for r in conn.execute("PRAGMA table_info(reservations)")]
        if "nightly_rate" not in columns:
            conn.execute("ALTER TABLE reservations ADD COLUMN nightly_rate REAL NOT NULL DEFAULT 0")
            # old reservations keep the price they were booked at: rate = saved total / nights
            conn.execute("""UPDATE reservations SET nightly_rate =
                             total_price / MAX(1, CAST(julianday(check_out) - julianday(check_in) AS INTEGER))""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_res_checkin ON reservations(check_in)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(payment_date)")
    finally:
        conn.close()


FIRST_NAMES = ["Aigerim", "Daniyar", "Marat", "Sara", "Timur", "Dana", "Yerlan", "Madina", "Askar", "Aliya",
               "Nurlan", "Zhanna", "Bauyrzhan", "Gulnara", "Ruslan", "Aizhan", "Kairat", "Saltanat", "Arman", "Dinara",
               "Berik", "Lyazzat", "Ermek", "Karina", "Sanzhar", "Laura", "Olzhas", "Assel", "Ilyas", "Moldir"]
LAST_NAMES = ["Sarsenov", "Kenzhebayev", "Bekov", "Nurmagambetova", "Akhmetov", "Zhaksylykov", "Tursynov", "Omarova",
              "Serikbayev", "Abdrakhmanova", "Kassymov", "Dosmailova", "Mukhametov", "Zhumabekova", "Satybaldiyev",
              "Ibraimova", "Baimukhanov", "Temirova", "Utegenov", "Kaliyeva"]


def seed_demo_data(conn, today, total=None):
    """Fictional guests and exactly `total` reservations (default 5,000) spread evenly over all bookable rooms
    and over the past 6 years, up to 45 days after today.

    Stays never overlap in the same room, about 12% are cancelled (with a refund), and
    stays that already ended are Completed. This gives the interface a realistic amount of data.
    """
    total = DEMO_RESERVATIONS if total is None else int(total)
    rng = random.Random(42)
    guests = max(12, min(900, total // 6))
    conn.execute("BEGIN")
    for i in range(1, guests + 1):
        conn.execute("INSERT INTO guests(full_name, phone, email) VALUES (?,?,?)",
                     (f"{FIRST_NAMES[(i - 1) % len(FIRST_NAMES)]} {LAST_NAMES[(i * 7) % len(LAST_NAMES)]}",
                      f"+7701{i:07d}", f"guest{i}@example.kz"))
    rooms = conn.execute(
        """SELECT r.room_id, rt.price_per_night FROM rooms r JOIN room_types rt USING(room_type_id)
           WHERE r.status = 'Available' ORDER BY r.room_id""").fetchall()
    per_room = [total // len(rooms) + (1 if i < total % len(rooms) else 0) for i in range(len(rooms))]
    try:
        first_day = today.replace(year=today.year - HISTORY_YEARS)
    except ValueError:                                      # 29 February
        first_day = today.replace(year=today.year - HISTORY_YEARS, day=28)
    last_day = today + timedelta(days=45)                   # the newest stays are upcoming bookings
    span = (last_day - first_day).days
    for room, count in zip(rooms, per_room):
        # cut the room's calendar into `count` equal slots and put one stay in each slot:
        # reservations are spread evenly over the years and can never overlap
        for k in range(count):
            slot_start = k * span // count
            slot_len = (k + 1) * span // count - slot_start
            nights = min(rng.randint(1, 4), slot_len)
            ci = first_day + timedelta(days=slot_start + rng.randint(0, slot_len - nights))
            co = ci + timedelta(days=nights)
            total_price = nights * room["price_per_night"]
            status = "Completed" if co < today else "Confirmed"
            res_id = conn.execute(
                "INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate) VALUES (?,?,?,?,?,?,?)",
                (rng.randint(1, guests), room["room_id"], ci.isoformat(), co.isoformat(), status, total_price,
                 room["price_per_night"])).lastrowid
            pay_day = min(today, ci - timedelta(days=rng.randint(3, 10)))
            method = rng.choice(METHODS)
            conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) VALUES (?,?,?,?,?)",
                         (res_id, total_price, method, pay_day.isoformat(), "Paid"))
            if rng.random() < 0.12:     # a cancelled booking (does not block the room)
                conn.execute("UPDATE reservations SET status='Cancelled' WHERE reservation_id=?", (res_id,))
                conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) VALUES (?,?,?,?,?)",
                             (res_id, total_price, method, min(today, pay_day + timedelta(days=1)).isoformat(), "Refunded"))
    conn.execute("COMMIT")


def add_demo_records(conn, count, today=None):
    """Add `count` more past reservations INTO the existing history. Nothing that exists is changed or deleted.

    The new stays are placed in free gaps between the existing stays of the same rooms, inside the
    period the data already covers (from the earliest stay until yesterday), so they never overlap
    a Confirmed booking. If the rooms are too full for that, the history is extended year by year
    further back. New fictional guests, payments and refunds are created as well.
    Returns {"added": number, "first": earliest date, "last": latest date}.
    """
    import bisect
    count = int(count)
    if count <= 0:
        raise BookingError("The number of records must be positive.", 400, "bad_count")
    today = today or date.today()
    existing = conn.execute("SELECT COUNT(*) FROM reservations").fetchone()[0]
    rng = random.Random(1000 + existing)                 # a different result each time it is used
    rooms = conn.execute(
        """SELECT r.room_id, rt.price_per_night FROM rooms r JOIN room_types rt USING(room_type_id)
           WHERE r.status = 'Available' ORDER BY r.room_id""").fetchall()
    if not rooms:
        raise BookingError("There are no available rooms to build stays for.", 400, "no_rooms")
    oldest = conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]
    try:
        default_first = today.replace(year=today.year - HISTORY_YEARS)
    except ValueError:                                    # 29 February
        default_first = today.replace(year=today.year - HISTORY_YEARS, day=28)
    first_day = min(date.fromisoformat(oldest), default_first) if oldest else default_first
    if (today - first_day).days < 10:
        raise BookingError("There is not enough past time to place new stays.", 400, "no_room_in_history")
    # existing stays that block a room, per room, as sorted lists of (check_in, check_out) day numbers
    busy = {r["room_id"]: [] for r in rooms}
    for row in conn.execute("SELECT room_id, check_in, check_out FROM reservations WHERE status IN ('Confirmed','Completed')"):
        if row["room_id"] in busy:
            busy[row["room_id"]].append((date.fromisoformat(row["check_in"]).toordinal(), date.fromisoformat(row["check_out"]).toordinal()))
    for stays in busy.values():
        stays.sort()

    def is_free(stays, a, b):
        i = bisect.bisect_left(stays, (a, a))
        if i > 0 and stays[i - 1][1] > a:                 # the stay before ends after our check-in
            return False
        if i < len(stays) and stays[i][0] < b:            # the stay after starts before our check-out
            return False
        return True

    conn.execute("BEGIN")
    try:
        last_guest = conn.execute("SELECT COALESCE(MAX(guest_id), 0) FROM guests").fetchone()[0]
        for i in range(1, max(1, min(900, count // 6)) + 1):
            idx = last_guest + i
            email = f"guest{idx}@example.kz"
            while conn.execute("SELECT 1 FROM guests WHERE email = ?", (email,)).fetchone():
                email = f"guest{idx}.{rng.randint(1000, 9999)}@example.kz"
            conn.execute("INSERT INTO guests(full_name, phone, email) VALUES (?,?,?)",
                         (f"{FIRST_NAMES[idx % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 7) % len(LAST_NAMES)]}",
                          f"+7701{idx:07d}", email))
        # only demo guests get the new history, guests that real people created are left alone
        guest_ids = [r[0] for r in conn.execute("SELECT guest_id FROM guests WHERE email LIKE 'guest%@example.kz'")]
        per_room = [count // len(rooms) + (1 if i < count % len(rooms) else 0) for i in range(len(rooms))]
        added, first_new, last_new = 0, today, first_day
        for room, number in zip(rooms, per_room):
            stays = busy[room["room_id"]]
            for _ in range(number):
                placed = False
                for _round in range(12):
                    for _attempt in range(200):
                        nights = rng.randint(1, 4)
                        ci = first_day + timedelta(days=rng.randint(0, max(0, (today - first_day).days - nights - 1)))
                        co = ci + timedelta(days=nights)
                        if co < today and is_free(stays, ci.toordinal(), co.toordinal()):
                            placed = True
                            break
                    if placed:
                        break
                    first_day -= timedelta(days=365)        # the calendar is too full: go one more year back
                if not placed:
                    raise BookingError("The past calendar is too full to place all new stays. Add fewer records.", 400, "history_full")
                bisect.insort(stays, (ci.toordinal(), co.toordinal()))
                total_price = nights * room["price_per_night"]
                res_id = conn.execute(
                    "INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate) VALUES (?,?,?,?,?,?,?)",
                    (rng.choice(guest_ids), room["room_id"], ci.isoformat(), co.isoformat(), "Completed", total_price,
                     room["price_per_night"])).lastrowid
                pay_day = min(today, ci - timedelta(days=rng.randint(3, 10)))
                method = rng.choice(METHODS)
                conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) VALUES (?,?,?,?,?)",
                             (res_id, total_price, method, pay_day.isoformat(), "Paid"))
                if rng.random() < 0.12:                   # a cancelled booking (does not block the room)
                    conn.execute("UPDATE reservations SET status='Cancelled' WHERE reservation_id=?", (res_id,))
                    conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) VALUES (?,?,?,?,?)",
                                 (res_id, total_price, method, min(today, pay_day + timedelta(days=1)).isoformat(), "Refunded"))
                added += 1
                first_new, last_new = min(first_new, ci), max(last_new, co)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"added": added, "first": first_new.isoformat(), "last": last_new.isoformat()}


# ---------------------------------------------------------------- validation helpers
def parse_dates(check_in, check_out):
    """Return (check_in, check_out, nights) as text and number, or raise BookingError."""
    try:
        d1 = datetime.strptime(str(check_in).strip(), "%Y-%m-%d").date()
        d2 = datetime.strptime(str(check_out).strip(), "%Y-%m-%d").date()
    except ValueError:
        raise BookingError("Dates must be written as YYYY-MM-DD, for example 2026-11-10.", 400, "bad_dates")
    if d2 <= d1:
        raise BookingError("Check-out must be later than check-in.", 400, "bad_dates")
    if (d2 - d1).days > 60:
        raise BookingError("A booking can be at most 60 nights.", 400, "bad_dates")
    return d1.isoformat(), d2.isoformat(), (d2 - d1).days


def require_not_past(check_in, today=None):
    today = today or date.today()
    if datetime.strptime(check_in, "%Y-%m-%d").date() < today:
        raise BookingError("Check-in cannot be in the past.", 400, "past_date")


def friendly(error):
    text = str(error)
    if "already booked" in text:
        return BookingError("Room is already booked for these dates.", 409, "room_unavailable")
    if "maintenance" in text:
        return BookingError("Room is under maintenance and cannot be booked.", 409, "room_maintenance")
    if "FOREIGN KEY" in text:
        return BookingError("The guest or the room does not exist.", 400, "not_found")
    return BookingError("The database rejected this data: " + text, 400, "db_error")


def hours_until_checkin(check_in, now=None):
    now = now or datetime.now()
    start = datetime.strptime(check_in, "%Y-%m-%d") + timedelta(hours=CHECK_IN_HOUR)
    return (start - now).total_seconds() / 3600.0


# ---------------------------------------------------------------- rooms
def search_free_rooms(conn, check_in, check_out):
    """Available rooms with no Confirmed reservation overlapping the dates."""
    ci, co, nights = parse_dates(check_in, check_out)
    rows = conn.execute(
        """SELECT ro.room_id, ro.room_number, ro.floor, rt.type_name, rt.capacity, rt.price_per_night
           FROM rooms ro JOIN room_types rt ON ro.room_type_id = rt.room_type_id
           WHERE ro.status = 'Available' AND ro.room_id NOT IN (
               SELECT room_id FROM reservations
               WHERE status = 'Confirmed' AND ? < check_out AND ? > check_in)
           ORDER BY rt.price_per_night, ro.room_number""", (ci, co)).fetchall()
    return [dict(r, total_price=r["price_per_night"] * nights) for r in rows], nights


def get_calendar_data(conn, start_date, end_date):
    """Room calendar for [start_date, end_date): all rooms, the stays that overlap the period
    (Confirmed and Completed) and the number of guests staying each night."""
    ci, co, _ = parse_dates(start_date, end_date)
    rooms = conn.execute(
        """SELECT ro.room_id, ro.room_number, ro.floor, rt.type_name
           FROM rooms ro JOIN room_types rt ON ro.room_type_id = rt.room_type_id
           ORDER BY ro.room_number""").fetchall()
    reservations = conn.execute(
        """SELECT r.reservation_id, r.room_id, r.check_in, r.check_out, r.status, g.full_name
           FROM reservations r JOIN guests g ON r.guest_id = g.guest_id
           WHERE r.status IN ('Confirmed','Completed') AND r.check_in < ? AND r.check_out > ?
           ORDER BY r.check_in""", (co, ci)).fetchall()
    daily_guests = []
    day, end = date.fromisoformat(ci), date.fromisoformat(co)
    while day < end:
        d = day.isoformat()
        n = conn.execute(
            """SELECT COUNT(*) FROM reservations
               WHERE status IN ('Confirmed','Completed') AND check_in <= ? AND check_out > ?""", (d, d)).fetchone()[0]
        daily_guests.append({"date": d, "guests": n})
        day += timedelta(days=1)
    return {"rooms": [dict(r) for r in rooms], "reservations": [dict(r) for r in reservations],
            "daily_guests": daily_guests}


def get_room(conn, room_id):
    return conn.execute(
        """SELECT ro.room_id, ro.room_number, ro.status, ro.floor, rt.type_name, rt.capacity, rt.price_per_night
           FROM rooms ro JOIN room_types rt ON ro.room_type_id = rt.room_type_id
           WHERE ro.room_id = ?""", (room_id,)).fetchone()


def alternatives(conn, check_in, check_out, exclude_room_id=None, limit=4):
    rooms, _ = search_free_rooms(conn, check_in, check_out)
    return [r for r in rooms if r["room_id"] != exclude_room_id][:limit]


# ---------------------------------------------------------------- booking
def _confirmation_text(res_id, guest_name, room, ci, co, nights, total):
    return (f"Dear {guest_name},\n\nYour booking is confirmed.\n\n"
            f"Reservation number: {res_id}\nRoom: {room['room_number']} ({room['type_name']})\n"
            f"Check-in: {ci} from {CHECK_IN_HOUR}:00\nCheck-out: {co}\nNights: {nights}\n"
            f"Total paid: {total:,.0f} KZT\n\n"
            f"Free cancellation up to {FREE_CANCEL_HOURS} hours before check-in.\n"
            "To manage your booking, use your reservation number and this email address.\n")


def book_room(conn, room_id, check_in, check_out, method, full_name="", phone="", email="",
              guest_id=None, simulate_payment_failure=False):
    """Save the guest (if new), the reservation, the payment and the confirmation email as ONE transaction.

    If any step fails everything is rolled back, so no half-finished booking remains.
    """
    ci, co, nights = parse_dates(check_in, check_out)
    if method not in METHODS:
        raise BookingError("Choose a payment method: Card, Cash or Transfer.", 400, "bad_method")
    try:
        room_id = int(room_id)
    except (TypeError, ValueError):
        raise BookingError("The room does not exist.", 404, "not_found")
    if guest_id is None:
        full_name, phone, email = str(full_name).strip(), str(phone).strip(), str(email).strip()
        if not full_name or not phone or not email:
            raise BookingError("Name, phone and email are required.", 400, "missing_field")
        if len(full_name) > 100 or len(email) > 100:
            raise BookingError("Name and email must be at most 100 characters.", 400, "bad_field")
        if not _PHONE_RE.match(phone):
            raise BookingError("Phone may contain digits, spaces, + ( ) and -, 6 to 20 characters.", 400, "bad_field")
        if not _EMAIL_RE.match(email):
            raise BookingError("Enter a valid email address, for example name@example.com.", 400, "bad_field")

    conn.execute("BEGIN IMMEDIATE")  # take the write lock before checking anything
    try:
        room = get_room(conn, room_id)
        if room is None:
            raise BookingError("The room does not exist.", 404, "not_found")
        if guest_id is None:
            found = conn.execute("SELECT guest_id, full_name FROM guests WHERE lower(email) = lower(?)", (email,)).fetchone()
            if found:
                guest_id, full_name = found["guest_id"], found["full_name"]
            else:
                guest_id = conn.execute("INSERT INTO guests(full_name, phone, email) VALUES (?,?,?)",
                                        (full_name, phone, email)).lastrowid
        total = nights * room["price_per_night"]
        res_id = conn.execute(
            """INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
               VALUES (?,?,?,?, 'Confirmed', ?, ?)""",
            (guest_id, room_id, ci, co, total, room["price_per_night"])).lastrowid
        if simulate_payment_failure:
            raise BookingError("Payment failed. The reservation was not saved.", 402, "payment_failed")
        conn.execute(
            """INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status)
               VALUES (?,?,?, date('now'), 'Paid')""", (res_id, total, method))
        to_email = email or conn.execute("SELECT email FROM guests WHERE guest_id=?", (guest_id,)).fetchone()[0]
        email_id = conn.execute(
            "INSERT INTO emails(reservation_id, to_email, subject, body) VALUES (?,?,?,?)",
            (res_id, to_email, f"Booking confirmation #{res_id}",
             _confirmation_text(res_id, full_name, room, ci, co, nights, total))).lastrowid
        conn.execute("COMMIT")
    except BookingError:
        conn.execute("ROLLBACK")
        raise
    except sqlite3.Error as e:
        conn.execute("ROLLBACK")
        raise friendly(e)
    return {"reservation_id": res_id, "room_id": room_id, "room_number": room["room_number"],
            "type_name": room["type_name"], "check_in": ci, "check_out": co, "nights": nights,
            "total_price": total, "email_id": email_id, "to_email": to_email}


# ---------------------------------------------------------------- confirmation emails (FR-02)
def deliver_pending_emails(conn):
    """Send every Pending email. Uses SMTP if SMTP_HOST is set, otherwise delivery is simulated."""
    host = os.environ.get("SMTP_HOST")
    sent = 0
    for row in conn.execute("SELECT * FROM emails WHERE status = 'Pending' ORDER BY email_id").fetchall():
        try:
            if host:
                msg = EmailMessage()
                msg["From"] = os.environ.get("SMTP_FROM", "bookings@hotel.example")
                msg["To"], msg["Subject"] = row["to_email"], row["subject"]
                msg.set_content(row["body"])
                with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=10) as smtp:
                    smtp.starttls()
                    if os.environ.get("SMTP_USER"):
                        smtp.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
                    smtp.send_message(msg)
                channel = "smtp"
            else:
                channel = "simulated"
            conn.execute("UPDATE emails SET status='Sent', channel=?, sent_at=datetime('now') WHERE email_id=?",
                         (channel, row["email_id"]))
            sent += 1
        except Exception:
            conn.execute("UPDATE emails SET status='Failed', channel='smtp' WHERE email_id=?", (row["email_id"],))
    return sent


def resend_email(conn, email_id):
    """Queue a copy of an email so that it is sent again. The old row stays as history. Returns the new id."""
    row = conn.execute("SELECT * FROM emails WHERE email_id = ?", (email_id,)).fetchone()
    if row is None:
        raise BookingError("Email not found.", 404, "not_found")
    subject = row["subject"] if row["subject"].endswith("(resent)") else row["subject"] + " (resent)"
    return conn.execute("INSERT INTO emails(reservation_id, to_email, subject, body) VALUES (?,?,?,?)",
                        (row["reservation_id"], row["to_email"], subject, row["body"])).lastrowid


def change_password(conn, staff_id, current, new, keep_token=None):
    """Change a staff password. The current password must be right, the new one must pass the password rules."""
    row = conn.execute("SELECT * FROM staff WHERE staff_id = ?", (staff_id,)).fetchone()
    if row is None:
        raise BookingError("Staff member not found.", 404, "not_found")
    if not security.verify_password(current, row["salt"], row["password_hash"]):
        raise BookingError("The current password is wrong.", 403, "wrong_password")
    if new == current:
        raise BookingError("Choose a password that is different from the current one.", 400, "same_password")
    problem = security.password_problem(new, row["email"])
    if problem:
        raise BookingError(problem, 400, "weak_password")
    salt, digest = security.hash_password(new)
    conn.execute("UPDATE staff SET salt = ?, password_hash = ? WHERE staff_id = ?", (salt, digest, staff_id))
    security.end_other_sessions(conn, staff_id, keep_token)


def get_email(conn, email_id):
    return conn.execute("SELECT * FROM emails WHERE email_id = ?", (email_id,)).fetchone()


def list_emails(conn, limit=100):
    return [dict(r) for r in conn.execute(
        "SELECT email_id, reservation_id, to_email, subject, body, status, channel, created_at, sent_at "
        "FROM emails ORDER BY email_id DESC LIMIT ?", (limit,)).fetchall()]


# ---------------------------------------------------------------- reading reservations
_NET_PAID = ("COALESCE((SELECT SUM(CASE p.status WHEN 'Paid' THEN p.amount WHEN 'Refunded' THEN -p.amount ELSE 0 END) "
             "FROM payments p WHERE p.reservation_id = r.reservation_id), 0)")


def _decorate(row, now=None):
    d = dict(row)
    hours = hours_until_checkin(d["check_in"], now)
    d["hours_until_checkin"] = round(hours, 1)
    d["free_cancellation"] = d["status"] == "Confirmed" and hours >= FREE_CANCEL_HOURS
    d["nights"] = (datetime.strptime(d["check_out"], "%Y-%m-%d") - datetime.strptime(d["check_in"], "%Y-%m-%d")).days
    return d


def reservation_detail(conn, reservation_id, now=None):
    row = conn.execute(
        f"""SELECT r.reservation_id, r.status, r.check_in, r.check_out, r.total_price, r.created_at,
                   g.full_name, g.email, g.phone, ro.room_number, ro.room_id, rt.type_name,
                   {_NET_PAID} AS paid
            FROM reservations r JOIN guests g ON g.guest_id = r.guest_id
            JOIN rooms ro ON ro.room_id = r.room_id JOIN room_types rt ON rt.room_type_id = ro.room_type_id
            WHERE r.reservation_id = ?""", (reservation_id,)).fetchone()
    return _decorate(row, now) if row else None


def find_guest_reservation(conn, reservation_id, email, now=None):
    """A guest can see a reservation only with the right reservation number AND email."""
    try:
        rid = int(reservation_id)
    except (TypeError, ValueError):
        rid = -1
    d = reservation_detail(conn, rid, now)
    if d is None or d["email"].lower() != str(email).strip().lower():
        raise BookingError("No reservation found for this number and email.", 404, "not_found")
    d.pop("phone", None)
    return d


_RES_JOINS = """FROM reservations r JOIN guests g ON g.guest_id = r.guest_id
               JOIN rooms ro ON ro.room_id = r.room_id JOIN room_types rt ON rt.room_type_id = ro.room_type_id"""


def _reservation_filter(status, q, date_from, date_to):
    """The WHERE clause shared by the paged list and the CSV export."""
    where, args = [], []
    if status in ("Confirmed", "Completed", "Cancelled"):
        where.append("r.status = ?")
        args.append(status)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        where.append("(lower(g.full_name) LIKE ? OR lower(g.email) LIKE ? OR ro.room_number LIKE ? OR CAST(r.reservation_id AS TEXT) = ?)")
        args += [like, like, like, q.strip()]
    for value, op in ((date_from, ">="), (date_to, "<=")):
        if value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise BookingError("Filter dates must be written as YYYY-MM-DD.", 400, "bad_dates")
            where.append(f"r.check_in {op} ?")
            args.append(value)
    return (("WHERE " + " AND ".join(where)) if where else ""), args


def list_reservations(conn, status=None, q=None, now=None, page=1, page_size=50,
                      date_from=None, date_to=None, order="desc"):
    """One page of reservations. Returns (rows, total) where total counts all rows that match the filter."""
    clause, args = _reservation_filter(status, q, date_from, date_to)
    page_size = max(1, min(int(page_size), 200))
    page = max(1, int(page))
    total = conn.execute(f"SELECT COUNT(*) {_RES_JOINS} {clause}", args).fetchone()[0]
    direction = "ASC" if order == "asc" else "DESC"
    rows = conn.execute(
        f"""SELECT r.reservation_id, r.status, r.check_in, r.check_out, r.total_price,
                   g.full_name, g.email, ro.room_number, rt.type_name, {_NET_PAID} AS paid
            {_RES_JOINS} {clause}
            ORDER BY r.check_in {direction}, r.reservation_id {direction} LIMIT ? OFFSET ?""",
        args + [page_size, (page - 1) * page_size]).fetchall()
    return [_decorate(r, now) for r in rows], total


EXPORT_LIMIT = 50000


def csv_cell(value):
    """Text that starts with = + - @ could run as a formula in Excel, so it gets a leading apostrophe."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def reservations_csv(conn, status=None, q=None, date_from=None, date_to=None, order="desc", limit=EXPORT_LIMIT):
    """All reservations that match the filter as CSV text (UTF-8 with a BOM so Excel shows letters correctly)."""
    import csv
    import io
    clause, args = _reservation_filter(status, q, date_from, date_to)
    direction = "ASC" if order == "asc" else "DESC"
    rows = conn.execute(
        f"""SELECT r.reservation_id, g.full_name, g.email, ro.room_number, rt.type_name, r.check_in, r.check_out,
                   CAST(julianday(r.check_out) - julianday(r.check_in) AS INTEGER) AS nights, r.status,
                   r.nightly_rate, r.total_price, {_NET_PAID} AS paid
            {_RES_JOINS} {clause}
            ORDER BY r.check_in {direction}, r.reservation_id {direction} LIMIT ?""", args + [limit]).fetchall()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["reservation_id", "guest", "email", "room", "room_type", "check_in", "check_out", "nights",
                     "status", "nightly_rate", "total_price", "paid_net"])
    for r in rows:
        writer.writerow([r["reservation_id"], csv_cell(r["full_name"]), csv_cell(r["email"]), csv_cell(r["room_number"]),
                         csv_cell(r["type_name"]), r["check_in"], r["check_out"], r["nights"], r["status"],
                         r["nightly_rate"], r["total_price"], r["paid"]])
    return "\ufeff" + out.getvalue(), len(rows)


def complete_past_reservations(conn, today=None):
    """Confirmed reservations whose check-out date has passed become Completed. Returns the count."""
    today = today or date.today().isoformat()
    return conn.execute("UPDATE reservations SET status='Completed' WHERE status='Confirmed' AND check_out < ?",
                        (today,)).rowcount


# ---------------------------------------------------------------- cancel and modify (FR-03)
def _net_paid(conn, reservation_id):
    return conn.execute(
        """SELECT COALESCE(SUM(CASE status WHEN 'Paid' THEN amount WHEN 'Refunded' THEN -amount ELSE 0 END), 0)
           FROM payments WHERE reservation_id = ?""", (reservation_id,)).fetchone()[0]


def _last_method(conn, reservation_id):
    row = conn.execute("SELECT payment_method FROM payments WHERE reservation_id=? ORDER BY payment_id DESC LIMIT 1",
                       (reservation_id,)).fetchone()
    return row[0] if row else "Card"


def cancel_reservation(conn, reservation_id, actor_role, now=None, refund=None):
    """Cancel a Confirmed reservation.

    More than 24 hours before check-in anyone may cancel and the guest is refunded in full.
    Later than that only a Manager may cancel, and the refund is the manager's decision.
    """
    now = now or datetime.now()
    conn.execute("BEGIN IMMEDIATE")
    try:
        r = conn.execute("SELECT * FROM reservations WHERE reservation_id = ?", (reservation_id,)).fetchone()
        if r is None:
            raise BookingError("Reservation not found.", 404, "not_found")
        if r["status"] != "Confirmed":
            raise BookingError("Only a Confirmed reservation can be cancelled.", 409, "not_confirmed")
        late = hours_until_checkin(r["check_in"], now) < FREE_CANCEL_HOURS
        if late and actor_role != "Manager":
            raise BookingError("Less than 24 hours before check-in: manager approval needed.", 403, "manager_approval")
        refund_it = (not late) or bool(refund)
        conn.execute("UPDATE reservations SET status = 'Cancelled' WHERE reservation_id = ?", (reservation_id,))
        refunded = 0.0
        paid = _net_paid(conn, reservation_id)
        if refund_it and paid > 0:
            conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) "
                         "VALUES (?,?,?, date('now'), 'Refunded')", (reservation_id, paid, _last_method(conn, reservation_id)))
            refunded = paid
        conn.execute("COMMIT")
        return {"reservation_id": reservation_id, "status": "Cancelled", "refunded": refunded, "late": late}
    except BookingError:
        conn.execute("ROLLBACK")
        raise
    except sqlite3.Error as e:
        conn.execute("ROLLBACK")
        raise friendly(e)


def modify_reservation(conn, reservation_id, new_check_in, new_check_out, actor_role, now=None):
    """Change the dates of a Confirmed reservation. The price difference is charged or refunded."""
    ci, co, nights = parse_dates(new_check_in, new_check_out)
    now = now or datetime.now()
    conn.execute("BEGIN IMMEDIATE")
    try:
        r = conn.execute("SELECT * FROM reservations WHERE reservation_id = ?", (reservation_id,)).fetchone()
        if r is None:
            raise BookingError("Reservation not found.", 404, "not_found")
        if r["status"] != "Confirmed":
            raise BookingError("Only a Confirmed reservation can be changed.", 409, "not_confirmed")
        if hours_until_checkin(r["check_in"], now) < FREE_CANCEL_HOURS and actor_role != "Manager":
            raise BookingError("Less than 24 hours before check-in: manager approval needed.", 403, "manager_approval")
        # the guest keeps the rate they booked at, even if the manager changed the price list since
        old_nights = (datetime.strptime(r["check_out"], "%Y-%m-%d") - datetime.strptime(r["check_in"], "%Y-%m-%d")).days
        price = r["nightly_rate"] or (r["total_price"] / old_nights)
        new_total = nights * price
        conn.execute("UPDATE reservations SET check_in=?, check_out=?, total_price=? WHERE reservation_id=?",
                     (ci, co, new_total, reservation_id))  # the trigger refuses an overlap
        diff = new_total - r["total_price"]
        method = _last_method(conn, reservation_id)
        if diff > 0:
            conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) "
                         "VALUES (?,?,?, date('now'), 'Paid')", (reservation_id, diff, method))
        elif diff < 0:
            conn.execute("INSERT INTO payments(reservation_id, amount, payment_method, payment_date, status) "
                         "VALUES (?,?,?, date('now'), 'Refunded')", (reservation_id, -diff, method))
        conn.execute("COMMIT")
        return {"reservation_id": reservation_id, "check_in": ci, "check_out": co, "nights": nights,
                "total_price": new_total, "difference": diff}
    except BookingError:
        conn.execute("ROLLBACK")
        raise
    except sqlite3.Error as e:
        conn.execute("ROLLBACK")
        raise friendly(e)


# ---------------------------------------------------------------- audit log and dashboard
def audit(conn, actor, action, detail=""):
    conn.execute("INSERT INTO audit_log(actor, action, detail) VALUES (?,?,?)", (actor, action, detail))


def list_audit(conn, limit=40):
    return [dict(r) for r in conn.execute("SELECT ts, actor, action, detail FROM audit_log ORDER BY log_id DESC LIMIT ?",
                                          (limit,)).fetchall()]


def _parse_day(value, label):
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except ValueError:
        raise BookingError(f"The {label} date must be written as YYYY-MM-DD.", 400, "bad_dates")


def first_reservation_date(conn):
    """Check-in date of the earliest reservation ever made (None when there are no reservations)."""
    return conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]


def dashboard(conn, now=None, date_from=None, date_to=None):
    """Manager figures.

    Without dates: revenue, counts and charts cover all time, occupancy covers the next 30 days.
    With dates (both ends included): every figure covers that period. Reservations count by check-in date,
    payments by payment date. A missing start means the first reservation ever, a missing end the last day booked.
    """
    now = now or datetime.now()
    today = now.date()
    first = first_reservation_date(conn)
    filtered = bool(date_from or date_to)
    if filtered:
        start = _parse_day(date_from, "start") if date_from else (
            datetime.strptime(first, "%Y-%m-%d").date() if first else today)
        if date_to:
            end = _parse_day(date_to, "end")
        else:
            last = conn.execute("SELECT MAX(check_out) FROM reservations").fetchone()[0]
            end = max(start, datetime.strptime(last, "%Y-%m-%d").date()) if last else start
        if end < start:
            raise BookingError("The end date must not be before the start date.", 400, "bad_dates")
    else:
        start, end = today, today + timedelta(days=29)
    s_iso, e_iso = start.isoformat(), end.isoformat()
    end_excl = (end + timedelta(days=1)).isoformat()      # a stay occupies the nights before its check-out day

    def occupancy(a, b_excl, nights):
        capacity = rooms_available * nights
        booked = conn.execute(
            """SELECT COALESCE(SUM(MAX(0, julianday(MIN(check_out, ?)) - julianday(MAX(check_in, ?)))), 0)
               FROM reservations WHERE status IN ('Confirmed','Completed') AND check_out > ? AND check_in < ?""",
            (b_excl, a, a, b_excl)).fetchone()[0]
        return round(100.0 * booked / capacity, 1) if capacity else 0.0

    rooms_available = conn.execute("SELECT COUNT(*) FROM rooms WHERE status='Available'").fetchone()[0]
    nights_in_period = (end - start).days + 1
    occupancy_period = occupancy(s_iso, end_excl, nights_in_period)
    horizon = (today + timedelta(days=30)).isoformat()
    occupancy_30 = occupancy(today.isoformat(), horizon, 30)

    pay_where, pay_args = ("WHERE p.payment_date BETWEEN ? AND ?", [s_iso, e_iso]) if filtered else ("", [])
    res_where, res_args = ("AND r.check_in BETWEEN ? AND ?", [s_iso, e_iso]) if filtered else ("", [])
    net_expr = "SUM(CASE p.status WHEN 'Paid' THEN p.amount WHEN 'Refunded' THEN -p.amount ELSE 0 END)"
    revenue_total = conn.execute(f"SELECT COALESCE({net_expr}, 0) FROM payments p {pay_where}", pay_args).fetchone()[0]
    by_type = [dict(r) for r in conn.execute(
        f"""SELECT rt.type_name, COALESCE({net_expr}, 0) AS revenue
            FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id
            JOIN rooms ro ON ro.room_id = r.room_id JOIN room_types rt ON rt.room_type_id = ro.room_type_id
            {pay_where} GROUP BY rt.type_name ORDER BY revenue DESC""", pay_args).fetchall()]
    most_booked = [dict(r) for r in conn.execute(
        f"""SELECT rt.type_name, COUNT(*) AS reservations
            FROM reservations r JOIN rooms ro ON ro.room_id = r.room_id JOIN room_types rt ON rt.room_type_id = ro.room_type_id
            WHERE r.status IN ('Confirmed','Completed') {res_where} GROUP BY rt.type_name ORDER BY reservations DESC""",
        res_args).fetchall()]
    counts = {r["status"]: r["n"] for r in conn.execute(
        f"SELECT r.status, COUNT(*) AS n FROM reservations r WHERE 1=1 {res_where} GROUP BY r.status", res_args)}
    total_res = sum(counts.values()) or 1
    # daily chart: the last 14 days of the period (all time: the last 14 days up to today)
    chart_end = (min(end, today) if start <= today else end) if filtered else today
    chart_start = max(start, chart_end - timedelta(days=13)) if filtered else chart_end - timedelta(days=13)
    days = (chart_end - chart_start).days + 1
    daily_map = {r["payment_date"]: r["net"] for r in conn.execute(
        f"""SELECT payment_date, COALESCE({net_expr}, 0) AS net FROM payments p
            WHERE payment_date BETWEEN ? AND ? GROUP BY payment_date""",
        (chart_start.isoformat(), chart_end.isoformat())).fetchall()}
    daily = [{"date": (chart_start + timedelta(days=i)).isoformat(),
              "revenue": daily_map.get((chart_start + timedelta(days=i)).isoformat(), 0)} for i in range(days)]
    arrivals = [dict(r) for r in conn.execute(
        """SELECT r.reservation_id, g.full_name, ro.room_number, rt.type_name, r.check_in, r.check_out
           FROM reservations r JOIN guests g ON g.guest_id = r.guest_id JOIN rooms ro ON ro.room_id = r.room_id
           JOIN room_types rt ON rt.room_type_id = ro.room_type_id
           WHERE r.status = 'Confirmed' AND r.check_in BETWEEN ? AND ?
           ORDER BY r.check_in, ro.room_number""",
        (today.isoformat(), (today + timedelta(days=7)).isoformat())).fetchall()]
    blocked_sql = "SELECT COUNT(*) FROM audit_log WHERE action = 'double_booking_blocked'"
    blocked = (conn.execute(blocked_sql + " AND substr(ts, 1, 10) BETWEEN ? AND ?", (s_iso, e_iso)).fetchone()[0]
               if filtered else conn.execute(blocked_sql).fetchone()[0])
    return {
        "first_reservation_date": first,
        "period": {"from": s_iso, "to": e_iso, "filtered": filtered, "nights": nights_in_period},
        "occupancy": occupancy_period,
        "occupancy_30_days": occupancy_30,
        "revenue_net": revenue_total,
        "upcoming_bookings": counts.get("Confirmed", 0),
        "cancellation_rate": round(100.0 * counts.get("Cancelled", 0) / total_res, 1),
        "double_bookings_blocked": blocked,
        "status_counts": counts,
        "revenue_by_type": by_type,
        "most_booked_types": most_booked,
        "daily_revenue": daily,
        "arrivals_next_7_days": arrivals,
    }


# ---------------------------------------------------------------- room types and prices (manager)
MAX_PRICE = 10_000_000


def list_room_types(conn):
    return [dict(r) for r in conn.execute(
        """SELECT rt.room_type_id, rt.type_name, rt.capacity, rt.price_per_night,
                  COUNT(ro.room_id) AS rooms,
                  COALESCE(SUM(ro.status = 'Maintenance'), 0) AS in_maintenance
           FROM room_types rt LEFT JOIN rooms ro ON ro.room_type_id = rt.room_type_id
           GROUP BY rt.room_type_id ORDER BY rt.price_per_night""").fetchall()]


def set_room_type_price(conn, room_type_id, price):
    """Change the nightly price of a room type for FUTURE bookings only.

    Existing reservations (Confirmed, Completed and Cancelled) keep the total_price and nightly_rate
    saved when they were booked. Only the room_types row is updated here.
    """
    if isinstance(price, bool):
        raise BookingError("Enter the price as a number.", 400, "bad_price")
    try:
        value = float(price)
    except (TypeError, ValueError):
        raise BookingError("Enter the price as a number.", 400, "bad_price")
    if not math.isfinite(value) or value <= 0 or value > MAX_PRICE:
        raise BookingError(f"The price must be more than 0 and at most {MAX_PRICE:,} KZT.".replace(",", " "),
                           400, "bad_price")
    value = round(value, 2)
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT type_name, price_per_night FROM room_types WHERE room_type_id = ?",
                           (room_type_id,)).fetchone()
        if row is None:
            raise BookingError("Room type not found.", 404, "not_found")
        if row["price_per_night"] != value:
            conn.execute("UPDATE room_types SET price_per_night = ? WHERE room_type_id = ?", (value, room_type_id))
        conn.execute("COMMIT")
    except BookingError:
        conn.execute("ROLLBACK")
        raise
    except sqlite3.Error as e:
        conn.execute("ROLLBACK")
        raise friendly(e)
    return {"room_type_id": room_type_id, "type_name": row["type_name"], "old_price": row["price_per_night"],
            "new_price": value, "changed": row["price_per_night"] != value}
