# Hotel music player setup

The music player is shared by all four visual styles. It has two separate sources:

1. **Local Beat Sync** — plays the supplied MP3 collections and analyses the local audio with the Web Audio API. GTA VI, Cyberpunk, Official and Daltonism each select their assigned local collection automatically.
2. **Spotify Embed** — loads the assigned Spotify playlist using Spotify's official Embed iFrame API. Spotify audio is not analysed and does not drive the visualizer; Spotify's own controls remain in charge of Spotify playback.

## 1. Put the uploaded archives beside the project

Copy the three source archives into the project root (the folder containing `run.py`), or leave them in that folder after downloading:

- `SpotiDownloader.com - GTA.zip`
- `SpotiDownloader.com - Cyberpunk .zip`
- `SpotiDownloader.com - Upbeat Mix.zip`

## 2. Install the archive files

Run this command from the project root:

```powershell
py tools/install_music.py "SpotiDownloader.com - GTA.zip" "SpotiDownloader.com - Cyberpunk .zip" "SpotiDownloader.com - Upbeat Mix.zip"
```

The installer validates all three ZIP files and copies them to `music_archives/gta.zip`, `music_archives/cyberpunk.zip` and `music_archives/upbeat.zip`. MP3 files stay packed in their archives; the Python server streams individual tracks on demand, including HTTP byte ranges for seeking. No 650 MB extraction step is needed.

## 3. Start the site

```powershell
py run.py
```

Open the site as usual. The floating **Lobby Music** button appears in every style.

## Playlist assignments

| Site style | Local MP3 collection | Spotify playlist |
|---|---|---|
| GTA VI — The Marisol | GTA archive (20 tracks) | `359kPloDaoWnejGP6mxSi0` |
| Cyberpunk — Neon Oasis | Cyberpunk archive (15 tracks) | `0cf3Aqb7GeyXHY4eIKFKcP` |
| Official & Premium | Upbeat Mix archive (36 tracks) | `37i9dQZF1EVJHK7Q1TBABQ` |
| Daltonism-safe | Upbeat Mix archive (36 tracks) | `37i9dQZF1EVJHK7Q1TBABQ` |

## Beat visualizer and page-wide particle behavior

For local MP3 playback, a Web Audio `AnalyserNode` reads frequency and time-domain samples. The audio-analysis loop runs while music plays, even when the floating drawer is collapsed. It publishes normalized bass (35–180 Hz), mid (180–2200 Hz), treble (2500–10000 Hz), RMS amplitude and transient events to the page-wide `#ambience-canvas`.

Low-frequency spectral flux is an approximate kick/beat-onset detector; high-frequency spectral flux is used for snare/hi-hat-like events. These are signal-based estimates, not a certified musical beat grid, so they may not identify every musical beat perfectly.

Theme-specific page-wide effects:

- **GTA VI:** pink/orange dust motes drift upward. Bass transients create short outward particle bursts; particle size and glow swell with bass energy.
- **Cyberpunk:** cyan/magenta data fragments move through the page. High-frequency transients create grid-snapped glitch fragments, short horizontal data tears and scanline accents.
- **Official:** gold and warm-white bokeh particles drift gently. Their size, opacity and drift speed respond smoothly to overall RMS amplitude.
- **Daltonism:** large, outlined blue/orange geometric shapes move slowly and breathe with heavily smoothed amplitude. The player exposes a **Motion: On/Off** control. If the OS requests reduced motion, the control is disabled and the canvas freezes as a static pattern.

The small player visualizer also remains theme-specific: GTA pink/orange equalizer, Cyberpunk cyan oscilloscope, Official gold sine wave and Daltonism blue bars. All visual animation stops when local audio is paused. The page-wide field stays behind page content and never intercepts pointer input.

When the Spotify source is selected, the local audio is paused and all beat-reactive particle effects return to their static state. Spotify playback is not analyzed or synchronized with visual media. Spotify embeds also require network access and may require the listener to press Play.

## Playback notes

- Browsers require a user gesture before audio playback; click a track or Play.
- The player remembers volume, shuffle/repeat settings and the last selected track per local collection.
- When switching to another style page, the browser unloads the previous page and pauses audio. The player saves the track and position; press Play on the new page to resume. This is a browser lifecycle limitation, not a booking-system issue.
- Spotify Embed controls are rendered by Spotify and cannot be fully restyled by the hotel site.
- The player uses no external JavaScript library for local playback or beat analysis.


## Left-to-right playback-only sound waves

The page-wide canvas draws a travelling waveform that moves from the left edge to the right edge. It appears only while a local MP3 is playing and clears immediately on pause or stop. GTA VI uses bass-driven pink/orange waves and travelling beat fronts; Cyberpunk uses treble-driven cyan/magenta spikes; Official uses a smooth gold wave; Daltonism uses solid blue geometric bands. With reduced motion enabled, the wave freezes while playback continues. Spotify Embed does not drive local audio visualizers.
