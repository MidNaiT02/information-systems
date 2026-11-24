"""Tests for the floor map, housekeeping, QR pass and check-in, flexible-date price calendar,
price suggestions and the QR encoder.   Run:  py -m unittest discover -s tests -v"""
import os
import re
import sqlite3
import sys
import unittest
from datetime import date, datetime, time, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db        # noqa: E402
import features  # noqa: E402
import qr        # noqa: E402
from test_api import Base, call, d  # noqa: E402

TODAY = date.today()


def iso(n):
    return (TODAY + timedelta(days=n)).isoformat()


class QRTests(unittest.TestCase):
    def test_size_grows_with_text_and_is_square(self):
        sizes = {len(qr.make_matrix(t)) for t in ("HB1-ABCDEF", "HB123456-ABCDEF", "x" * 30, "x" * 60)}
        self.assertEqual(sizes, {21, 25, 29, 33})                 # versions 1 to 4
        m = qr.make_matrix("HB12-A1B2C3")
        self.assertTrue(all(len(row) == len(m) for row in m))

    def test_finder_patterns_in_three_corners(self):
        m = qr.make_matrix("HB12-A1B2C3")
        n = len(m)
        for r0, c0 in ((0, 0), (0, n - 7), (n - 7, 0)):
            self.assertTrue(all(m[r0][c0 + i] == 1 and m[r0 + 6][c0 + i] == 1 for i in range(7)))
            self.assertEqual(m[r0 + 3][c0 + 3], 1)
            self.assertEqual(m[r0 + 1][c0 + 1], 0)
        self.assertEqual(m[n - 8][8], 1)           # dark module

    def test_same_text_same_picture_and_too_long_is_refused(self):
        self.assertEqual(qr.make_matrix("HB5-AAAAAA"), qr.make_matrix("HB5-AAAAAA"))
        self.assertNotEqual(qr.make_matrix("HB5-AAAAAA"), qr.make_matrix("HB5-AAAAAB"))
        with self.assertRaises(ValueError):
            qr.make_matrix("x" * 200)

    def test_svg_is_plain_shapes_only(self):
        svg = qr.to_svg("HB5-AAAAAA")
        self.assertTrue(svg.startswith("<svg") and "<path" in svg)
        self.assertNotIn("script", svg.lower())


class FeatureBase(Base):
    def free_room(self, ci, co, type_name="Suite"):
        status, data, _ = call("GET", f"/api/rooms/search?check_in={ci}&check_out={co}")
        self.assertEqual(status, 200, data)
        return next(r for r in data["rooms"] if r["type_name"] == type_name)

    def book_today(self, nights=1, type_name="Suite", email="today@example.kz"):
        room = self.free_room(iso(0), iso(nights), type_name)
        room_number = self.conn.execute("SELECT room_number FROM rooms WHERE room_id=?", (room["room_id"],)).fetchone()[0]
        status, data, _ = self.book(room=room_number, ci=iso(0), co=iso(nights), email=email)
        self.assertEqual(status, 201, data)
        return data

    def staff_post(self, path, body=None, who="frontdesk"):
        cookie, csrf = self.login(who)
        return call("POST", path, body or {}, cookie, csrf)

    def staff_get(self, path, who="frontdesk"):
        cookie, _ = self.login(who)
        return call("GET", path, cookie=cookie)


