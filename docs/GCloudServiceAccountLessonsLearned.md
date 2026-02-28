# GCP Lessons Learned: Service Accounts & Storage Permissions

These lessons emerged from setting up Speech-to-Text access to a GCS bucket, but they apply broadly to **any Google Cloud AI/ML API that reads from Cloud Storage** (Vision, Video Intelligence, Natural Language, etc).

---

## Lesson 1: Google-Managed Service Agents Are Not Project Service Accounts

When a Google Cloud API (e.g. Speech-to-Text, Vision) reads from GCS on your behalf, it does so using a **Google-managed service agent** — a special service account that belongs to Google's infrastructure, not your project.

| API | Service Agent Email Pattern |
| :--- | :--- |
| Cloud Speech-to-Text | `service-{PROJECT_NUMBER}@gcp-sa-speech.iam.gserviceaccount.com` |
| Cloud Vision | `service-{PROJECT_NUMBER}@gcp-sa-vision.iam.gserviceaccount.com` |
| Cloud Video Intelligence | `service-{PROJECT_NUMBER}@gcp-sa-videointelligence.iam.gserviceaccount.com` |
| Cloud Natural Language | `service-{PROJECT_NUMBER}@gcp-sa-language.iam.gserviceaccount.com` |

**These will NOT appear in your project's IAM console** (`IAM & Admin → Service Accounts`), which only lists service accounts you created. Do not waste time looking for them there.

---

## Lesson 2: Service Agents Are Provisioned Lazily

The service agent email does not exist until you **make your first successful API call**. If you try to grant IAM permissions to the service agent email before any API call, the `gcloud` command will fail with:

```
ERROR: HTTPError 400: Service account (...) does not exist.
```

**Solution:** Make a real API call first (even if it fails with a 404 on the GCS object — a permission error is not sufficient). Once the API responds, the service agent is provisioned within a few seconds.

---

## Lesson 3: Same-Project Access Is Automatic

If your GCS bucket and the Cloud API are both in the **same GCP project**, the service agent already has read access to your bucket via the project's legacy IAM bindings (`roles/storage.legacyObjectReader` → `projectViewer`). You do not need to grant anything explicitly.

**Explicitly granting is only required for cross-project access** (e.g. the API is in Project A but the bucket is in Project B).

```bash
# Check your current bucket IAM — if you see these, same-project APIs can read it:
# - roles/storage.legacyBucketReader → projectViewer:YOUR_PROJECT
# - roles/storage.legacyObjectReader → projectViewer:YOUR_PROJECT
gcloud storage buckets get-iam-policy gs://YOUR_BUCKET
```

---

## Lesson 4: Model Selection Matters for Accuracy

When calling Speech-to-Text (and likely other AI APIs), the default model is not always the best choice. In our testing:

| Config | Transcript | Confidence |
| :--- | :--- | :--- |
| Default (no model specified) | `"result"` | 28% |
| `model: "latest_long"` | `"She achieves great results."` | 92% |

**Always specify `model: "latest_long"` for general audio**, and `model: "latest_short"` for short utterances (under ~1 min). Enable `enableAutomaticPunctuation: true` for readable output.

---

## Lesson 5: LRO Polling Endpoint Format

For long-running operations (`longrunningrecognize`, Video Intelligence jobs, etc), the operation name returned is **just a number** (e.g. `4567056075577147015`), not a full resource path.

The correct polling URL is:
```
GET https://speech.googleapis.com/v1/operations/{OPERATION_ID}
```

Not the more verbose `projects/.../operations/...` format (that's a different API surface). Pass the same auth headers as the original request.

---

## Lesson 6: Verify With `curl` Before Building CyberChef Operations

Always test the raw API call with `curl` before writing operation code. The two-step pattern (submit → poll) is easy to verify interactively:

```bash
# Step 1: Submit job
TOKEN=$(gcloud auth print-access-token)
curl -X POST "https://speech.googleapis.com/v1/speech:longrunningrecognize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: YOUR_PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "languageCode": "en-US",
      "model": "latest_long",
      "enableAutomaticPunctuation": true
    },
    "audio": { "uri": "gs://YOUR_BUCKET/audio/file.mp3" }
  }'
# → { "name": "1234567890" }

# Step 2: Poll until done
curl "https://speech.googleapis.com/v1/operations/1234567890" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: YOUR_PROJECT_ID"
# → { "done": true, "response": { "results": [...] } }
```
