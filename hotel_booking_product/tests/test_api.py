"""Tests for the Hotel Booking System (backend logic, JSON API, security).

Run:  py -m unittest discover -s tests -v
"""
import io
import json
import os
import sys
import tempfile
import sqlite3
import unittest
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db        # noqa: E402
import security  # noqa: E402
import server    # noqa: E402

security.ITERATIONS = 2000   # faster password hashing for the tests only

FAR = date.today() + timedelta(days=500)       # dates far away from the demo data


def d(n):
    return (FAR + timedelta(days=n)).isoformat()


def call(method, path, body=None, cookie=None, csrf=None, content_type="application/json"):
    raw = json.dumps(body).encode() if body is not None else b""
    path_only, _, qs = path.partition("?")
    env = {"REQUEST_METHOD": method, "PATH_INFO": path_only, "QUERY_STRING": qs,
           "CONTENT_TYPE": content_type if method == "POST" else "", "CONTENT_LENGTH": str(len(raw)),
           "wsgi.input": io.BytesIO(raw)}
    if cookie:
        env["HTTP_COOKIE"] = f"session={cookie}"
    if csrf:
        env["HTTP_X_CSRF_TOKEN"] = csrf
    out = {}

    def start_response(status, headers):
        out["status"], out["headers"] = int(status.split()[0]), headers

    data = b"".join(server.app(env, start_response))
    ctype = dict(out["headers"]).get("Content-Type", "")
    parsed = json.loads(data) if "json" in ctype else data
    return out["status"], parsed, out["headers"]


class Base(unittest.TestCase):
    RECORDS = 300      # demo reservations created for each test

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(self.tmp, "test.db")
        db.init_db(db.DB_PATH, reset=True, records=self.RECORDS)    # small demo data keeps the tests fast
        self.conn = db.connect()
        server._failed.clear()

    def tearDown(self):
        self.conn.close()

    def count(self, table):
        return self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def room_id(self, number):
        return self.conn.execute("SELECT room_id FROM rooms WHERE room_number=?", (number,)).fetchone()[0]

    def booking_body(self, room="101", ci=None, co=None, email="anna@example.kz", **extra):
        body = {"room_id": self.room_id(room), "check_in": ci or d(0), "check_out": co or d(2),
                "full_name": "Anna Test", "phone": "+77001234567", "email": email, "method": "Card"}
        body.update(extra)
        return body

    def book(self, **kw):
        return call("POST", "/api/bookings", self.booking_body(**kw))

    def login(self, who="manager"):
        email, pw = {"manager": ("manager@hotel.example", "Manager#2026"),
                     "frontdesk": ("frontdesk@hotel.example", "FrontDesk#2026")}[who]
        status, data, headers = call("POST", "/api/auth/login", {"email": email, "password": pw})
        self.assertEqual(status, 200, data)
        cookie = [v for k, v in headers if k == "Set-Cookie"][0].split(";")[0].split("=", 1)[1]
        return cookie, data["csrf"]


class SearchAndBookingTests(Base):
    def test_health(self):
        self.assertEqual(call("GET", "/api/health")[0], 200)

    def test_search_rejects_bad_dates(self):
        self.assertEqual(call("GET", "/api/rooms/search?check_in=25/10/2026&check_out=2026-10-27")[0], 400)
        self.assertEqual(call("GET", f"/api/rooms/search?check_in={d(3)}&check_out={d(1)}")[0], 400)
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        status, data, _ = call("GET", f"/api/rooms/search?check_in={yesterday}&check_out={date.today().isoformat()}")
        self.assertEqual((status, data["code"]), (400, "past_date"))

    def test_valid_booking_saves_reservation_payment_and_email(self):
        r0, p0, e0 = self.count("reservations"), self.count("payments"), self.count("emails")
        status, data, _ = self.book()
        self.assertEqual(status, 201, data)
        self.assertEqual(data["total_price"], 2 * 25000)
        self.assertEqual((self.count("reservations"), self.count("payments"), self.count("emails")), (r0 + 1, p0 + 1, e0 + 1))
        self.assertEqual(data["email"]["status"], "Sent")

    def test_confirmation_email_is_sent_within_one_minute(self):
        """FR-02: the confirmation email is sent within 1 minute of the booking"""
        _, data, _ = self.book()
        row = self.conn.execute("SELECT created_at, sent_at, body FROM emails WHERE email_id=?", (data["email_id"],)).fetchone()
        fmt = "%Y-%m-%d %H:%M:%S"
        delta = datetime.strptime(row["sent_at"], fmt) - datetime.strptime(row["created_at"], fmt)
        self.assertLessEqual(delta.total_seconds(), 60)
        for part in (str(data["reservation_id"]), "101", d(0), d(2)):
            self.assertIn(part, row["body"])

    def test_double_booking_is_rejected_with_alternatives(self):
        """FR-01: overlapping dates are rejected and other free rooms are suggested"""
        self.assertEqual(self.book(ci=d(0), co=d(2))[0], 201)
        status, data, _ = self.book(ci=d(1), co=d(3), email="bob@example.kz")
        self.assertEqual((status, data["code"]), (409, "room_unavailable"))
        self.assertTrue(data["alternatives"])
        self.assertNotIn(self.room_id("101"), [r["room_id"] for r in data["alternatives"]])

    def test_blocked_double_booking_is_counted_for_the_manager(self):
        self.book(ci=d(0), co=d(2))
        self.book(ci=d(1), co=d(3), email="bob@example.kz")
        cookie, _ = self.login("manager")
        _, dash, _ = call("GET", "/api/manager/dashboard", cookie=cookie)
        self.assertEqual(dash["double_bookings_blocked"], 1)

    def test_back_to_back_stay_is_allowed(self):
        self.assertEqual(self.book(ci=d(0), co=d(2))[0], 201)
        self.assertEqual(self.book(ci=d(2), co=d(4), email="bob@example.kz")[0], 201)

    def test_search_hides_a_booked_room(self):
        self.book(ci=d(10), co=d(12))
        _, data, _ = call("GET", f"/api/rooms/search?check_in={d(11)}&check_out={d(13)}")
        self.assertNotIn("101", [r["room_number"] for r in data["rooms"]])
        self.assertNotIn("105", [r["room_number"] for r in data["rooms"]])   # maintenance

    def test_maintenance_room_is_rejected(self):
        status, data, _ = self.book(room="105")
        self.assertEqual((status, data["code"]), (409, "room_maintenance"))

    def test_bad_input_is_rejected(self):
        self.assertEqual(self.book(full_name="")[0], 400)
        self.assertEqual(self.book(email="not-an-email")[0], 400)
        self.assertEqual(self.book(phone="abc")[0], 400)
        self.assertEqual(self.book(method="Bitcoin")[0], 400)
        self.assertEqual(self.book(co=d(-1))[0], 400)
        self.assertEqual(call("POST", "/api/bookings", dict(self.booking_body(), room_id=9999))[0], 404)

    def test_failed_payment_rolls_back_everything(self):
        """Transaction: a failed payment leaves no reservation, guest or email behind"""
        before = [self.count(t) for t in ("reservations", "guests", "emails", "payments")]
        status, data, _ = self.book(email="new@example.kz", simulate_payment_failure=True)
        self.assertEqual((status, data["code"]), (402, "payment_failed"))
        self.assertEqual([self.count(t) for t in ("reservations", "guests", "emails", "payments")], before)

    def test_same_email_reuses_the_guest(self):
        self.book(ci=d(0), co=d(1))
        g = self.count("guests")
        self.book(ci=d(5), co=d(6))
        self.assertEqual(self.count("guests"), g)