class PassTests(FeatureBase):
    def test_booking_returns_a_pass_with_qr(self):
        res = self.book_today()
        self.assertRegex(res["pass"]["code"], r"^HB\d+-[0-9A-F]{32}$")
        self.assertTrue(res["pass"]["qr_svg"].startswith("<svg"))
        self.assertTrue(res["pass"]["code"].startswith(f"HB{res['reservation_id']}-"))

    def test_my_reservations_shows_the_pass_only_while_confirmed(self):
        res = self.book(ci=d(0), co=d(2))[1]
        token, csrf = self.guest_session("anna@example.kz")
        status, history, _ = call("GET", "/api/guest/reservations", cookie=token, cookie_name="guest_session")
        self.assertEqual(status, 200, history)
        item = next(x for x in history["reservations"] if x["reservation_id"] == res["reservation_id"])
        self.assertEqual(item["pass"]["code"], res["pass"]["code"])
        cancelled, _, _ = call("POST", "/api/bookings/cancel", {"reservation_id": res["reservation_id"]},
                               cookie=token, csrf=csrf, cookie_name="guest_session")
        self.assertEqual(cancelled, 200)
        status, history, _ = call("GET", "/api/guest/reservations", cookie=token, cookie_name="guest_session")
        item = next(x for x in history["reservations"] if x["reservation_id"] == res["reservation_id"])
        self.assertIsNone(item["pass"])

    def test_pass_lookup_needs_staff_and_rejects_forged_codes(self):
        res = self.book_today()
        code = res["pass"]["code"]
        self.assertEqual(call("GET", f"/api/staff/passes/lookup?code={code}")[0], 401)
        status, data, _ = self.staff_get(f"/api/staff/passes/lookup?code={code}")
        self.assertEqual((status, data["reservation_id"]), (200, res["reservation_id"]))
        forged = f"HB{res['reservation_id']}-000000"
        status, data, _ = self.staff_get(f"/api/staff/passes/lookup?code={forged}")
        self.assertEqual((status, data["code"]), (404, "bad_pass"))
        status, data, _ = self.staff_get(f"/api/staff/passes/lookup?code={res['reservation_id']}")   # plain number is fine for staff
        self.assertEqual(status, 200)
        self.assertEqual(self.staff_get("/api/staff/passes/lookup?code=hello")[0], 400)

    def test_code_is_not_case_or_space_sensitive(self):
        res = self.book_today()
        typed = " " + res["pass"]["code"].lower() + " "
        self.assertEqual(self.staff_get(f"/api/staff/passes/lookup?code={typed.replace(' ', '%20')}")[0], 200)


class CheckInTests(FeatureBase):
    def test_check_in_then_check_out_makes_room_dirty(self):
        res = self.book_today()
        rid = res["reservation_id"]
        self.assertEqual(self.conn.execute("SELECT housekeeping FROM rooms WHERE room_id=?", (res["room_id"],)).fetchone()[0], "Inspected")
        cookie, csrf = self.login("frontdesk")
        status, data, _ = call("POST", f"/api/staff/reservations/{rid}/check-in", {"code": res["pass"]["code"]}, cookie, csrf)
        self.assertEqual(status, 200, data)
        self.assertTrue(data["checked_in_at"] and data["can_check_out"])
        self.assertEqual(call("POST", f"/api/staff/reservations/{rid}/check-in", {}, cookie, csrf)[0], 409)   # twice
        status, data, _ = call("POST", f"/api/staff/reservations/{rid}/check-out", {}, cookie, csrf)
        self.assertEqual(status, 200, data)
        self.assertEqual(self.conn.execute("SELECT housekeeping FROM rooms WHERE room_id=?", (res["room_id"],)).fetchone()[0], "Dirty")
        self.assertEqual(call("POST", f"/api/staff/reservations/{rid}/check-out", {}, cookie, csrf)[0], 409)  # twice
        actions = [r[0] for r in self.conn.execute("SELECT action FROM audit_log")]
        self.assertIn("check_in", actions)
        self.assertIn("check_out", actions)

    def test_rules(self):
        cookie, csrf = self.login("frontdesk")
        future = self.book(ci=d(0), co=d(2))[1]["reservation_id"]
        status, data, _ = call("POST", f"/api/staff/reservations/{future}/check-in", {}, cookie, csrf)
        self.assertEqual((status, data["code"]), (409, "cannot_check_in"))
        self.assertIn("opens on", data["error"])
        res = self.book(room="102", ci=d(5), co=d(7), email="cancel@example.kz")[1]
        owner_token, owner_csrf = self.guest_session("cancel@example.kz")
        self.assertEqual(call("POST", "/api/bookings/cancel", {"reservation_id": res["reservation_id"]},
                              cookie=owner_token, csrf=owner_csrf, cookie_name="guest_session")[0], 200)
        status, data, _ = call("POST", f"/api/staff/reservations/{res['reservation_id']}/check-in", {}, cookie, csrf)
        self.assertEqual((status, data["code"]), (409, "cannot_check_in"))
        self.assertIn("cancelled", data["error"])
        other = self.book_today(email="other@example.kz")
        self.assertEqual(call("POST", f"/api/staff/reservations/{other['reservation_id']}/check-out", {}, cookie, csrf)[0], 409)   # never checked in
        wrong = call("POST", f"/api/staff/reservations/{other['reservation_id']}/check-in", {"code": res["pass"]["code"]}, cookie, csrf)
        self.assertEqual(wrong[0], 409)
        self.assertEqual(call("POST", f"/api/staff/reservations/{other['reservation_id']}/check-in", {}, None, None)[0], 401)
        self.assertEqual(call("POST", f"/api/staff/reservations/{other['reservation_id']}/check-in", {}, cookie, "wrong")[0], 403)

    def test_dirty_room_gives_a_warning_but_check_in_works(self):
        res = self.book_today()
        self.conn.execute("UPDATE rooms SET housekeeping='Dirty' WHERE room_id=?", (res["room_id"],))
        status, data, _ = self.staff_post(f"/api/staff/reservations/{res['reservation_id']}/check-in")
        self.assertEqual(status, 200)
        self.assertIn("not cleaned", data["warning"])


