"""The activity log cannot be edited or deleted, and the database file is private."""
import os
import sqlite3
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db  # noqa: E402


class DatabaseProtectionTests(unittest.TestCase):
    def test_audit_log_is_append_only_and_file_is_private(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "hotel.db")
            db.init_db(path=path, demo_data=False)
            conn = db.connect(path)
            try:
                conn.execute("INSERT INTO audit_log(actor, action) VALUES ('test','created')")   # adding still works
                with self.assertRaises(sqlite3.DatabaseError):
                    conn.execute("UPDATE audit_log SET action='changed'")
                with self.assertRaises(sqlite3.DatabaseError):
                    conn.execute("DELETE FROM audit_log")
            finally:
                conn.close()
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)

    def test_old_database_gets_protection_on_upgrade(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "hotel.db")
            db.init_db(path=path, demo_data=False)
            conn = db.connect(path)
            conn.execute("DROP TRIGGER audit_no_update")
            conn.execute("DROP TRIGGER audit_no_delete")
            conn.close()
            db.init_db(path=path, demo_data=False)          # existing database -> migrate()
            conn = db.connect(path)
            try:
                conn.execute("INSERT INTO audit_log(actor, action) VALUES ('test','created')")
                with self.assertRaises(sqlite3.DatabaseError):
                    conn.execute("DELETE FROM audit_log")
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
