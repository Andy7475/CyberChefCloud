# Research Report: Cloud-Native Orchestration with CyberChef
## Processing Large Media at Scale Without Touching the Browser

**Version:** 1.0 | **Date:** 2026-02-28

---

## 1. The Problem: CyberChef's Browser Constraints

CyberChef runs entirely client-side in the browser. Every byte it processes passes through the browser's memory. This is fine for text manipulation and small files, but for large-scale media processing it creates three fundamental constraints:

| Constraint | Practical Limit | Impact |
| :--- | :--- | :--- |
| **Memory** | ~2GB per browser tab (V8 engine heap limit) | A single 4K video file can easily be 5–20GB |
| **Bandwidth** | Consumer uplink speeds (5–50 Mbps typical) | 100 x 1GB video files = 100GB transferred to the browser before it can even begin |
| **Processing time** | Synchronous Web Worker thread | Large base64 encoding of binary media can lock the UI for tens of seconds |

**Conclusion:** It is architecturally inappropriate to pass raw video or audio files *through* the browser for cloud AI processing. The browser should be an **orchestration layer**, not a data mule.

---

## 2. The Core Insight: GCS URI as the CyberChef Input

Google's Cloud AI APIs (Speech-to-Text, Video Intelligence, Vision) all support a `gcsUri` input parameter natively:

```
gs://my-bucket/videos/suspect_001.mp4
```

This means the API will pull the file **directly within Google's own infrastructure**: from Cloud Storage, through the API's compute, and the result (text) is returned to the API caller (the browser). **The raw video data never leaves Google Cloud.** The browser only ever sends a short string (the GCS URI) and receives back a short string (the transcription).

This is the architectural unlock that makes CyberChef a viable intelligence orchestration tool.

```
[Browser (CyberChef)]
    |
    |  ① Input: "gs://bucket/video.mp4"  (tiny string, ~50 bytes)
    |
    v
[Google Cloud API Endpoint]
    |
    |  ② API pulls video internally via high-speed Google backbone
    |
    v
[Cloud Storage Bucket]
    |
    |  ③ Transcription result text returned
    |
    v
[Browser (CyberChef)]  ← Only receives the resulting text
```

---

## 3. Scenario: Transcribing 100 Videos from a GCS Bucket

### 3.1 Naïve Approach (One URI at a Time)

A simple CyberChef recipe using a proposed `GCloud Speech-to-Text` operation:

```
Input:  gs://intel-bucket/videos/suspect_001.mp4

Recipe:
  1. GCloud Speech-to-Text  [Auth Token, Language: auto-detect, Output: Plain Text]
  
Output: "The package will be delivered at 1400 hours..."
```

This works fine for one file, but is **not scalable** for 100 files.

### 3.2 Scalable Approach: CyberChef Fork + Batch URIs

CyberChef's native `Fork` operation splits a multi-line input into separate execution streams, runs the recipe on each, then `Merge`s the results. This is a natural fit:

```
Input:
  gs://intel-bucket/videos/suspect_001.mp4
  gs://intel-bucket/videos/suspect_002.mp4
  ...
  gs://intel-bucket/videos/suspect_100.mp4

Recipe:
  1. Fork [Split delimiter: \n, Merge delimiter: \n---\n]
  2. GCloud Speech-to-Text  [Auth Token, Language: auto-detect]
  3. Merge

Output:
  "The package will be delivered at 1400 hours..."
  ---
  "We need to move to the secondary location..."
  ---
  ...
```

This is already implementable with the CyberChef `Fork` pattern. The critical implementation detail is that the `GCloud Speech-to-Text` operation must detect whether its input is a `gs://` URI and switch to the `longrunningrecognize` API endpoint, rather than the synchronous `recognize` endpoint (see Section 5).

### 3.3 Generating the File List from GCS

Before running the recipe above, the analyst needs the list of 100 GCS URIs. This could be sourced several ways:

