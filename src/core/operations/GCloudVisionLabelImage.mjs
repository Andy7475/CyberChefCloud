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
 * @param {string} bucket
 * @param {string} objectPath
 * @param {string} content
 * @returns {Promise<string>}
 */
async function writeGCSText(bucket, objectPath, content) {
    const encodedObject = encodeURIComponent(objectPath).replace(/%2F/g, "%2F");
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodedObject}`;
    const headers = new Headers();
    headers.set("Content-Type", "text/plain; charset=utf-8");
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
 * Converts ArrayBuffer to base64.
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
        method: "POST", headers: authed.headers, body, mode: "cors", cache: "no-cache"
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
 * Fetches an image from GCS.
 * @param {string} gcsUri
 * @returns {Promise<{buffer: ArrayBuffer}>}
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
    return { buffer: await response.arrayBuffer() };
}

/**
 * GCloud Vision Label Image operation
 */
class GCloudVisionLabelImage extends Operation {

    /**
     * GCloudVisionLabelImage constructor
     */
    constructor() {
        super();

        this.name = "GCloud Vision Label Image";
        this.module = "Cloud";
        this.description = [
            "Calls the <b>Google Cloud Vision API</b> to identify labels (objects, scenes, activities) ",
            "and physical objects in an image and returns a clean, human-readable list.",
            "<br><br>",
            "This is the 'describe this image' and 'list objects' ingredient. ",
            "Unlike <i>GCloud Vision Analyze</i>, it strips out the raw JSON and gives you a ",
            "simple flat list, ready for display, further text processing, or saving to a file.",
            "<br><br>",
            "<b>Features used:</b>",
            "<ul>",
            "<li><code>LABEL_DETECTION</code> — General descriptors (scenes, themes, activities)</li>",
            "<li><code>OBJECT_LOCALIZATION</code> — Physical objects with location info</li>",
            "</ul>",
            "<b>Output Formats:</b>",
            "<ul>",
            "<li><b>List</b> — One label per line with confidence score</li>",
            "<li><b>CSV</b> — type,description,confidence</li>",
            "<li><b>JSON</b> — Compact structured array</li>",
            "</ul>",
            "<br>",
            "Requires prior <code>Authenticate Google Cloud</code> operation.",
        ].join("");
        this.infoURL = "https://cloud.google.com/vision/docs/labels";
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
                "name": "Detect Labels",
                "type": "boolean",
                "value": true
            },
            {
                "name": "Detect Objects (with location)",
                "type": "boolean",
                "value": true
            },
            {
                "name": "Output Format",
                "type": "option",
                "value": ["List", "CSV", "JSON"]
            },
            {
                "name": "Min Confidence (0-1)",
                "type": "number",
                "value": 0.5
            },
            {
                "name": "Max Results",
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
            inputMode, detectLabels, detectObjects, outputFormat,
            minConfidence, maxResults, outputDest, outputDirectory
        ] = args;

        const features = [];
        if (detectLabels) features.push({ type: "LABEL_DETECTION", maxResults });
        if (detectObjects) features.push({ type: "OBJECT_LOCALIZATION", maxResults });
        if (features.length === 0) throw new OperationError("Please enable at least one detection type (Labels or Objects).");

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

        // Aggregate results into a common shape: { type, description, confidence }
        const results = [];

        if (visionResponse.labelAnnotations) {
            for (const label of visionResponse.labelAnnotations) {
                const conf = label.score ?? 0;
                if (conf >= minConfidence) {
                    results.push({ type: "Label", description: label.description || "", confidence: conf });
                }
            }
        }
        if (visionResponse.localizedObjectAnnotations) {
            for (const obj of visionResponse.localizedObjectAnnotations) {
                const conf = obj.score ?? 0;
                if (conf >= minConfidence) {
                    results.push({ type: "Object", description: obj.name || "", confidence: conf });
                }
            }
        }

        // Sort by confidence descending
        results.sort((a, b) => b.confidence - a.confidence);

        if (results.length === 0) {
            return `(No labels or objects detected with confidence >= ${minConfidence})`;
        }

        let output;
        switch (outputFormat) {
            case "CSV":
                output = "type,description,confidence\n" +
                    results.map(r => `${r.type},${r.description},${r.confidence.toFixed(4)}`).join("\n");
                break;
            case "JSON":
                output = JSON.stringify(results, null, 2);
                break;
            default: // List
                output = results
                    .map(r => `[${r.type.padEnd(6)}] ${r.description} (${Math.round(r.confidence * 100)}%)`)
                    .join("\n");
                break;
        }

        if (outputDest === "Write to GCS") {
            const ext = outputFormat === "JSON" ? ".json" : ".txt";
            const virtualInputUri = gcsUri || "gs://upload/image.jpg";
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_vision_labels", ext);
            await writeGCSText(dest.bucket, dest.objectPath, output);
            return dest.gcsUri;
        }

        return output;
    }

}

export default GCloudVisionLabelImage;