class HousekeepingTests(FeatureBase):
    def room(self, number="301"):
        return self.room_id(number)

    def test_order_dirty_clean_inspected(self):
        rid = self.room()
        self.conn.execute("UPDATE rooms SET housekeeping='Dirty' WHERE room_id=?", (rid,))
        cookie, csrf = self.login("frontdesk")
        url = f"/api/staff/rooms/{rid}/housekeeping"
        status, data, _ = call("POST", url, {"status": "Inspected"}, cookie, csrf)
        self.assertEqual((status, data["code"]), (409, "bad_transition"))
        self.assertEqual(call("POST", url, {"status": "Clean"}, cookie, csrf)[0], 200)
        self.assertEqual(call("POST", url, {"status": "Clean"}, cookie, csrf)[0], 409)
        self.assertEqual(call("POST", url, {"status": "Inspected"}, cookie, csrf)[0], 200)
        self.assertEqual(call("POST", url, {"status": "Dirty"}, cookie, csrf)[0], 200)      # reported dirty again
        self.assertEqual(call("POST", url, {"status": "Spotless"}, cookie, csrf)[0], 400)
        self.assertEqual(call("POST", "/api/staff/rooms/99999/housekeeping", {"status": "Clean"}, cookie, csrf)[0], 404)
        self.assertEqual(call("POST", url, {"status": "Clean"}, None, None)[0], 401)
        self.assertTrue(self.conn.execute("SELECT 1 FROM audit_log WHERE action='housekeeping'").fetchone())

    def test_board_puts_arrival_rooms_first_and_counts(self):
        res = self.book_today()
        rid = res["room_id"]
        other = self.room("302")
        self.conn.execute("UPDATE rooms SET housekeeping='Dirty' WHERE room_id IN (?,?)", (rid, other))
        status, data, _ = self.staff_get("/api/staff/housekeeping")
        self.assertEqual(status, 200)
        self.assertEqual(data["rooms"][0]["room_id"], rid)
        self.assertTrue(data["rooms"][0]["priority"])
        self.assertGreaterEqual(data["summary"]["Dirty"], 2)
        self.assertEqual(data["summary"]["priority"], 1)
        total = sum(data["summary"][k] for k in ("Dirty", "Clean", "Inspected"))
        self.assertEqual(total, 160)            # room 105 is under maintenance and not on the board

    def test_stay_reaching_checkout_time_makes_the_room_dirty_once(self):
        rid = self.room("401")
        self.conn.execute("""INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
                             VALUES (1, ?, ?, ?, 'Confirmed', 25000, 25000)""", (rid, iso(-2), iso(0)))
        before_noon, after_noon = datetime.combine(TODAY, time(11, 0)), datetime.combine(TODAY, time(13, 0))
        self.assertEqual(features.sweep_departures(self.conn, before_noon), 0)
        self.assertEqual(self.conn.execute("SELECT housekeeping FROM rooms WHERE room_id=?", (rid,)).fetchone()[0], "Inspected")
        self.assertEqual(features.sweep_departures(self.conn, after_noon), 1)
        self.assertEqual(self.conn.execute("SELECT housekeeping FROM rooms WHERE room_id=?", (rid,)).fetchone()[0], "Dirty")
        features.set_housekeeping(self.conn, rid, "Clean", after_noon)
        self.assertEqual(features.sweep_departures(self.conn, after_noon + timedelta(hours=2)), 0)    # a cleaned room stays cleaned
        self.assertEqual(self.conn.execute("SELECT housekeeping FROM rooms WHERE room_id=?", (rid,)).fetchone()[0], "Clean")

    def test_old_database_is_upgraded(self):
        if sqlite3.sqlite_version_info < (3, 35, 0):
            self.skipTest("this SQLite cannot drop columns")
        self.conn.close()
        raw = sqlite3.connect(db.DB_PATH)
        for col in ("housekeeping", "hk_updated"):
            raw.execute(f"ALTER TABLE rooms DROP COLUMN {col}")
        for col in ("checked_in_at", "checked_out_at"):
            raw.execute(f"ALTER TABLE reservations DROP COLUMN {col}")
        raw.commit(); raw.close()
        db.init_db(db.DB_PATH)                     # existing database: migrate
        self.conn = db.connect()
        cols = [r[1] for r in self.conn.execute("PRAGMA table_info(rooms)")]
        self.assertIn("housekeeping", cols)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM rooms WHERE housekeeping NOT IN ('Dirty','Clean','Inspected')").fetchone()[0], 0)
        self.assertEqual(call("GET", "/api/health")[0], 200)


