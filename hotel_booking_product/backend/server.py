"""Hotel Booking System: JSON API + static frontend (WSGI, standard library only)."""
import json
import mimetypes
import os
import re
import sys
import time
import traceback
from datetime import date, datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

import db
import security

FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
COOKIE = "session"
MAX_BODY = 100_000
LOGIN_LIMIT, LOGIN_WINDOW = 5, 300          # 5 wrong passwords, then 5 minutes pause
_failed = {}                                 # email -> list of timestamps

SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "DENY"),
    ("Content-Security-Policy",
     "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
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
        self.token = None          # the session token of this request, if any

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
    rooms, nights = db.search_free_rooms(c.conn, ci, co)
    return 200, {"check_in": ci, "check_out": co, "nights": nights, "rooms": rooms}


def api_book(c):
    b = c.body
    ci, co, _ = db.parse_dates(b.get("check_in", ""), b.get("check_out", ""))
    db.require_not_past(ci, c.today)
    try:
        res = db.book_room(c.conn, b.get("room_id"), ci, co, str(b.get("method", "")),
                           b.get("full_name", ""), b.get("phone", ""), b.get("email", ""),
                           simulate_payment_failure=bool(b.get("simulate_payment_failure")))
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
    return 201, res


def api_lookup(c):
    d = db.find_guest_reservation(c.conn, c.body.get("reservation_id"), c.body.get("email", ""), c.now)
    return 200, d


def api_guest_cancel(c):
    d = db.find_guest_reservation(c.conn, c.body.get("reservation_id"), c.body.get("email", ""), c.now)
    result = db.cancel_reservation(c.conn, d["reservation_id"], "Guest", c.now)
    db.audit(c.conn, "guest", "cancel", f"reservation {d['reservation_id']}")
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
    db.audit(c.conn, row["email"], "login", "")
    return 200, {"user": {"name": row["full_name"], "role": row["role"], "email": row["email"],
                          "default_password": uses_default_password(c.conn, row["staff_id"])}, "csrf": csrf}


def api_logout(c):
    security.end_session(c.conn, c.token)
    c.cookies.append(f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
    return 200, {"ok": True}


def api_me(c):
    if not c.user:
        return 200, {"user": None}
    return 200, {"user": {"name": c.user["name"], "role": c.user["role"], "email": c.user["email"],
                          "default_password": uses_default_password(c.conn, c.user["staff_id"])},
                 "csrf": c.user["csrf"]}


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


ROUTES = [  # method, regex, handler, access ("public", "staff", "manager")
    ("GET", r"/api/health", api_health, "public"),
    ("GET", r"/api/rooms/search", api_search, "public"),
    ("POST", r"/api/bookings", api_book, "public"),
    ("POST", r"/api/bookings/lookup", api_lookup, "public"),
    ("POST", r"/api/bookings/cancel", api_guest_cancel, "public"),
    ("POST", r"/api/auth/login", api_login, "public"),
    ("POST", r"/api/auth/logout", api_logout, "public"),
    ("GET", r"/api/auth/me", api_me, "public"),
    ("GET", r"/api/staff/reservations", api_staff_reservations, "staff"),
    ("POST", r"/api/staff/reservations/(\d+)/cancel", api_staff_cancel, "staff"),
    ("POST", r"/api/staff/reservations/(\d+)/modify", api_staff_modify, "staff"),
    ("GET", r"/api/staff/calendar", api_staff_calendar, "staff"),
    ("GET", r"/api/staff/emails", api_staff_emails, "staff"),
    ("POST", r"/api/staff/emails/(\d+)/resend", api_staff_resend_email, "staff"),
    ("POST", r"/api/auth/password", api_change_password, "staff"),
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
    rel = "index.html" if path in ("/", "") else path[len("/static/"):] if path.startswith("/static/") else None
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
        user = security.get_session(conn, token)
        if access in ("staff", "manager"):
            if user is None:
                raise db.BookingError("Log in as staff first.", 401, "login_required")
            if access == "manager" and user["role"] != "Manager":
                raise db.BookingError("Only the Manager role can open this.", 403, "forbidden")
            if method == "POST" and environ.get("HTTP_X_CSRF_TOKEN") != user["csrf"]:
                raise db.BookingError("Security check failed. Reload the page and try again.", 403, "bad_csrf")

        ctx = Ctx(conn, method, path, parse_qs(environ.get("QUERY_STRING", "")), body, user, params)
        ctx.token = token
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
    httpd = make_server(host, port, app, server_class=ThreadedServer, handler_class=QuietHandler)
    httpd.serve_forever()
