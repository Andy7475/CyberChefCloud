---
name: add-cloud-run-function
description: Create, secure and deploy a Cloud Run function that one CyberChefCloud cloud operation calls, with its secrets in Secret Manager and its source in infrastructure/. Use when an op needs a backend, for example to hold a third-party API key, call an API that blocks browser (CORS) requests, or run a server-side library; when asked to add, write, deploy or redeploy a Cloud Run function, proxy or service for CyberChefCloud; or when wiring an ingredient to such a function.
---

# Add a Cloud Run function for a cloud operation

**One cloud operation calls one Cloud Run function, and that function does one job.** The function takes the op's JSON request, does the one thing the browser can't, and returns JSON. It holds no state, serves no other op, and does no formatting that the op could do itself.

Worked example: the `Cloud Convert` op (`src/core/operations/CloudConvert.mjs`) and `infrastructure/cloud-convert-proxy/`. Read both before you start. `infrastructure/README.md` lists the services and the rules on secrets and access.

## 0. Check that a function is needed

Use a function only when the op needs at least one of these:
- a secret, such as a third-party API key, which must never reach the browser;
- an API that rejects browser requests (CORS);
- a library that only runs on a server.

A Google API that accepts the user's OAuth token from the browser doesn't need a function. Use the `add-cloud-operation` skill instead.

Fixed values (all safe to commit):

| | |
| :--- | :--- |
| Project ID / number | `cyberchefcloud` / `593556123914` |
| Region | `europe-west2` |
| Service name | `cyber-chef-cloud-<thing>` |
| Service URL | `https://cyber-chef-cloud-<thing>-593556123914.europe-west2.run.app` (known before deploying) |
| Folder | `infrastructure/<thing>-proxy/` |
| Runtime | Python 3.14 (`--base-image python314`), `functions-framework` |

The user's default `gcloud` project is not `cyberchefcloud`. Always pass `--project cyberchefcloud`.

## 1. Folder layout

```
infrastructure/<thing>-proxy/
  main.py            # the function
  requirements.txt   # functions-framework, requests, + the API's library
  deploy.sh          # copy of cloud-convert-proxy/deploy.sh with the names changed
  .gcloudignore      # keeps deploy.sh etc. out of the upload
```

Copy `.gcloudignore` from `infrastructure/cloud-convert-proxy/`.

## 2. Write `main.py`

Start from this template. CORS and the caller check are required. Only the part marked `# --- the one job ---` changes from function to function.

```python
import hashlib
import os
import time

import functions_framework
import requests

PROJECT_ID = "cyberchefcloud"
REQUIRED_PERMISSION = "run.routes.invoke"
ALLOWED_ORIGINS = {"https://andy7475.github.io"}  # plus http://localhost:* below
CACHE_SECONDS = 300

# Injected from Secret Manager by deploy.sh (--set-secrets). Never hard-code, log or return it.
API_KEY = os.environ.get("<THING>_API_KEY")

_allowed_tokens = {}  # sha256(token) -> expiry time; avoids one IAM check per request


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


@functions_framework.http
def handle(request):
    headers = cors_headers(request)
    if request.method == "OPTIONS":
        return ("", 204, headers)
    if request.method != "POST":
        return ({"error": "Use POST."}, 405, headers)
    if not caller_allowed(request):
        return ({"error": "Not authorised. Use OAuth or an access token in 'Authenticate Google Cloud' "
                          "for an account with access to project cyberchefcloud."}, 403, headers)

    body = request.get_json(silent=True)
    if not body:
        return ({"error": "Invalid or missing JSON payload."}, 400, headers)

    try:
        # --- the one job ---
        # validate body fields -> return 400 with a readable "error" if wrong
        # call the third-party API with API_KEY
        result = ...
        return ({"result": result}, 200, headers)
    except Exception as e:
        return ({"error": str(e)}, 500, headers)
```

Rules:
- **Request and response contract:** the request is JSON. A success returns `200` with JSON. A failure returns a 4xx/5xx status with `{"error": "<readable message>"}`, which the op shows to the user. Binary data travels as base64 in a field (`file_data` in Cloud Convert).
- **The caller check works like this:** it asks Google whether the token's owner has `run.routes.invoke` on `cyberchefcloud`. A valid token for someone with project access gets the permission back. Anyone else gets an empty list, and a bad token gets 401. It works with access tokens and PKCE tokens (scope `cloud-platform`). It does **not** work with API keys, so the op must refuse API-key auth (step 6). Checked: a `gcloud` access token returns the permission and a bogus token returns 401. If a PKCE token gets `SERVICE_DISABLED` back, enable the Cloud Resource Manager API in the project that owns the OAuth client.
- **Don't send `x-goog-user-project`** on the `testIamPermissions` call. Doing so needs the Cloud Resource Manager API enabled in `cyberchefcloud`, and it isn't.
- **Keep secrets out of errors.** If the third-party API takes its key in the URL, don't return `str(e)` from a `requests` exception unchanged, because the message can contain the URL.
- **Temporary files:** use `tempfile.NamedTemporaryFile`, never a fixed path like `/tmp/input.pdf`. Cloud Run handles several requests at once in one instance, and `/tmp` is in memory.
- Set `timeout=` on every outbound `requests` call.
- Use the default entry point name `handle` unless you're matching a function that already exists.

## 3. Store the secret in Secret Manager

