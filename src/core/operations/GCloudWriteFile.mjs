/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { getGcpCredentials, writeGCSBytes } from "../lib/GoogleCloud.mjs";
import { resolveMimeType } from "../lib/FileType.mjs";


/**
 * Common MIME types grouped for the dropdown, ordered by likelihood of use.
 * The first value is the default.
 */
const MIME_TYPES = [
    { name: "Auto", value: "Auto" },
    // Text
    { name: "text/plain", value: "text/plain" },
    { name: "text/plain; charset=utf-8", value: "text/plain; charset=utf-8" },
    { name: "text/html; charset=utf-8", value: "text/html; charset=utf-8" },
    { name: "text/csv", value: "text/csv" },
    { name: "text/xml", value: "text/xml" },
    { name: "text/markdown", value: "text/markdown" },
    // Structured data
    { name: "application/json", value: "application/json" },
    { name: "application/xml", value: "application/xml" },
    { name: "application/yaml", value: "application/yaml" },
    { name: "application/pdf", value: "application/pdf" },
    // Images
    { name: "image/png", value: "image/png" },
    { name: "image/jpeg", value: "image/jpeg" },
    { name: "image/gif", value: "image/gif" },
    { name: "image/webp", value: "image/webp" },
    { name: "image/svg+xml", value: "image/svg+xml" },
    { name: "image/tiff", value: "image/tiff" },
    { name: "image/bmp", value: "image/bmp" },
    // Audio
    { name: "audio/mpeg", value: "audio/mpeg" },
    { name: "audio/wav", value: "audio/wav" },
    { name: "audio/ogg", value: "audio/ogg" },
    { name: "audio/flac", value: "audio/flac" },
    { name: "audio/mp4", value: "audio/mp4" },
    { name: "audio/webm", value: "audio/webm" },
    // Video
    { name: "video/mp4", value: "video/mp4" },
    { name: "video/webm", value: "video/webm" },
    { name: "video/ogg", value: "video/ogg" },
    { name: "video/avi", value: "video/avi" },
    // Archives
    { name: "application/zip", value: "application/zip" },
    { name: "application/gzip", value: "application/gzip" },
    { name: "application/x-tar", value: "application/x-tar" },
    // Binary fallback
    { name: "application/octet-stream", value: "application/octet-stream" },
];

/**
 * GCloud Write File operation
 */
class GCloudWriteFile extends Operation {

    /**
     * GCloudWriteFile constructor
     */
    constructor() {
        super();

        this.name = "GCloud Write File";
        this.module = "Cloud";
        this.description = [
            "Writes the input data to a specified Google Cloud Storage (GCS) bucket.",
            "<br><br>",
            "<b>Inputs:</b> The data (file or text) you want to upload.",
            "<br>",
            "<b>Outputs:</b> A success message containing the written GCS URI.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Configure the bucket URI in the arguments, and the input data will be uploaded there.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/storage/docs/json_api/v1/objects/insert";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Destination GCS URI",
                "type": "string",
                "value": "",
                "hint": "gs://bucket/path/filename.ext"
            },
            {
                "name": "MIME / Content Type",
                "type": "editableOption",
                "value": MIME_TYPES,
                "defaultIndex": 0
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [destUri, mimeTypeArg] = args;
        const mimeType = resolveMimeType(input, mimeTypeArg);

        if (!destUri || !destUri.trim()) {
            throw new OperationError("GCloud Write File: 'Destination GCS URI' is required (e.g. gs://bucket/path/file.txt).");
        }

        const uri = destUri.trim();
        const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
        if (!match) {
            throw new OperationError(`GCloud Write File: Invalid destination GCS URI: "${uri}". Must be of the form gs://bucket/object/path.`);
        }
        const [, bucket, objectPath] = match;

        if (!input || input.byteLength === 0) {
            throw new OperationError("GCloud Write File: Input is empty. Nothing to write.");
        }

        const contentType = (mimeType && mimeType.trim()) ? mimeType.trim() : "application/octet-stream";

        const creds = getGcpCredentials();
        if (creds && creds.authType === "API Key") {
            throw new OperationError(
                "GCloud Write File: Writing to Google Cloud Storage requires OAuth 2.0 or Personal Access Token (PAT) authentication. " +
                "API Keys do not have permissions to upload objects. Please update your Authenticate Google Cloud settings."
            );
        }

        try {
            const writtenUri = await writeGCSBytes(bucket, objectPath, input, contentType);
            return writtenUri;
        } catch (e) {
            if (e.name === "OperationError") throw e;
            throw new OperationError(`GCloud Write File: ${e.message || e.toString()}`);
        }
    }

}

export default GCloudWriteFile;
