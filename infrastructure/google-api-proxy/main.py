"""
Google API relay for CyberChefCloud (service cyber-chef-cloud-google-api).

Every Google API call that CyberChefCloud's operations make goes through this relay
(googleFetch in src/core/lib/GoogleCloud.mjs), so the calls come from Google Cloud rather than
from the user's browser and network. Browsers calling some Google APIs directly were refused
with Google's "automated queries" page, which the browser reports only as "Failed to fetch".

The request's own headers (including the user's Authorization) are forwarded, so Google bills and
authorises the call exactly as if the browser had made it. The relay holds no secrets and stores
nothing. It only forwards to https://*.googleapis.com, and only for callers whose token has
run.routes.invoke on the cyberchefcloud project.

Request (POST, JSON), with "Authorization: Bearer <the user's token>" for the caller check:
    {"url": "https://speech.googleapis.com/v1/speech:recognize", "method": "POST",
     "headers": {"Authorization": "Bearer ...", "Content-Type": "application/json",
                 "x-goog-user-project": "my-project"},
     "body": "<request body as text>" | "bodyBase64": "<binary request body>" | neither}
Response: 200 {"status": <Google's status>, "contentType": "...", "bodyBase64": "<Google's response>"}
          or 4xx/5xx {"error": "<readable message>"} for a problem with the relay itself.
Cloud Run limits a request or response to 32 MB, so about 24 MB of file data each way.

@author CyberChefCloud
@copyright Crown Copyright 2026
@license Apache-2.0
"""

import base64
import binascii
import hashlib
import time
from urllib.parse import urlsplit

import functions_framework
import requests

PROJECT_ID = "cyberchefcloud"
REQUIRED_PERMISSION = "run.routes.invoke"
ALLOWED_ORIGINS = {"https://andy7475.github.io"}  # plus http://localhost:* below
CACHE_SECONDS = 300

ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
# Only these request headers are passed on to Google
FORWARDED_HEADERS = {"authorization", "content-type", "x-goog-user-project", "range"}
UPSTREAM_TIMEOUT = 300

_allowed_tokens = {}  # sha256(Authorization header) -> expiry time


def cors_headers(request):
    """CORS headers that allow the GitHub Pages site and the local dev server."""
    origin = request.headers.get("Origin", "")
    allowed = origin in ALLOWED_ORIGINS or origin.startswith("http://localhost:")
    return {
        "Access-Control-Allow-Origin": origin if allowed else "https://andy7475.github.io",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "3600",
        "Vary": "Origin",
    }


def caller_allowed(request):
    """True if the Bearer token belongs to someone with REQUIRED_PERMISSION on PROJECT_ID."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    key = hashlib.sha256(auth.encode()).hexdigest()
    now = time.time()
    if _allowed_tokens.get(key, 0) > now:
        return True
    resp = requests.post(
        f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT_ID}:testIamPermissions",
        headers={"Authorization": auth},
        json={"permissions": [REQUIRED_PERMISSION]},
        timeout=10,
    )
    if resp.ok and REQUIRED_PERMISSION in resp.json().get("permissions", []):
        _allowed_tokens[key] = now + CACHE_SECONDS
        return True
    return False


def target_allowed(url):
    """True for https URLs on a googleapis.com host, with no user info or unusual port."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return (parts.scheme == "https" and not parts.username and not parts.password
            and parts.port in (None, 443)
            and (host == "googleapis.com" or host.endswith(".googleapis.com")))


@functions_framework.http
def handle(request):
    """Relays one Google API request for an authorised caller."""
    headers = cors_headers(request)
    if request.method == "OPTIONS":
        return ("", 204, headers)
    if request.method != "POST":
        return ({"error": "Use POST."}, 405, headers)
    if not caller_allowed(request):
        return ({"error": "Not authorised for the Google API relay. Use OAuth or an access token in "
                          "'Authenticate Google Cloud' for an account with access to project cyberchefcloud."},
                403, headers)

    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return ({"error": "Invalid or missing JSON payload."}, 400, headers)

    # --- the one job: forward the request to Google with the caller's token ---
    url = body.get("url", "")
    method = str(body.get("method", "GET")).upper()
    if not target_allowed(url):
        return ({"error": "The relay only forwards to https://*.googleapis.com."}, 400, headers)
    if method not in ALLOWED_METHODS:
        return ({"error": f"Method {method} is not relayed."}, 400, headers)

    upstream_headers = {k: str(v) for k, v in (body.get("headers") or {}).items()
                        if k.lower() in FORWARDED_HEADERS}
    text, encoded = body.get("body"), body.get("bodyBase64")
    if text is not None and not isinstance(text, str):
        return ({"error": "body must be text."}, 400, headers)
    try:
        data = base64.b64decode(encoded, validate=True) if encoded else (
            text.encode("utf-8") if text is not None else None)
    except (binascii.Error, TypeError):
        return ({"error": "bodyBase64 is not valid Base64."}, 400, headers)

    try:
        resp = requests.request(method, url, headers=upstream_headers, data=data, timeout=UPSTREAM_TIMEOUT)
    except requests.Timeout:
        return ({"error": "Google did not answer the relay in time."}, 504, headers)
    except requests.RequestException as e:
        # The message holds only the URL the caller sent, never a secret
        return ({"error": f"The relay could not reach Google: {type(e).__name__}"}, 502, headers)

    return ({"status": resp.status_code,
             "contentType": resp.headers.get("Content-Type", ""),
             "bodyBase64": base64.b64encode(resp.content).decode("ascii")}, 200, headers)
