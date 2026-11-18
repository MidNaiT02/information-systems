"""Extra features: floor map, housekeeping board, QR booking pass and check-in, flexible-date price
calendar, and rule-based price suggestions. Standard library only."""
import hashlib
import hmac
import sqlite3
from datetime import date, datetime, timedelta

import db
import qr

HK_STATUSES = ("Dirty", "Clean", "Inspected")
CHECK_OUT_HOUR = 12                 # a guest is treated as gone at 12:00 on the check-out date
_FMT = "%Y-%m-%d %H:%M:%S"


# ---------------------------------------------------------------- columns (new and old databases)
def ensure_columns(conn):
    """Add the housekeeping and check-in columns when they are missing. Returns True if they were just added."""
    rooms = [r[1] for r in conn.execute("PRAGMA table_info(rooms)")]
    added = False
    if "housekeeping" not in rooms:
        conn.execute("ALTER TABLE rooms ADD COLUMN housekeeping TEXT NOT NULL DEFAULT 'Inspected'")
        conn.execute("ALTER TABLE rooms ADD COLUMN hk_updated TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'")
        added = True
    res = [r[1] for r in conn.execute("PRAGMA table_info(reservations)")]
    if "checked_in_at" not in res:
        conn.execute("ALTER TABLE reservations ADD COLUMN checked_in_at TEXT")
        conn.execute("ALTER TABLE reservations ADD COLUMN checked_out_at TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_res_checkout ON reservations(check_out)")
    return added


def seed_housekeeping(conn, today=None):
    """Give a new housekeeping board a realistic start: everything inspected, except rooms whose guest left
    yesterday (a third still dirty, a third cleaned, a third inspected)."""
    today = today or date.today()
    yesterday = today - timedelta(days=1)
    conn.execute("UPDATE rooms SET housekeeping = 'Inspected', hk_updated = ?", (today.isoformat() + " 00:00:00",))
    stamp = yesterday.isoformat() + f" {CHECK_OUT_HOUR:02d}:30:00"
    rows = conn.execute("""SELECT DISTINCT room_id FROM reservations
                           WHERE status IN ('Confirmed','Completed') AND check_out = ?""", (yesterday.isoformat(),)).fetchall()
    for r in rows:
        status = HK_STATUSES[r["room_id"] % 3]
        conn.execute("UPDATE rooms SET housekeeping = ?, hk_updated = ? WHERE room_id = ?", (status, stamp, r["room_id"]))


# ---------------------------------------------------------------- booking pass (QR) and check-in
def pass_code(reservation_id, email, created_at):
    digest = hashlib.sha256(f"{reservation_id}|{str(email).lower()}|{created_at}".encode()).hexdigest()
    return f"HB{reservation_id}-{digest[:6].upper()}"


def pass_for(conn, reservation_id):
    """Pass code and QR image (inline SVG) of a reservation, or None."""
    row = conn.execute("""SELECT r.reservation_id, r.created_at, g.email FROM reservations r
                          JOIN guests g ON g.guest_id = r.guest_id WHERE r.reservation_id = ?""", (reservation_id,)).fetchone()
    if row is None:
        return None
    code = pass_code(row["reservation_id"], row["email"], row["created_at"])
    return {"code": code, "qr_svg": qr.to_svg(code)}


def resolve_pass(conn, text):
    """Reservation id for a scanned or typed code (or a plain reservation number). Staff only."""
    text = str(text or "").strip().upper().replace(" ", "")
    if text.isdigit():
        number = int(text)
    elif text.startswith("HB") and "-" in text and text[2:text.index("-")].isdigit():
        number = int(text[2:text.index("-")])
        expected = pass_for(conn, number)
        if expected is None or not hmac.compare_digest(expected["code"], text):
            raise db.BookingError("This pass code is not valid. Check the code and try again.", 404, "bad_pass")
    else:
        raise db.BookingError("Enter a pass code like HB123-A1B2C3, or a reservation number.", 400, "bad_pass")
    if conn.execute("SELECT 1 FROM reservations WHERE reservation_id = ?", (number,)).fetchone() is None:
        raise db.BookingError("No reservation found for this code.", 404, "not_found")
    return number


