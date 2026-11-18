"""Hotel enhancements: loyalty, add-ons, maintenance, reviews and refund policy."""
from datetime import date, datetime
import sqlite3

TIERS = ((10, "Platinum", 12), (5, "Gold", 8), (2, "Silver", 5), (0, "None", 0))
ADDONS = {"breakfast": ("Breakfast", 6000), "airport_transfer": ("Airport transfer", 12000), "late_checkout": ("Late check-out", 5000)}

def init(conn):
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS reservation_addons (
      reservation_id INTEGER NOT NULL REFERENCES reservations(reservation_id), addon_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL, PRIMARY KEY(reservation_id, addon_key));
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      ticket_id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(room_id),
      reason TEXT NOT NULL, start_date DATE NOT NULL, expected_end_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In Progress','Resolved','Cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK(expected_end_date >= start_date));
    CREATE TABLE IF NOT EXISTS reviews (
      review_id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(reservation_id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS revenue_lines (
      line_id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL REFERENCES reservations(reservation_id),
      category TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    ''')
    cols={r[1] for r in conn.execute('PRAGMA table_info(reservations)')}
    for name, decl in [('loyalty_tier', "TEXT NOT NULL DEFAULT 'None'"),('loyalty_discount', 'REAL NOT NULL DEFAULT 0'),('base_total','REAL NOT NULL DEFAULT 0')]:
        if name not in cols: conn.execute(f'ALTER TABLE reservations ADD COLUMN {name} {decl}')
    conn.execute("UPDATE reservations SET base_total=total_price WHERE base_total=0 AND total_price>0")

def loyalty(conn, guest_id):
    n=conn.execute("SELECT COUNT(*) FROM reservations WHERE guest_id=? AND status='Completed'",(guest_id,)).fetchone()[0]
    for threshold,name,discount in TIERS:
        if n>=threshold: return {'completed_stays':n,'tier':name,'discount_percent':discount}

def refund_percent(check_in, now=None):
    """Policy: 4+ days=100%; 2-3 days=95%; 1 day=90%; check-in day=80%; after check-in=0%."""
    now=now or datetime.now()
    days=(date.fromisoformat(check_in)-now.date()).days
    if days>=4: pct=100
    elif days>=2: pct=95
    elif days==1: pct=90
    elif days==0: pct=80
    else: pct=0
    return {'days_left':days,'refund_percent':pct}

def refund_preview(conn, reservation_id, now=None):
    r=conn.execute('SELECT check_in FROM reservations WHERE reservation_id=?',(reservation_id,)).fetchone()
    if not r: raise ValueError('Reservation not found')
    policy=refund_percent(r['check_in'],now)
    paid=conn.execute("SELECT COALESCE(SUM(CASE status WHEN 'Paid' THEN amount WHEN 'Refunded' THEN -amount ELSE 0 END),0) FROM payments WHERE reservation_id=?",(reservation_id,)).fetchone()[0]
    policy.update(paid=paid, refund_amount=round(paid*policy['refund_percent']/100,2))
    return policy

def loyalty_counts(conn):
    rows=conn.execute("SELECT g.guest_id, COUNT(r.reservation_id) n FROM guests g LEFT JOIN reservations r ON r.guest_id=g.guest_id AND r.status='Completed' GROUP BY g.guest_id").fetchall()
    counts={'Silver':0,'Gold':0,'Platinum':0,'None':0}
    for row in rows:
        tier=next(name for threshold,name,pct in TIERS if row['n']>=threshold)
        counts[tier]+=1
    return {'members':counts,'total_guests':len(rows)}

def create_ticket(conn, room_id, reason, start, end):
    if not reason.strip() or date.fromisoformat(end)<date.fromisoformat(start): raise ValueError('Provide a reason and a valid date range')
    found=conn.execute('SELECT room_id FROM rooms WHERE room_number=?',(str(room_id),)).fetchone()
    if not found: found=conn.execute('SELECT room_id FROM rooms WHERE room_id=?',(room_id,)).fetchone()
    if not found: raise ValueError('Room not found')
    room_id=found['room_id']
    cur=conn.execute("INSERT INTO maintenance_tickets(room_id,reason,start_date,expected_end_date) VALUES(?,?,?,?)",(room_id,reason.strip(),start,end))
    conn.execute("UPDATE rooms SET status='Available' WHERE room_id=?",(room_id,))
    return cur.lastrowid

def active_maintenance(conn, room_id, day):
    return conn.execute("SELECT 1 FROM maintenance_tickets WHERE room_id=? AND status IN ('Open','In Progress') AND start_date<=? AND expected_end_date>=? LIMIT 1",(room_id,day,day)).fetchone() is not None

def list_tickets(conn):
    return [dict(r) for r in conn.execute("SELECT t.*, ro.room_number FROM maintenance_tickets t JOIN rooms ro USING(room_id) ORDER BY start_date DESC,t.ticket_id DESC")]

def submit_review(conn, reservation_id, pass_code, rating, comment):
    import features
    expected=features.pass_for(conn,reservation_id)
    if not expected or expected['code'] != str(pass_code).strip().upper(): raise ValueError('Invalid booking pass code')
    r=conn.execute("SELECT status,checked_out_at FROM reservations WHERE reservation_id=?",(reservation_id,)).fetchone()
    if not r or r['status']!='Completed' or not r['checked_out_at']: raise ValueError('Reviews are available after check-out')
    if not 1<=int(rating)<=5: raise ValueError('Rating must be from 1 to 5')
    conn.execute('INSERT INTO reviews(reservation_id,rating,comment) VALUES(?,?,?)',(reservation_id,int(rating),str(comment)[:2000]))
    return {'ok':True}

def room_ratings(conn):
    return {r['room_id']:{'average_rating':round(r['avg'],2),'review_count':r['n']} for r in conn.execute('SELECT ro.room_id,AVG(v.rating) avg,COUNT(*) n FROM reviews v JOIN reservations r USING(reservation_id) JOIN rooms ro USING(room_id) GROUP BY ro.room_id')}