| Method | Description |
| :--- | :--- |
| **GCloud List Bucket operation** (proposed) | A new CyberChef op that takes a bucket name and lists its contents as `gs://` URIs, one per line — directly pipe-able into `Fork`. |
| **`gsutil ls`** | Run locally in a terminal, paste output into CyberChef. Simple but manual. |
| **Cloud Storage JSON API** | A raw API call from CyberChef to `storage.googleapis.com/storage/v1/b/{bucket}/o` returns a JSON list of objects to parse via `JSONPath`. |

A `GCloud List Bucket` operation would be a high-value addition: it turns CyberChef into a self-contained orchestrator from discovery through to transcription.

---

## 4. Wider Google Cloud Considerations

### 4.1 IAM & Permissions

For this architecture to work, the identity making the API call (i.e., the OAuth token held in the browser) must have the correct IAM roles on **both** the Cloud Storage bucket and the Cloud AI API.

**Minimum required roles:**

| Resource | Role | Purpose |
| :--- | :--- | :--- |
| Cloud Storage Bucket | `roles/storage.objectViewer` | Allows the Speech/Video API to access the source media |
| Speech-to-Text API | `roles/speech.editor` or `serviceusage.serviceUsage.use` | Allows calling the transcription API |
| Video Intelligence API | `roles/cloudmldeveloper` | Allows calling video annotation endpoints |

**Key gotcha:** The Speech-to-Text API accesses GCS on behalf of the **Speech service account**, not the end user. Depending on how the bucket is configured (Uniform vs. Fine-grained ACL), this may require explicitly granting the Speech service account (`service-{PROJECT_NUMBER}@gcp-sa-speech.iam.gserviceaccount.com`) access to the bucket.

### 4.2 Long-Running Operations & Polling

This is the most significant technical challenge for CyberChef integration. Transcribing a 1-hour video file can take **5–15 minutes** of cloud processing time. Cloud AI APIs handle this with an **asynchronous long-running operation (LRO)** pattern:

1.  **Client calls** `longrunningrecognize` → API immediately returns an **operation ID** (e.g., `operations/7654321`).
2.  **Client polls** `GET /operations/7654321` repeatedly until `done: true`.
3.  **Client retrieves** the transcript from the completed response.

The CyberChef operation must implement this polling loop internally, with configurable:
- **Poll interval** (e.g., every 10 seconds)
- **Maximum wait time** (e.g., 30 minutes) to avoid hanging indefinitely
- **Progress indication** in the output box (e.g., `[Polling... attempt 3/180]`) so the analyst knows it's working

This is non-trivial but entirely implementable within a CyberChef Web Worker using `async/await`.

### 4.3 Cross-Origin Resource Sharing (CORS)

Google's Cloud AI REST APIs are configured to allow `cross-origin` requests from browsers, which is why our existing Google Translate operation works. However, the **Cloud Storage JSON API** is more restrictive. Reading object metadata is generally fine, but to enable the CyberChef "List Bucket" concept, the GCS bucket itself may need its [CORS configuration](https://cloud.google.com/storage/docs/cross-origin) updated to allow `GET` requests from the CyberChef origin.

```json
[{
  "origin": ["https://your-cyberchef-domain.com"],
  "method": ["GET"],
  "responseHeader": ["Content-Type"],
  "maxAgeSeconds": 3600
}]
```

### 4.4 Cost Considerations

Cloud AI APIs are billed per minute of audio/video processed. With 100 files:

| API | Billing Unit | 100 × 30-min files |
| :--- | :--- | :--- |
| Speech-to-Text v1 | $0.006 / 15 sec | ~$7.20 per batch |
| Video Intelligence API (transcription) | $0.10 / minute | ~$300 per batch |
| Cloud Vision (OCR) | $1.50 / 1000 images | Effectively free per frame |

CyberChef should surface **estimated cost warnings** in the operation UI before the user submits a large batch, ideally by calculating `(number of items in Fork) × (estimated cost per file)` and displaying it as an info banner.

### 4.5 Output Results Storage

When processing 100 videos, the combined text output could be very large. Options for handling this:

| Option | Trade-off |
| :--- | :--- |
| **Return all text to browser** | Simple. Fine for short transcripts but could exhaust browser memory for 100 × 1hr videos |
| **Write results back to GCS** | The operation writes each transcript to `gs://bucket/transcripts/video_001.txt`. CyberChef's output is just a list of the written file URIs. Memory-efficient and produces a persistent artefact. |
| **Write to BigQuery** | For very large-scale analysis, writing structured transcripts to BigQuery enables SQL-based querying — but is beyond the scope of CyberChef's current integration. |

**Recommendation:** Offer an `Output Mode` toggle in the operation: `Return to CyberChef` vs. `Write to GCS Path`. The latter should accept a destination bucket/prefix argument.

---

## 5. Proposed Operation Design: `GCloud Speech-to-Text`

### Arguments

| Argument | Type | Description |
| :--- | :--- | :--- |
| Auth Token | `toggleString` | OAuth Bearer token or API Key |
| Quota Project | `string` | GCP Project ID for billing |
| Input Mode | `option` | `Raw Audio (bytes)` \| `GCS URI (gs://...)` |
| Language Code | `string` | e.g., `en-US`, `auto` |
| Output Format | `option` | `Plain Text` \| `Timestamped` \| `JSON` |
| Output Destination | `option` | `Return to CyberChef` \| `Write to GCS Path` |
| Dest GCS Path | `string` | e.g., `gs://my-bucket/transcripts/` (if above is GCS) |
| Max Poll Minutes | `number` | How long to wait for LRO completion (default: 30) |

### Runtime Logic (pseudocode)

```javascript
async run(input, args) {
    const isGcsUri = input.trim().startsWith("gs://");

    if (isGcsUri) {
        // 1. Call longrunningrecognize with gcsUri
        const operationId = await startLongRunningJob(input, args);
        // 2. Poll until done
        const transcript = await pollUntilComplete(operationId, args.maxPollMinutes);
        // 3. Return or write
        if (args.outputDest === "GCS") {
            await writeTranscriptToGCS(transcript, args.destGcsPath, input);
            return `Written to: ${args.destGcsPath}`;
        }
        return transcript;
    } else {
        // Inline bytes: call synchronous recognize endpoint
        const transcript = await recognizeBytes(input, args);
        return transcript;
    }
}
```

---

## 6. Wider Orchestration Patterns

Beyond transcription, the GCS URI pattern enables a broader class of **cloud-native batch operations**:

```
[CyberChef Recipe]

  GCloud List Bucket [gs://intel-bucket/images/]
    → Outputs: gs://...001.jpg \n gs://...002.jpg \n ...
  
  Fork [\n]
  
  GCloud Vision API [Mode: OCR, Input: GCS URI]
    → Each image: extracted text
  
  GCloud Natural Language [Entity Extraction]
    → Entities from each image's text
  
  Merge

  GCloud Gemini [System: "Summarise all intelligence into a SITREP"]
    → Final structured intelligence report
```

This is a powerful capability: **the browser is the recipe engine, Google Cloud is the compute engine.** The browser never holds anything larger than text.

---

## 7. Summary & Recommendations

| Priority | Recommendation |
| :--- | :--- |
| **High** | Implement `GCS URI` detection in all new media API operations so they never stream bytes through the browser |
| **High** | Implement LRO polling with progress indicators for asynchronous operations |
| **High** | Add `GCloud List Bucket` operation to enable self-contained batch orchestration recipes |
| **Medium** | Add `Write to GCS Path` output mode so results persist within the cloud estate |
| **Medium** | Add pre-flight IAM permission checking and cost estimates in the operation UI |
| **Medium** | Document required CORS and service account IAM configs for GCS bucket access |
| **Low** | Explore BigQuery or Pub/Sub integration for very high-volume streaming workflows |

The key architectural principle to embed in all future GCloud CyberChef operations is:

> **"Move the computation to the data, not the data to the computation."**

If the data is already in Google Cloud, CyberChef should orchestrate cloud-side processing and only receive the distilled intelligence result.