class GuestSelfServiceTests(Base):
    def make(self):
        _, data, _ = self.book(ci=d(20), co=d(23))
        return data

    def test_lookup_needs_the_right_email(self):
        b = self.make()
        ok = call("POST", "/api/bookings/lookup", {"reservation_id": b["reservation_id"], "email": "ANNA@example.kz"})
        self.assertEqual(ok[0], 200)
        self.assertNotIn("phone", ok[1])
        bad = call("POST", "/api/bookings/lookup", {"reservation_id": b["reservation_id"], "email": "other@example.kz"})
        self.assertEqual(bad[0], 404)

    def test_early_cancellation_refunds_and_frees_the_room(self):
        b = self.make()
        status, data, _ = call("POST", "/api/bookings/cancel", {"reservation_id": b["reservation_id"], "email": "anna@example.kz"})
        self.assertEqual(status, 200)
        self.assertEqual(data["refunded"], b["total_price"])
        _, detail, _ = call("POST", "/api/bookings/lookup", {"reservation_id": b["reservation_id"], "email": "anna@example.kz"})
        self.assertEqual((detail["status"], detail["paid"]), ("Cancelled", 0))
        _, rooms, _ = call("GET", f"/api/rooms/search?check_in={d(20)}&check_out={d(23)}")
        self.assertIn("101", [r["room_number"] for r in rooms["rooms"]])

    def test_cancelling_twice_fails(self):
        b = self.make()
        body = {"reservation_id": b["reservation_id"], "email": "anna@example.kz"}
        call("POST", "/api/bookings/cancel", body)
        self.assertEqual(call("POST", "/api/bookings/cancel", body)[0], 409)

    def test_late_cancellation_needs_a_manager(self):
        """FR-03: less than 24 hours before check-in a guest cannot cancel online"""
        b = self.make()
        now = datetime.strptime(d(20), "%Y-%m-%d") + timedelta(hours=14) - timedelta(hours=5)
        with self.assertRaises(db.BookingError) as ctx:
            db.cancel_reservation(self.conn, b["reservation_id"], "Guest", now=now)
        self.assertEqual(ctx.exception.code, "manager_approval")

    def test_manager_can_cancel_late_with_or_without_refund(self):
        now = datetime.strptime(d(20), "%Y-%m-%d") + timedelta(hours=14) - timedelta(hours=5)
        a = self.make()
        res = db.cancel_reservation(self.conn, a["reservation_id"], "Manager", now=now, refund=True)
        self.assertEqual(res["refunded"], a["total_price"])
        _, c, _ = self.book(ci=d(30), co=d(32), email="c@example.kz")
        now2 = datetime.strptime(d(30), "%Y-%m-%d") + timedelta(hours=14) - timedelta(hours=2)
        res2 = db.cancel_reservation(self.conn, c["reservation_id"], "Manager", now=now2, refund=False)
        self.assertEqual(res2["refunded"], 0)


