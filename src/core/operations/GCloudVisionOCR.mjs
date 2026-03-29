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
 * @param {string[]} languageHints
 * @returns {Promise<Object>}
 */
async function callVisionAnnotate(imageBase64, features, languageHints) {
    const url = "https://vision.googleapis.com/v1/images:annotate";
    const request = {
        image: { content: imageBase64 },
        features,
    };
    if (languageHints && languageHints.length > 0) {
        request.imageContext = { languageHints };
    }

    const data = await gcpFetch(url, {
        method: "POST",
        body: { requests: [request] }
    });

    if (data?.responses?.[0]?.error) {
        const err = data.responses[0].error;
        throw new OperationError(`GCloud Vision OCR API: ${err.message} (code ${err.code})`);
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
        throw new OperationError(`GCloud Vision OCR: GCS fetch error (${response.status}): ${msg}`);
    }
    return { buffer: await response.arrayBuffer() };
}

/**
 * GCloud Vision OCR operation
 */
class GCloudVisionOCR extends Operation {

    /**
     * GCloudVisionOCR constructor
     */
    constructor() {
        super();

        this.name = "GCloud Vision OCR";
        this.module = "Cloud";
        this.description = [
            "Extracts text from images using the Google Cloud Vision API (Optical Character Recognition).",
            "<br><br>",
            "<b>Inputs:</b> An image file (JPEG, PNG, etc.) or a GCS URI.",
            "<br>",
            "<b>Outputs:</b> The plain text extracted from the image.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input a photo of a receipt, output: the textual contents of the receipt.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/vision/docs/ocr";
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
                "name": "OCR Mode",
                "type": "option",
                "value": ["Standard Text (TEXT_DETECTION)", "Dense Document (DOCUMENT_TEXT_DETECTION)"]
            },
            {
                "name": "Language Hints (Optional, comma-separated)",
                "type": "string",
                "value": ""
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
        const [inputMode, ocrMode, languageHintsStr, outputDest, outputDirectory] = args;

        const languageHints = languageHintsStr ?
            languageHintsStr.split(",").map(s => s.trim()).filter(s => s.length > 0) :
            [];

        const featureType = ocrMode.startsWith("Dense") ? "DOCUMENT_TEXT_DETECTION" : "TEXT_DETECTION";
        const features = [{ type: featureType }];

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
        const visionResponse = await callVisionAnnotate(imageBase64, features, languageHints);

        let extractedText = "";

        if (featureType === "DOCUMENT_TEXT_DETECTION") {
            // fullTextAnnotation gives the richest structured result
            extractedText = visionResponse?.fullTextAnnotation?.text || "";

            if (!extractedText && visionResponse?.textAnnotations?.[0]) {
                // Fallback to textAnnotations[0] (full image text)
                extractedText = visionResponse.textAnnotations[0].description || "";
            }
        } else {
            // TEXT_DETECTION — textAnnotations[0] is the full detected text block
            extractedText = visionResponse?.textAnnotations?.[0]?.description || "";
        }

        if (!extractedText) {
            return "(No text detected in the image)";
        }

        if (outputDest === "Write to GCS") {
            const virtualInputUri = gcsUri || "gs://upload/image.jpg";
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_vision_ocr", ".txt");
            await writeGCSText(dest.bucket, dest.objectPath, extractedText);
            return dest.gcsUri;
        }

        return extractedText;
    }

}

export default GCloudVisionOCR;
