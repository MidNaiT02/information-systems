"""Install the three provided MP3 ZIP archives into music_archives/.

Usage:
  py tools/install_music.py "SpotiDownloader.com - GTA.zip" \
      "SpotiDownloader.com - Cyberpunk .zip" "SpotiDownloader.com - Upbeat Mix.zip"
"""
import argparse
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "music_archives")


def main():
    parser = argparse.ArgumentParser(description="Install the hotel music ZIP archives.")
    parser.add_argument("gta", help="Path to the GTA MP3 ZIP archive")
    parser.add_argument("cyberpunk", help="Path to the Cyberpunk MP3 ZIP archive")
    parser.add_argument("upbeat", help="Path to the Upbeat Mix MP3 ZIP archive")
    args = parser.parse_args()
    mapping = (("gta", args.gta, 20), ("cyberpunk", args.cyberpunk, 15), ("upbeat", args.upbeat, 36))
    os.makedirs(DEST, exist_ok=True)
    for pack, source, expected_count in mapping:
        source = os.path.abspath(source)
        if not os.path.isfile(source):
            raise SystemExit(f"Archive not found: {source}")
        try:
            with zipfile.ZipFile(source, "r") as archive:
                mp3s = [item for item in archive.infolist() if not item.is_dir() and item.filename.lower().endswith(".mp3")]
                if len(mp3s) != expected_count:
                    raise SystemExit(f"{pack}: expected {expected_count} MP3 files, found {len(mp3s)}")
                bad = archive.testzip()
                if bad:
                    raise SystemExit(f"{pack}: archive integrity check failed at {bad}")
                if any(item.compress_type != zipfile.ZIP_STORED for item in mp3s):
                    raise SystemExit(f"{pack}: MP3 entries must be stored without ZIP compression for byte-range streaming")
        except zipfile.BadZipFile as exc:
            raise SystemExit(f"Invalid ZIP archive ({pack}): {exc}")
        destination = os.path.join(DEST, f"{pack}.zip")
        shutil.copy2(source, destination)
        print(f"Installed {pack}: {len(mp3s)} MP3 tracks -> {destination}")
    print("Music archives installed. Start the app with: py run.py")


if __name__ == "__main__":
    main()
