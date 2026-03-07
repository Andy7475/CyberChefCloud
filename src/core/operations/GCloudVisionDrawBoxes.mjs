/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, generateGCSDestinationUri } from "../lib/GoogleCloud.mjs";

/**
 * Fetches an image from a GCS URI and returns its raw bytes as an ArrayBuffer.
 *
 * @param {string} gcsUri - The gs:// URI of the image.
 * @returns {Promise<{buffer: ArrayBuffer, contentType: string}>}
 */
async function fetchGCSImage(gcsUri) {
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
 * Uploads an image (ArrayBuffer) to a GCS URI.
 *
 * @param {string} bucket
 * @param {string} objectPath
 * @param {ArrayBuffer} imageBuffer
 * @param {string} contentType
 * @returns {Promise<string>} The gs:// URI of the written file.
 */
async function writeGCSImage(bucket, objectPath, imageBuffer, contentType) {
    const encodedObject = encodeURIComponent(objectPath).replace(/%2F/g, "%2F");
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodedObject}`;
    const headers = new Headers();
    headers.set("Content-Type", contentType || "image/jpeg");
    const authed = applyGCPAuth(url, headers);
    const response = await fetch(authed.url, {
        method: "POST",
        headers: authed.headers,
        body: imageBuffer,
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
 * Calls the Vision API annotateImage endpoint.
 *
 * @param {string} imageBase64 - Base64-encoded image content.
 * @param {Array<{type: string, maxResults?: number}>} features - Vision feature list.
 * @returns {Promise<Object>} The annotateImage response object.
 */
async function callVisionAnnotate(imageBase64, features) {
    const url = "https://vision.googleapis.com/v1/images:annotate";
    const headers = new Headers();
    headers.set("Content-Type", "application/json; charset=utf-8");
    const authed = applyGCPAuth(url, headers);

    const body = JSON.stringify({
        requests: [{
            image: { content: imageBase64 },
            features
        }]
    });

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
 * Converts an ArrayBuffer to a base64 string.
 * Works in Web Worker context using Uint8Array.
 *
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
 * Draws bounding boxes on an image using OffscreenCanvas.
 * Falls back to a text summary if OffscreenCanvas is unavailable.
 *
 * @param {ArrayBuffer} imageBuffer - The raw image bytes.
 * @param {string} contentType - MIME type (e.g. image/jpeg).
 * @param {Array<{box: {left,top,width,height}, label: string, colour: string}>} annotations
 * @returns {Promise<ArrayBuffer>} Annotated image as ArrayBuffer.
 */
async function drawBoundingBoxes(imageBuffer, contentType, annotations) {
    // OffscreenCanvas + createImageBitmap are available in modern Web Workers
    if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
        throw new OperationError("GCloud Vision Draw Boxes: OffscreenCanvas is not available in this browser's Web Worker environment. Try a Chromium-based browser.");
    }

    const blob = new Blob([imageBuffer], { type: contentType });
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);

    const LINE_WIDTH = Math.max(2, Math.round(Math.min(bitmap.width, bitmap.height) / 300));
    const FONT_SIZE = Math.max(12, Math.round(Math.min(bitmap.width, bitmap.height) / 60));
    ctx.lineWidth = LINE_WIDTH;
    ctx.font = `bold ${FONT_SIZE}px sans-serif`;

    for (const ann of annotations) {
        const { box, label, colour } = ann;
        ctx.strokeStyle = colour || "#00FF00";
        ctx.fillStyle = colour || "#00FF00";
        ctx.strokeRect(box.left, box.top, box.width, box.height);

        // Label background
        const textWidth = ctx.measureText(label).width;
        const textH = FONT_SIZE + 4;
        ctx.fillRect(box.left, box.top - textH, textWidth + 4, textH);
        ctx.fillStyle = "#000000";
        ctx.fillText(label, box.left + 2, box.top - 3);
    }

    // Output as JPEG for broad compatibility (OffscreenCanvas.convertToBlob)
    const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    return await outBlob.arrayBuffer();
}

/**
 * Parses normalized vertices from a Vision API bounding poly into pixel coords.
 *
 * @param {Object} poly - normalizedBoundingPoly or boundingPoly.
 * @param {boolean} normalized - If true, vertices are 0-1 ratios, else pixels.
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {{left, top, width, height}}
 */
function polyToBox(poly, normalized, imgWidth, imgHeight) {
    const verts = poly?.normalizedVertices || poly?.vertices || [];
    if (!verts.length) return null;
    const xs = verts.map(v => (normalized ? (v.x || 0) * imgWidth : (v.x || 0)));
    const ys = verts.map(v => (normalized ? (v.y || 0) * imgHeight : (v.y || 0)));
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return { left, top, width: right - left, height: bottom - top };
}

/**
 * GCloud Vision Draw Bounding Boxes operation
 */
class GCloudVisionDrawBoxes extends Operation {

    /**
     * GCloudVisionDrawBoxes constructor
     */
    constructor() {
        super();

        this.name = "GCloud Vision Draw Bounding Boxes";
        this.module = "Cloud";
        this.description = [
            "Analyses an image with the <b>Google Cloud Vision API</b> and returns the image ",
            "with bounding boxes and labels drawn on it. ",
            "Ideal for visually verifying what the Vision API detects in an image.",
            "<br><br>",
            "<b>Browser Upload mode:</b> Provide raw image bytes (from a <code>Load File</code> operation). ",
            "The image is Base64-encoded in the browser and sent directly to the Vision API.",
            "<br><br>",
            "<b>GCS URI mode:</b> Provide a <code>gs://</code> URI. The image is fetched from Google Cloud ",
            "Storage, analysed, and returned annotated.",
            "<br><br>",
            "<b>Detection Type:</b> Choose <em>Objects</em> (localizedObjectAnnotations), ",
            "<em>Faces</em> (faceAnnotations), or <em>Text</em> (textAnnotations).",
            "<br><br>",
            "The annotated image is returned as binary image data to CyberChef, ",
            "or optionally written to GCS.",
            "<br><br>",
            "Requires prior <code>Authenticate Google Cloud</code> operation.",
        ].join("");
        this.infoURL = "https://cloud.google.com/vision/docs/reference/rest/v1/images/annotate";
        this.inputType = "ArrayBuffer";
        this.outputType = "ArrayBuffer";
        this.presentType = "html";
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["Browser Upload (Raw Image Bytes)", "GCS URI (gs://...)"]
            },
            {
                "name": "Detection Type",
                "type": "option",
                "value": ["Objects", "Faces", "Text", "Objects & Faces", "Objects & Text"]
            },
            {
                "name": "Max Results",
                "type": "number",
                "value": 20
            },
            {
                "name": "Box Colour (hex)",
                "type": "string",
                "value": "#00FF00"
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
     * @returns {ArrayBuffer}
     */
    async run(input, args) {
        const [inputMode, detectionType, maxResults, boxColour, outputDest, outputDirectory] = args;

        let imageBuffer;
        let contentType = "image/jpeg";
        let gcsUri = null;

        if (inputMode === "GCS URI (gs://...)") {
            const uri = new TextDecoder().decode(input).trim();
            if (!uri.startsWith("gs://")) throw new OperationError("Input Mode is GCS URI but input does not start with gs://");
            gcsUri = uri;
            const fetched = await fetchGCSImage(gcsUri);
            imageBuffer = fetched.buffer;
            contentType = fetched.contentType;
        } else {
            if (!input || input.byteLength === 0) throw new OperationError("No image data provided. Pipe raw image bytes into this operation.");
            imageBuffer = input;
        }

        // Determine Vision API features
        const featureMap = {
            "Objects": [{ type: "OBJECT_LOCALIZATION", maxResults }],
            "Faces": [{ type: "FACE_DETECTION", maxResults }],
            "Text": [{ type: "TEXT_DETECTION", maxResults }],
            "Objects & Faces": [{ type: "OBJECT_LOCALIZATION", maxResults }, { type: "FACE_DETECTION", maxResults }],
            "Objects & Text": [{ type: "OBJECT_LOCALIZATION", maxResults }, { type: "TEXT_DETECTION", maxResults }],
        };
        const features = featureMap[detectionType] || featureMap.Objects;

        const imageBase64 = arrayBufferToBase64(imageBuffer);
        const visionResponse = await callVisionAnnotate(imageBase64, features);

        // Collect annotations from the response
        const annotations = [];

        // Get image dimensions for normalized vertex calculations
        // We must decode the image to get width/height - use createImageBitmap if available
        let imgWidth = 1, imgHeight = 1;
        if (typeof createImageBitmap !== "undefined") {
            const blob = new Blob([imageBuffer], { type: contentType });
            const bm = await createImageBitmap(blob);
            imgWidth = bm.width;
            imgHeight = bm.height;
            bm.close();
        }

        // Objects (normalized bounding polys)
        if (visionResponse.localizedObjectAnnotations) {
            for (const obj of visionResponse.localizedObjectAnnotations) {
                const box = polyToBox(obj.boundingPoly, true, imgWidth, imgHeight);
                if (box) {
                    const score = obj.score ? ` ${Math.round(obj.score * 100)}%` : "";
                    annotations.push({ box, label: `${obj.name}${score}`, colour: boxColour });
                }
            }
        }

        // Faces (pixel bounding polys)
        if (visionResponse.faceAnnotations) {
            for (const face of visionResponse.faceAnnotations) {
                const box = polyToBox(face.boundingPoly, false, imgWidth, imgHeight);
                if (box) {
                    const det = face.detectionConfidence ? ` ${Math.round(face.detectionConfidence * 100)}%` : "";
                    annotations.push({ box, label: `Face${det}`, colour: "#FF4444" });
                }
            }
        }

        // Text (pixel bounding polys - use the first full-text block)
        if (visionResponse.textAnnotations && visionResponse.textAnnotations.length > 1) {
            // Skip index 0 (full document text), iterate individual word/block blocks
            for (const text of visionResponse.textAnnotations.slice(1)) {
                const box = polyToBox(text.boundingPoly, false, imgWidth, imgHeight);
                if (box) {
                    annotations.push({ box, label: text.description || "Text", colour: "#4488FF" });
                }
            }
        }

        if (annotations.length === 0) {
            throw new OperationError("GCloud Vision: No annotations found in the image for the selected detection type.");
        }

        const annotatedBuffer = await drawBoundingBoxes(imageBuffer, contentType, annotations);

        if (outputDest === "Write to GCS") {
            const virtualInputUri = gcsUri || "gs://upload/image.jpg";
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_vision_boxes", ".jpg");
            await writeGCSImage(dest.bucket, dest.objectPath, annotatedBuffer, "image/jpeg");
            return new TextEncoder().encode(dest.gcsUri).buffer;
        }

        return annotatedBuffer;
    }

    /**
     * Presents the output ArrayBuffer as an inline image in the browser.
     * @param {ArrayBuffer} data
     * @returns {string} HTML img tag
     */
    present(data) {
        if (!data || data.byteLength === 0) return "";
        const bytes = new Uint8Array(data);
        // Detect if it's a GCS URI string (text) rather than image bytes
        const textDec = new TextDecoder();
        const text = textDec.decode(new Uint8Array(data.slice(0, 10)));
        if (text.startsWith("gs://")) {
            return `<p>Written to GCS: <code>${textDec.decode(data)}</code></p>`;
        }
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        return `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%;height:auto;" alt="Annotated image" />`;
    }

}

export default GCloudVisionDrawBoxes;
