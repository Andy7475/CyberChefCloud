import base64
import hashlib
import os
import tempfile
import time

import cloudconvert
import functions_framework
import requests
from google.cloud import storage

PROJECT_ID = "cyberchefcloud"
REQUIRED_PERMISSION = "run.routes.invoke"
ALLOWED_ORIGINS = {"https://andy7475.github.io"}  # plus http://localhost:* below
CACHE_SECONDS = 300

# Injected from Secret Manager by deploy.sh (--set-secrets). Never log or return it.
CLOUDCONVERT_API_KEY = os.environ.get("CLOUDCONVERT_API_KEY")
if CLOUDCONVERT_API_KEY:
    cloudconvert.configure(api_key=CLOUDCONVERT_API_KEY)

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


@functions_framework.http
def convert_file(request):
    """Converts a file with CloudConvert. Input and output can be base64 bytes or GCS objects."""
    headers = cors_headers(request)
    if request.method == "OPTIONS":
        return ("", 204, headers)
    if request.method != "POST":
        return ({"error": "Use POST."}, 405, headers)
    if not caller_allowed(request):
        return ({"error": "Not authorised. Use OAuth or a PAT in 'Authenticate Google Cloud' "
                          "for an account with access to project cyberchefcloud."}, 403, headers)

    req_json = request.get_json(silent=True)
    if not req_json:
        return ({"error": "Invalid or missing JSON payload."}, 400, headers)

    input_type = req_json.get("input_type")
    output_type = req_json.get("output_type")
    source = req_json.get("source", "bytes")            # 'bytes' or 'gcs'
    destination = req_json.get("destination", "bytes")  # 'bytes' or 'gcs'

    if not input_type or not output_type:
        return ({"error": "input_type and output_type are required."}, 400, headers)
    if source not in ("bytes", "gcs") or destination not in ("bytes", "gcs"):
        return ({"error": "source and destination must be 'bytes' or 'gcs'."}, 400, headers)

    temp_input_path = None
    try:
        storage_client = storage.Client()

        # 1. Get the input file
        if source == "bytes":
            file_b64 = req_json.get("file_data")
            if not file_b64:
                return ({"error": "file_data is required when source is 'bytes'."}, 400, headers)
            file_bytes = base64.b64decode(file_b64)
        else:
            blob = storage_client.bucket(req_json.get("input_bucket")).blob(req_json.get("input_file_name"))
            file_bytes = blob.download_as_bytes()

        # Unique temp file: one instance handles several requests at once, and /tmp is in memory
        with tempfile.NamedTemporaryFile(suffix=f".{input_type}", delete=False) as f:
            f.write(file_bytes)
            temp_input_path = f.name

        # 2. Create the CloudConvert job: upload -> convert -> export URL
        job = cloudconvert.Job.create(payload={
            "tasks": {
                "import-task": {"operation": "import/upload"},
                "convert-task": {
                    "operation": "convert",
                    "input": "import-task",
                    "input_format": input_type,
                    "output_format": output_type,
                },
                "export-task": {"operation": "export/url", "input": "convert-task"},
            }
        })

        import_task = next(t for t in job["tasks"] if t["name"] == "import-task")
        cloudconvert.Task.upload(file_name=temp_input_path, task=import_task)

        job = cloudconvert.Job.wait(id=job["id"])

        # 3. Collect the result
        failed = [t for t in job["tasks"] if t["status"] == "error"]
        if failed:
            return ({"error": f"CloudConvert error: {failed[0].get('message', 'Unknown error')}"}, 500, headers)

        export_task = next(t for t in job["tasks"] if t["name"] == "export-task")
        file_url = export_task["result"]["files"][0]["url"]
        download = requests.get(file_url, timeout=60)
        download.raise_for_status()
        converted_bytes = download.content

        # 4. Route the output
        if destination == "gcs":
            out_bucket_name = req_json.get("output_bucket")
            out_file_name = req_json.get("output_file_name")
            storage_client.bucket(out_bucket_name).blob(out_file_name).upload_from_string(converted_bytes)
            return ({"status": "success", "message": f"File saved to gs://{out_bucket_name}/{out_file_name}"}, 200, headers)

        b64_output = base64.b64encode(converted_bytes).decode("utf-8")
        return ({"status": "success", "file_data": b64_output}, 200, headers)

    except Exception as e:
        return ({"error": str(e)}, 500, headers)
    finally:
        if temp_input_path and os.path.exists(temp_input_path):
            os.remove(temp_input_path)