The secret value must never be in the repo, in chat or in a command you run. Check first whether it already exists:

```bash
gcloud secrets describe <THING>_API_KEY --project cyberchefcloud
```

If it doesn't, **ask the user to run this themselves** (`read -rs` keeps the key out of shell history and off screen):

```bash
read -rs KEY && printf %s "$KEY" | gcloud secrets create <THING>_API_KEY --project cyberchefcloud --data-file=- && unset KEY
gcloud secrets add-iam-policy-binding <THING>_API_KEY --project cyberchefcloud \
  --member serviceAccount:593556123914-compute@developer.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
```

`deploy.sh` maps it to an environment variable with `--set-secrets <THING>_API_KEY=<THING>_API_KEY:latest`.

## 4. Write `deploy.sh`

Copy `infrastructure/cloud-convert-proxy/deploy.sh` and change `SERVICE`, `FUNCTION` and `SECRET`. If the function needs more than one secret, give `--set-secrets` a comma-separated list. If it needs none, delete the secret check and the flag. Keep `PROJECT_ID` pinned to `cyberchefcloud`, `--no-invoker-iam-check` (the browser can't send IAM identity tokens), and a low `--max-instances` to cap the cost of misuse. Run `chmod +x deploy.sh`.

## 5. Run locally, deploy, then test with curl

Optional local run (pass the secret from the user's shell, never typed by you):

```bash
cd infrastructure/<thing>-proxy
uv run --with-requirements requirements.txt functions-framework --target handle --port 8090
```

**Ask the user before deploying.** Deploying changes a live service. Then run `./infrastructure/<thing>-proxy/deploy.sh`.

Check the deployed service before you write the op:

```bash
URL=https://cyber-chef-cloud-<thing>-593556123914.europe-west2.run.app
TOKEN=$(gcloud auth print-access-token)

# CORS preflight from the dev server: expect 204 and Access-Control-Allow-Origin: http://localhost:8080
curl -si -X OPTIONS "$URL" -H "Origin: http://localhost:8080" -H "Access-Control-Request-Method: POST" | head -10

# No token: expect 403
curl -s -X POST "$URL" -H "Content-Type: application/json" -d '{}'

# Real call: expect 200 and the result
curl -s -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ ... }'
```

Read the logs with `gcloud run services logs read cyber-chef-cloud-<thing> --project cyberchefcloud --region europe-west2 --limit 50`.

## 6. Write the operation

Follow the `add-cloud-operation` skill steps 1 to 7 (op file, CSP, category, config/lint, offline test, Nightwatch test, manual check). These things are different for a function-backed op:

- **Call the function with `fetch`, not `gcpFetch`.** `gcpFetch` is for Google APIs, and it adds `?key=` / `x-goog-user-project` handling the function doesn't use.
- **Refuse API-key auth**, because the function's caller check needs an OAuth token or access token.
- The CSP `connect-src` entry in `src/web/html/index.html` is the **exact** service URL, as is the entry in `docs/AuthorizedEndpoints.md`.

```javascript
const SERVICE_URL = "https://cyber-chef-cloud-<thing>-593556123914.europe-west2.run.app";

// in run():
const creds = getGcpCredentials();
if (!creds || !creds.authString) {
    throw new OperationError("<Op Name>: Please run 'Authenticate Google Cloud' first.");
}
if (creds.authType === "API Key") {
    throw new OperationError("<Op Name>: needs OAuth or an access token in 'Authenticate Google Cloud'. An API key can't be checked by the service.");
}

const response = await fetch(SERVICE_URL, {
    method: "POST",
    mode: "cors",
    cache: "no-cache",
    headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${creds.authString}`
    },
    body: JSON.stringify(payload)
});
const rawText = await response.text();
let data;
try {
    data = JSON.parse(rawText);
} catch (e) {
    data = { error: rawText };
}
if (!response.ok) {
    throw new OperationError(`<Op Name>: ${data.error || response.statusText}`);
}
```

In the op description, say that it uses a CyberChefCloud Cloud Run service, and that it needs `Authenticate Google Cloud` with OAuth or an access token for an account that has access to the project.

## 7. Record it

- Add a row to the services table in `infrastructure/README.md`: folder, service, op, secrets.
- If the function changes the "two proxies" count, update the line about Cloud Run proxies in `CLAUDE.md`.
- Commit `main.py`, `requirements.txt`, `deploy.sh` and `.gcloudignore`. Before committing, run `git diff --cached` and check that it contains no key, token or `.env` file.

## Checklist

- [ ] A function is really needed (step 0); it serves exactly one op
- [ ] `infrastructure/<thing>-proxy/` has `main.py`, `requirements.txt`, `deploy.sh` (executable) and `.gcloudignore`
- [ ] `main.py` has CORS for GitHub Pages + localhost, the `caller_allowed` check, JSON `{"error"}` responses and `timeout=` on outbound calls; no secrets in code or errors
- [ ] Secret in Secret Manager, created by the user, readable by the compute service account
- [ ] User approved the deploy; curl checks pass (preflight 204, no-token 403, real call 200)
- [ ] Op uses `fetch` + Bearer token, refuses API-key auth, and is in the CSP, `AuthorizedEndpoints.md` and `Categories.json`
- [ ] Offline and Nightwatch tests added (`add-cloud-operation` steps 5 and 6)
- [ ] `infrastructure/README.md` table updated