def stay_state(conn, reservation_id, now):
    """Reservation details for the front desk plus what can be done with it right now."""
    d = db.reservation_detail(conn, reservation_id, now)
    extra = conn.execute("""SELECT r.checked_in_at, r.checked_out_at, ro.housekeeping FROM reservations r
                            JOIN rooms ro ON ro.room_id = r.room_id WHERE r.reservation_id = ?""", (reservation_id,)).fetchone()
    d.pop("phone", None)
    d.update(checked_in_at=extra["checked_in_at"], checked_out_at=extra["checked_out_at"], housekeeping=extra["housekeeping"])
    today = now.date().isoformat()
    can_in, why = False, ""
    if d["status"] != "Confirmed":
        why = f"The reservation is {d['status'].lower()}."
    elif d["checked_in_at"]:
        why = "The guest is already checked in."
    elif today < d["check_in"]:
        why = f"Check-in opens on {d['check_in']}."
    elif today >= d["check_out"]:
        why = "The stay has already ended."
    else:
        can_in = True
    d["can_check_in"], d["check_in_blocked"] = can_in, why
    d["can_check_out"] = bool(d["checked_in_at"]) and not d["checked_out_at"]
    d["room_ready"] = d["housekeeping"] != "Dirty"
    return d


def check_in(conn, reservation_id, now):
    conn.execute("BEGIN IMMEDIATE")
    try:
        d = stay_state(conn, reservation_id, now)
        if not d["can_check_in"]:
            raise db.BookingError(d["check_in_blocked"] or "This guest cannot be checked in.", 409, "cannot_check_in")
        conn.execute("UPDATE reservations SET checked_in_at = ? WHERE reservation_id = ?", (now.strftime(_FMT), reservation_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    d["checked_in_at"], d["can_check_in"], d["can_check_out"] = now.strftime(_FMT), False, True
    d["warning"] = "" if d["room_ready"] else f"Room {d['room_number']} is not cleaned yet (status: Dirty). Tell housekeeping."
    return d


def check_out(conn, reservation_id, now):
    """The guest leaves: the room becomes Dirty and shows up on the housekeeping board."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        d = stay_state(conn, reservation_id, now)
        if not d["checked_in_at"]:
            raise db.BookingError("This guest was never checked in.", 409, "cannot_check_out")
        if d["checked_out_at"]:
            raise db.BookingError("This guest is already checked out.", 409, "cannot_check_out")
        stamp = now.strftime(_FMT)
        conn.execute("UPDATE reservations SET checked_out_at = ? WHERE reservation_id = ?", (stamp, reservation_id))
        conn.execute("UPDATE rooms SET housekeeping = 'Dirty', hk_updated = ? WHERE room_id = ?", (stamp, d["room_id"]))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    d.update(checked_out_at=stamp, can_check_out=False, housekeeping="Dirty")
    return d


# ---------------------------------------------------------------- housekeeping board
def sweep_departures(conn, now):
    """Stays that reached check-out time (12:00 on the check-out date) without a manual check-out make the room Dirty."""
    stamp = now.strftime(_FMT)
    rows = conn.execute(
        """SELECT r.reservation_id, r.room_id, r.check_out || ' 12:00:00' AS left_at
           FROM reservations r JOIN rooms ro ON ro.room_id = r.room_id
           WHERE r.status IN ('Confirmed','Completed') AND r.checked_out_at IS NULL
             AND r.check_out || ' 12:00:00' <= ? AND r.check_out || ' 12:00:00' > ro.hk_updated
           ORDER BY r.check_out""", (stamp,)).fetchall()
    if not rows:
        return 0
    conn.execute("BEGIN IMMEDIATE")
    try:
        for r in rows:
            conn.execute("UPDATE reservations SET checked_out_at = ? WHERE reservation_id = ?", (r["left_at"], r["reservation_id"]))
            conn.execute("UPDATE rooms SET housekeeping = 'Dirty', hk_updated = ? WHERE room_id = ? AND hk_updated < ?",
                         (r["left_at"], r["room_id"], r["left_at"]))
        conn.execute("COMMIT")
    except sqlite3.Error:
        conn.execute("ROLLBACK")
        raise
    return len(rows)


def housekeeping_board(conn, now):
    sweep_departures(conn, now)
    today = now.date().isoformat()
    rooms = conn.execute(
        """SELECT ro.room_id, ro.room_number, ro.floor, ro.status AS room_status, ro.housekeeping, ro.hk_updated, rt.type_name
           FROM rooms ro JOIN room_types rt ON rt.room_type_id = ro.room_type_id ORDER BY ro.room_number""").fetchall()
    arrivals = {r["room_id"]: r["full_name"] for r in conn.execute(
        """SELECT r.room_id, g.full_name FROM reservations r JOIN guests g ON g.guest_id = r.guest_id
           WHERE r.status = 'Confirmed' AND r.check_in = ?""", (today,))}
    departures = {r["room_id"]: r["full_name"] for r in conn.execute(
        """SELECT r.room_id, g.full_name FROM reservations r JOIN guests g ON g.guest_id = r.guest_id
           WHERE r.status IN ('Confirmed','Completed') AND r.check_out = ? AND r.checked_out_at IS NULL""", (today,))}
    summary = {"Dirty": 0, "Clean": 0, "Inspected": 0, "priority": 0, "arriving_today": len(arrivals), "departing_today": len(departures)}
    items = []
    for r in rooms:
        if r["room_status"] == "Maintenance":
            continue
        summary[r["housekeeping"]] += 1
        arriving, departing = r["room_id"] in arrivals, r["room_id"] in departures
        priority = arriving and r["housekeeping"] != "Inspected"
        summary["priority"] += priority
        if r["housekeeping"] != "Inspected" or departing:
            items.append({"room_id": r["room_id"], "room_number": r["room_number"], "floor": r["floor"], "type_name": r["type_name"],
                          "housekeeping": r["housekeeping"], "updated": r["hk_updated"], "arriving_today": arriving,
                          "arriving_guest": arrivals.get(r["room_id"]), "departing_today": departing, "priority": priority})
    items.sort(key=lambda i: (not i["priority"], i["housekeeping"] != "Dirty", i["floor"], i["room_number"]))
    return {"date": today, "summary": summary, "rooms": items}


def set_housekeeping(conn, room_id, new_status, now):
    if new_status not in HK_STATUSES:
        raise db.BookingError("Status must be Dirty, Clean or Inspected.", 400, "bad_status")
    conn.execute("BEGIN IMMEDIATE")
    try:
        room = conn.execute("SELECT room_number, status, housekeeping FROM rooms WHERE room_id = ?", (room_id,)).fetchone()
        if room is None:
            raise db.BookingError("Room not found.", 404, "not_found")
        old = room["housekeeping"]
        allowed = {("Dirty", "Clean"), ("Clean", "Inspected")} | {(o, "Dirty") for o in ("Clean", "Inspected")}
        if (old, new_status) not in allowed:
            hint = "Clean the room before inspecting it." if (old, new_status) == ("Dirty", "Inspected") else f"The room is already {old}."
            raise db.BookingError(hint, 409, "bad_transition")
        conn.execute("UPDATE rooms SET housekeeping = ?, hk_updated = ? WHERE room_id = ?", (new_status, now.strftime(_FMT), room_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"room_id": room_id, "room_number": room["room_number"], "old": old, "new": new_status}


# ---------------------------------------------------------------- floor map
def floor_map(conn, day, now):
    """State of every room on one day: free, arriving, occupied, departing or maintenance."""
    d = db._parse_day(day, "Date").isoformat() if day else now.date().isoformat()
    today = now.date().isoformat()
    if d == today:
        sweep_departures(conn, now)
    rooms = conn.execute(
        """SELECT ro.room_id, ro.room_number, ro.floor, ro.status, ro.housekeeping, rt.type_name
           FROM rooms ro JOIN room_types rt ON rt.room_type_id = ro.room_type_id ORDER BY ro.floor DESC, ro.room_number""").fetchall()
    horizon = (date.fromisoformat(d) + timedelta(days=60)).isoformat()
    stays = conn.execute(
        """SELECT r.reservation_id, r.room_id, r.check_in, r.check_out, r.status, r.checked_in_at, r.checked_out_at, g.full_name
           FROM reservations r JOIN guests g ON g.guest_id = r.guest_id
           WHERE r.status IN ('Confirmed','Completed') AND r.check_out >= ? AND r.check_in <= ?
           ORDER BY r.check_in""", (d, horizon)).fetchall()
    by_room = {}
    for s in stays:
        by_room.setdefault(s["room_id"], []).append(dict(s))
    floors, counts = {}, {"free": 0, "arriving": 0, "occupied": 0, "departing": 0, "maintenance": 0, "dirty": 0}
    for ro in rooms:
        mine = by_room.get(ro["room_id"], [])
        current = next((s for s in mine if s["check_in"] <= d < s["check_out"]), None)
        leaving = next((s for s in mine if s["check_out"] == d), None)
        upcoming = next((s for s in mine if s["check_in"] > d), None)
        ticket = conn.execute("SELECT ticket_id,reason,expected_end_date FROM maintenance_tickets WHERE room_id=? AND status IN ('Open','In Progress') AND start_date<=? AND expected_end_date>=? ORDER BY start_date LIMIT 1", (ro["room_id"], d, d)).fetchone()
        if ro["status"] == "Maintenance" or ticket:
            state = "maintenance"
        elif current:
            state = "arriving" if current["check_in"] == d and not current["checked_in_at"] else "occupied"
        elif leaving:
            state = "departing"
        else:
            state = "free"
        counts[state] += 1
        dirty = d == today and ro["housekeeping"] == "Dirty" and ro["status"] != "Maintenance"
        counts["dirty"] += dirty
        floors.setdefault(ro["floor"], []).append({
            "room_id": ro["room_id"], "room_number": ro["room_number"], "type_name": ro["type_name"], "state": state,
            "housekeeping": ro["housekeeping"] if d == today else None, "dirty": dirty,
            "turnover": bool(current and leaving), "stay": current or leaving, "next": upcoming,
            "maintenance_ticket": dict(ticket) if ticket else None})
    return {"date": d, "is_today": d == today, "counts": counts,
            "floors": [{"floor": f, "rooms": r} for f, r in sorted(floors.items(), reverse=True)]}


# ---------------------------------------------------------------- flexible-date price calendar (guests)
def price_calendar(conn, check_in, check_out, flex, today):
    ci, co, nights = db.parse_dates(check_in, check_out)
    try:
        flex = max(1, min(7, int(flex)))
    except (TypeError, ValueError):
        flex = 3
    types = [dict(r) for r in conn.execute("SELECT room_type_id, type_name, price_per_night FROM room_types ORDER BY price_per_night")]
    start = date.fromisoformat(ci)
    windows = []
    for off in range(-flex, flex + 1):
        a, b = start + timedelta(days=off), start + timedelta(days=off + nights)
        if a < today:
            continue
        free = {r["room_type_id"]: r["n"] for r in conn.execute(
            """SELECT ro.room_type_id, COUNT(*) AS n FROM rooms ro
               WHERE ro.status = 'Available' AND ro.room_id NOT IN (
                   SELECT room_id FROM reservations WHERE status = 'Confirmed' AND ? < check_out AND ? > check_in)
               GROUP BY ro.room_type_id""", (a.isoformat(), b.isoformat()))}
        cells = [{"type_name": t["type_name"], "free": free.get(t["room_type_id"], 0),
                  "total_price": t["price_per_night"] * nights if free.get(t["room_type_id"], 0) else None} for t in types]
        prices = [c["total_price"] for c in cells if c["total_price"] is not None]
        windows.append({"offset": off, "check_in": a.isoformat(), "check_out": b.isoformat(), "selected": off == 0, "cells": cells,
                        "cheapest_total": min(prices) if prices else None, "free_total": sum(c["free"] for c in cells), "tag": ""})
    priced = [w["cheapest_total"] for w in windows if w["cheapest_total"] is not None]
    for w in windows:
        if w["cheapest_total"] is None:
            w["tag"] = "sold_out"
        elif priced and len(set(priced)) > 1 and w["cheapest_total"] == min(priced):
            w["tag"] = "cheapest"
    return {"nights": nights, "flex": flex, "types": [t["type_name"] for t in types], "windows": windows,
            "prices_vary": len(set(priced)) > 1}


# ---------------------------------------------------------------- price suggestions (manager, rule based)
RULES = [
    "Busiest of next weekend (Fri to Sun) and the next 7 days is 90% full or more: raise by 10%.",
    "That busiest period is 75% full or more: raise by 5%.",
    "The next 30 days are at least 1.5 times fuller than this hotel's own last-year average (and at least 25% full): raise by 5%.",
    "The next 30 days are at most 0.25 times the last-year average: lower by 10%. At most 0.5 times: lower by 5%.",
    "Types with fewer than 5 rooms only use the two sell-out rules above (too few rooms to judge low demand).",
    "Otherwise keep the price. Prices are rounded to 500 KZT. The manager decides; nothing is changed automatically.",
]


def _occupancy(conn, type_id, a, b):
    """Booked room-nights / available room-nights of one room type in [a, b)."""
    nights = (b - a).days
    rooms = conn.execute("SELECT COUNT(*) FROM rooms WHERE room_type_id = ? AND status = 'Available'", (type_id,)).fetchone()[0]
    if rooms == 0 or nights <= 0:
        return 0.0
    booked = conn.execute(
        """SELECT COALESCE(SUM(MAX(0, julianday(MIN(r.check_out, ?)) - julianday(MAX(r.check_in, ?)))), 0)
           FROM reservations r JOIN rooms ro ON ro.room_id = r.room_id
           WHERE ro.room_type_id = ? AND ro.status = 'Available' AND r.status IN ('Confirmed','Completed')
             AND r.check_in < ? AND r.check_out > ?""",
        (b.isoformat(), a.isoformat(), type_id, b.isoformat(), a.isoformat())).fetchone()[0]
    return min(1.0, booked / (rooms * nights))


def _round500(x):
    return int(round(x / 500.0)) * 500


def price_suggestions(conn, today):
    friday = today + timedelta(days=(4 - today.weekday()) % 7)
    weekend = (friday, friday + timedelta(days=2))
    week, month, year = (today, today + timedelta(days=7)), (today, today + timedelta(days=30)), (today - timedelta(days=365), today)
    out = []
    for t in conn.execute("SELECT room_type_id, type_name, price_per_night FROM room_types ORDER BY price_per_night").fetchall():
        tid = t["room_type_id"]
        occ_we, occ_7, occ_30, base = (_occupancy(conn, tid, *w) for w in (weekend, week, month, year))
        rooms = conn.execute("SELECT COUNT(*) FROM rooms WHERE room_type_id = ? AND status = 'Available'", (tid,)).fetchone()[0]
        small = rooms < 5                       # one or two bookings swing the numbers: only the sell-out rules apply
        peak = max(occ_we, occ_7)
        which = "next weekend" if occ_we >= occ_7 else "the next 7 days"
        pct, reason = 0, "Demand looks normal, keep the price."
        if peak >= 0.90:
            pct, reason = 10, f"{t['type_name']} is {peak:.0%} full {which}. Sell-out risk, raise by 10%."
        elif peak >= 0.75:
            pct, reason = 5, f"{t['type_name']} is {peak:.0%} full {which}. Raise by 5%."
        elif not small and occ_30 >= 0.25 and base > 0 and occ_30 >= 1.5 * base:
            pct, reason = 5, f"{t['type_name']} is {occ_30:.0%} full over the next 30 days, {occ_30 / base:.1f}x its last-year average. Raise by 5%."
        elif not small and base >= 0.03 and occ_30 <= 0.25 * base:
            pct, reason = -10, f"{t['type_name']} is only {occ_30:.0%} full over the next 30 days (last-year average {base:.0%}). Lower by 10%."
        elif not small and base >= 0.03 and occ_30 <= 0.5 * base:
            pct, reason = -5, f"{t['type_name']} is {occ_30:.0%} full over the next 30 days (last-year average {base:.0%}). Lower by 5%."
        current = float(t["price_per_night"])
        suggested = _round500(current * (1 + pct / 100.0)) if pct else current
        if small and pct == 0:
            reason = f"Only {rooms} room{'s' if rooms != 1 else ''} of this type, too few to judge low demand. Keep the price."
        out.append({"room_type_id": tid, "type_name": t["type_name"], "current_price": current, "suggested_price": suggested,
                    "change_percent": pct, "action": "raise" if suggested > current else "lower" if suggested < current else "keep",
                    "reason": reason, "occupancy": {"weekend": round(occ_we, 3), "next_7_days": round(occ_7, 3),
                                                      "next_30_days": round(occ_30, 3), "last_year_average": round(base, 3)}})
    return {"as_of": today.isoformat(), "weekend": [weekend[0].isoformat(), (weekend[1] - timedelta(days=1)).isoformat()],
            "rules": RULES, "suggestions": out}
