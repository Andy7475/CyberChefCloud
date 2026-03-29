/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, generateGCSDestinationUri, writeGCSText, gcpFetch } from "../lib/GoogleCloud.mjs";


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
            "Analyzes images using the Google Cloud Vision API to detect faces, landmarks, logos, and explicit content.",
            "<br><br>",
            "<b>Inputs:</b> An image file (JPEG, PNG, etc.) or a GCS URI.",
            "<br>",
            "<b>Outputs:</b> A rich JSON format containing all detected image properties and confidence scores.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input an image of the Eiffel Tower, and receive landmark detection data.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
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
