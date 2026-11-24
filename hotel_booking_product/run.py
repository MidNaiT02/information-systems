"""Start the Hotel Booking System.   Usage:  py run.py [--reset] [--empty] [--records 5000] [--add-records 5000]   then open http://127.0.0.1:8000"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
from backend import db      # noqa: E402
from backend import server  # noqa: E402

if __name__ == "__main__":
    records = None
    if "--records" in sys.argv:
        records = int(sys.argv[sys.argv.index("--records") + 1])
    production = os.environ.get("APP_ENV", "development").lower() == "production"
    if production:
        missing = [name for name, value in (("FRONTDESK_PASSWORD", os.environ.get("FRONTDESK_PASSWORD")),
                                             ("MANAGER_PASSWORD", os.environ.get("MANAGER_PASSWORD"))) if not value]
        if missing:
            raise SystemExit("Production mode requires FRONTDESK_PASSWORD and MANAGER_PASSWORD environment variables.")
        if (os.environ["FRONTDESK_PASSWORD"] == "FrontDesk#2026" or
                os.environ["MANAGER_PASSWORD"] == "Manager#2026"):
            raise SystemExit("Do not use the published demo passwords in production. Set two unique staff passwords.")
    created = db.init_db(reset="--reset" in sys.argv, records=records,
                         demo_data=(not production and "--empty" not in sys.argv))
    if production:
        conn = db.connect()
        try:
            db.harden_production_accounts(conn)
        finally:
            conn.close()
    if "--add-records" in sys.argv:
        extra = int(sys.argv[sys.argv.index("--add-records") + 1])
        conn = db.connect()
        info = db.add_demo_records(conn, extra)
        conn.close()
        print(f"Added {info['added']:,} past reservations between {info['first']} and {info['last']}.")
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print(f"Hotel Booking System: http://{host}:{port}   (stop with Ctrl+C)")
    if created:
        if production or "--empty" in sys.argv:
            print("New EMPTY database created (rooms and staff accounts only).")
        else:
            print(f"New database created with demo data ({records or db.DEMO_RESERVATIONS} reservations).")
    try:
        server.serve(host, port)
    except KeyboardInterrupt:
        print("\nStopped.")
