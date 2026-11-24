# The Marisol — standalone booking experience

The Marisol is an optional, separate Miami/Vice City-inspired booking page. It does **not** replace or restyle the existing Cyberpunk hotel interface.

## Open the experience

Start the application as usual:

```bash
py run.py
```

Then open:

- Main Cyberpunk hotel system: `http://127.0.0.1:8000/`
- The Marisol: `http://127.0.0.1:8000/marisol`

Both pages use the same database, guest accounts, room availability, booking creation, loyalty calculations, reservation history, cancellation rules, and QR check-in passes.

## Features

- Kazakh default interface with an English toggle.
- Sunset and After Dark appearance presets, scoped only to The Marisol page.
- Availability search, date selection, guest stepper and capacity filtering.
- Room-type filters and original locally stored SVG room illustrations.
- Guest login/registration, account profile and password change.
- Three-stage booking flow and postcard-style confirmation.
- Guest reservation list with QR check-in pass and eligible cancellation.
- Diagonal overlay wipe, text glitch and staggered card entrance when switching tabs.
- Mobile booking search panel that expands from the bottom of the screen.

## Notes

- Booking requires a signed-in Guest account, matching the existing account-owned reservation security model.
- The guest count is validated against room capacity and stored with the reservation.
- Payment methods are part of the current prototype. Payment confirmation remains simulated; no card numbers are collected or processed.
- Room art is original SVG artwork stored in `frontend/marisol/`.
- Google Fonts are used for Bebas Neue and Inter; the page falls back to system sans-serif fonts if remote fonts are unavailable.
