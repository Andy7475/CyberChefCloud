/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { resolveMimeType } from "../lib/FileType.mjs";
import { applyGCPAuth, generateGCSDestinationUri, writeGCSBinary, gcpFetch, getGcpCredentials } from "../lib/GoogleCloud.mjs";
import { toBase64, fromBase64 } from "../lib/Base64.mjs";


/**
 * Converts MIME style (image/jpeg) to DLP's ByteContentItem.BytesType enum.
 * @param {string} mimeType
 * @returns {string}
 */
function mapMimeTypeToDlpType(mimeType) {
    const map = {
        "image/jpeg": "IMAGE_JPEG",
        "image/png": "IMAGE_PNG",
        "image/bmp": "IMAGE_BMP",
        "image/svg+xml": "IMAGE_SVG"
    };
    return map[mimeType.toLowerCase()] || "BYTES_TYPE_UNSPECIFIED";
}

/**
 * Fetches an image from GCS.
 * @param {string} gcsUri
 * @returns {Promise<{buffer: ArrayBuffer, mimeType: string}>}
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
        throw new OperationError(`GCS fetch error (${response.status}): ${msg}`);
    }
    
    // Attempt to guess mime type from GCS headers, otherwise fallback
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    return { buffer: await response.arrayBuffer(), mimeType };
}

/**
 * GCloud Redact Image operation
 */
class GCloudRedactImage extends Operation {

    /**
     * GCloudRedactImage constructor
     */
    constructor() {
        super();

        this.name = "GCloud Redact Image";
        this.module = "Cloud";
        this.description = [
            "Redacts sensitive data from images using the Google Cloud Sensitive Data Protection (DLP) API.",
            "By default, redacts matching infoTypes with black rectangles.",
            "<br><br>",
            "<b>Inputs:</b> An image file (JPEG, PNG, BMP, SVG) or a GCS URI.",
            "<br>",
            "<b>Outputs:</b> The redacted image.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input: An image of a receipt -> Output: The image with emails and credit cards blocked out.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/sensitive-data-protection/docs/reference/rest/v2/projects.locations.image/redact";
        this.inputType = "ArrayBuffer";
        this.outputType = "ArrayBuffer";
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["Inline Upload", "GCS URI (gs://...)"]
            },
            {
                "name": "Input MIME Type",
                "type": "editableOption",
                "value": [
                    { name: "Auto", value: "Auto" },
                    { name: "JPEG", value: "image/jpeg" },
                    { name: "PNG", value: "image/png" },
                    { name: "BMP", value: "image/bmp" },
                    { name: "SVG", value: "image/svg+xml" }
                ]
            },
            {
                "name": "InfoTypes to Redact (Optional)",
                "type": "string",
                "value": "",
                "hint": "Comma-separated list (e.g. EMAIL_ADDRESS, CREDIT_CARD_NUMBER). Leave blank for default."
            },
            {
                "name": "Redact All Text",
                "type": "boolean",
                "value": false,
                "hint": "If true, also masks all text found in the image."
            },
            {
                "name": "Output Destination",
                "type": "option",
                "value": ["Return to CyberChef", "Write to GCS"]
            },
            {
                "name": "Output Directory (Optional)",
                "type": "string",
                "value": "",
                "hint": "gs://bucket/path/ — blank = same directory as Input GCS URI."
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {ArrayBuffer} ArrayBuffer of the redacted image or ArrayBuffer of the text of the GCS URI
     */
    async run(input, args) {
        const [
            inputMode,
            mimeTypeArg,
            infoTypesStr,
            redactAllText,
            outputDest,
            outputDirectory
        ] = args;

        const creds = getGcpCredentials();
        if (!creds || !creds.quotaProject) {
            throw new OperationError(
                "GCloud Redact Image: Please run 'Authenticate Google Cloud' first and set a Quota Project."
            );
        }

        let imageBuffer;
        let mimeType;
        let gcsUri = null;

        if (inputMode === "GCS URI (gs://...)") {
            const uri = new TextDecoder().decode(input).trim();
            if (!uri.startsWith("gs://")) throw new OperationError("Input Mode is GCS URI but input does not start with gs://");
            gcsUri = uri;
            const fetched = await fetchGCSImageBuffer(gcsUri);
            imageBuffer = fetched.buffer;
            
            // For GCS, Auto resolution evaluates the fetched buffer. For specific mimetype drop down
            // values, resolveMimeType returns it properly.
            mimeType = resolveMimeType(imageBuffer, mimeTypeArg);
        } else {
            if (!input || input.byteLength === 0) throw new OperationError("No image data provided.");
            imageBuffer = input;
            mimeType = resolveMimeType(input, mimeTypeArg);
        }
        const imageBase64 = toBase64(imageBuffer);
        const dlpBytesType = mapMimeTypeToDlpType(mimeType);

        const project = creds.quotaProject;
        const url = `https://dlp.googleapis.com/v2/projects/${encodeURIComponent(project)}/image:redact`;

        const requestBody = {
            byteItem: {
                type: dlpBytesType,
                data: imageBase64
            }
        };

        const infoTypesFilter = infoTypesStr.split(",")
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => ({ name: s }));

        if (infoTypesFilter.length > 0) {
            requestBody.inspectConfig = {
                infoTypes: infoTypesFilter
            };
            
            requestBody.imageRedactionConfigs = infoTypesFilter.map(infoType => ({
                infoType: infoType
                // default colour is black, so no need to pass redactionColor
            }));
        }

        if (redactAllText) {
            requestBody.imageRedactionConfigs = requestBody.imageRedactionConfigs || [];
            requestBody.imageRedactionConfigs.push({
                redactAllText: true
            });
        }

        let data;
        try {
            data = await gcpFetch(url, {
                method: "POST",
                body: requestBody
            });
        } catch (e) {
            throw new OperationError(`GCloud Redact Image API error: ${e.message}`);
        }

        if (!data.redactedImage) {
            throw new OperationError("GCloud Redact Image returned no image data.");
        }

        const redactedBuffer = new Uint8Array(fromBase64(data.redactedImage, null, "byteArray")).buffer;

        // Get target extension
        let ext = ".jpg";
        if (mimeType.includes("png")) ext = ".png";
        else if (mimeType.includes("bmp")) ext = ".bmp";
        else if (mimeType.includes("svg")) ext = ".svg";

        if (outputDest === "Write to GCS") {
            const virtualInputUri = gcsUri || "gs://upload/image" + ext;
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_redact", ext);
            await writeGCSBinary(dest.bucket, dest.objectPath, redactedBuffer, mimeType);
            return new TextEncoder().encode(dest.gcsUri).buffer;
        }

        return redactedBuffer;
    }

}

export default GCloudRedactImage;
