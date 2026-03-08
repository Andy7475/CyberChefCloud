/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, writeGCSBytes } from "../lib/GoogleCloud.mjs";

/**
 * Common MIME types grouped for the dropdown, ordered by likelihood of use.
 * The first value is the default.
 */
const MIME_TYPES = [
    // Text
    "text/plain",
    "text/plain; charset=utf-8",
    "text/html; charset=utf-8",
    "text/csv",
    "text/xml",
    "text/markdown",
    // Structured data
    "application/json",
    "application/xml",
    "application/yaml",
    "application/pdf",
    // Images
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/tiff",
    "image/bmp",
    // Audio
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/flac",
    "audio/mp4",
    "audio/webm",
    // Video
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/avi",
    // Archives
    "application/zip",
    "application/gzip",
    "application/x-tar",
    // Binary fallback
    "application/octet-stream",
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
