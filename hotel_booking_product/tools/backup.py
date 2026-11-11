"""Back up and restore the database.

  py tools/backup.py                          make a backup now (works while the server is running)
  py tools/backup.py --keep 30 --dir D:\\bk    choose the folder and how many backups to keep (default 14)
  py tools/backup.py verify FILE              check that a backup is not damaged
  py tools/backup.py restore FILE --force     put a backup back (stop the server first)

A backup is a consistent copy of the database, compressed (.gz), with a SHA-256 checksum next to it.
It is NOT encrypted: keep the backup folder on an encrypted disk (for example BitLocker) or a protected share.
"""
import argparse
import gzip
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import db  # noqa: E402

DEFAULT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backups")


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def integrity(path):
    """Return (ok, counts) for a plain SQLite file."""
    conn = sqlite3.connect(path)
    try:
        ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok" and not conn.execute("PRAGMA foreign_key_check").fetchall()
        counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("reservations", "payments", "guests")}
        return ok, counts
    finally:
        conn.close()


def make_backup(db_path=None, out_dir=None, keep=14, now=None):
    """Create hotel_YYYYmmdd_HHMMSS.db.gz plus .sha256. Returns (file, size in bytes, counts)."""
    db_path, out_dir = db_path or db.DB_PATH, os.path.abspath(out_dir or DEFAULT_DIR)
    if not os.path.exists(db_path):
        raise SystemExit(f"There is no database at {db_path}.")
    os.makedirs(out_dir, exist_ok=True)
    work = tempfile.mkdtemp()
    try:
        snapshot = os.path.join(work, "snapshot.db")
        src, dst = sqlite3.connect(db_path), sqlite3.connect(snapshot)
        with dst:
            src.backup(dst)                      # a consistent copy even if someone is using the database
        src.close()
        dst.close()
        ok, counts = integrity(snapshot)
        if not ok:
            raise SystemExit("The database failed its integrity check, so no backup was made.")
        name = f"hotel_{(now or datetime.now()).strftime('%Y%m%d_%H%M%S')}.db.gz"
        target = os.path.join(out_dir, name)
        with open(snapshot, "rb") as f_in, gzip.open(target, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        with open(target + ".sha256", "w") as f:
            f.write(f"{sha256_of(target)}  {name}\n")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    old = sorted(f for f in os.listdir(out_dir) if f.startswith("hotel_") and f.endswith(".db.gz"))
    for victim in old[:-keep] if keep > 0 else []:
        for path in (os.path.join(out_dir, victim), os.path.join(out_dir, victim + ".sha256")):
            if os.path.exists(path):
                os.remove(path)
    return target, os.path.getsize(target), counts


def verify_backup(path):
    """True if the checksum matches and the data inside passes the integrity check."""
    sidecar = path + ".sha256"
    if not os.path.exists(sidecar):
        return False, "The .sha256 file next to the backup is missing."
    with open(sidecar) as f:
        expected = f.read().split()[0]
    if sha256_of(path) != expected:
        return False, "The checksum does not match: the backup file is damaged or was changed."
    work = tempfile.mkdtemp()
    try:
        plain = os.path.join(work, "check.db")
        with gzip.open(path, "rb") as f_in, open(plain, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        ok, counts = integrity(plain)
        return (ok, f"OK: {counts['reservations']:,} reservations, {counts['payments']:,} payments, {counts['guests']:,} guests."
                if ok else "The data inside the backup failed the integrity check.")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def restore_backup(path, db_path=None, force=False):
    """Replace the database with a verified backup. The old file is kept next to it as .before_restore_<time>."""
    db_path = db_path or db.DB_PATH
    ok, message = verify_backup(path)
    if not ok:
        raise SystemExit("Restore stopped. " + message)
    if os.path.exists(db_path) and not force:
        raise SystemExit("A database already exists. Stop the server and add --force to replace it.")
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    safety = None
    if os.path.exists(db_path):
        safety = f"{db_path}.before_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(db_path, safety)
    for suffix in ("-wal", "-shm"):
        if os.path.exists(db_path + suffix):
            os.remove(db_path + suffix)
    with gzip.open(path, "rb") as f_in, open(db_path, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return safety


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command = argv.pop(0) if argv and argv[0] in ("verify", "restore") else "backup"
    parser = argparse.ArgumentParser(prog="backup.py")
    if command == "backup":
        parser.add_argument("--dir", default=DEFAULT_DIR)
        parser.add_argument("--keep", type=int, default=14)
        a = parser.parse_args(argv)
        target, size, counts = make_backup(out_dir=a.dir, keep=a.keep)
        print(f"Backup written: {os.path.abspath(target)} ({size / 1024:,.0f} KB)")
        print(f"It contains {counts['reservations']:,} reservations, {counts['payments']:,} payments, {counts['guests']:,} guests.")
        print(f"The newest {a.keep} backups are kept.")
    elif command == "verify":
        parser.add_argument("file")
        ok, message = verify_backup(parser.parse_args(argv).file)
        print(message)
        sys.exit(0 if ok else 1)
    else:
        parser.add_argument("file")
        parser.add_argument("--force", action="store_true")
        a = parser.parse_args(argv)
        safety = restore_backup(a.file, force=a.force)
        print("Database restored. Start the server again.")
        if safety:
            print(f"The previous database was kept as {safety}")


if __name__ == "__main__":
    main()