class FloorMapTests(FeatureBase):
    def test_states_and_counts(self):
        res = self.book_today(nights=2)
        status, data, _ = self.staff_get("/api/staff/floor-map")
        self.assertEqual(status, 200, data)
        rooms = {r["room_number"]: r for f in data["floors"] for r in f["rooms"]}
        self.assertEqual(len(rooms), 161)
        self.assertEqual(sum(data["counts"][k] for k in ("free", "arriving", "occupied", "departing", "maintenance")), 161)
        self.assertEqual(rooms["105"]["state"], "maintenance")
        self.assertEqual(rooms[res["room_number"]]["state"], "arriving")
        self.assertEqual([f["floor"] for f in data["floors"]], list(range(9, 0, -1)))
        call("POST", f"/api/staff/reservations/{res['reservation_id']}/check-in", {}, *self.login("frontdesk"))
        rooms = {r["room_number"]: r for f in self.staff_get("/api/staff/floor-map")[1]["floors"] for r in f["rooms"]}
        self.assertEqual(rooms[res["room_number"]]["state"], "occupied")
        rooms = {r["room_number"]: r for f in self.staff_get(f"/api/staff/floor-map?date={iso(1)}")[1]["floors"] for r in f["rooms"]}
        self.assertEqual(rooms[res["room_number"]]["state"], "occupied")
        rooms = {r["room_number"]: r for f in self.staff_get(f"/api/staff/floor-map?date={iso(2)}")[1]["floors"] for r in f["rooms"]}
        self.assertEqual(rooms[res["room_number"]]["state"], "departing")
        self.assertIsNone(rooms[res["room_number"]]["housekeeping"])            # housekeeping is only shown for today

    def test_dirty_flag_bad_date_and_login(self):
        rid = self.room_id("201")
        self.conn.execute("UPDATE rooms SET housekeeping='Dirty' WHERE room_id=?", (rid,))
        data = self.staff_get("/api/staff/floor-map")[1]
        room = next(r for f in data["floors"] for r in f["rooms"] if r["room_id"] == rid)
        self.assertTrue(room["dirty"])
        self.assertGreaterEqual(data["counts"]["dirty"], 1)
        self.assertEqual(self.staff_get("/api/staff/floor-map?date=tomorrow")[0], 400)
        self.assertEqual(call("GET", "/api/staff/floor-map")[0], 401)


