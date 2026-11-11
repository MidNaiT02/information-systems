-- Hotel Booking System: database schema (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE guests (
  guest_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE
);

CREATE TABLE room_types (
  room_type_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  type_name       TEXT NOT NULL UNIQUE,
  capacity        INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  price_per_night REAL NOT NULL CHECK (price_per_night > 0)
);

CREATE TABLE rooms (
  room_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room_type_id INTEGER NOT NULL REFERENCES room_types(room_type_id),
  room_number  TEXT NOT NULL UNIQUE,
  floor        INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('Available','Maintenance'))
);

CREATE TABLE reservations (
  reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id       INTEGER NOT NULL REFERENCES guests(guest_id),
  room_id        INTEGER NOT NULL REFERENCES rooms(room_id),
  check_in       DATE NOT NULL,
  check_out      DATE NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('Confirmed','Cancelled','Completed')),
  total_price    REAL NOT NULL DEFAULT 0 CHECK (total_price >= 0),  -- price saved at booking time
  nightly_rate   REAL NOT NULL DEFAULT 0 CHECK (nightly_rate >= 0), -- rate per night locked at booking time
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (check_out > check_in)
);

CREATE TABLE payments (
  payment_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(reservation_id),
  amount         REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Card','Cash','Transfer')),
  payment_date   DATE NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('Paid','Failed','Refunded'))
);

CREATE TABLE staff (
  staff_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('FrontDesk','Manager')),
  email         TEXT NOT NULL UNIQUE,
  salt          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(staff_id),
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE emails (
  email_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER REFERENCES reservations(reservation_id),
  to_email       TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Sent','Failed')),
  channel        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at        TEXT
);

CREATE TABLE audit_log (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL DEFAULT (datetime('now')),
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_res_room_dates ON reservations(room_id, check_in, check_out);
CREATE INDEX idx_res_status     ON reservations(status);
CREATE INDEX idx_pay_res        ON payments(reservation_id);
CREATE INDEX idx_res_checkin    ON reservations(check_in);
CREATE INDEX idx_pay_date       ON payments(payment_date);

-- Double booking protection: the database refuses overlapping Confirmed reservations
CREATE TRIGGER no_double_booking_insert
BEFORE INSERT ON reservations
WHEN NEW.status = 'Confirmed' AND EXISTS (
  SELECT 1 FROM reservations
  WHERE room_id = NEW.room_id AND status = 'Confirmed'
    AND NEW.check_in < check_out AND NEW.check_out > check_in)
BEGIN
  SELECT RAISE(ABORT, 'Room is already booked for these dates');
END;

CREATE TRIGGER no_double_booking_update
BEFORE UPDATE OF room_id, check_in, check_out, status ON reservations
WHEN NEW.status = 'Confirmed' AND EXISTS (
  SELECT 1 FROM reservations
  WHERE room_id = NEW.room_id AND status = 'Confirmed'
    AND reservation_id <> NEW.reservation_id
    AND NEW.check_in < check_out AND NEW.check_out > check_in)
BEGIN
  SELECT RAISE(ABORT, 'Room is already booked for these dates');
END;

CREATE TRIGGER no_booking_in_maintenance
BEFORE INSERT ON reservations
WHEN (SELECT status FROM rooms WHERE room_id = NEW.room_id) = 'Maintenance'
BEGIN
  SELECT RAISE(ABORT, 'Room is under maintenance');
END;

-- Reference data
INSERT INTO room_types (type_name, capacity, price_per_night) VALUES
 ('Standard',2,25000),('Deluxe',3,40000),('Suite',4,70000),('President',6,150000);

-- 161 rooms: Standard 100 (floors 1-5), Deluxe 50 (floors 6-7), Suite 10 (floor 8), President 1 (floor 9)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
INSERT INTO rooms (room_type_id, room_number, floor, status)
SELECT 1, CAST(((i-1)/20 + 1) * 100 + (i-1) % 20 + 1 AS TEXT), (i-1)/20 + 1,
       CASE WHEN i = 5 THEN 'Maintenance' ELSE 'Available' END   -- room 105 is under maintenance
FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50)
INSERT INTO rooms (room_type_id, room_number, floor, status)
SELECT 2, CAST((6 + (i-1)/25) * 100 + (i-1) % 25 + 1 AS TEXT), 6 + (i-1)/25, 'Available' FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10)
INSERT INTO rooms (room_type_id, room_number, floor, status)
SELECT 3, CAST(800 + i AS TEXT), 8, 'Available' FROM n;

INSERT INTO rooms (room_type_id, room_number, floor, status) VALUES (4, '901', 9, 'Available');
