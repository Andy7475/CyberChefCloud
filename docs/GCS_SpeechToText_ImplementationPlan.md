# Implementation Plan: GCS Orchestration & Speech-to-Text

## Background & Goal

We want CyberChef to act as a **cloud-native orchestrator** for processing large media files in GCS without ever streaming raw media bytes through the browser.

**Concrete end-to-end workflow:**

```
Input:  "cyber-chef-cloud-examples"

Recipe:
  1. GCloud List Bucket  [prefix: audio/]
       → gs://cyber-chef-cloud-examples/audio/hello_kitty.mp3
         gs://cyber-chef-cloud-examples/audio/track_02.mp3
         gs://cyber-chef-cloud-examples/audio/track_03.mp3
         gs://cyber-chef-cloud-examples/audio/track_04.mp3

  2. Fork [\n]

  3. GCloud Speech to Text  [Output: Return to CyberChef  |OR|  Write to GCS]
       → Browser mode:  "The package will be delivered at 1400..."
       → GCS mode:      gs://cyber-chef-cloud-examples/output/audio/hello_kitty.mp3/speech-to-text/text.txt

  4. Merge
```

**Key principle:** raw audio never touches the browser — GCS URI is passed in, transcript text (or a GCS output URI) comes back.

---

## Design Decisions

- **LRO polling: internal** — the `GCloud Speech to Text` operation polls internally (every 10 seconds, up to 30 minutes max), updating the output box with progress. No separate "Poll Operation" step needed.
- **Output path convention:** `output/{media_type}/{source_filename}/{service}/text.txt`  
  e.g. `gs://cyber-chef-cloud-examples/output/audio/hello_kitty.mp3/speech-to-text/text.txt`

---

## 1. Shared Library Changes

**File:** `src/core/lib/GoogleCloud.mjs`

### New helper: `listGCSBucket`

```
listGCSBucket(bucket, prefix, authType, authStringObj, quotaProject)

Calls: GET https://storage.googleapis.com/storage/v1/b/{bucket}/o?prefix={prefix}
Returns: array of { name, gs_uri, size, contentType }
```

### New helper: `readGCSFile`

```
readGCSFile(gcsUri, authType, authStringObj, quotaProject)

Parses gs://bucket/object
Calls: GET https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encodedObject}?alt=media
Returns: ArrayBuffer (raw bytes)
```

### New helper: `pollLongRunningOperation`

```
pollLongRunningOperation(operationName, authString, quotaProject, maxMs, intervalMs, onProgress)

Calls: GET https://speech.googleapis.com/v1/operations/{operationName}  every intervalMs
Calls onProgress(elapsedSeconds) on each tick (for progress output to CyberChef output box)
Resolves when response.done === true
Rejects on timeout or API error
Defaults: poll every 10s, timeout after 30 mins
```

---

## 2. New Operation: `GCloud List Bucket`

**File:** `src/core/operations/GCloudListBucket.mjs`

| Property | Value |
| :--- | :--- |
| Name | `GCloud List Bucket` |
| Module | `Cloud` |
| Input Type | `string` (bucket name or `gs://` prefix) |
| Output Type | `string` |
| `manualBake` | `true` |

**Arguments:**

| # | Name | Type | Default |
| :--- | :--- | :--- | :--- |
| 0 | Folder Prefix | `string` | `audio/` |
| 1 | Output Format | `option` | `GCS URIs (one per line)` / `Filenames only` / `JSON` |
| 2–4 | *(GCP_AUTH_ARGS)* | — | — |

**Behaviour:**
- Strips `gs://` prefix from input to normalise bucket name
- Default output = newline-separated `gs://` URIs → directly pipe into `Fork`

---

## 3. New Operation: `GCloud Read File`

**File:** `src/core/operations/GCloudReadFile.mjs`

| Property | Value |
| :--- | :--- |
| Name | `GCloud Read File` |
| Module | `Cloud` |
| Input Type | `string` (`gs://` URI) |
| Output Type | `ArrayBuffer` |
| `manualBake` | `true` |