class PriceCalendarTests(FeatureBase):
    def test_seven_windows_and_dates_in_the_past_are_left_out(self):
        status, data, _ = call("GET", f"/api/rooms/price-calendar?check_in={d(0)}&check_out={d(2)}&flex=3")
        self.assertEqual(status, 200)
        self.assertEqual([w["offset"] for w in data["windows"]], list(range(-3, 4)))
        self.assertEqual(data["nights"], 2)
        self.assertEqual(data["types"], ["Standard", "Deluxe", "Suite", "President"])
        selected = [w for w in data["windows"] if w["selected"]]
        self.assertEqual((len(selected), selected[0]["check_in"]), (1, d(0)))
        near = call("GET", f"/api/rooms/price-calendar?check_in={iso(1)}&check_out={iso(3)}&flex=3")[1]
        self.assertTrue(all(w["check_in"] >= iso(0) for w in near["windows"]))
        self.assertEqual(len(near["windows"]), 5)           # -3 and -2 would start before today
        self.assertFalse(data["prices_vary"])

    def test_sold_out_type_changes_the_cheapest_price_and_tags(self):
        ci, co = d(0), d(2)
        for r in self.conn.execute("SELECT room_id FROM rooms WHERE room_type_id = 1 AND status='Available'").fetchall():
            self.conn.execute("""INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
                                 VALUES (1, ?, ?, ?, 'Confirmed', 50000, 25000)""", (r["room_id"], ci, co))
        data = call("GET", f"/api/rooms/price-calendar?check_in={ci}&check_out={co}&flex=2")[1]
        mine = next(w for w in data["windows"] if w["selected"])
        standard = next(c for c in mine["cells"] if c["type_name"] == "Standard")
        self.assertEqual((standard["free"], standard["total_price"]), (0, None))
        self.assertEqual(mine["cheapest_total"], 2 * 40000)            # Deluxe is now the cheapest free room
        self.assertTrue(data["prices_vary"])
        tags = {w["offset"]: w["tag"] for w in data["windows"]}
        self.assertEqual((tags[0], tags[1], tags[-1]), ("", "", ""))   # these windows still overlap the sold-out nights
        self.assertEqual((tags[2], tags[-2]), ("cheapest", "cheapest"))  # leaving on the day another guest arrives is allowed

    def test_all_sold_out_and_bad_input(self):
        ci, co = d(0), d(1)
        self.conn.execute("""INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
                             SELECT 1, room_id, ?, ?, 'Confirmed', 1, 1 FROM rooms WHERE status='Available'""", (ci, co))
        data = call("GET", f"/api/rooms/price-calendar?check_in={ci}&check_out={co}&flex=1")[1]
        self.assertEqual(next(w for w in data["windows"] if w["selected"])["tag"], "sold_out")
        self.assertEqual(call("GET", "/api/rooms/price-calendar?check_in=bad&check_out=x")[0], 400)
        self.assertEqual(call("GET", f"/api/rooms/price-calendar?check_in={d(0)}&check_out={d(2)}&flex=99")[1]["flex"], 7)


class PriceSuggestionTests(FeatureBase):
    def weekend(self):
        friday = TODAY + timedelta(days=(4 - TODAY.weekday()) % 7)
        return friday.isoformat(), (friday + timedelta(days=2)).isoformat()

    def fill(self, type_id, ci, co, count=None):
        rows = self.conn.execute("SELECT room_id FROM rooms WHERE room_type_id=? AND status='Available'", (type_id,)).fetchall()
        for r in rows[:count]:
            self.conn.execute("""INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
                                 VALUES (1, ?, ?, ?, 'Confirmed', 1, 1)""", (r["room_id"], ci, co))

    def suggestions(self):
        status, data, _ = self.staff_get("/api/manager/price-suggestions", "manager")
        self.assertEqual(status, 200, data)
        return {s["type_name"]: s for s in data["suggestions"]}, data

    def test_only_the_manager_can_see_them(self):
        self.assertEqual(self.staff_get("/api/manager/price-suggestions", "frontdesk")[0], 403)
        self.assertEqual(call("GET", "/api/manager/price-suggestions")[0], 401)

    def test_full_weekend_raises_the_suite_price_by_ten_percent(self):
        ci, co = self.weekend()
        self.fill(3, ci, co)                                     # all 10 suites booked for the weekend
        s, data = self.suggestions()
        suite = s["Suite"]
        self.assertEqual((suite["action"], suite["change_percent"], suite["suggested_price"]), ("raise", 10, 77000))
        self.assertEqual(suite["occupancy"]["weekend"], 1.0)
        self.assertIn("Suite is 100% full", suite["reason"])
        self.assertEqual(data["rules"][0][:7], "Busiest")
        self.assertEqual(s["Standard"]["action"], "keep")
        self.assertEqual(self.conn.execute("SELECT price_per_night FROM room_types WHERE type_name='Suite'").fetchone()[0], 70000)   # nothing changed yet

    def test_busy_but_not_full_raises_five_percent_and_rounds_to_500(self):
        ci, co = self.weekend()
        self.fill(2, ci, co, count=40)                           # 40 of 50 deluxe rooms = 80%
        deluxe = self.suggestions()[0]["Deluxe"]
        self.assertEqual((deluxe["action"], deluxe["change_percent"], deluxe["suggested_price"]), ("raise", 5, 42000))
        self.assertEqual(deluxe["suggested_price"] % 500, 0)

    def test_quiet_period_lowers_the_price_but_never_for_a_single_room(self):
        # busy last year, nothing coming up: Standard should get a cut; the single President room must not
        for r in self.conn.execute("SELECT room_id FROM rooms WHERE room_type_id IN (1, 4) AND status='Available'").fetchall():
            self.conn.execute("UPDATE reservations SET status='Cancelled' WHERE room_id=? AND status='Confirmed' AND check_out > ?", (r["room_id"], iso(-1)))
        past = [r["room_id"] for r in self.conn.execute("SELECT room_id FROM rooms WHERE room_type_id=1 AND status='Available'")]
        for rid in past:
            self.conn.execute("""INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
                                 VALUES (1, ?, ?, ?, 'Completed', 1, 1)""", (rid, iso(-250), iso(-220)))
        president = self.room_id("901")
        self.conn.execute("""INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price, nightly_rate)
                             VALUES (1, ?, ?, ?, 'Completed', 1, 1)""", (president, iso(-330), iso(-100)))
        s, _ = self.suggestions()
        self.assertEqual((s["Standard"]["action"], s["Standard"]["change_percent"], s["Standard"]["suggested_price"]), ("lower", -10, 22500))
        self.assertEqual(s["President"]["action"], "keep")
        self.assertIn("too few", s["President"]["reason"])

    def test_applying_a_suggestion_uses_the_existing_price_rules(self):
        ci, co = self.weekend()
        self.fill(3, ci, co)
        old = self.book(ci=d(0), co=d(1))[1]
        price = self.suggestions()[0]["Suite"]["suggested_price"]
        status, data, _ = self.staff_post(f"/api/manager/room-types/3/price", {"price": price}, "manager")
        self.assertEqual((status, data["new_price"]), (200, 77000))
        row = self.conn.execute("SELECT total_price FROM reservations WHERE reservation_id=?", (old["reservation_id"],)).fetchone()
        self.assertEqual(row[0], old["total_price"])                  # existing reservations keep their price


