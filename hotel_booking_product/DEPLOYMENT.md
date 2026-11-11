# Running the Hotel Booking System on a real computer

This guide is for a Windows computer or server in the hotel. It was written together with the program but has
NOT been tried on a real server yet. Test every step on a spare computer first, and read the results carefully.

## 1. What you need

- Windows 10 or newer (or Windows Server), Python 3.8 or newer ("py --version" must work).
- The project folder, for example `C:\hotel_booking_product`.
- A name for the site, for example `bookings.myhotel.kz`, pointing to the computer (needed for HTTPS).

## 2. First start and passwords

1. Choose real passwords BEFORE the first start (the database is created and the staff accounts are made at the first start):

        $env:FRONTDESK_PASSWORD = "your-own-long-password-1"
        $env:MANAGER_PASSWORD   = "another-long-password-2"
        py run.py

2. Open http://127.0.0.1:8000, log in as staff, and check that no yellow demo password warning appears.
3. If the database already exists, log in and use the Account button to change both passwords.
4. The demo data (5,000 fictional reservations) is only for trying the system. A real hotel starts with an empty history:
   stop the server, delete `data\hotel.db`, and start with:

        py run.py --reset --empty

   This creates the rooms and the two staff accounts and nothing else. The first real booking is reservation number 1.

## 3. Start it automatically when the computer starts

Use the full path to python.exe (find it with `py -c "import sys; print(sys.executable)"`), because the scheduled task does not use your PATH.

    schtasks /Create /TN "HotelBooking" /SC ONSTART /RU SYSTEM /RL HIGHEST ^
      /TR "cmd /c cd /d C:\hotel_booking_product && C:\Python\python.exe run.py >> data\server.log 2>&1"

Set the settings from section 2 and section 5 as system environment variables (Windows, "Edit the system environment variables"),
so that the task sees them. Start it once with `schtasks /Run /TN "HotelBooking"` and check `data\server.log`.

## 4. HTTPS (required for real use)

Staff passwords and guest data must not travel without encryption. Keep the program on `127.0.0.1:8000` (do not change HOST)
and put a reverse proxy in front of it. With Caddy (it gets a free certificate by itself) the whole file is:

    bookings.myhotel.kz {
        reverse_proxy 127.0.0.1:8000
    }

Then set `COOKIE_SECURE=1` so the login cookie is only sent over HTTPS. In the Windows firewall open port 443 (and 80 for the certificate)
and keep port 8000 closed to the network.

## 5. Real emails

Set these variables and restart. Without them the confirmation emails are only written to the outbox (simulated).

    SMTP_HOST=smtp.myhotel.kz   SMTP_PORT=587   SMTP_USER=bookings@myhotel.kz   SMTP_PASSWORD=...   SMTP_FROM=bookings@myhotel.kz

Send a test booking to your own address. If sending fails the email shows as Failed in the outbox and the front desk can press "Send again".

## 6. Nightly backup

    schtasks /Create /TN "HotelBackup" /SC DAILY /ST 03:00 /RU SYSTEM ^
      /TR "cmd /c cd /d C:\hotel_booking_product && C:\Python\python.exe tools\backup.py --dir D:\hotel_backups --keep 30"

- The backup works while the server runs and keeps the newest 30 copies. Put the folder on another disk, and copy it off the computer too.
- The backups are NOT encrypted. Use an encrypted disk (BitLocker) or a protected network share.
- Check a backup: `py tools\backup.py verify D:\hotel_backups\hotel_YYYYMMDD_HHMMSS.db.gz`
- **Try a restore once a month on a spare computer.** A backup that was never restored is only a hope.

### Restore after a problem

1. Stop the server (`schtasks /End /TN "HotelBooking"`).
2. `py tools\backup.py restore D:\hotel_backups\hotel_YYYYMMDD_HHMMSS.db.gz --force`
   The old database is kept next to the new one as `hotel.db.before_restore_<time>`.
3. Start the server again and check the Reservations page.

## 7. Checking that it is alive

Open `https://bookings.myhotel.kz/api/health`. The answer `{"status": "ok", "database": "ok", ...}` means the program can read its database.
A monitoring service (for example UptimeRobot) can call this address every minute and send a message when it fails. NFR-02 (99.5% uptime)
can only be measured with such a monitor.

## 8. Updating the program

1. Run a backup. 2. Stop the server. 3. Copy the new files over the old ones, but NOT the `data` folder.
4. Start the server. An older database is upgraded automatically when it starts (see `migrate` in `backend/db.py`).
5. Run `py -m unittest discover -s tests` on a copy first if you changed any code.

## 9. Security checklist

- [ ] Both demo passwords changed, and no demo password warning is shown.
- [ ] HTTPS works, `COOKIE_SECURE=1` is set, port 8000 is not reachable from the network.
- [ ] Backups run every night, are stored on another disk, and a restore was tested.
- [ ] Only the hotel owner can read the `data` and backup folders (folder permissions).
- [ ] Windows and Python get security updates.
- [ ] SMTP password and other secrets are only in system environment variables, not in files that are shared.
- [ ] A real payment provider is NOT connected: the program only records simulated payments. Do not take real card numbers with it.

## 10. Common problems

| Problem | What to do |
|---|---|
| "py" is not recognized | Install Python from python.org and tick "Add python.exe to PATH" |
| Address already in use | Another program uses port 8000. Stop it, or set `PORT=8001` |
| Everybody is logged out after a restart | Normal for the login pause only. Staff sessions are stored in the database and stay valid for 8 hours |
| Emails stay "Sent" with channel simulated | SMTP_HOST is not set (see section 5) |
| The site is slow | Run `py tools\measure_search.py`, and `py tools\check_database.py` to see the size of the data |
