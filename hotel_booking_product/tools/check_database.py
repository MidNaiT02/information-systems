"""Show what is in the database and check its integrity.   Run:  py tools/check_database.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db  # noqa: E402


def main():
    if not os.path.exists(db.DB_PATH):
        print("No database yet. Start the system once with:  py run.py")
        return
    conn = db.connect()
    print(f"Database file: {db.DB_PATH}\n")
    print("Rows per table")
    for table in ("guests", "room_types", "rooms", "reservations", "payments", "staff", "sessions", "emails", "audit_log"):
        print(f"  {table:<14}{conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]:>8,}")
    print("\nReservations by status")
    for r in conn.execute("SELECT status, COUNT(*) n FROM reservations GROUP BY status ORDER BY n DESC"):
        print(f"  {r['status']:<12}{r['n']:>8,}")
    span = conn.execute("SELECT MIN(check_in), MAX(check_out) FROM reservations").fetchone()
    print(f"\nStays from {span[0]} to {span[1]}")
    overlaps = conn.execute(
        """SELECT COUNT(*) FROM reservations a JOIN reservations b
           ON a.room_id = b.room_id AND a.reservation_id < b.reservation_id
           AND a.status = 'Confirmed' AND b.status = 'Confirmed'
           AND a.check_in < b.check_out AND a.check_out > b.check_in""").fetchone()[0]
    orphans = conn.execute("SELECT COUNT(*) FROM reservations r LEFT JOIN guests g ON g.guest_id = r.guest_id WHERE g.guest_id IS NULL").fetchone()[0]
    bad_dates = conn.execute("SELECT COUNT(*) FROM reservations WHERE check_out <= check_in").fetchone()[0]
    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    print("\nIntegrity checks (all should be 0)")
    print(f"  overlapping Confirmed bookings: {overlaps}")
    print(f"  reservations without a guest:   {orphans}")
    print(f"  check-out not after check-in:   {bad_dates}")
    print(f"  foreign key violations:         {len(fk)}")


if __name__ == "__main__":
    main()