class StaffTests(Base):
    def make(self, ci=20, co=22):
        return self.book(ci=d(ci), co=d(co))[1]

    def test_front_desk_can_change_dates_and_pay_the_difference(self):
        b = self.make()
        cookie, csrf = self.login("frontdesk")
        status, data, _ = call("POST", f"/api/staff/reservations/{b['reservation_id']}/modify",
                               {"check_in": d(20), "check_out": d(23)}, cookie=cookie, csrf=csrf)
        self.assertEqual(status, 200, data)
        self.assertEqual((data["total_price"], data["difference"]), (3 * 25000, 25000))
        detail = db.reservation_detail(self.conn, b["reservation_id"])
        self.assertEqual(detail["paid"], 3 * 25000)

    def test_shorter_stay_refunds_the_difference(self):
        b = self.make(20, 24)
        cookie, csrf = self.login("frontdesk")
        _, data, _ = call("POST", f"/api/staff/reservations/{b['reservation_id']}/modify",
                          {"check_in": d(20), "check_out": d(21)}, cookie=cookie, csrf=csrf)
        self.assertEqual(data["difference"], -3 * 25000)
        self.assertEqual(db.reservation_detail(self.conn, b["reservation_id"])["paid"], 25000)

    def test_changing_dates_cannot_create_a_double_booking(self):
        a = self.make(20, 22)
        self.book(ci=d(22), co=d(24), email="b@example.kz")
        cookie, csrf = self.login("frontdesk")
        status, data, _ = call("POST", f"/api/staff/reservations/{a['reservation_id']}/modify",
                               {"check_in": d(20), "check_out": d(23)}, cookie=cookie, csrf=csrf)
        self.assertEqual((status, data["code"]), (409, "room_unavailable"))
        self.assertEqual(db.reservation_detail(self.conn, a["reservation_id"])["check_out"], d(22))

    def test_late_change_needs_a_manager(self):
        b = self.make()
        now = datetime.strptime(d(20), "%Y-%m-%d") + timedelta(hours=14) - timedelta(hours=3)
        with self.assertRaises(db.BookingError) as ctx:
            db.modify_reservation(self.conn, b["reservation_id"], d(20), d(23), "FrontDesk", now=now)
        self.assertEqual(ctx.exception.code, "manager_approval")
        self.assertEqual(db.modify_reservation(self.conn, b["reservation_id"], d(20), d(23), "Manager", now=now)["nights"], 3)

    def test_staff_cancel_through_the_api(self):
        b = self.make()
        cookie, csrf = self.login("frontdesk")
        status, data, _ = call("POST", f"/api/staff/reservations/{b['reservation_id']}/cancel", {}, cookie=cookie, csrf=csrf)
        self.assertEqual((status, data["refunded"]), (200, b["total_price"]))

    def test_reservation_list_filters(self):
        self.make()
        cookie, _ = self.login("frontdesk")
        _, data, _ = call("GET", "/api/staff/reservations?status=Confirmed&q=anna", cookie=cookie)
        self.assertTrue(data["reservations"])
        self.assertTrue(all(r["status"] == "Confirmed" for r in data["reservations"]))
        _, none, _ = call("GET", "/api/staff/reservations?q=nobody-with-this-name", cookie=cookie)
        self.assertEqual(none["reservations"], [])

    def test_search_filter_is_safe_against_sql_injection(self):
        cookie, _ = self.login("manager")
        status, data, _ = call("GET", "/api/staff/reservations?q=%27%20OR%201%3D1%20--", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(data["reservations"], [])
        self.assertGreater(self.count("reservations"), 0)

    def test_outbox_lists_confirmation_emails(self):
        self.make()
        cookie, _ = self.login("frontdesk")
        _, data, _ = call("GET", "/api/staff/emails", cookie=cookie)
        self.assertTrue(any("Booking confirmation" in m["subject"] for m in data["emails"]))


class SecurityTests(Base):
    def test_staff_pages_need_a_login(self):
        for path in ("/api/staff/reservations", "/api/staff/emails", "/api/manager/dashboard", "/api/manager/audit"):
            self.assertEqual(call("GET", path)[0], 401, path)

    def test_roles_front_desk_cannot_open_manager_pages(self):
        cookie, _ = self.login("frontdesk")
        self.assertEqual(call("GET", "/api/manager/dashboard", cookie=cookie)[0], 403)
        self.assertEqual(call("GET", "/api/manager/audit", cookie=cookie)[0], 403)
        mcookie, _ = self.login("manager")
        self.assertEqual(call("GET", "/api/manager/dashboard", cookie=mcookie)[0], 200)

    def test_wrong_password_is_rejected(self):
        status, data, _ = call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "wrong"})
        self.assertEqual((status, data["code"]), (401, "bad_login"))
        self.assertEqual(call("POST", "/api/auth/login", {"email": "nobody@hotel.example", "password": "x"})[0], 401)

    def test_login_cookie_is_http_only_and_same_site(self):
        _, _, headers = call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "Manager#2026"})
        cookie = [v for k, v in headers if k == "Set-Cookie"][0]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)

    def test_login_is_blocked_after_five_wrong_passwords(self):
        for _ in range(5):
            call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "bad"})
        status, data, _ = call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "Manager#2026"})
        self.assertEqual((status, data["code"]), (429, "too_many_attempts"))

    def test_logout_ends_the_session(self):
        cookie, csrf = self.login("manager")
        self.assertEqual(call("GET", "/api/manager/dashboard", cookie=cookie)[0], 200)
        env_cookie = cookie
        # the logout handler reads the cookie header, so send it in the same way the browser does
        raw = b"{}"
        env = {"REQUEST_METHOD": "POST", "PATH_INFO": "/api/auth/logout", "QUERY_STRING": "", "CONTENT_TYPE": "application/json",
               "CONTENT_LENGTH": "2", "wsgi.input": io.BytesIO(raw), "HTTP_COOKIE": f"session={env_cookie}"}
        server.app(env, lambda s, h: None)
        self.assertEqual(call("GET", "/api/manager/dashboard", cookie=cookie)[0], 401)

    def test_csrf_token_is_required_for_staff_changes(self):
        b = self.book(ci=d(20), co=d(22))[1]
        cookie, csrf = self.login("frontdesk")
        url = f"/api/staff/reservations/{b['reservation_id']}/cancel"
        self.assertEqual(call("POST", url, {}, cookie=cookie)[0], 403)
        self.assertEqual(call("POST", url, {}, cookie=cookie, csrf="wrong")[0], 403)
        self.assertEqual(call("POST", url, {}, cookie=cookie, csrf=csrf)[0], 200)

    def test_passwords_are_stored_as_hashes(self):
        rows = self.conn.execute("SELECT salt, password_hash FROM staff").fetchall()
        self.assertEqual(len(rows), 2)
        for r in rows:
            self.assertEqual(len(r["password_hash"]), 64)
            self.assertNotIn("2026", r["password_hash"] + r["salt"])
        raw = sum(1 for (t,) in self.conn.execute("SELECT password_hash FROM staff") if t in ("Manager#2026", "FrontDesk#2026"))
        self.assertEqual(raw, 0)

    def test_session_tokens_are_stored_hashed(self):
        cookie, _ = self.login("manager")
        stored = [r[0] for r in self.conn.execute("SELECT token_hash FROM sessions")]
        self.assertNotIn(cookie, stored)

    def test_api_requires_json_and_valid_methods(self):
        self.assertEqual(call("POST", "/api/bookings", {}, content_type="text/plain")[0], 415)
        self.assertEqual(call("GET", "/api/bookings")[0], 405)
        self.assertEqual(call("GET", "/api/nothing")[0], 404)

    def test_static_files_headers_and_path_traversal(self):
        status, body, headers = call("GET", "/")
        h = dict(headers)
        self.assertEqual(status, 200)
        self.assertIn(b"Hotel Booking System", body)
        self.assertIn("default-src 'self'", h["Content-Security-Policy"])
        self.assertEqual(h["X-Content-Type-Options"], "nosniff")
        self.assertEqual(call("GET", "/static/app.js")[0], 200)
        self.assertEqual(call("GET", "/static/../backend/db.py")[0], 404)
        self.assertEqual(call("GET", "/static/..%2fbackend%2fdb.py")[0], 404)


class DatabaseRuleTests(Base):
    """The database enforces the rules even when the API is bypassed."""

    def insert(self, guest, room, ci, co, status="Confirmed"):
        return self.conn.execute(
            "INSERT INTO reservations(guest_id, room_id, check_in, check_out, status) VALUES (?,?,?,?,?)",
            (guest, room, ci, co, status))

    def test_database_blocks_overlap_and_bad_data(self):
        r = self.room_id("202")
        self.insert(1, r, d(0), d(3))
        for args in [(1, r, d(1), d(2)), (1, r, d(-1), d(1)), (1, r, d(2), d(5))]:
            with self.assertRaises(Exception):
                self.insert(*args)
        with self.assertRaises(Exception):
            self.insert(1, r, d(10), d(9))                      # check-out before check-in
        with self.assertRaises(Exception):
            self.insert(999, r, d(10), d(11))                   # guest that does not exist
        with self.assertRaises(Exception):
            self.insert(1, self.room_id("105"), d(10), d(11))   # maintenance

    def test_changing_a_booking_cannot_create_a_double_booking(self):
        r = self.room_id("203")
        self.insert(1, r, d(0), d(2))
        rid = self.insert(2, r, d(5), d(7)).lastrowid
        with self.assertRaises(Exception):
            self.conn.execute("UPDATE reservations SET check_in=?, check_out=? WHERE reservation_id=?", (d(1), d(3), rid))

    def test_cancelled_bookings_do_not_block_a_room(self):
        r = self.room_id("302")
        self.insert(1, r, d(0), d(2), status="Cancelled")
        self.insert(2, r, d(0), d(2))

    def test_wrong_date_format_is_rejected(self):
        with self.assertRaises(db.BookingError):
            db.search_free_rooms(self.conn, "25/10/2026", "2026-10-27")

    def test_past_stays_become_completed(self):
        r = self.room_id("301")
        a = self.insert(1, r, d(0), d(2)).lastrowid
        c = self.insert(2, r, d(2), d(4), status="Cancelled").lastrowid
        status = lambda i: self.conn.execute("SELECT status FROM reservations WHERE reservation_id=?", (i,)).fetchone()[0]
        db.complete_past_reservations(self.conn, today=d(2))     # the stay ends today: still Confirmed
        self.assertEqual(status(a), "Confirmed")
        db.complete_past_reservations(self.conn, today=d(3))     # the day after: Completed
        self.assertEqual((status(a), status(c)), ("Completed", "Cancelled"))
        self.assertEqual(db.complete_past_reservations(self.conn, today=d(3)), 0)   # nothing left to change


