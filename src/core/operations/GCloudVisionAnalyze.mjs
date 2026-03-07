/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, generateGCSDestinationUri } from "../lib/GoogleCloud.mjs";

/**
 * Writes text content to a GCS object.
 *
 * @param {string} bucket
 * @param {string} objectPath
 * @param {string} content
 * @param {string} contentType
 * @returns {Promise<string>} The gs:// URI of the written file.
 */
async function writeGCSText(bucket, objectPath, content, contentType = "application/json; charset=utf-8") {
    const encodedObject = encodeURIComponent(objectPath).replace(/%2F/g, "%2F");
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodedObject}`;
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    const authed = applyGCPAuth(url, headers);
    const response = await fetch(authed.url, {
        method: "POST",
        headers: authed.headers,
        body: content,
        mode: "cors",
        cache: "no-cache"
    });
    if (!response.ok) {
        let msg = response.statusText;
        try {
            const d = await response.json(); msg = d?.error?.message || msg;
        } catch (e) { /* ignore */ }
        throw new OperationError(`GCloud Vision: GCS write error (${response.status}): ${msg}`);
    }
    return `gs://${bucket}/${objectPath}`;
}

/**
 * Converts an ArrayBuffer to a base64 string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Calls the Vision API annotateImage endpoint.
 *
 * @param {string} imageBase64
 * @param {Array<{type: string, maxResults?: number}>} features
 * @returns {Promise<Object>}
 */
async function callVisionAnnotate(imageBase64, features) {
    const url = "https://vision.googleapis.com/v1/images:annotate";
    const headers = new Headers();
    headers.set("Content-Type", "application/json; charset=utf-8");
    const authed = applyGCPAuth(url, headers);
    const body = JSON.stringify({ requests: [{ image: { content: imageBase64 }, features }] });
    const response = await fetch(authed.url, {
        method: "POST",
        headers: authed.headers,
        body,
        mode: "cors",
        cache: "no-cache"
    });
    let data;
    try {
        data = await response.json();
    } catch (e) {
        throw new OperationError("GCloud Vision: Failed to parse API response.");
    }
    if (!response.ok) {
        const msg = data?.error?.message || response.statusText;
        throw new OperationError(`GCloud Vision: API error (${response.status}): ${msg}`);
    }
    if (data?.responses?.[0]?.error) {
        const err = data.responses[0].error;
        throw new OperationError(`GCloud Vision API: ${err.message} (code ${err.code})`);
    }
    return data.responses[0];
}

/**
 * Fetches an image from a GCS URI and returns its bytes + contentType.
 * @param {string} gcsUri
 * @returns {Promise<{buffer: ArrayBuffer, contentType: string}>}
 */