if __name__ == "__main__":
    unittest.main()

class HotelEnhancementTests(unittest.TestCase):
    def setUp(self):
        import os, tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, 'hotel.db')
        db.init_db(self.path, demo_data=False)
        self.conn = db.connect(self.path)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_refund_percent_by_days_left(self):
        import enhancements
        from datetime import datetime, timedelta
        base = datetime(2026, 11, 18, 10)
        self.assertEqual(enhancements.refund_percent((base.date()+timedelta(days=7)).isoformat(), base)['refund_percent'], 100)
        self.assertEqual(enhancements.refund_percent((base.date()+timedelta(days=3)).isoformat(), base)['refund_percent'], 95)
        self.assertEqual(enhancements.refund_percent((base.date()+timedelta(days=1)).isoformat(), base)['refund_percent'], 90)
        self.assertEqual(enhancements.refund_percent(base.date().isoformat(), base)['refund_percent'], 80)
        self.assertEqual(enhancements.refund_percent((base.date()-timedelta(days=1)).isoformat(), base)['refund_percent'], 0)

    def test_booking_addons_are_saved_as_separate_revenue(self):
        b = db.book_room(self.conn, 1, '2026-12-10', '2026-12-12', 'Card', 'Guest', '+77010000000', 'guest@example.kz', add_ons=['breakfast'])
        self.assertEqual(b['addons_total'], 6000)
        line = self.conn.execute('SELECT category,amount FROM revenue_lines WHERE reservation_id=?',(b['reservation_id'],)).fetchone()
        self.assertEqual((line['category'],line['amount']),('Breakfast',6000))

    def test_maintenance_ticket_blocks_dates_and_can_be_resolved(self):
        import enhancements
        tid=enhancements.create_ticket(self.conn,1,'Repair','2026-12-01','2026-12-03')
        rooms,_=db.search_free_rooms(self.conn,'2026-12-02','2026-12-03')
        self.assertNotIn(1,[r['room_id'] for r in rooms])
        self.conn.execute("UPDATE maintenance_tickets SET status='Resolved' WHERE ticket_id=?",(tid,))
        rooms,_=db.search_free_rooms(self.conn,'2026-12-02','2026-12-03')
        self.assertIn(1,[r['room_id'] for r in rooms])

    def test_loyalty_tiers_count_completed_stays(self):
        import enhancements
        guest=self.conn.execute("INSERT INTO guests(full_name,phone,email) VALUES('Repeat Guest','+77010000001','repeat@example.kz')").lastrowid
        for i in range(2):
            self.conn.execute("INSERT INTO reservations(guest_id,room_id,check_in,check_out,status,total_price,nightly_rate) VALUES(?, ?, ?, ?, 'Completed',100,100)",(guest,i+1,f'2026-01-0{i+1}',f'2026-01-0{i+2}'))
        self.assertEqual(enhancements.loyalty(self.conn,guest)['tier'],'Silver')
