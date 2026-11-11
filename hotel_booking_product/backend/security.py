"""Passwords and sessions (standard library only)."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

ITERATIONS = 200_000
SESSION_HOURS = 8
_FMT = "%Y-%m-%d %H:%M:%S"


def _now_utc():
    return datetime.now(timezone.utc)


def hash_password(password, salt_hex=None):
    """PBKDF2-HMAC-SHA256. Returns (salt_hex, hash_hex). The password itself is never stored."""
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password, salt_hex, hash_hex):
    _, candidate = hash_password(password, salt_hex)
    return hmac.compare_digest(candidate, hash_hex)


def _token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session(conn, staff_id):
    """Create a session. Only a hash of the token is stored in the database."""
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(16)
    expires = (_now_utc() + timedelta(hours=SESSION_HOURS)).strftime(_FMT)
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_now_utc().strftime(_FMT),))
    conn.execute("INSERT INTO sessions(token_hash, staff_id, csrf_token, expires_at) VALUES (?,?,?,?)",
                 (_token_hash(token), staff_id, csrf, expires))
    return token, csrf


def get_session(conn, token):
    """Return {staff_id, name, role, email, csrf} for a valid token, otherwise None."""
    if not token:
        return None
    row = conn.execute(
        """SELECT s.staff_id, s.csrf_token, s.expires_at, st.full_name, st.role, st.email
           FROM sessions s JOIN staff st ON st.staff_id = s.staff_id
           WHERE s.token_hash = ?""", (_token_hash(token),)).fetchone()
    if row is None or row["expires_at"] < _now_utc().strftime(_FMT):
        return None
    return {"staff_id": row["staff_id"], "name": row["full_name"], "role": row["role"],
            "email": row["email"], "csrf": row["csrf_token"]}


def end_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


# used to spend the same time when the email is unknown (so timing does not reveal accounts)
_DUMMY_SALT, _DUMMY_HASH = hash_password("not-a-real-password")


def check_login(conn, email, password):
    """Return the staff row for a correct email and password, otherwise None."""
    row = conn.execute("SELECT * FROM staff WHERE lower(email) = lower(?)", (email,)).fetchone()
    if row is None:
        verify_password(password, _DUMMY_SALT, _DUMMY_HASH)
        return None
    return row if verify_password(password, row["salt"], row["password_hash"]) else None


def password_problem(new_password, email=""):
    """Return a sentence that explains what is wrong with the password, or None if it is acceptable."""
    if len(new_password) < 10:
        return "The new password must be at least 10 characters long."
    if not any(c.isalpha() for c in new_password) or not any(c.isdigit() for c in new_password):
        return "Use letters and at least one digit in the new password."
    if new_password.lower() == (email or "").lower():
        return "The password must not be the same as the email address."
    return None


def end_other_sessions(conn, staff_id, keep_token=None):
    """After a password change every other login of this person is ended."""
    keep = _token_hash(keep_token) if keep_token else ""
    conn.execute("DELETE FROM sessions WHERE staff_id = ? AND token_hash != ?", (staff_id, keep))