class DashboardTests(Base):
    def test_dashboard_numbers_match_the_data(self):
        cookie, _ = self.login("manager")
        _, dash, _ = call("GET", "/api/manager/dashboard", cookie=cookie)
        net = self.conn.execute("SELECT SUM(CASE status WHEN 'Paid' THEN amount WHEN 'Refunded' THEN -amount ELSE 0 END) FROM payments").fetchone()[0]
        self.assertAlmostEqual(dash["revenue_net"], net)
        self.assertAlmostEqual(sum(t["revenue"] for t in dash["revenue_by_type"]), net)
        self.assertEqual(sum(dash["status_counts"].values()), self.count("reservations"))
        self.assertEqual(len(dash["daily_revenue"]), 14)
        self.assertTrue(0 <= dash["occupancy_30_days"] <= 100)

    def test_a_new_booking_increases_revenue(self):
        cookie, _ = self.login("manager")
        before = call("GET", "/api/manager/dashboard", cookie=cookie)[1]["revenue_net"]
        self.book(ci=d(40), co=d(43))
        after = call("GET", "/api/manager/dashboard", cookie=cookie)[1]["revenue_net"]
        self.assertEqual(after - before, 3 * 25000)


class RoomsAndPricesTests(Base):
    RECORDS = 3000     # enough history to have Completed, Confirmed and Cancelled reservations

    def prices(self):
        return {r["type_name"]: r["room_type_id"] for r in self.conn.execute("SELECT * FROM room_types")}

    def snapshot(self):
        res = self.conn.execute("SELECT reservation_id, status, total_price, nightly_rate FROM reservations ORDER BY 1").fetchall()
        pay = self.conn.execute("SELECT payment_id, amount, status FROM payments ORDER BY 1").fetchall()
        return [tuple(r) for r in res], [tuple(r) for r in pay]

    def set_price(self, cookie, csrf, type_id, price):
        return call("POST", f"/api/manager/room-types/{type_id}/price", {"price": price}, cookie=cookie, csrf=csrf)

    def test_hotel_has_161_rooms_by_type(self):
        rows = dict(self.conn.execute(
            "SELECT rt.type_name, COUNT(*) FROM rooms ro JOIN room_types rt USING(room_type_id) GROUP BY rt.type_name").fetchall())
        self.assertEqual(rows, {"Standard": 100, "Deluxe": 50, "Suite": 10, "President": 1})
        self.assertEqual(self.count("rooms"), 161)

    def test_only_the_manager_can_change_prices(self):
        sid = self.prices()["Standard"]
        fcookie, fcsrf = self.login("frontdesk")
        self.assertEqual(self.set_price(fcookie, fcsrf, sid, 30000)[0], 403)
        self.assertEqual(call("POST", f"/api/manager/room-types/{sid}/price", {"price": 30000})[0], 401)
        mcookie, mcsrf = self.login("manager")
        self.assertEqual(call("POST", f"/api/manager/room-types/{sid}/price", {"price": 30000}, cookie=mcookie)[0], 403)  # no CSRF
        status, data, _ = self.set_price(mcookie, mcsrf, sid, 30000)
        self.assertEqual((status, data["old_price"], data["new_price"]), (200, 25000, 30000))
        self.assertEqual(call("GET", "/api/manager/room-types", cookie=fcookie)[0], 403)
        _, listing, _ = call("GET", "/api/manager/room-types", cookie=mcookie)
        by_name = {t["type_name"]: t for t in listing["room_types"]}
        self.assertEqual((by_name["Standard"]["price_per_night"], by_name["Standard"]["rooms"],
                          by_name["Standard"]["in_maintenance"]), (30000, 100, 1))
        self.assertEqual(by_name["President"]["rooms"], 1)

    def test_bad_prices_are_refused(self):
        sid = self.prices()["Standard"]
        cookie, csrf = self.login("manager")
        for bad in (0, -5, "abc", None, True, 10 ** 9, float("inf")):
            status, data, _ = self.set_price(cookie, csrf, sid, bad if bad != float("inf") else "inf")
            self.assertEqual((status, data["code"]), (400, "bad_price"), bad)
        self.assertEqual(self.set_price(cookie, csrf, 9999, 1000)[0], 404)
        self.assertEqual(self.conn.execute("SELECT price_per_night FROM room_types WHERE room_type_id=?", (sid,)).fetchone()[0], 25000)

    def test_price_change_never_touches_existing_reservations(self):
        self.book(room="101", ci=d(60), co=d(62))                       # a Confirmed one made now
        _, b, _ = self.book(room="102", ci=d(60), co=d(62))
        call("POST", "/api/bookings/cancel", {"reservation_id": b["reservation_id"], "email": "anna@example.kz"})
        statuses = {r[0] for r in self.conn.execute("SELECT status FROM reservations")}
        self.assertEqual(statuses, {"Confirmed", "Cancelled", "Completed"})   # all three kinds exist
        before = self.snapshot()
        cookie, csrf = self.login("manager")
        for type_id in self.prices().values():
            self.assertEqual(self.set_price(cookie, csrf, type_id, 99999)[0], 200)
        self.assertEqual(self.snapshot(), before)

    def test_new_bookings_use_the_new_price_and_old_ones_keep_theirs(self):
        sid = self.prices()["Standard"]
        _, a, _ = self.book(room="101", ci=d(70), co=d(72))
        self.assertEqual(a["total_price"], 2 * 25000)
        cookie, csrf = self.login("manager")
        self.set_price(cookie, csrf, sid, 30000)
        _, rooms, _ = call("GET", f"/api/rooms/search?check_in={d(80)}&check_out={d(82)}")
        standard = [r for r in rooms["rooms"] if r["type_name"] == "Standard"][0]
        self.assertEqual((standard["price_per_night"], standard["total_price"]), (30000, 60000))
        _, b, _ = self.book(room="102", ci=d(80), co=d(82), email="bob@example.kz")
        self.assertEqual(b["total_price"], 2 * 30000)
        # the first guest still sees the old total, and changing dates keeps the OLD nightly rate
        self.assertEqual(db.reservation_detail(self.conn, a["reservation_id"])["total_price"], 50000)
        fcookie, fcsrf = self.login("frontdesk")
        status, data, _ = call("POST", f"/api/staff/reservations/{a['reservation_id']}/modify",
                               {"check_in": d(70), "check_out": d(73)}, cookie=fcookie, csrf=fcsrf)
        self.assertEqual((status, data["total_price"], data["difference"]), (200, 3 * 25000, 25000))

    def test_price_change_is_written_to_the_activity_log(self):
        cookie, csrf = self.login("manager")
        self.set_price(cookie, csrf, self.prices()["Deluxe"], 45000)
        _, audit, _ = call("GET", "/api/manager/audit", cookie=cookie)
        self.assertTrue(any(x["action"] == "price_change" and "Deluxe" in x["detail"] and "45000" in x["detail"]
                            for x in audit["audit"]))

    def test_an_old_database_without_nightly_rate_is_upgraded(self):
        self.conn.execute("ALTER TABLE reservations DROP COLUMN nightly_rate")
        self.conn.close()
        db.init_db(db.DB_PATH)                                         # existing file: migrate, do not recreate
        self.conn = db.connect()
        bad = self.conn.execute(
            "SELECT COUNT(*) FROM reservations WHERE ABS(nightly_rate * (julianday(check_out) - julianday(check_in)) - total_price) > 0.01").fetchone()[0]
        self.assertEqual(bad, 0)
        self.assertGreater(self.count("reservations"), 0)


