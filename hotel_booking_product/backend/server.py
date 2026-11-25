"""Hotel Booking System: JSON API + static frontend (WSGI, standard library only)."""
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
import traceback
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

import db
import features
import security
import enhancements
import music


FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
COOKIE = "session"
GUEST_COOKIE = "guest_session"
MAX_BODY = 100_000
LOGIN_LIMIT, LOGIN_WINDOW = 5, 300          # 5 wrong passwords, then 5 minutes pause
_failed = {}                                 # email -> list of timestamps

SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "DENY"),
    ("Content-Security-Policy",
     "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://cdnjs.cloudflare.com https://open.spotify.com; frame-src https://open.spotify.com; "
     "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"),
]


class Ctx:
    """Everything a handler needs for one request."""

    def __init__(self, conn, method, path, query, body, user, params):
        self.conn, self.method, self.path = conn, method, path
        self.query, self.body, self.user, self.params = query, body, user, params
        self.today = date.today()
        self.now = datetime.now()
        self.cookies = []          # extra Set-Cookie headers
        self.token = None          # staff session token, if any
        self.guest_token = None

    def q(self, name, default=""):
        return self.query.get(name, [default])[0]


# ------------------------------------------------------------------ public handlers
def api_health(c):
    """Used by monitoring: answers 200 only if the database can be read."""
    try:
        c.conn.execute("SELECT 1 FROM rooms LIMIT 1").fetchone()
    except Exception:
        raise db.BookingError("The database cannot be read.", 503, "database_down")
    return 200, {"status": "ok", "database": "ok", "time": c.now.isoformat(timespec="seconds")}


def api_search(c):
    ci, co = c.q("check_in"), c.q("check_out")
    ci, co, _ = db.parse_dates(ci, co)
    db.require_not_past(ci, c.today)
    try:
        guest_count = int(c.q("guests", "1"))
    except (TypeError, ValueError):
        raise db.BookingError("Enter a valid number of guests.", 400, "bad_guest_count")
    if guest_count < 1 or guest_count > 8:
        raise db.BookingError("Guest count must be between 1 and 8.", 400, "bad_guest_count")
    rooms, nights = db.search_free_rooms(c.conn, ci, co)
    rooms = [room for room in rooms if int(room.get("capacity", 1)) >= guest_count]
    return 200, {"check_in": ci, "check_out": co, "nights": nights, "guest_count": guest_count, "rooms": rooms}


def api_book(c):
    b = c.body
    ci, co, _ = db.parse_dates(b.get("check_in", ""), b.get("check_out", ""))
    db.require_not_past(ci, c.today)
    guest_id = None
    full_name, phone, email = b.get("full_name", ""), b.get("phone", ""), b.get("email", "")
    if c.user and c.user.get("role") == "Guest":
        # A signed-in guest's reservation must belong to their account, not just their email text.
        guest_id = c.user["guest_id"]
        account_guest = c.conn.execute(
            "SELECT full_name, phone, email FROM guests WHERE guest_id=?", (guest_id,)
        ).fetchone()
        if account_guest is None:
            raise db.BookingError("Your guest account could not be found. Please sign in again.", 401, "login_required")
        full_name, phone, email = account_guest["full_name"], account_guest["phone"], account_guest["email"]
    try:
        res = db.book_room(c.conn, b.get("room_id"), ci, co, str(b.get("method", "")),
                           full_name, phone, email, guest_id=guest_id,
                           simulate_payment_failure=bool(b.get("simulate_payment_failure")), add_ons=b.get("add_ons", []), guest_count=b.get("guest_count", 1))
    except db.BookingError as e:
        if e.code == "room_unavailable":
            db.audit(c.conn, "guest", "double_booking_blocked", f"room {b.get('room_id')} {ci} to {co}")
        if e.code in ("room_unavailable", "room_maintenance"):
            try:
                e.extra["alternatives"] = db.alternatives(c.conn, ci, co, exclude_room_id=int(b.get("room_id")))
            except (TypeError, ValueError):
                pass
        raise
    db.deliver_pending_emails(c.conn)           # FR-02: sent right after the booking is saved
    mail = db.get_email(c.conn, res["email_id"])
    res["email"] = {"to": mail["to_email"], "status": mail["status"], "channel": mail["channel"],
                    "sent_at": mail["sent_at"]}
    res["pass"] = features.pass_for(c.conn, res["reservation_id"])
    return 201, res


def api_price_calendar(c):
    return 200, features.price_calendar(c.conn, c.q("check_in"), c.q("check_out"), c.q("flex", "3"), c.today)


def api_guest_cancel(c):
    """A guest may cancel only a reservation owned by the signed-in account."""
    try:
        reservation_id = int(c.body.get("reservation_id"))
    except (TypeError, ValueError):
        raise db.BookingError("Enter a valid reservation number.", 400, "bad_reservation_number")
    owned = c.conn.execute(
        "SELECT 1 FROM reservations WHERE reservation_id=? AND guest_id=?",
        (reservation_id, c.user["guest_id"])
    ).fetchone()
    if not owned:
        raise db.BookingError("No reservation found for this account.", 404, "not_found")
    result = db.cancel_reservation(c.conn, reservation_id, "Guest", c.now)
    db.audit(c.conn, c.user["email"], "guest_cancel", f"reservation {reservation_id}")
    return 200, result


