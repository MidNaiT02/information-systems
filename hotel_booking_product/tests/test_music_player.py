"""Tests for local MP3 archive streaming and byte-range support."""
import io
import os
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import music  # noqa: E402
import server  # noqa: E402


class MusicRangeTests(unittest.TestCase):
    def test_full_range_is_none(self):
        self.assertIsNone(music.parse_byte_range(None, 100))
        self.assertIsNone(music.parse_byte_range("", 100))

    def test_explicit_range(self):
        self.assertEqual(music.parse_byte_range("bytes=10-19", 100), (10, 19))

    def test_open_ended_range(self):
        self.assertEqual(music.parse_byte_range("bytes=90-", 100), (90, 99))

    def test_suffix_range(self):
        self.assertEqual(music.parse_byte_range("bytes=-8", 100), (92, 99))

    def test_bad_or_unsatisfiable_range_raises(self):
        for value in ("items=0-2", "bytes=", "bytes=100-101", "bytes=4-2", "bytes=-0", "bytes=0-1,3-4"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    music.parse_byte_range(value, 100)


class MusicRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        self.temp.close()
        self.track = music.CATALOG["gta"][0]
        self.payload = bytes(range(256)) * 4
        with zipfile.ZipFile(self.temp.name, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr(self.track["file"], self.payload)

    def tearDown(self):
        os.unlink(self.temp.name)

    def call(self, path, range_header=None):
        env = {"REQUEST_METHOD": "GET", "PATH_INFO": path, "QUERY_STRING": "", "CONTENT_LENGTH": "0", "wsgi.input": io.BytesIO(b"")}
        if range_header:
            env["HTTP_RANGE"] = range_header
        captured = {}

        def start_response(status, headers):
            captured["status"] = int(status.split()[0])
            captured["headers"] = dict(headers)

        with patch.dict(music.ARCHIVES, {"gta": self.temp.name}):
            body = b"".join(server.app(env, start_response))
        return captured, body

    def test_music_route_returns_audio_and_accept_ranges(self):
        response, body = self.call(f"/music/gta/{self.track['id']}")
        self.assertEqual(response["status"], 200)
        self.assertEqual(response["headers"]["Content-Type"], "audio/mpeg")
        self.assertEqual(response["headers"]["Accept-Ranges"], "bytes")
        self.assertEqual(body, self.payload)

    def test_music_route_streams_requested_byte_range(self):
        response, body = self.call(f"/music/gta/{self.track['id']}", "bytes=100-199")
        self.assertEqual(response["status"], 206)
        self.assertEqual(response["headers"]["Content-Range"], f"bytes 100-199/{len(self.payload)}")
        self.assertEqual(body, self.payload[100:200])

    def test_unknown_track_returns_404(self):
        response, _ = self.call("/music/gta/not-a-track")
        self.assertEqual(response["status"], 404)


class MusicCatalogTests(unittest.TestCase):
    def test_all_four_style_collections_are_present_and_complete(self):
        self.assertEqual(len(music.CATALOG.get("gta", [])), 20)
        self.assertEqual(len(music.CATALOG.get("cyberpunk", [])), 15)
        self.assertEqual(len(music.CATALOG.get("upbeat", [])), 36)
        for pack, tracks in music.CATALOG.items():
            for track in tracks:
                with self.subTest(pack=pack, track=track.get("id")):
                    self.assertTrue(track.get("title"))
                    self.assertTrue(track.get("artist"))
                    self.assertTrue(track.get("file", "").lower().endswith(".mp3"))
                    self.assertTrue(track.get("url", "").startswith(f"/music/{pack}/"))

    def test_all_four_pages_load_the_shared_music_player(self):
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
        for page in ("index.html", "gta-vi.html", "official.html", "daltonism.html"):
            with self.subTest(page=page):
                with open(os.path.join(root, page), encoding="utf-8") as source:
                    html = source.read()
                self.assertIn("/static/music-player.css", html)
                self.assertIn("/static/music-player.js", html)

    def test_shared_music_player_publishes_local_audio_metrics_for_page_particles(self):
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
        with open(os.path.join(root, "music-player.js"), encoding="utf-8") as source:
            player = source.read()
        self.assertIn("window.hotelAmbientAudioFrame(audioMetrics)", player)
        self.assertIn("frequencyBand(frequency, 35, 180)", player)
        self.assertIn("frequencyBand(frequency, 2500, 10000)", player)
        self.assertIn("waveformRms(waveform)", player)
        # Closing the floating drawer must not cancel the audio-analysis loop.
        self.assertIn("else if (!state.open && !state.playing)", player)

    def test_ambience_supports_all_styles_and_accessibility_motion_toggle(self):
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
        with open(os.path.join(root, "ambience.js"), encoding="utf-8") as source:
            ambience = source.read()
        self.assertIn("window.hotelAmbientAudioFrame = publishAudioFrame", ambience)
        self.assertIn("window.hotelAmbientSetMotion = setMotionEnabled", ambience)
        for theme in ("gta", "cyberpunk", "official", "accessible"):
            self.assertIn(theme, ambience)
        self.assertIn("detail.highHit", ambience)
        self.assertIn("metrics.rms", ambience)
        # The page-wide waveform travels left-to-right and is hidden when playback stops.
        self.assertIn("function drawTravelingWaves", ambience)
        self.assertIn("if (!metrics.playing)", ambience)
        self.assertIn("wavePhase += dt / 1000 * phaseSpeed", ambience)
        self.assertIn("(x / wavelength) - wavePhase", ambience)
        self.assertIn("front.x += dt *", ambience)
        self.assertNotIn("drawCenterOutWaves", ambience)
        # Daltonism uses static deep-blue blocks instead of rapid/glowing effects.
        self.assertIn("if (theme === 'accessible')", ambience)
        self.assertIn("#1E3A8A", ambience)
        with open(os.path.join(root, "music-player.js"), encoding="utf-8") as source:
            player = source.read()
        self.assertIn("hm-motion-toggle", player)
        self.assertIn("MOTION: OFF (SYSTEM SETTING)", player)
        self.assertIn("if (!state.playing || state.source !== 'local')", player)
        self.assertIn("&& (!state.playing || state.source !== 'local')", player)


if __name__ == "__main__":
    unittest.main()