class DashboardFilterTests(Base):
    RECORDS = 3000     # about 75 days of history, so periods in the past and the future both have data

    def dash(self, qs=""):
        cookie, _ = self.login("manager")
        return call("GET", "/api/manager/dashboard" + qs, cookie=cookie)

    def test_first_reservation_date_is_reported(self):
        status, data, _ = self.dash()
        first = self.conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]
        self.assertEqual((status, data["first_reservation_date"], data["period"]["filtered"]), (200, first, False))

    def test_filtered_figures_match_the_data_in_the_period(self):
        first_day = self.conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]
        first = (datetime.strptime(first_day, "%Y-%m-%d").date() - timedelta(days=10)).isoformat()   # payments come before check-in
        mid = (datetime.strptime(first_day, "%Y-%m-%d").date() + timedelta(days=20)).isoformat()
        _, data, _ = self.dash(f"?from={first}&to={mid}")
        net = self.conn.execute("SELECT COALESCE(SUM(CASE status WHEN 'Paid' THEN amount WHEN 'Refunded' THEN -amount ELSE 0 END),0) "
                                "FROM payments WHERE payment_date BETWEEN ? AND ?", (first, mid)).fetchone()[0]
        n = self.conn.execute("SELECT COUNT(*) FROM reservations WHERE check_in BETWEEN ? AND ?", (first, mid)).fetchone()[0]
        self.assertAlmostEqual(data["revenue_net"], net)
        self.assertAlmostEqual(sum(t["revenue"] for t in data["revenue_by_type"]), net)
        self.assertEqual(sum(data["status_counts"].values()), n)
        self.assertEqual(data["period"], {"from": first, "to": mid, "filtered": True, "nights": 31})
        self.assertGreater(net, 0)
        self.assertEqual(len(data["daily_revenue"]), 14)
        self.assertTrue(0 <= data["occupancy"] <= 100)
        _, whole, _ = self.dash()
        self.assertLess(sum(data["status_counts"].values()), sum(whole["status_counts"].values()))

    def test_a_short_period_and_an_empty_period(self):
        today = date.today().isoformat()
        _, one_day, _ = self.dash(f"?from={today}&to={today}")
        self.assertEqual((len(one_day["daily_revenue"]), one_day["period"]["nights"]), (1, 1))
        _, empty, _ = self.dash("?from=1999-01-01&to=1999-01-31")
        self.assertEqual((empty["revenue_net"], empty["status_counts"], empty["occupancy"]), (0, {}, 0.0))

    def test_only_a_start_date_means_until_the_last_booked_day(self):
        first = self.conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]
        _, from_only, _ = self.dash(f"?from={first}")
        _, whole, _ = self.dash()
        self.assertEqual(sum(from_only["status_counts"].values()), sum(whole["status_counts"].values()))
        _, to_only, _ = self.dash(f"?to={date.today().isoformat()}")
        self.assertEqual(to_only["period"]["from"], first)
        self.assertLess(sum(to_only["status_counts"].values()), sum(whole["status_counts"].values()))

    def test_bad_dates_are_refused(self):
        for qs in ("?from=25/10/2026", "?to=nonsense", "?from=2026-05-02&to=2026-05-01"):
            status, data, _ = self.dash(qs)
            self.assertEqual((status, data["code"]), (400, "bad_dates"), qs)

    def test_occupancy_of_a_period_counts_booked_nights(self):
        a, b = d(100), d(103)                                           # 3 nights, far from the demo data
        self.book(room="101", ci=a, co=b)
        _, data, _ = self.dash(f"?from={a}&to={b}")                      # 4 days, 3 nights booked in one of 160 rooms
        rooms = self.conn.execute("SELECT COUNT(*) FROM rooms WHERE status='Available'").fetchone()[0]
        self.assertAlmostEqual(data["occupancy"], round(100.0 * 3 / (rooms * 4), 1))


