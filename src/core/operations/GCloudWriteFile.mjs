/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, getGcpCredentials, writeGCSBytes } from "../lib/GoogleCloud.mjs";


/**
 * Common MIME types grouped for the dropdown, ordered by likelihood of use.
 * The first value is the default.
 */
const MIME_TYPES = [
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
            "Writes the current data (text or binary) to a file in ",
            "<b>Google Cloud Storage</b> and returns the <code>gs://</code> URI of ",
            "the written file.",
            "<br><br>",
            "<b>Destination GCS URI</b> — full object path including filename, e.g. ",
            "<code>gs://my-bucket/output/report.json</code>. ",
            "You can use a CyberChef <code>Register</code> expression here to dynamically ",
            "build the path from a previous step's output (e.g. capturing the URI from ",
            "<code>GCloud Read File</code>).",
            "<br><br>",
            "<b>MIME / Content Type</b> — the <code>Content-Type</code> uploaded with the object. ",
            "Select from the list or type a custom value.",
            "<br><br>",
            "<b>Output</b> — the <code>gs://</code> URI of the uploaded object, which can be ",
            "piped into further operations (e.g. <code>GCloud Natural Language</code> or ",
            "<code>GCloud Speech to Text</code> via their GCS URI input mode).",
            "<br><br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation.",
        ].join("");
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
        const [destUri, mimeType] = args;

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