# ------------------------------------------------------------------ authentication
_default_cache = {}


def uses_default_password(conn, staff_id):
    """True while the account still has the demo password from the seed data (cached per stored hash)."""
    row = conn.execute("SELECT email, salt, password_hash FROM staff WHERE staff_id = ?", (staff_id,)).fetchone()
    if row is None:
        return False
    if row["password_hash"] not in _default_cache:
        _default_cache[row["password_hash"]] = any(
            security.verify_password(p, row["salt"], row["password_hash"])
            for _n, _r, e, p in db.STAFF_SEED if e.lower() == row["email"].lower())
    return _default_cache[row["password_hash"]]


def _throttled(email):
    now = time.time()
    recent = [t for t in _failed.get(email, []) if now - t < LOGIN_WINDOW]
    _failed[email] = recent
    return len(recent) >= LOGIN_LIMIT


def api_login(c):
    security.end_guest_session(c.conn, c.guest_token)
    email = str(c.body.get("email", "")).strip().lower()
    password = str(c.body.get("password", ""))
    if _throttled(email):
        raise db.BookingError("Too many wrong passwords. Try again in 5 minutes.", 429, "too_many_attempts")
    row = security.check_login(c.conn, email, password)
    if row is None:
        _failed.setdefault(email, []).append(time.time())
        db.audit(c.conn, email or "unknown", "login_failed", "")
        raise db.BookingError("Wrong email or password.", 401, "bad_login")
    _failed.pop(email, None)
    token, csrf = security.new_session(c.conn, row["staff_id"])
    flags = "; HttpOnly; SameSite=Lax; Path=/; Max-Age=%d" % (security.SESSION_HOURS * 3600)
    if os.environ.get("COOKIE_SECURE") == "1":
        flags += "; Secure"
    c.cookies.append(f"{COOKIE}={token}{flags}")
    c.cookies.append(f"{GUEST_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
    db.audit(c.conn, row["email"], "login", "")
    return 200, {"user": {"name": row["full_name"], "role": row["role"], "email": row["email"],
                          "default_password": uses_default_password(c.conn, row["staff_id"])}, "csrf": csrf}


def _guest_profile(conn, guest_id, name, email, phone=""):
    membership = enhancements.loyalty_progress(conn, guest_id)
    return {"name": name, "role": "Guest", "email": email, "phone": phone or "",
            "loyalty_tier": membership["tier"], "loyalty_discount": membership["discount_percent"],
            "completed_stays": membership["completed_stays"],
            "loyalty_progress": {k: membership[k] for k in
                ("next_tier", "next_threshold", "stays_to_next", "progress_percent", "is_max_tier")}}


def api_guest_reservations(c):
    """Return every reservation belonging to the signed-in guest account."""
    if not c.user or c.user.get("role") != "Guest":
        raise db.BookingError("Sign in with your guest account to view your reservations.", 401, "login_required")
    db.complete_past_reservations(c.conn)
    ids = c.conn.execute(
        "SELECT reservation_id FROM reservations WHERE guest_id=? ORDER BY check_in DESC, reservation_id DESC",
        (c.user["guest_id"],)
    ).fetchall()
    reservations = []
    for row in ids:
        item = db.reservation_detail(c.conn, row["reservation_id"], c.now)
        if item:
            item["pass"] = features.pass_for(c.conn, item["reservation_id"]) if item["status"] in ("Confirmed", "Completed") else None
            reservations.append(item)
    profile = _guest_profile(c.conn, c.user["guest_id"], c.user["name"], c.user["email"], c.user.get("phone", ""))
    return 200, {"reservations": reservations, "count": len(reservations), "user": profile}


def api_guest_register(c):
    """Create a guest account immediately; no email-verification step is required."""
    name = str(c.body.get("full_name", "")).strip()
    phone = str(c.body.get("phone", "")).strip()
    email = str(c.body.get("email", "")).strip().lower()
    password = str(c.body.get("password", ""))
    if len(name) < 2 or len(name) > 100:
        raise db.BookingError("Enter your full name (2–100 characters).", 400, "bad_name")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 100:
        raise db.BookingError("Enter a valid email address.", 400, "bad_email")
    if not phone or len(phone) > 20:
        raise db.BookingError("Enter a valid phone number (up to 20 characters).", 400, "bad_phone")
    problem = security.password_problem(password, email)
    if problem:
        raise db.BookingError(problem, 400, "weak_password")
    if c.conn.execute("SELECT 1 FROM staff WHERE lower(email)=lower(?)", (email,)).fetchone():
        raise db.BookingError("This email is reserved for a staff account.", 409, "email_in_use")
    if c.conn.execute("SELECT 1 FROM guest_accounts a JOIN guests g USING(guest_id) WHERE lower(g.email)=lower(?)", (email,)).fetchone():
        raise db.BookingError("An account already exists for this email. Please log in.", 409, "account_exists")

    # Without proving email ownership, never attach an account to an old booking
    # that was created before the guest registered. That would allow account takeover.
    existing_guest = c.conn.execute("SELECT guest_id FROM guests WHERE lower(email)=lower(?)", (email,)).fetchone()
    if existing_guest:
        raise db.BookingError(
            "This email is already attached to a reservation created before an account existed. Please contact the front desk to link that reservation to your account.",
            409, "existing_booking_needs_staff_link")

    if _throttled("register:" + email):
        raise db.BookingError("Too many registration attempts. Try again in 5 minutes.", 429, "too_many_attempts")
    _failed.setdefault("register:" + email, []).append(time.time())
    salt, password_digest = security.hash_password(password)
    # Switching to a guest account must not leave a staff session active in the same browser.
    security.end_session(c.conn, c.token)
    security.end_guest_session(c.conn, c.guest_token)
    c.cookies.append(f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
    guest_id = c.conn.execute(
        "INSERT INTO guests(full_name,phone,email) VALUES (?,?,?)", (name, phone, email)
    ).lastrowid
    account_id = c.conn.execute(
        "INSERT INTO guest_accounts(guest_id,salt,password_hash) VALUES (?,?,?)",
        (guest_id, salt, password_digest)
    ).lastrowid
    token, csrf = security.new_guest_session(c.conn, account_id)
    flags = "; HttpOnly; SameSite=Lax; Path=/; Max-Age=%d" % (security.SESSION_HOURS * 3600)
    if os.environ.get("COOKIE_SECURE") == "1":
        flags += "; Secure"
    c.cookies.append(f"{GUEST_COOKIE}={token}{flags}")
    db.audit(c.conn, email, "guest_register", "account created without email verification")
    return 201, {"user": _guest_profile(c.conn, guest_id, name, email, phone), "csrf": csrf}


def api_guest_login(c):
    security.end_session(c.conn, c.token)
    c.cookies.append(f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
    email = str(c.body.get("email", "")).strip().lower()
    password = str(c.body.get("password", ""))
    if _throttled("guest:" + email):
        raise db.BookingError("Too many wrong passwords. Try again in 5 minutes.", 429, "too_many_attempts")
    row = security.check_guest_login(c.conn, email, password)
    if row is None:
        _failed.setdefault("guest:" + email, []).append(time.time())
        raise db.BookingError("Wrong email or password.", 401, "bad_login")
    _failed.pop("guest:" + email, None)
    token, csrf = security.new_guest_session(c.conn, row["account_id"])
    flags = "; HttpOnly; SameSite=Lax; Path=/; Max-Age=%d" % (security.SESSION_HOURS * 3600)
    if os.environ.get("COOKIE_SECURE") == "1": flags += "; Secure"
    c.cookies.append(f"{GUEST_COOKIE}={token}{flags}")
    db.audit(c.conn, email, "guest_login", "")
    return 200, {"user": _guest_profile(c.conn, row["guest_id"], row["full_name"], row["email"], row["phone"]), "csrf": csrf}

def api_guest_password_reset_request(c):
    email = str(c.body.get("email", "")).strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 100:
        raise db.BookingError("Enter a valid email address.", 400, "bad_email")
    if _throttled("reset:" + email):
        raise db.BookingError("Too many recovery requests. Try again in 5 minutes.", 429, "too_many_attempts")
    _failed.setdefault("reset:" + email, []).append(time.time())
    if not os.environ.get("SMTP_HOST"):
        raise db.BookingError("Password recovery requires email delivery. Configure SMTP_HOST first.", 503, "smtp_not_configured")
    account = c.conn.execute("SELECT a.account_id FROM guest_accounts a JOIN guests g USING(guest_id) WHERE lower(g.email)=lower(?)", (email,)).fetchone()
    # Return the same response whether or not the account exists.
    if account:
        code = f"{secrets.randbelow(100_000_000):08d}"
        code_salt, code_digest = security.hash_password(code)
        expires = (c.now + timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
        c.conn.execute("""INSERT INTO guest_password_resets(email,code_salt,code_hash,expires_at,attempts)
            VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET code_salt=excluded.code_salt,
            code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=datetime('now')""",
            (email, code_salt, code_digest, expires))
        try:
            db.send_transactional_email(email, "Reset your hotel account password",
                f"Your password reset code is: {code}\n\nIt expires in 10 minutes. If you did not request this, ignore this message.")
        except Exception:
            c.conn.execute("DELETE FROM guest_password_resets WHERE lower(email)=lower(?)", (email,))
            raise db.BookingError("The recovery email could not be sent. Check SMTP settings and try again.", 503, "email_delivery_failed")
    return 200, {"message": "If an account exists for this email, a recovery code has been sent."}


def api_guest_password_reset_confirm(c):
    email = str(c.body.get("email", "")).strip().lower()
    code = str(c.body.get("code", "")).strip()
    new = str(c.body.get("new_password", ""))
    problem = security.password_problem(new, email)
    if problem:
        raise db.BookingError(problem, 400, "weak_password")
    row = c.conn.execute("SELECT * FROM guest_password_resets WHERE lower(email)=lower(?)", (email,)).fetchone()
    if row is None or row["expires_at"] < c.now.strftime("%Y-%m-%d %H:%M:%S") or row["attempts"] >= 5:
        raise db.BookingError("The recovery code is invalid or expired. Request a new code.", 400, "reset_expired")
    if not re.fullmatch(r"\d{8}", code) or not security.verify_password(code, row["code_salt"], row["code_hash"]):
        c.conn.execute("UPDATE guest_password_resets SET attempts=attempts+1 WHERE lower(email)=lower(?)", (email,))
        raise db.BookingError("The recovery code is incorrect.", 400, "bad_reset_code")
    account = c.conn.execute("SELECT a.account_id FROM guest_accounts a JOIN guests g USING(guest_id) WHERE lower(g.email)=lower(?)", (email,)).fetchone()
    if account is None:
        c.conn.execute("DELETE FROM guest_password_resets WHERE lower(email)=lower(?)", (email,))
        raise db.BookingError("The recovery code is invalid or expired. Request a new code.", 400, "reset_expired")
    salt, digest = security.hash_password(new)
    c.conn.execute("UPDATE guest_accounts SET salt=?,password_hash=? WHERE account_id=?", (salt, digest, account["account_id"]))
    c.conn.execute("DELETE FROM guest_sessions WHERE account_id=?", (account["account_id"],))
    c.conn.execute("DELETE FROM guest_password_resets WHERE lower(email)=lower(?)", (email,))
    db.audit(c.conn, email, "guest_password_reset", "")
    return 200, {"ok": True, "message": "Password reset. Sign in with your new password."}


def api_logout(c):
    security.end_session(c.conn, c.token)
    security.end_guest_session(c.conn, c.guest_token)
    c.cookies.append(f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
    c.cookies.append(f"{GUEST_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
    return 200, {"ok": True}


def api_me(c):
    if not c.user:
        return 200, {"user": None}
    if c.user.get("role") == "Guest":
        return 200, {"user": _guest_profile(c.conn, c.user["guest_id"], c.user["name"], c.user["email"], c.user.get("phone", "")),
                     "csrf": c.user.get("csrf")}
    return 200, {"user": {"name": c.user["name"], "role": c.user["role"], "email": c.user["email"],
                          "default_password": uses_default_password(c.conn, c.user["staff_id"])},
                 "csrf": c.user["csrf"]}


def api_account(c):
    """Return the signed-in user's own profile for any supported role."""
    if c.user.get("role") == "Guest":
        row = c.conn.execute(
            "SELECT g.guest_id, g.full_name, g.email, g.phone, a.created_at "
            "FROM guests g JOIN guest_accounts a USING(guest_id) WHERE g.guest_id=?",
            (c.user["guest_id"],)
        ).fetchone()
        if row is None:
            raise db.BookingError("Your account could not be found. Please sign in again.", 404, "account_not_found")
        user = {"account_id": row["guest_id"], "name": row["full_name"], "email": row["email"],
                "phone": row["phone"], "role": "Guest", "created_at": row["created_at"]}
        user.update({k: v for k, v in _guest_profile(
            c.conn, row["guest_id"], row["full_name"], row["email"], row["phone"]
        ).items() if k.startswith("loyalty_") or k in ("completed_stays",)})
        return 200, {"user": user}

    row = c.conn.execute(
        "SELECT staff_id, full_name, email, role, phone FROM staff WHERE staff_id=?",
        (c.user["staff_id"],)
    ).fetchone()
    if row is None:
        raise db.BookingError("Your staff account could not be found. Please sign in again.", 404, "account_not_found")
    return 200, {"user": {"account_id": row["staff_id"], "name": row["full_name"],
                           "email": row["email"], "phone": row["phone"], "role": row["role"],
                           "default_password": uses_default_password(c.conn, row["staff_id"])}}


def api_update_account(c):
    """Update only profile fields that are safe for the current user to edit."""
    name = str(c.body.get("full_name", "")).strip()
    if len(name) < 2 or len(name) > 100:
        raise db.BookingError("Enter your full name (2–100 characters).", 400, "bad_name")

    if c.user.get("role") == "Guest":
        phone = str(c.body.get("phone", "")).strip()
        if not phone or len(phone) > 20:
            raise db.BookingError("Enter a valid phone number (up to 20 characters).", 400, "bad_phone")
        c.conn.execute("UPDATE guests SET full_name=?, phone=? WHERE guest_id=?",
                       (name, phone, c.user["guest_id"]))
        db.audit(c.conn, c.user["email"], "guest_profile_updated", "name and phone updated")
        return 200, {"user": _guest_profile(c.conn, c.user["guest_id"], name, c.user["email"], phone)}

    phone = str(c.body.get("phone", "")).strip()
    if phone and not re.fullmatch(r"[0-9+()\- ]{6,20}", phone):
        raise db.BookingError("Enter a valid phone number (6–20 characters).", 400, "bad_phone")
    c.conn.execute("UPDATE staff SET full_name=?, phone=? WHERE staff_id=?",
                   (name, phone, c.user["staff_id"]))
    db.audit(c.conn, c.user["email"], "staff_profile_updated", "name and phone updated")
    return 200, {"user": {"name": name, "email": c.user["email"], "phone": phone,
                           "role": c.user["role"],
                           "default_password": uses_default_password(c.conn, c.user["staff_id"])}}


def api_change_password(c):
    email = c.user["email"].lower()
    if _throttled(email):
        raise db.BookingError("Too many wrong passwords. Try again in 5 minutes.", 429, "too_many_attempts")
    try:
        db.change_password(c.conn, c.user["staff_id"], str(c.body.get("current", "")), str(c.body.get("new", "")), c.token)
    except db.BookingError as e:
        if e.code == "wrong_password":
            _failed.setdefault(email, []).append(time.time())
            db.audit(c.conn, email, "password_change_failed", "")
        raise
    db.audit(c.conn, email, "password_changed", "")
    return 200, {"ok": True}


def api_change_guest_password(c):
    email = c.user["email"].lower()
    if _throttled("guest:" + email):
        raise db.BookingError("Too many attempts. Try again in 5 minutes.", 429, "too_many_attempts")
    row = c.conn.execute("SELECT salt,password_hash FROM guest_accounts WHERE account_id=?", (c.user["account_id"],)).fetchone()
    current = str(c.body.get("current", ""))
    new = str(c.body.get("new", ""))
    if row is None or not security.verify_password(current, row["salt"], row["password_hash"]):
        _failed.setdefault("guest:" + email, []).append(time.time())
        raise db.BookingError("The current password is wrong.", 403, "wrong_password")
    problem = security.password_problem(new, email)
    if problem:
        raise db.BookingError(problem, 400, "weak_password")
    if new == current:
        raise db.BookingError("Choose a password that is different from the current one.", 400, "same_password")
    salt, digest = security.hash_password(new)
    c.conn.execute("UPDATE guest_accounts SET salt=?, password_hash=? WHERE account_id=?",
                   (salt, digest, c.user["account_id"]))
    security.end_other_guest_sessions(c.conn, c.user["account_id"], c.guest_token)
    db.audit(c.conn, email, "guest_password_changed", "")
    return 200, {"ok": True}


# ------------------------------------------------------------------ staff handlers
def _int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def api_staff_reservations(c):
    db.complete_past_reservations(c.conn)
    page, size = max(1, _int(c.q("page"), 1)), max(1, min(_int(c.q("page_size"), 50), 200))
    rows, total = db.list_reservations(c.conn, c.q("status"), c.q("q"), c.now, page, size,
                                       c.q("from") or None, c.q("to") or None, c.q("order", "desc"))
    return 200, {"reservations": rows, "total": total, "page": page, "page_size": size,
                 "pages": max(1, -(-total // size))}


def api_staff_cancel(c):
    rid = int(c.params[0])
    result = db.cancel_reservation(c.conn, rid, c.user["role"], c.now, refund=c.body.get("refund"))
    db.audit(c.conn, c.user["email"], "cancel", f"reservation {rid}, refunded {result['refunded']:.0f}")
    return 200, result


def api_staff_modify(c):
    rid = int(c.params[0])
    ci, co, _ = db.parse_dates(c.body.get("check_in", ""), c.body.get("check_out", ""))
    db.require_not_past(ci, c.today)
    result = db.modify_reservation(c.conn, rid, ci, co, c.user["role"], c.now)
    db.audit(c.conn, c.user["email"], "modify", f"reservation {rid} to {ci}..{co}")
    return 200, result


def api_staff_calendar(c):
    db.complete_past_reservations(c.conn)
    start, end = c.q("from").strip(), c.q("to").strip()
    if not start or not end:
        raise db.BookingError("Give both 'from' and 'to' dates (YYYY-MM-DD).", 400, "bad_dates")
    return 200, db.get_calendar_data(c.conn, start, end)


def api_staff_emails(c):
    return 200, {"emails": db.list_emails(c.conn)}


def api_staff_resend_email(c):
    new_id = db.resend_email(c.conn, int(c.params[0]))
    db.deliver_pending_emails(c.conn)
    mail = db.get_email(c.conn, new_id)
    db.audit(c.conn, c.user["email"], "email_resent", f"email {c.params[0]} to {mail['to_email']}")
    return 200, {"email_id": new_id, "status": mail["status"], "channel": mail["channel"], "to": mail["to_email"]}


def api_staff_floor_map(c):
    return 200, features.floor_map(c.conn, c.q("date").strip() or None, c.now)


def api_staff_housekeeping(c):
    return 200, features.housekeeping_board(c.conn, c.now)


def api_staff_set_housekeeping(c):
    result = features.set_housekeeping(c.conn, int(c.params[0]), str(c.body.get("status", "")), c.now)
    db.audit(c.conn, c.user["email"], "housekeeping", f"room {result['room_number']}: {result['old']} -> {result['new']}")
    return 200, result


def api_staff_pass_lookup(c):
    rid = features.resolve_pass(c.conn, c.q("code"))
    d = features.stay_state(c.conn, rid, c.now)
    return 200, d


def api_staff_check_in(c):
    rid = int(c.params[0])
    if c.body.get("code"):
        if features.resolve_pass(c.conn, c.body.get("code")) != rid:
            raise db.BookingError("This pass belongs to another reservation.", 409, "bad_pass")
    d = features.check_in(c.conn, rid, c.now)
    db.audit(c.conn, c.user["email"], "check_in", f"reservation {rid}, room {d['room_number']}")
    return 200, d


def api_staff_check_out(c):
    rid = int(c.params[0])
    d = features.check_out(c.conn, rid, c.now)
    db.audit(c.conn, c.user["email"], "check_out", f"reservation {rid}, room {d['room_number']} is now Dirty")
    return 200, d


def api_manager_price_suggestions(c):
    return 200, features.price_suggestions(c.conn, c.today)


def api_manager_export(c):
    text, count = db.reservations_csv(c.conn, c.q("status"), c.q("q"), c.q("from") or None, c.q("to") or None, c.q("order", "desc"))
    db.audit(c.conn, c.user["email"], "export_csv", f"{count} reservations")
    name = f"reservations_{c.today.isoformat()}.csv"
    return 200, text.encode("utf-8"), {"content_type": "text/csv; charset=utf-8",
                                       "headers": [("Content-Disposition", f'attachment; filename="{name}"')]}


def api_manager_dashboard(c):
    db.complete_past_reservations(c.conn)
    return 200, db.dashboard(c.conn, c.now, c.q("from").strip() or None, c.q("to").strip() or None)


def api_manager_room_types(c):
    return 200, {"room_types": db.list_room_types(c.conn)}


def api_manager_set_price(c):
    rid = int(c.params[0])
    result = db.set_room_type_price(c.conn, rid, c.body.get("price"))
    if result["changed"]:
        db.audit(c.conn, c.user["email"], "price_change",
                 f"{result['type_name']}: {result['old_price']:.0f} -> {result['new_price']:.0f} KZT per night "
                 "(existing reservations keep their price)")
    return 200, result


def api_manager_audit(c):
    return 200, {"audit": db.list_audit(c.conn)}


def api_staff_loyalty(c):
    return 200, enhancements.loyalty_counts(c.conn)


def api_staff_maintenance(c):
    if c.method == "GET": return 200, {"tickets": enhancements.list_tickets(c.conn)}
    b=c.body
    try: tid=enhancements.create_ticket(c.conn, b.get("room_id"), str(b.get("reason","")), b.get("start_date",""), b.get("expected_end_date",""))
    except (ValueError, TypeError) as e: raise db.BookingError(str(e),400,"bad_ticket")
    db.audit(c.conn,c.user["email"],"maintenance_ticket",f"ticket {tid}")
    return 201,{"ticket_id":tid}


def api_staff_ticket_update(c):
    status=str(c.body.get("status",""))
    if status not in ("Open","In Progress","Resolved","Cancelled"):
        raise db.BookingError("Invalid maintenance status.",400,"bad_status")
    cur=c.conn.execute("UPDATE maintenance_tickets SET status=? WHERE ticket_id=?",(status,int(c.params[0])))
    if not cur.rowcount: raise db.BookingError("Ticket not found.",404,"not_found")
    return 200,{"ok":True,"status":status}


def api_guest_review(c):
    b = c.body
    try:
        rid = int(b.get("reservation_id"))
    except (ValueError, TypeError):
        raise db.BookingError("Enter a valid reservation number.", 400, "review_failed")
    owned = c.conn.execute("SELECT 1 FROM reservations WHERE reservation_id=? AND guest_id=?",
                           (rid, c.user["guest_id"])).fetchone()
    if not owned:
        raise db.BookingError("This reservation does not belong to your account.", 403, "forbidden")
    pass_data = features.pass_for(c.conn, rid)
    if not pass_data:
        raise db.BookingError("Reservation not found.", 404, "not_found")
    try:
        return 201, enhancements.submit_review(c.conn, rid, pass_data["code"], int(b.get("rating")), b.get("comment", ""))
    except (ValueError, TypeError, sqlite3.IntegrityError) as e:
        raise db.BookingError(str(e), 400, "review_failed")


def api_staff_reviews(c):
    rows=[dict(r) for r in c.conn.execute("SELECT v.*,r.reservation_id,ro.room_number,g.full_name FROM reviews v JOIN reservations r USING(reservation_id) JOIN rooms ro USING(room_id) JOIN guests g USING(guest_id) ORDER BY v.rating ASC,v.created_at DESC")]
    return 200,{"reviews":rows,"low_rating_count":sum(x["rating"]<=2 for x in rows)}


def api_staff_ratings(c):
    return 200,{"ratings":enhancements.room_ratings(c.conn)}


ROUTES = [  # method, regex, handler, access ("public", "staff", "manager")
    ("GET", r"/api/health", api_health, "public"),
    ("GET", r"/api/guest/reservations", api_guest_reservations, "guest"),
    ("GET", r"/api/staff/loyalty", api_staff_loyalty, "staff"),
    ("GET", r"/api/staff/maintenance", api_staff_maintenance, "staff"),
    ("POST", r"/api/staff/maintenance", api_staff_maintenance, "staff"),
    ("POST", r"/api/staff/maintenance/(\d+)", api_staff_ticket_update, "staff"),
    ("GET", r"/api/staff/reviews", api_staff_reviews, "staff"),
    ("GET", r"/api/staff/room-ratings", api_staff_ratings, "staff"),
    ("POST", r"/api/reviews", api_guest_review, "guest"),
    ("GET", r"/api/rooms/search", api_search, "public"),
    ("POST", r"/api/bookings", api_book, "guest"),
    ("POST", r"/api/bookings/cancel", api_guest_cancel, "guest"),
    ("POST", r"/api/auth/login", api_login, "public"),
    ("POST", r"/api/auth/register", api_guest_register, "public"),
    ("POST", r"/api/auth/guest-password-reset/request", api_guest_password_reset_request, "public"),
    ("POST", r"/api/auth/guest-password-reset/confirm", api_guest_password_reset_confirm, "public"),
    ("POST", r"/api/auth/guest-login", api_guest_login, "public"),
    ("POST", r"/api/auth/logout", api_logout, "public"),
    ("GET", r"/api/auth/me", api_me, "public"),
    ("GET", r"/api/auth/account", api_account, "user"),
    ("POST", r"/api/auth/account", api_update_account, "user"),
    ("GET", r"/api/staff/reservations", api_staff_reservations, "staff"),
    ("POST", r"/api/staff/reservations/(\d+)/cancel", api_staff_cancel, "staff"),
    ("POST", r"/api/staff/reservations/(\d+)/modify", api_staff_modify, "staff"),
    ("GET", r"/api/staff/calendar", api_staff_calendar, "staff"),
    ("GET", r"/api/rooms/price-calendar", api_price_calendar, "public"),
    ("GET", r"/api/staff/floor-map", api_staff_floor_map, "staff"),
    ("GET", r"/api/staff/housekeeping", api_staff_housekeeping, "staff"),
    ("POST", r"/api/staff/rooms/(\d+)/housekeeping", api_staff_set_housekeeping, "staff"),
    ("GET", r"/api/staff/passes/lookup", api_staff_pass_lookup, "staff"),
    ("POST", r"/api/staff/reservations/(\d+)/check-in", api_staff_check_in, "staff"),
    ("POST", r"/api/staff/reservations/(\d+)/check-out", api_staff_check_out, "staff"),
    ("GET", r"/api/manager/price-suggestions", api_manager_price_suggestions, "manager"),
    ("GET", r"/api/staff/emails", api_staff_emails, "staff"),
    ("POST", r"/api/staff/emails/(\d+)/resend", api_staff_resend_email, "staff"),
    ("POST", r"/api/auth/password", api_change_password, "staff"),
    ("POST", r"/api/auth/guest-password", api_change_guest_password, "guest"),
    ("GET", r"/api/manager/export.csv", api_manager_export, "manager"),
    ("GET", r"/api/manager/dashboard", api_manager_dashboard, "manager"),
    ("GET", r"/api/manager/audit", api_manager_audit, "manager"),
    ("GET", r"/api/manager/room-types", api_manager_room_types, "manager"),
    ("POST", r"/api/manager/room-types/(\d+)/price", api_manager_set_price, "manager"),
]
ROUTES = [(m, re.compile("^" + p + "$"), h, a) for m, p, h, a in ROUTES]


# ------------------------------------------------------------------ plumbing
def _token(cookie_header):
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header or "")
    except Exception:
        return None
    return cookie[COOKIE].value if COOKIE in cookie else None


def _respond(start_response, status, payload, extra=None, content_type="application/json; charset=utf-8", no_store=True):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
    headers = [("Content-Type", content_type), ("Content-Length", str(len(body)))] + SECURITY_HEADERS
    if no_store:
        headers.append(("Cache-Control", "no-store"))
    headers += extra or []
    start_response(f"{status} {HTTPStatus(status).phrase}", headers)
    return [body]


def _static(start_response, path):
    rel = ("index.html" if path in ("/", "")
           else "gta-vi.html" if path in ("/gta-vi", "/gta-vi/")
           else "official.html" if path in ("/official", "/official/")
           else "daltonism.html" if path in ("/daltonism", "/daltonism/")
           else path[len("/static/"):] if path.startswith("/static/") else None)
    if rel is None:
        return None
    full = os.path.normpath(os.path.join(FRONTEND, rel))
    if not full.startswith(FRONTEND + os.sep) or not os.path.isfile(full):
        return None
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
        ctype += "; charset=utf-8"
    with open(full, "rb") as f:
        data = f.read()
    return _respond(start_response, 200, data, content_type=ctype, no_store=False,
                    extra=[("Cache-Control", "no-cache")])


def app(environ, start_response):
    method = environ["REQUEST_METHOD"]
    path = environ.get("PATH_INFO", "/")
    if method == "GET" and path.startswith("/music/"):
        return music.audio_response(environ, start_response, path)
    if method == "GET" and not path.startswith("/api/"):
        served = _static(start_response, path)
        if served is not None:
            return served
        return _respond(start_response, 404, {"error": "Page not found.", "code": "not_found"})
    if not path.startswith("/api/"):
        return _respond(start_response, 404, {"error": "Not found.", "code": "not_found"})

    route, params = None, ()
    path_known = False
    for m, rx, handler, access in ROUTES:
        match = rx.match(path)
        if match:
            path_known = True
            if m == method:
                route, params = (handler, access), match.groups()
                break
    if route is None:
        if path_known:
            return _respond(start_response, 405, {"error": "Method not allowed.", "code": "method_not_allowed"})
        return _respond(start_response, 404, {"error": "Unknown API address.", "code": "not_found"})

    handler, access = route
    conn = db.connect()
    try:
        body = {}
        if method == "POST":
            if "application/json" not in environ.get("CONTENT_TYPE", ""):
                raise db.BookingError("Send the data as JSON.", 415, "bad_content_type")
            try:
                size = int(environ.get("CONTENT_LENGTH") or 0)
            except ValueError:
                size = 0
            if size > MAX_BODY:
                raise db.BookingError("Request is too large.", 413, "too_large")
            raw = environ["wsgi.input"].read(size) if size else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except ValueError:
                raise db.BookingError("The request is not valid JSON.", 400, "bad_json")
            if not isinstance(body, dict):
                raise db.BookingError("The request must be a JSON object.", 400, "bad_json")

        token = _token(environ.get("HTTP_COOKIE"))
        cookie_jar = SimpleCookie()
        try: cookie_jar.load(environ.get("HTTP_COOKIE", ""))
        except Exception: pass
        guest_token = cookie_jar[GUEST_COOKIE].value if GUEST_COOKIE in cookie_jar else None
        user = security.get_session(conn, token)
        if user is None:
            user = security.get_guest_session(conn, guest_token)
        if access == "user" and user is None:
            raise db.BookingError("Sign in to view your account.", 401, "login_required")
        if access == "user" and method == "POST" and environ.get("HTTP_X_CSRF_TOKEN") != user.get("csrf"):
            raise db.BookingError("Security check failed. Reload the page and try again.", 403, "bad_csrf")
        if access == "guest" and (user is None or user.get("role") != "Guest"):
            raise db.BookingError("Sign in with your guest account to continue.", 401, "login_required")
        if access in ("staff", "manager"):
            if user is None or user.get("role") not in ("FrontDesk", "Manager"):
                raise db.BookingError("Log in with a staff account first.", 401, "login_required")
            if access == "manager" and user["role"] != "Manager":
                raise db.BookingError("Only the Manager role can open this.", 403, "forbidden")
            if method == "POST" and environ.get("HTTP_X_CSRF_TOKEN") != user["csrf"]:
                raise db.BookingError("Security check failed. Reload the page and try again.", 403, "bad_csrf")
        if access == "guest" and method == "POST" and environ.get("HTTP_X_CSRF_TOKEN") != user.get("csrf"):
            raise db.BookingError("Security check failed. Reload the page and try again.", 403, "bad_csrf")

        ctx = Ctx(conn, method, path, parse_qs(environ.get("QUERY_STRING", "")), body, user, params)
        ctx.token = token
        ctx.guest_token = guest_token
        result = handler(ctx)
        status, payload = result[0], result[1]
        options = result[2] if len(result) > 2 else {}
        extra = [("Set-Cookie", ck) for ck in ctx.cookies] + options.get("headers", [])
        if "content_type" in options:
            return _respond(start_response, status, payload, extra, content_type=options["content_type"])
        return _respond(start_response, status, payload, extra)
    except db.BookingError as e:
        return _respond(start_response, e.status, dict({"error": str(e), "code": e.code}, **e.extra))
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return _respond(start_response, 500, {"error": "Something went wrong on the server.", "code": "server_error"})
    finally:
        conn.close()


class ThreadedServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietHandler(WSGIRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def serve(host="127.0.0.1", port=8000):
    if os.environ.get("APP_ENV", "development").lower() == "production":
        try:
            from waitress import serve as waitress_serve
        except ImportError as exc:
            raise RuntimeError("Production mode requires Waitress. Install it with: pip install -r requirements.txt") from exc
        waitress_serve(app, host=host, port=port, threads=int(os.environ.get("WEB_THREADS", "8")))
        return
    httpd = make_server(host, port, app, server_class=ThreadedServer, handler_class=QuietHandler)
    httpd.serve_forever()