class FiveThousandRecordsTests(unittest.TestCase):
    """The default demo data has 5,000 reservations, and the lists handle them page by page."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(cls.tmp, "big.db")
        db.init_db(db.DB_PATH, reset=True)          # default size: 5,000 reservations
        cls.conn = db.connect()
        server._failed.clear()
        _, data, headers = call("POST", "/api/auth/login", {"email": "frontdesk@hotel.example", "password": "FrontDesk#2026"})
        cls.cookie = [v for k, v in headers if k == "Set-Cookie"][0].split(";")[0].split("=", 1)[1]

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def get(self, qs=""):
        status, data, _ = call("GET", "/api/staff/reservations?" + qs, cookie=self.cookie)
        self.assertEqual(status, 200, data)
        return data

    def test_database_has_exactly_5000_reservations(self):
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reservations").fetchone()[0], 5000)
        self.assertGreater(self.conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0], 5000)
        self.assertGreater(self.conn.execute("SELECT COUNT(*) FROM guests").fetchone()[0], 500)

    def test_no_room_is_double_booked_in_the_demo_data(self):
        overlaps = self.conn.execute(
            """SELECT COUNT(*) FROM reservations a JOIN reservations b
               ON a.room_id = b.room_id AND a.reservation_id < b.reservation_id
               AND a.status = 'Confirmed' AND b.status = 'Confirmed'
               AND a.check_in < b.check_out AND a.check_out > b.check_in""").fetchone()[0]
        self.assertEqual(overlaps, 0)

    def test_the_list_is_paged(self):
        first = self.get("page=1&page_size=50")
        self.assertEqual((first["total"], len(first["reservations"]), first["pages"]), (5000, 50, 100))
        second = self.get("page=2&page_size=50")
        ids1 = {r["reservation_id"] for r in first["reservations"]}
        ids2 = {r["reservation_id"] for r in second["reservations"]}
        self.assertFalse(ids1 & ids2)
        last = self.get("page=100&page_size=50")
        self.assertEqual(len(last["reservations"]), 50)
        self.assertEqual(len(self.get("page=101&page_size=50")["reservations"]), 0)

    def test_page_size_is_limited(self):
        self.assertEqual(len(self.get("page_size=100000")["reservations"]), 200)

    def test_filters_and_total_agree(self):
        total = 0
        for status in ("Confirmed", "Completed", "Cancelled"):
            part = self.get(f"status={status}&page_size=1")
            self.assertGreater(part["total"], 0)
            total += part["total"]
        self.assertEqual(total, 5000)
        window = self.get(f"from={d(-600)}&to={d(-500)}&page_size=200")
        self.assertTrue(all(d(-600) <= r["check_in"] <= d(-500) for r in window["reservations"]))

    def test_sort_order(self):
        newest = self.get("order=desc&page_size=5")["reservations"]
        oldest = self.get("order=asc&page_size=5")["reservations"]
        self.assertGreater(newest[0]["check_in"], oldest[0]["check_in"])

    def test_bad_filter_date_is_rejected(self):
        status, data, _ = call("GET", "/api/staff/reservations?from=2026-13-45", cookie=self.cookie)
        self.assertEqual((status, data["code"]), (400, "bad_dates"))

    def test_5000_reservations_are_spread_over_all_160_bookable_rooms(self):
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0], 161)
        self.assertEqual(self.conn.execute("SELECT COUNT(DISTINCT room_id) FROM reservations").fetchone()[0], 160)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reservations WHERE nightly_rate <= 0").fetchone()[0], 0)

    def test_reservations_are_spread_evenly_over_the_past_6_years(self):
        first = self.conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]
        six_years_ago = date.today().replace(year=date.today().year - 6)
        self.assertLessEqual(abs((datetime.strptime(first, "%Y-%m-%d").date() - six_years_ago).days), 10)
        per_year = [n for y, n in self.conn.execute(
            "SELECT substr(check_in, 1, 4), COUNT(*) FROM reservations WHERE check_in >= ? AND check_in < ? GROUP BY 1",
            (six_years_ago.replace(month=1, day=1).isoformat(), date.today().replace(month=1, day=1).isoformat())).fetchall()]
        full_years = per_year[1:]                       # the first year starts part way through
        self.assertGreaterEqual(len(full_years), 5)
        self.assertLess(max(full_years) - min(full_years), 0.1 * max(full_years))
        self.assertGreater(self.conn.execute("SELECT COUNT(*) FROM reservations WHERE status = 'Confirmed'").fetchone()[0], 0)

    def test_search_stays_fast_with_5000_reservations(self):
        t0 = datetime.now()
        for i in range(50):
            a = date.today() + timedelta(days=1 + i)
            db.search_free_rooms(self.conn, a.isoformat(), (a + timedelta(days=2)).isoformat())
        self.assertLess((datetime.now() - t0).total_seconds() / 50, 0.5)

    def test_dashboard_works_with_5000_reservations(self):
        _, _, headers = call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "Manager#2026"})
        mc = [v for k, v in headers if k == "Set-Cookie"][0].split(";")[0].split("=", 1)[1]
        status, dash, _ = call("GET", "/api/manager/dashboard", cookie=mc)
        self.assertEqual(status, 200)
        self.assertEqual(sum(dash["status_counts"].values()), 5000)


class AddRecordsTests(unittest.TestCase):
    """5,000 more past reservations can be added into the existing history without changing the old data."""

    @staticmethod
    def checksum(conn, upto):
        import hashlib
        rows = conn.execute("SELECT * FROM reservations WHERE reservation_id <= ? ORDER BY reservation_id", (upto,)).fetchall()
        return hashlib.md5(repr([tuple(r) for r in rows]).encode()).hexdigest()

    def test_adding_5000_makes_10000_and_keeps_the_old_data(self):
        tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(tmp, "grow.db")
        db.init_db(db.DB_PATH, reset=True)                       # 5,000 reservations
        conn = db.connect()
        conn.execute("INSERT INTO guests(full_name, phone, email) VALUES ('Own Guest', '+7000000', 'own@example.kz')")
        old_checksum = self.checksum(conn, 5000)
        old_span = conn.execute("SELECT MIN(check_in), MAX(check_out) FROM reservations").fetchone()
        old_payments = conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0]
        info = db.add_demo_records(conn, 5000)
        self.assertEqual(info["added"], 5000)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM reservations").fetchone()[0], 10000)
        self.assertEqual(self.checksum(conn, 5000), old_checksum)                       # nothing old was changed
        self.assertGreater(conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0], old_payments + 5000)
        overlaps = conn.execute(
            """SELECT COUNT(*) FROM reservations a JOIN reservations b
               ON a.room_id = b.room_id AND a.reservation_id < b.reservation_id
               AND a.status = 'Confirmed' AND b.status = 'Confirmed'
               AND a.check_in < b.check_out AND a.check_out > b.check_in""").fetchone()[0]
        self.assertEqual(overlaps, 0)
        self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
        # the new stays lie inside the old period and are all in the past
        new = conn.execute("SELECT MIN(check_in), MAX(check_out) FROM reservations WHERE reservation_id > 5000").fetchone()
        self.assertGreaterEqual(new[0], old_span[0])
        self.assertLess(new[1], date.today().isoformat())
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM reservations WHERE reservation_id > 5000 AND status = 'Confirmed'").fetchone()[0], 0)
        # real guests are not given fake history
        own = conn.execute("SELECT COUNT(*) FROM reservations r JOIN guests g USING(guest_id) WHERE g.email = 'own@example.kz'").fetchone()[0]
        self.assertEqual(own, 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM reservations WHERE reservation_id > 5000 AND nightly_rate <= 0").fetchone()[0], 0)
        conn.close()

    def test_the_lists_page_through_the_larger_data(self):
        tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(tmp, "grow2.db")
        db.init_db(db.DB_PATH, reset=True, records=500)
        conn = db.connect()
        db.add_demo_records(conn, 1000)
        server._failed.clear()
        _, _, headers = call("POST", "/api/auth/login", {"email": "frontdesk@hotel.example", "password": "FrontDesk#2026"})
        cookie = [v for k, v in headers if k == "Set-Cookie"][0].split(";")[0].split("=", 1)[1]
        _, data, _ = call("GET", "/api/staff/reservations?page_size=100&page=15", cookie=cookie)
        self.assertEqual((data["total"], data["pages"], len(data["reservations"])), (1500, 15, 100))
        conn.close()

    def test_a_full_calendar_extends_the_history_instead_of_failing(self):
        """An older database with only 10 bookable rooms is already about half full, so new stays go further back"""
        tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(tmp, "grow4.db")
        db.init_db(db.DB_PATH, reset=True, demo_data=False)
        conn = db.connect()
        conn.execute("UPDATE rooms SET status = 'Maintenance' WHERE room_id > 10")
        db.seed_demo_data(conn, date.today(), 5000)
        old_first = conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0]
        db.add_demo_records(conn, 5000)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM reservations").fetchone()[0], 10000)
        self.assertLess(conn.execute("SELECT MIN(check_in) FROM reservations").fetchone()[0], old_first)
        overlaps = conn.execute(
            """SELECT COUNT(*) FROM reservations a JOIN reservations b
               ON a.room_id = b.room_id AND a.reservation_id < b.reservation_id
               AND a.status = 'Confirmed' AND b.status = 'Confirmed'
               AND a.check_in < b.check_out AND a.check_out > b.check_in""").fetchone()[0]
        self.assertEqual(overlaps, 0)
        conn.close()

    def test_a_count_of_zero_is_rejected(self):
        tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(tmp, "grow3.db")
        db.init_db(db.DB_PATH, reset=True, records=50)
        conn = db.connect()
        with self.assertRaises(db.BookingError):
            db.add_demo_records(conn, 0)
        conn.close()


class ImprovementTests(Base):
    """Resend email, password change, CSV export, health check and backups."""

    # ---- health
    def test_health_checks_the_database(self):
        status, data, _ = call("GET", "/api/health")
        self.assertEqual((status, data["status"], data["database"]), (200, "ok", "ok"))

    # ---- resend a confirmation email (FR-02)
    def test_front_desk_can_resend_a_confirmation_email(self):
        _, b, _ = self.book(ci=d(20), co=d(22))
        cookie, csrf = self.login("frontdesk")
        n = self.count("emails")
        status, data, _ = call("POST", f"/api/staff/emails/{b['email_id']}/resend", {}, cookie=cookie, csrf=csrf)
        self.assertEqual((status, data["status"], data["to"]), (200, "Sent", "anna@example.kz"))
        self.assertEqual(self.count("emails"), n + 1)                    # the old row stays as history
        subject = self.conn.execute("SELECT subject FROM emails WHERE email_id=?", (data["email_id"],)).fetchone()[0]
        self.assertTrue(subject.endswith("(resent)"))
        again = call("POST", f"/api/staff/emails/{data['email_id']}/resend", {}, cookie=cookie, csrf=csrf)[1]
        self.assertEqual(self.conn.execute("SELECT subject FROM emails WHERE email_id=?", (again["email_id"],)).fetchone()[0].count("(resent)"), 1)

    def test_resend_needs_login_csrf_and_a_real_email(self):
        _, b, _ = self.book(ci=d(20), co=d(22))
        self.assertEqual(call("POST", f"/api/staff/emails/{b['email_id']}/resend", {})[0], 401)
        cookie, csrf = self.login("frontdesk")
        self.assertEqual(call("POST", f"/api/staff/emails/{b['email_id']}/resend", {}, cookie=cookie)[0], 403)
        self.assertEqual(call("POST", "/api/staff/emails/999999/resend", {}, cookie=cookie, csrf=csrf)[0], 404)

    # ---- passwords
    def test_demo_accounts_are_flagged_until_the_password_is_changed(self):
        cookie, csrf = self.login("frontdesk")
        self.assertTrue(call("GET", "/api/auth/me", cookie=cookie)[1]["user"]["default_password"])
        status, _, _ = call("POST", "/api/auth/password", {"current": "FrontDesk#2026", "new": "Better-pass-2027"}, cookie=cookie, csrf=csrf)
        self.assertEqual(status, 200)
        self.assertFalse(call("GET", "/api/auth/me", cookie=cookie)[1]["user"]["default_password"])

    def test_changed_password_works_and_the_old_one_does_not(self):
        cookie, csrf = self.login("manager")
        call("POST", "/api/auth/password", {"current": "Manager#2026", "new": "Another-pass-77"}, cookie=cookie, csrf=csrf)
        self.assertEqual(call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "Manager#2026"})[0], 401)
        self.assertEqual(call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "Another-pass-77"})[0], 200)

    def test_password_rules_are_enforced(self):
        cookie, csrf = self.login("manager")
        for bad, code in (("short1", "weak_password"), ("onlyletterspassword", "weak_password"),
                          ("1234567890123", "weak_password"), ("Manager#2026", "same_password")):
            status, data, _ = call("POST", "/api/auth/password", {"current": "Manager#2026", "new": bad}, cookie=cookie, csrf=csrf)
            self.assertEqual((status, data["code"]), (400, code), bad)
        status, data, _ = call("POST", "/api/auth/password", {"current": "wrong", "new": "Valid-pass-123"}, cookie=cookie, csrf=csrf)
        self.assertEqual((status, data["code"]), (403, "wrong_password"))

    def test_changing_the_password_ends_the_other_sessions(self):
        first, _ = self.login("manager")
        second, csrf2 = self.login("manager")
        call("POST", "/api/auth/password", {"current": "Manager#2026", "new": "Third-pass-555"}, cookie=second, csrf=csrf2)
        self.assertEqual(call("GET", "/api/manager/dashboard", cookie=first)[0], 401)
        self.assertEqual(call("GET", "/api/manager/dashboard", cookie=second)[0], 200)

    def test_guessing_the_current_password_is_limited(self):
        cookie, csrf = self.login("manager")
        for _ in range(5):
            call("POST", "/api/auth/password", {"current": "guess", "new": "Valid-pass-123"}, cookie=cookie, csrf=csrf)
        status, data, _ = call("POST", "/api/auth/password", {"current": "Manager#2026", "new": "Valid-pass-123"}, cookie=cookie, csrf=csrf)
        self.assertEqual((status, data["code"]), (429, "too_many_attempts"))

    def test_password_change_needs_login_and_csrf(self):
        self.assertEqual(call("POST", "/api/auth/password", {"current": "a", "new": "b"})[0], 401)
        cookie, _ = self.login("manager")
        self.assertEqual(call("POST", "/api/auth/password", {"current": "Manager#2026", "new": "Valid-pass-123"}, cookie=cookie)[0], 403)

    # ---- CSV export
    def test_manager_can_download_the_reservations_as_csv(self):
        import csv
        import io
        self.book(ci=d(20), co=d(22))
        cookie, _ = self.login("manager")
        status, body, headers = call("GET", "/api/manager/export.csv?status=Confirmed", cookie=cookie)
        h = dict(headers)
        self.assertEqual(status, 200)
        self.assertIn("text/csv", h["Content-Type"])
        self.assertIn("attachment", h["Content-Disposition"])
        rows = list(csv.reader(io.StringIO(body.decode("utf-8").lstrip("\ufeff"))))
        self.assertEqual(rows[0][:4], ["reservation_id", "guest", "email", "room"])
        self.assertEqual(len(rows) - 1, self.conn.execute("SELECT COUNT(*) FROM reservations WHERE status='Confirmed'").fetchone()[0])
        self.assertTrue(any(r[1] == "Anna Test" for r in rows[1:]))

    def test_csv_export_follows_the_filters_and_is_manager_only(self):
        self.book(ci=d(20), co=d(22))
        mcookie, _ = self.login("manager")
        fcookie, _ = self.login("frontdesk")
        self.assertEqual(call("GET", "/api/manager/export.csv", cookie=fcookie)[0], 403)
        self.assertEqual(call("GET", "/api/manager/export.csv")[0], 401)
        _, body, _ = call("GET", f"/api/manager/export.csv?from={d(19)}&to={d(21)}", cookie=mcookie)
        lines = body.decode("utf-8").strip().splitlines()
        self.assertEqual(len(lines), 2)                       # header and the one booking
        self.assertEqual(call("GET", "/api/manager/export.csv?from=bad", cookie=mcookie)[0], 400)

    def test_csv_cells_cannot_run_as_formulas(self):
        self.assertEqual(db.csv_cell("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")")
        for risky in ("+1+1", "-2", "@SUM(A1)"):
            self.assertTrue(db.csv_cell(risky).startswith("'"))
        self.assertEqual(db.csv_cell("Anna"), "Anna")
        self.book(full_name="=cmd|' /C calc'!A0", ci=d(20), co=d(22))
        cookie, _ = self.login("manager")
        _, body, _ = call("GET", "/api/manager/export.csv?q=cmd", cookie=cookie)
        text = body.decode("utf-8")
        self.assertIn(",'=cmd", text)                         # the apostrophe stops Excel from running it
        self.assertNotIn(",=cmd", text)

    def test_export_is_written_to_the_activity_log(self):
        cookie, _ = self.login("manager")
        call("GET", "/api/manager/export.csv", cookie=cookie)
        _, audit, _ = call("GET", "/api/manager/audit", cookie=cookie)
        self.assertTrue(any(a["action"] == "export_csv" for a in audit["audit"]))


class BackupTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
        import backup
        self.backup = backup
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "hotel.db")
        db.DB_PATH = self.path
        db.init_db(self.path, reset=True, records=300)
        self.out = os.path.join(self.tmp, "backups")

    def count(self, path):
        conn = sqlite3.connect(path)
        n = conn.execute("SELECT COUNT(*) FROM reservations").fetchone()[0]
        conn.close()
        return n

    def test_backup_is_verified_and_has_a_checksum(self):
        target, size, counts = self.backup.make_backup(self.path, self.out)
        self.assertTrue(os.path.exists(target) and os.path.exists(target + ".sha256"))
        self.assertEqual(counts["reservations"], 300)
        ok, message = self.backup.verify_backup(target)
        self.assertTrue(ok, message)

    def test_a_damaged_backup_is_detected(self):
        target, _, _ = self.backup.make_backup(self.path, self.out)
        with open(target, "ab") as f:
            f.write(b"x")
        ok, message = self.backup.verify_backup(target)
        self.assertFalse(ok)
        self.assertIn("checksum", message)
        os.remove(target + ".sha256")
        self.assertFalse(self.backup.verify_backup(target)[0])

    def test_restore_brings_back_the_old_data_and_keeps_a_safety_copy(self):
        target, _, _ = self.backup.make_backup(self.path, self.out)
        conn = db.connect(self.path)
        conn.execute("DELETE FROM payments")
        conn.execute("DELETE FROM emails")
        conn.execute("DELETE FROM reservations")
        conn.close()
        self.assertEqual(self.count(self.path), 0)
        with self.assertRaises(SystemExit):
            self.backup.restore_backup(target, self.path)                   # refuses without --force
        safety = self.backup.restore_backup(target, self.path, force=True)
        self.assertEqual(self.count(self.path), 300)
        self.assertTrue(safety and os.path.exists(safety))
        self.assertEqual(self.count(safety), 0)

    def test_only_the_newest_backups_are_kept(self):
        from datetime import datetime as dt
        for minute in range(5):
            self.backup.make_backup(self.path, self.out, keep=3, now=dt(2026, 11, 1, 3, minute, 0))
        files = sorted(f for f in os.listdir(self.out) if f.endswith(".db.gz"))
        self.assertEqual(len(files), 3)
        self.assertTrue(files[0].startswith("hotel_20261101_0302"))
        self.assertEqual(len([f for f in os.listdir(self.out) if f.endswith(".sha256")]), 3)

    def test_backup_works_while_the_database_is_in_use(self):
        conn = db.connect(self.path)
        conn.execute("BEGIN")
        conn.execute("INSERT INTO guests(full_name, phone, email) VALUES ('Busy', '+7000000', 'busy@example.kz')")
        conn.execute("COMMIT")
        target, _, counts = self.backup.make_backup(self.path, self.out)
        self.assertTrue(self.backup.verify_backup(target)[0])
        conn.close()


class EmptyDatabaseTests(unittest.TestCase):
    """A real hotel starts with `py run.py --empty`: rooms and staff accounts, but no demo reservations."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(self.tmp, "empty.db")
        db.init_db(db.DB_PATH, reset=True, demo_data=False)
        self.conn = db.connect()
        server._failed.clear()
        _, data, headers = call("POST", "/api/auth/login", {"email": "manager@hotel.example", "password": "Manager#2026"})
        self.cookie = [v for k, v in headers if k == "Set-Cookie"][0].split(";")[0].split("=", 1)[1]

    def tearDown(self):
        self.conn.close()

    def test_nothing_but_rooms_and_staff_exist(self):
        counts = {t: self.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("reservations", "payments", "guests", "emails")}
        self.assertEqual(counts, {"reservations": 0, "payments": 0, "guests": 0, "emails": 0})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0], 2)
        self.assertGreater(self.conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0], 100)

    def test_every_staff_page_works_without_data(self):
        for path in ("/api/staff/reservations", "/api/manager/dashboard", "/api/manager/audit", "/api/staff/emails",
                     "/api/manager/export.csv", "/api/manager/room-types"):
            self.assertEqual(call("GET", path, cookie=self.cookie)[0], 200, path)
        _, dash, _ = call("GET", "/api/manager/dashboard", cookie=self.cookie)
        self.assertEqual((dash["revenue_net"], dash["upcoming_bookings"], dash["first_reservation_date"]), (0, 0, None))

    def test_the_first_booking_works_and_shows_on_the_dashboard(self):
        ci, co = d(0), d(2)
        _, rooms, _ = call("GET", f"/api/rooms/search?check_in={ci}&check_out={co}")
        room = rooms["rooms"][0]["room_id"]
        status, booking, _ = call("POST", "/api/bookings", {"room_id": room, "check_in": ci, "check_out": co, "full_name": "First Guest",
                                                            "phone": "+77001234567", "email": "first@example.kz", "method": "Cash"})
        self.assertEqual((status, booking["reservation_id"]), (201, 1))
        _, dash, _ = call("GET", "/api/manager/dashboard", cookie=self.cookie)
        self.assertEqual(dash["upcoming_bookings"], 1)
        self.assertGreater(dash["revenue_net"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
