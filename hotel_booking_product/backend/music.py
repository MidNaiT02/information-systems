"""Local music archive streaming with byte-range support for the hotel player.

The MP3 assets stay in three ZIP archives under music_archives/. Since the
archives contain already-compressed MP3 files stored without ZIP compression,
we can seek directly to a track and stream only the requested byte range.
"""
from __future__ import annotations

import json
import os
import re
import zipfile
from http import HTTPStatus

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
CATALOG_PATH = os.path.join(FRONTEND, "music", "catalog.json")
ARCHIVES = {
    "gta": os.path.join(ROOT, "music_archives", "gta.zip"),
    "cyberpunk": os.path.join(ROOT, "music_archives", "cyberpunk.zip"),
    "upbeat": os.path.join(ROOT, "music_archives", "upbeat.zip"),
}


def _load_catalog():
    try:
        with open(CATALOG_PATH, "r", encoding="utf-8") as source:
            return json.load(source).get("playlists", {})
    except (OSError, ValueError):
        return {}


CATALOG = _load_catalog()
TRACK_LOOKUP = {
    (pack, str(track.get("id"))): track
    for pack, tracks in CATALOG.items()
    for track in tracks
}


def parse_byte_range(value: str | None, size: int):
    """Return (start, end) for a single HTTP byte range, or None if absent.

    Raises ValueError for malformed or unsatisfiable ranges.
    """
    if not value:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match:
        raise ValueError("Only one byte range is supported")
    first, last = match.groups()
    if not first and not last:
        raise ValueError("Empty byte range")
    if not first:
        suffix = int(last)
        if suffix <= 0:
            raise ValueError("Invalid suffix range")
        start = max(0, size - suffix)
        end = size - 1
    else:
        start = int(first)
        end = int(last) if last else size - 1
        if start >= size or end < start:
            raise ValueError("Range is not satisfiable")
        end = min(end, size - 1)
    if size <= 0 or start >= size:
        raise ValueError("Range is not satisfiable")
    return start, end


def _error(start_response, status, message, extra_headers=None):
    body = (message + "\n").encode("utf-8")
    headers = [
        ("Content-Type", "text/plain; charset=utf-8"),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
    ] + (extra_headers or [])
    start_response(f"{status} {HTTPStatus(status).phrase}", headers)
    return [body]


def audio_response(environ, start_response, path):
    """Serve /music/<pack>/<track_id> with correct audio/mpeg range headers."""
    parts = path.strip("/").split("/")
    if len(parts) != 3 or parts[0] != "music":
        return _error(start_response, 404, "Music track not found.")
    pack, track_id = parts[1], parts[2]
    track = TRACK_LOOKUP.get((pack, track_id))
    archive_path = ARCHIVES.get(pack)
    if not track or not archive_path:
        return _error(start_response, 404, "Music track not found.")
    if not os.path.isfile(archive_path):
        return _error(start_response, 503, "Music archive is missing. See MUSIC_SETUP.md.")

    member_name = track.get("file")
    if not member_name:
        return _error(start_response, 404, "Music track is not configured.")
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            info = archive.getinfo(member_name)
            if info.compress_type != zipfile.ZIP_STORED:
                return _error(start_response, 500, "Music archive entries must be stored without compression.")
            size = info.file_size
    except (OSError, KeyError, zipfile.BadZipFile):
        return _error(start_response, 503, "Music archive could not be read. See MUSIC_SETUP.md.")

    try:
        byte_range = parse_byte_range(environ.get("HTTP_RANGE"), size)
    except ValueError:
        return _error(
            start_response,
            416,
            "Requested range is not satisfiable.",
            [("Content-Range", f"bytes */{size}"), ("Accept-Ranges", "bytes")],
        )

    start, end = byte_range if byte_range else (0, size - 1)
    status = 206 if byte_range else 200
    headers = [
        ("Content-Type", "audio/mpeg"),
        ("Content-Length", str(max(0, end - start + 1))),
        ("Accept-Ranges", "bytes"),
        ("Cache-Control", "public, max-age=86400"),
        ("Content-Disposition", "inline"),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
    ]
    if byte_range:
        headers.append(("Content-Range", f"bytes {start}-{end}/{size}"))
    start_response(f"{status} {HTTPStatus(status).phrase}", headers)

    # Stream in bounded chunks rather than loading a 10–15 MB track into RAM.
    def body():
        try:
            with zipfile.ZipFile(archive_path, "r") as archive:
                with archive.open(member_name, "r") as audio:
                    audio.seek(start)
                    remaining = end - start + 1
                    while remaining > 0:
                        chunk = audio.read(min(64 * 1024, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk
        except (OSError, KeyError, zipfile.BadZipFile):
            # The response headers have already been sent; closing the iterator
            # is the only safe action if the archive becomes unavailable.
            return

    return body()