async function fetchGCSImageBuffer(gcsUri) {
    const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new OperationError(`Invalid GCS URI: ${gcsUri}`);
    const [, bucket, object] = match;
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
    const headers = new Headers();
    const authed = applyGCPAuth(url, headers);
    const response = await fetch(authed.url, { method: "GET", headers: authed.headers, mode: "cors", cache: "no-cache" });
    if (!response.ok) {
        let msg = response.statusText;
        try {
            const d = await response.json(); msg = d?.error?.message || msg;
        } catch (e) { /* ignore */ }
        throw new OperationError(`GCloud Vision: GCS fetch error (${response.status}): ${msg}`);
    }
    const contentType = response.headers.get("Content-Type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    return { buffer, contentType };
}

/**
 * GCloud Vision Analyze operation (raw JSON output)
 */
class GCloudVisionAnalyze extends Operation {

    /**
     * GCloudVisionAnalyze constructor
     */
    constructor() {
        super();

        this.name = "GCloud Vision Analyze";
        this.module = "Cloud";
        this.description = [
            "Runs one or more <b>Google Cloud Vision API</b> feature detections on an image ",
            "and returns the <b>raw JSON response</b>.",
            "<br><br>",
            "Useful for exploring the full depth of the API response before building downstream ",
            "pipeline steps. Select the features you want from the checkboxes — multiple features ",
            "are batched into a single API call.",
            "<br><br>",
            "<b>Available features:</b>",
            "<ul>",
            "<li><code>LABEL_DETECTION</code> — General objects, scenes, and activities</li>",
            "<li><code>OBJECT_LOCALIZATION</code> — Objects with bounding box coordinates</li>",
            "<li><code>FACE_DETECTION</code> — Faces and facial landmarks</li>",
            "<li><code>LANDMARK_DETECTION</code> — Famous landmarks</li>",
            "<li><code>LOGO_DETECTION</code> — Brand logos</li>",
            "<li><code>TEXT_DETECTION</code> — Sparse text (signs, labels)</li>",
            "<li><code>DOCUMENT_TEXT_DETECTION</code> — Dense text / documents</li>",
            "<li><code>SAFE_SEARCH_DETECTION</code> — Adult / violence / racy content scoring</li>",
            "<li><code>IMAGE_PROPERTIES</code> — Dominant colours</li>",
            "<li><code>WEB_DETECTION</code> — Web references and visually similar images</li>",
            "<li><code>CROP_HINTS</code> — Suggested crop regions</li>",
            "</ul>",
            "<br>",
            "<b>Input Mode:</b> Either pipe raw image bytes (e.g. from <code>Load File</code>) ",
            "or input a <code>gs://</code> URI. When in GCS mode, the image is fetched from Cloud ",
            "Storage before being sent to the Vision API.",
        ].join("");
        this.infoURL = "https://cloud.google.com/vision/docs/reference/rest/v1/images/annotate";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["Browser Upload (Raw Image Bytes)", "GCS URI (gs://...)"]
            },
            {
                "name": "Label Detection",
                "type": "boolean",
                "value": true
            },
            {
                "name": "Object Localization",
                "type": "boolean",
                "value": true
            },
            {
                "name": "Face Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Landmark Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Logo Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Text Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Document Text Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Safe Search Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Image Properties",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Web Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Crop Hints",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Max Results Per Feature",
                "type": "number",
                "value": 20
            },
            {
                "name": "Output Destination",
                "type": "option",
                "value": ["Return to CyberChef", "Write to GCS"]
            },
            {
                "name": "Output Directory (Optional)",
                "type": "string",
                "value": ""
            },
            {
                "name": "Quota Project (Optional)",
                "type": "string",
                "value": ""
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [
            inputMode,
            labelDetection, objectLocalization, faceDetection, landmarkDetection,
            logoDetection, textDetection, documentTextDetection, safeSearchDetection,
            imageProperties, webDetection, cropHints,
            maxResults, outputDest, outputDirectory
        ] = args;

        // Build feature list
        const FEATURE_MAP = [
            [labelDetection, "LABEL_DETECTION"],
            [objectLocalization, "OBJECT_LOCALIZATION"],
            [faceDetection, "FACE_DETECTION"],
            [landmarkDetection, "LANDMARK_DETECTION"],
            [logoDetection, "LOGO_DETECTION"],
            [textDetection, "TEXT_DETECTION"],
            [documentTextDetection, "DOCUMENT_TEXT_DETECTION"],
            [safeSearchDetection, "SAFE_SEARCH_DETECTION"],
            [imageProperties, "IMAGE_PROPERTIES"],
            [webDetection, "WEB_DETECTION"],
            [cropHints, "CROP_HINTS"],
        ];
        const features = FEATURE_MAP
            .filter(([enabled]) => enabled)
            .map(([, type]) => ({ type, maxResults }));

        if (features.length === 0) throw new OperationError("Please select at least one Vision API feature to run.");

        let imageBuffer;
        let gcsUri = null;

        if (inputMode === "GCS URI (gs://...)") {
            const uri = new TextDecoder().decode(input).trim();
            if (!uri.startsWith("gs://")) throw new OperationError("Input Mode is GCS URI but input does not start with gs://");
            gcsUri = uri;
            const fetched = await fetchGCSImageBuffer(gcsUri);
            imageBuffer = fetched.buffer;
        } else {
            if (!input || input.byteLength === 0) throw new OperationError("No image data provided.");
            imageBuffer = input;
        }

        const imageBase64 = arrayBufferToBase64(imageBuffer);
        const visionResponse = await callVisionAnnotate(imageBase64, features);
        const jsonStr = JSON.stringify(visionResponse, null, 2);

        if (outputDest === "Write to GCS") {
            const virtualInputUri = gcsUri || "gs://upload/image.jpg";
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_vision_raw", ".json");
            await writeGCSText(dest.bucket, dest.objectPath, jsonStr, "application/json; charset=utf-8");
            return dest.gcsUri;
        }

        return jsonStr;
    }

}

export default GCloudVisionAnalyze;
