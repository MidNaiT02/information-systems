"""Add more demo reservations INTO the existing history. Nothing that is already there is changed or deleted.

Run:  py tools/add_records.py          (adds 5,000)
      py tools/add_records.py 2000     (adds 2,000)
Stop the web server first (Ctrl+C). The new stays are placed in free gaps between the old past stays,
inside the period the database already covers.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db  # noqa: E402


def counts(conn):
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("reservations", "payments", "guests")}


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    if db.init_db():
        print("There was no database yet, so one was created with the default demo data first.")
    conn = db.connect()
    before = counts(conn)
    result = db.add_demo_records(conn, count)
    after = counts(conn)
    overlaps = conn.execute(
        """SELECT COUNT(*) FROM reservations a JOIN reservations b
           ON a.room_id = b.room_id AND a.reservation_id < b.reservation_id
           AND a.status = 'Confirmed' AND b.status = 'Confirmed'
           AND a.check_in < b.check_out AND a.check_out > b.check_in""").fetchone()[0]
    print(f"Added {result['added']:,} past reservations between {result['first']} and {result['last']}.")
    for key in before:
        print(f"  {key:<13}{before[key]:>8,} -> {after[key]:>8,}")
    print(f"Overlapping Confirmed bookings: {overlaps}")


if __name__ == "__main__":
    main()
