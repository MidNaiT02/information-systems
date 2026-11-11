"""Measure NFR-01: 95% of room searches must return within 2 seconds when 300 users search at once.

Run:  py tools/measure_search.py
It builds a temporary database with 5,000 reservations, then measures the search
(1) for one user, 200 times, and (2) for 300 users at the same time.
"""
import os
import statistics
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db  # noqa: E402

TARGET_SECONDS = 2.0


def percentile(values, p):
    values = sorted(values)
    return values[max(0, int(round(p / 100 * len(values))) - 1)]


def main():
    path = os.path.join(tempfile.mkdtemp(), "measure.db")
    db.DB_PATH = path
    db.init_db(path, reset=True, demo_data=False)
    conn = db.connect(path)
    conn.execute("INSERT INTO guests(full_name, phone, email) VALUES ('Load Test', '+7000000', 'load@example.kz')")
    rooms = [r[0] for r in conn.execute("SELECT room_id FROM rooms WHERE status='Available'")]
    start = date.today() + timedelta(days=1)
    rows, day, n = [], 0, 0
    while n < 5000:
        for room in rooms:
            if n >= 5000:
                break
            rows.append((1, room, (start + timedelta(days=day)).isoformat(), (start + timedelta(days=day + 2)).isoformat(), "Confirmed", 50000))
            n += 1
        day += 2
    conn.execute("BEGIN")
    conn.executemany("INSERT INTO reservations(guest_id, room_id, check_in, check_out, status, total_price) VALUES (?,?,?,?,?,?)", rows)
    conn.execute("COMMIT")
    span = day
    print(f"Database: {n} reservations over {span} days, {len(rooms)} rooms\n")

    def one_search(i):
        a = start + timedelta(days=(i * 7) % max(1, span - 5))
        c = db.connect(path)
        t0 = time.perf_counter()
        db.search_free_rooms(c, a.isoformat(), (a + timedelta(days=3)).isoformat())
        elapsed = time.perf_counter() - t0
        c.close()
        return elapsed

    single = [one_search(i) for i in range(200)]
    print("One user, 200 searches")
    print(f"  average {statistics.mean(single) * 1000:.2f} ms, 95th percentile {percentile(single, 95) * 1000:.2f} ms, max {max(single) * 1000:.2f} ms")

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=300) as pool:
        many = list(pool.map(one_search, range(300)))
    total = time.perf_counter() - t0
    p95 = percentile(many, 95)
    print("\n300 users at the same time")
    print(f"  average {statistics.mean(many) * 1000:.2f} ms, 95th percentile {p95 * 1000:.2f} ms, max {max(many) * 1000:.2f} ms, all done in {total:.2f} s")
    print(f"\nNFR-01 (95% within {TARGET_SECONDS:.0f} s at 300 users): {'MET' if p95 <= TARGET_SECONDS else 'NOT MET'}")
    print("Note: this measures the database search on one computer, without a network and without the web server.")


if __name__ == "__main__":
    main()
