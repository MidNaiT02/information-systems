# Latest project update

This archive contains the current hotel-booking implementation. Earlier versions of this project used anonymous booking management codes and included a Spotify playlist widget; those features have been removed from the active application.

## Current booking and account behavior

- Guests must sign in or create a guest account before confirming a reservation.
- Every new reservation is linked to the signed-in guest account. Guests view and manage their own reservations from **My reservations**; no separate private management code is generated or required.
- The QR check-in pass remains separate. It is used by front-desk staff to identify a confirmed reservation at check-in.
- Legacy management-code database columns and old email text are removed during migration where the installed SQLite version supports it. Any remaining legacy column on older SQLite builds is unused and not accepted by any endpoint.
- Spotify playlist UI and its frontend script have been removed.

## Account page

- Guest, Front desk and Manager roles share a social-profile-inspired Account page with a cover banner, initials avatar, role badge, account stats, profile information, account security and role-specific shortcuts.
- All roles can edit their own name and phone number and change their password.
- Email address and role remain read-only. Server-side authorization and CSRF protection apply to profile updates.
- Guest registration creates the account immediately without email verification. Forgotten-password recovery still uses an emailed one-time code and therefore requires SMTP.

## Four visual styles and three languages

- The default `/` page remains **Cyberpunk / NEON OASIS**; `/gta-vi` is **GTA VI Style / THE MARISOL** with a separate After Dark on/off control.
- Added `/official` for **Official & Premium** and `/daltonism` for **Daltonism-safe / High Accessibility**. All four pages load the same app code, API client, authentication, database and role-based guest/front-desk/manager features.
- The shared language selector supports **Қазақша (KZ), English (EN) and Русский (RU)** and remembers the user's selection across pages. Cyberpunk and GTA VI default to Kazakh; Official and Daltonism-safe default to English until a language has been saved.
- Dates, times and numeric formatting use the selected locale. The Official design uses a restrained 200 ms fade/slide transition. Daltonism-safe mode uses a gentle fade, large touch targets, strong keyboard focus, text/pattern/icon cues in addition to color, and no glitch transitions. Its background particles are slow geometric shapes with a Motion On/Off control and a static state for system reduced-motion preferences.
- The Daltonism-safe style is designed for high contrast and color-vision accessibility, but a formal WCAG AAA audit and assistive-technology certification have not been performed.

## Security and deployment notes

- Staff passwords are not printed at startup. Production mode requires explicit non-demo staff passwords and uses Waitress; configure HTTPS at a reverse proxy and set `COOKIE_SECURE=1` after HTTPS is active.
- Guest sessions use separate HttpOnly cookies and CSRF tokens. Guests can view/cancel only reservations owned by their account.
- QR check-in passes use a per-database secret and a keyed 128-bit value. Legacy QR passes may need to be replaced; staff can use the reservation number for legacy stays.
- Database and log files are excluded from this archive. Back up and preserve any real database separately before updating.

## Remaining work requiring external integration or further engineering

- **Payments:** Card, cash and transfer records remain simulated. No payment provider is connected; do not treat a `Paid` record as proof of a real transaction.
- **Email delivery:** Confirmation email delivery still occurs in the booking request path. A durable queue with retries and monitoring is recommended for high volume.
- **Pricing:** Suggestions remain rule-based occupancy hints rather than AI or competitor-price forecasts.
- **Scale:** SQLite is suitable only for a small single-hotel workload. Consider PostgreSQL and realistic load tests before scaling.
- **Production operations:** Configure real SMTP, an HTTPS reverse proxy, backups, database-folder permissions and monitoring. No live production deployment was performed.

## Validation

- Python unit tests: 149 passed.
- Python source compilation: passed.
- JavaScript syntax checks: passed for all frontend JavaScript files.
- Browser UI tests were not executed because the `jsdom` dependency declared in `tests/ui/package.json` is not installed in the available environment.


## Music player integration

- Added a shared floating music player to all four visual styles.
- Added 71 MP3 track catalog entries with title, artist, album and duration metadata.
- Added a local archive streaming endpoint with HTTP byte-range seeking.
- Added Web Audio frequency/time-domain analysis and style-specific visualizers.
- Added GTA VI, Cyberpunk and shared Official/Daltonism Spotify playlist embeds through Spotify's official iFrame API.
- Kept Spotify playback separate from beat visualization to comply with Spotify's synchronization policy.
- Added volume, mute, seek, previous/next, shuffle, repeat, track list, keyboard shortcuts, Media Session and local preferences.
- Added a page-wide, beat-reactive particle layer shared across all four visual styles. The local audio analyzer publishes bass, mid, treble, RMS and transient metrics even while the floating player drawer is collapsed.
- GTA particles expand and burst on bass hits; Cyberpunk fragments snap/glitch on high-frequency transients; Official gold bokeh responds gently to amplitude; Daltonism blue/orange geometry breathes slowly with a Motion On/Off control.
- Added system reduced-motion handling: the particle canvas remains visible as a static wallpaper and the Daltonism motion toggle is disabled when the OS requests reduced motion.
- Added reduced-motion behavior and accessible controls for Daltonism mode.
- Added `MUSIC_SETUP.md`, `tools/install_music.py` and music streaming regression tests.


## Left-to-right playback-only sound waves

- Replaced the center-outward wave with a travelling waveform whose phase moves from the left edge to the right edge.
- The full-page wave is hidden before local music starts and clears immediately when the track is paused or stopped.
- GTA VI uses pink/orange bass-driven waves and left-to-right beat fronts; Cyberpunk uses cyan/magenta treble spikes and data pulses; Official uses smooth gold waves; Daltonism uses solid blue geometric bands.
- Reduced-motion mode freezes the waveform while a local song is playing; no wave is shown when playback is inactive.
- The compact player visualizer is also cleared while idle. Spotify Embed does not drive local audio visualizers.
