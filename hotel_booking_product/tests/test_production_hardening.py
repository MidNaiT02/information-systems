"""Regression tests for safe migration from demo data into production mode."""
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db  # noqa: E402
import security  # noqa: E402


class ProductionHardeningTests(unittest.TestCase):
    def test_demo_logins_are_removed_and_default_staff_passwords_are_rotated(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "hotel.db")
            db.init_db(path=path, demo_data=False)
            conn = db.connect(path)
            try:
                # Recreate the known development defaults regardless of the
                # environment in which the test suite was started.
                salt, digest = security.hash_password("FrontDesk#2026")
                conn.execute("UPDATE staff SET salt=?,password_hash=? WHERE lower(email)=?",
                             (salt, digest, "frontdesk@hotel.example"))
                salt, digest = security.hash_password("Already-changed-2028")
                conn.execute("UPDATE staff SET salt=?,password_hash=? WHERE lower(email)=?",
                             (salt, digest, "manager@hotel.example"))

                guest_id = conn.execute(
                    "INSERT INTO guests(full_name,phone,email) VALUES (?,?,?)",
                    ("Demo Platinum", "+7700000000", "demo.platinum@hotel.test")).lastrowid
                guest_salt, guest_hash = security.hash_password("PlatinumTier#2026")
                account_id = conn.execute(
                    "INSERT INTO guest_accounts(guest_id,salt,password_hash) VALUES (?,?,?)",
                    (guest_id, guest_salt, guest_hash)).lastrowid
                conn.execute("INSERT INTO demo_loyalty_profiles(guest_id,simulated_completed_stays) VALUES (?,10)",
                             (guest_id,))
                conn.execute("INSERT INTO guest_sessions(token_hash,account_id,csrf_token,expires_at) VALUES (?,?,?,?)",
                             (security.token_hash("demo-session"), account_id, "csrf", "2999-01-01 00:00:00"))

                with patch.dict(os.environ, {
                    "FRONTDESK_PASSWORD": "Production-Frontdesk-2029",
                    "MANAGER_PASSWORD": "Production-Manager-2030",
                }):
                    db.harden_production_accounts(conn)

                staff = conn.execute("SELECT email,salt,password_hash FROM staff").fetchall()
                staff_by_email = {row["email"]: row for row in staff}
                self.assertTrue(security.verify_password("Production-Frontdesk-2029",
                    staff_by_email["frontdesk@hotel.example"]["salt"],
                    staff_by_email["frontdesk@hotel.example"]["password_hash"]))
                self.assertTrue(security.verify_password("Already-changed-2028",
                    staff_by_email["manager@hotel.example"]["salt"],
                    staff_by_email["manager@hotel.example"]["password_hash"]))
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM guest_accounts WHERE guest_id=?",
                                              (guest_id,)).fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM guest_sessions WHERE account_id=?",
                                              (account_id,)).fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM demo_loyalty_profiles WHERE guest_id=?",
                                              (guest_id,)).fetchone()[0], 0)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