**Arguments:**

| # | Name | Type |
| :--- | :--- | :--- |
| 0–2 | *(GCP_AUTH_ARGS)* | — |

> **Note:** Intended for small files (text, small images). For large audio/video, use the GCS URI mode in Speech-to-Text directly — don't stream large binaries through the browser.

---

## 4. New Operation: `GCloud Speech to Text`

**File:** `src/core/operations/GCloudSpeechToText.mjs`

| Property | Value |
| :--- | :--- |
| Name | `GCloud Speech to Text` |
| Module | `Cloud` |
| Input Type | `string` |
| Output Type | `string` |
| `manualBake` | `true` |

**Arguments:**

| # | Name | Type | Default |
| :--- | :--- | :--- | :--- |
| 0 | Input Mode | `option` | `GCS URI (gs://...)` / `Raw Audio Bytes (Base64)` |
| 1 | Language Code | `string` | `en-US` |
| 2 | Output Destination | `option` | `Return to CyberChef` / `Write to GCS` |
| 3 | Output GCS Bucket | `string` | `cyber-chef-cloud-examples` |
| 4 | Max Poll Minutes | `number` | `30` |
| 5–7 | *(GCP_AUTH_ARGS)* | — | — |

**Runtime Logic:**

```
IF Input Mode == "GCS URI":
    Call longrunningrecognize with { audio: { uri: input }, config: { languageCode } }
    → Get operationName
    transcript = await pollLongRunningOperation(operationName, ...)
    (progress updates written to output box during polling)

ELSE (Raw Audio Bytes / Base64):
    Call recognize with { audio: { content: base64Input }, config: { languageCode } }
    transcript = joined results

IF Output Destination == "Write to GCS":
    sourceFilename = last path segment of input gs:// URI (e.g. "hello_kitty.mp3")
    destPath = "output/audio/{sourceFilename}/speech-to-text/text.txt"
    PUT transcript → gs://{outputBucket}/{destPath}
    return "gs://{outputBucket}/{destPath}"   ← this is the CyberChef output

ELSE:
    return transcript text
```

**Output path example:**
```
Input:   gs://cyber-chef-cloud-examples/audio/hello_kitty.mp3
Output:  gs://cyber-chef-cloud-examples/output/audio/hello_kitty.mp3/speech-to-text/text.txt
```

After Fork + Merge across 4 files, the CyberChef output will be 4 GCS URIs the analyst can save, come back to later, and use as the input to a new recipe.

---

## 5. Tests

**File:** `tests/browser/03_cloud_ops.js`

Following the existing pattern (skippable via missing token):

| Test | Type |
| :--- | :--- |
| `GCloud List Bucket: Missing Key Validation` | No API call |
| `GCloud List Bucket: Lists audio/ files from cyber-chef-cloud-examples` | Live, skippable |
| `GCloud Speech-to-Text: GCS URI returns transcription in browser` | Live + LRO, skippable |
| `GCloud Speech-to-Text: GCS URI writes to output/ bucket` | Live + LRO + GCS write, skippable |

---

## 6. Verification Plan

### Automated
```bash
# From /home/projects/CyberChefCloud
CYBERCHEF_GCP_TEST_TOKEN=$(gcloud auth print-access-token) npm run test:browser
```

### Manual
1. Open CyberChef at `http://localhost:8080`
2. Add **GCloud List Bucket**, input `cyber-chef-cloud-examples`, prefix `audio/`
3. Bake → confirm 4 `gs://` URIs in output
4. Add **Fork** `[\n]` + **GCloud Speech to Text** (GCS URI, Return to CyberChef) + **Merge**
5. Bake → confirm 4 transcripts separated by `---`
6. Repeat with **Write to GCS** mode
7. Verify in terminal: `gsutil cat gs://cyber-chef-cloud-examples/output/audio/hello_kitty.mp3/speech-to-text/text.txt`
