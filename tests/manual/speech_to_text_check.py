#!/usr/bin/env python3
"""
Sends an audio file to Google Cloud Speech-to-Text the same way CyberChefCloud's
"GCloud Speech to Text" operation does (Raw audio mode), using your gcloud login.

It first sends the browser's CORS preflight (OPTIONS) with the headers the app uses, then the
request itself. It prints whether each response carries the CORS headers a browser needs (without
them the browser reports only "Failed to fetch"), and the transcript or Google's error.

Usage:
    python3 tests/manual/speech_to_text_check.py recording.wav --project YOUR_PROJECT
    python3 tests/manual/speech_to_text_check.py recording.wav --project YOUR_PROJECT --language en-GB --model latest_short

With no file, it sends one second of generated 16 kHz silence, which checks access and CORS
(the API should answer with no transcript).

Needs only Python 3 and the gcloud CLI (`gcloud auth login` first). Nothing is saved.

@author CyberChefCloud
@copyright Crown Copyright 2026
@license Apache-2.0
"""

import argparse
import base64
import io
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import wave

ENDPOINT = "https://speech.googleapis.com/v1/speech:recognize"
APP_ORIGIN = "https://andy7475.github.io"
MAX_INLINE_BYTES = 10 * 1024 * 1024


def access_token():
    """Gets an OAuth access token from the gcloud CLI."""
    gcloud = shutil.which("gcloud")
    if not gcloud:
        sys.exit("gcloud is not installed or not on PATH.")
    result = subprocess.run([gcloud, "auth", "print-access-token"], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit("gcloud could not give a token. Run `gcloud auth login` first.\n" + result.stderr.strip())
    return result.stdout.strip()


def silence_wav(seconds=1.0):
    """One second of 16 kHz mono 16-bit silence, as WAV bytes."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buffer.getvalue()


def describe_wav(data):
    """Prints the WAV header details, as the app's recorder writes them."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            seconds = w.getnframes() / w.getframerate()
            print(f"WAV: {w.getnchannels()} channel(s), {w.getframerate()} Hz, "
                  f"{w.getsampwidth() * 8}-bit, {seconds:.1f} s")
            if seconds > 60:
                print("  Over 60 s: the synchronous API will refuse it; use GCS URI mode for long audio.")
    except wave.Error:
        print("Not a WAV file; sending it as it is (the API also reads FLAC, MP3, Ogg and others).")


def preflight(origin):
    """Sends the CORS preflight a browser sends before the app's request, and reports it."""
    request = urllib.request.Request(ENDPOINT, method="OPTIONS", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-goog-user-project",
    })
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, headers = response.status, response.headers
    except urllib.error.HTTPError as err:
        status, headers = err.code, err.headers
    except urllib.error.URLError as err:
        print(f"Preflight: no response ({err.reason})")
        return
    allow_origin = headers.get("Access-Control-Allow-Origin")
    allow_headers = (headers.get("Access-Control-Allow-Headers") or "").lower()
    ok = status in (200, 204) and allow_origin and "x-goog-user-project" in allow_headers
    print(f"Preflight: HTTP {status}, allow-origin={allow_origin}, allow-headers={allow_headers or None}")
    print("  OK: the browser may send the request" if ok else
          "  Refused: a browser would stop here and report 'Failed to fetch'")


def main():
    """Sends the request and reports what came back."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio", nargs="?", help="Audio file (for example a WAV saved from the app)")
    parser.add_argument("--project", required=True, help="Google Cloud project for quota and billing")
    parser.add_argument("--language", default="en-US", help="Language code (default en-US)")
    parser.add_argument("--model", default="latest_long", help="Model (default latest_long, as the app)")
    parser.add_argument("--origin", default=APP_ORIGIN, help=f"Origin to send (default {APP_ORIGIN})")
    args = parser.parse_args()

    if args.audio:
        with open(args.audio, "rb") as f:
            data = f.read()
    else:
        print("No file given: sending 1 s of generated silence.")
        data = silence_wav()
    describe_wav(data)

    content = base64.b64encode(data).decode("ascii")
    body = json.dumps({
        "config": {"languageCode": args.language, "model": args.model, "enableAutomaticPunctuation": True},
        "audio": {"content": content},
    }).encode("utf-8")
    print(f"Request: {len(body) / 1024:.0f} KB")
    if len(body) > MAX_INLINE_BYTES:
        print("  Over 10 MB: Google will reject this; use GCS URI mode for large audio.")

    preflight(args.origin)
    request = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": f"Bearer {access_token()}",
        "x-goog-user-project": args.project,
        "Content-Type": "application/json; charset=utf-8",
        "Origin": args.origin,
    })
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            status, headers, text = response.status, response.headers, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        status, headers, text = err.code, err.headers, err.read().decode("utf-8", "replace")
    except urllib.error.URLError as err:
        sys.exit(f"No response at all: {err.reason}")

    print(f"HTTP {status}")
    allow = headers.get("Access-Control-Allow-Origin")
    if allow:
        print(f"CORS: Access-Control-Allow-Origin: {allow} (the browser can read this response)")
    else:
        print("CORS: no Access-Control-Allow-Origin header: a browser would report this as 'Failed to fetch'")

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        print("Response (not JSON):", text[:500])
        return
    if "error" in data:
        print("Google error:", data["error"].get("message"))
        return
    results = data.get("results", [])
    transcript = " ".join(r["alternatives"][0].get("transcript", "") for r in results if r.get("alternatives"))
    print("Transcript:", transcript.strip() or "(no speech detected)")


if __name__ == "__main__":
    main()
