/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, generateGCSDestinationUri, writeGCSText, gcpFetch } from "../lib/GoogleCloud.mjs";


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
    const data = await gcpFetch(url, {
        method: "POST",
        body: { requests: [{ image: { content: imageBase64 }, features }] }
    });

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
            "Classifies images into broad categories/labels using the Google Cloud Vision API.",
            "<br><br>",
            "<b>Inputs:</b> An image file (JPEG, PNG, etc.) or a GCS URI.",
            "<br>",
            "<b>Outputs:</b> A comma-separated list of detected labels or a detailed JSON result.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input a picture of a dog, output: <code>Dog, Pet, Golden Retriever, Animal</code>.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
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
