# Task List: GCS + Speech-to-Text CyberChef Operations

## Phase 1: Planning & Documentation
- [x] Review existing `GoogleTranslate.mjs`, `GoogleCloud.mjs` lib, and `03_cloud_ops.js` patterns
- [x] Write implementation plan (`GCS_SpeechToText_ImplementationPlan.md`)
- [x] Write GCP configuration guide (`GCloudGCSSetup.md`)
- [x] Get user approval on plan — **approved, internal LRO polling confirmed**

## Phase 2: Shared Library Enhancements (`src/core/lib/GoogleCloud.mjs`)
- [ ] Add `listGCSBucket(bucket, prefix, authType, authStringObj, quotaProject)` helper
- [ ] Add `readGCSFile(gcsUri, authType, authStringObj, quotaProject)` helper
- [ ] Add `pollLongRunningOperation(operationName, authString, quotaProject, maxMs, intervalMs, onProgress)` polling helper

## Phase 3: New Operations

### 3.1 `GCloud List Bucket` (`src/core/operations/GCloudListBucket.mjs`)
- [ ] Create operation file scaffolding
- [ ] Args: Bucket Name, Prefix/Folder filter, Auth args, Output Format
- [ ] Calls GCS JSON API: `storage/v1/b/{bucket}/o?prefix=`
- [ ] Default output: newline-separated `gs://` URIs (pipe directly into `Fork`)

### 3.2 `GCloud Read File` (`src/core/operations/GCloudReadFile.mjs`)
- [ ] Create operation file scaffolding
- [ ] Args: Auth args only (input = `gs://` URI)
- [ ] Calls GCS media download endpoint
- [ ] Output: raw file bytes (`ArrayBuffer`)

### 3.3 `GCloud Speech to Text` (`src/core/operations/GCloudSpeechToText.mjs`)
- [ ] Create operation file scaffolding
- [ ] Args: Input Mode, Language Code, Output Destination, Output GCS Bucket, Max Poll Minutes, Auth args
- [ ] GCS URI mode → call `longrunningrecognize` → internal LRO polling loop
- [ ] Raw bytes mode → call synchronous `recognize` endpoint
- [ ] Output mode: `Return to CyberChef` (transcript text) OR `Write to GCS` (returns the written `gs://` URI)
- [ ] GCS output path convention: `output/audio/{filename}/speech-to-text/text.txt`

## Phase 4: Tests (`tests/browser/03_cloud_ops.js`)
- [ ] `GCloud List Bucket: Missing Key Validation` (no API call)
- [ ] `GCloud List Bucket: Lists audio/ files from cyber-chef-cloud-examples` (live, skippable)
- [ ] `GCloud Speech-to-Text: GCS URI mode returns transcription` (live, LRO, skippable)
- [ ] `GCloud Speech-to-Text: GCS URI mode writes to output/ bucket` (live, LRO, skippable)

## Phase 5: Documentation
- [ ] Update `GCloudGCSSetup.md` with any gotchas discovered during testing
