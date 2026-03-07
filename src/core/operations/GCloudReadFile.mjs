/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth } from "../lib/GoogleCloud.mjs";

/**
 * Downloads a file from GCS and returns its raw bytes.
 *
 * @param {string} gcsUri - Full gs:// URI of the file.
 * @returns {Promise<ArrayBuffer>} Raw file bytes.
 */
async function readGCSFile(gcsUri) {
    const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new OperationError(`GCloud Read File: Invalid GCS URI: ${gcsUri}`);
    const [, bucket, object] = match;
    const encodedObject = encodeURIComponent(object).replace(/%2F/g, "%2F");
    let url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodedObject}?alt=media`;

    const headers = new Headers();
    const authed = applyGCPAuth(url, headers);

    const response = await fetch(authed.url, { method: "GET", headers: authed.headers, mode: "cors", cache: "no-cache" });
    if (!response.ok) {
        let msg = response.statusText;
        try { const d = await response.json(); msg = d?.error?.message || msg; } catch (e) { /* ignore */ }
        throw new OperationError(`GCloud Read File: GCS API Error (${response.status}): ${msg}`);
    }
    return await response.arrayBuffer();
}

/**
 * GCloud Read File operation
 */
class GCloudReadFile extends Operation {

    /**
     * GCloudReadFile constructor
     */
    constructor() {
        super();

        this.name = "GCloud Read File";
        this.module = "Cloud";
        this.description = [
            "Downloads a file from Google Cloud Storage and returns its raw bytes.",
            "<br><br>",
            "Input must be a <code>gs://</code> URI (e.g. <code>gs://my-bucket/images/photo.png</code>).",
            "<br><br>",
            "<b>Note:</b> This operation downloads the full file into the browser. ",
            "It is best suited for small files such as text or images. ",
            "For large audio or video files, use the GCS URI input mode within the Speech-to-Text or ",
            "Video Intelligence operations instead — they process the file entirely within Google Cloud.",
        ].join("\n");
        this.infoURL = "https://cloud.google.com/storage/docs/json_api/v1/objects/get";
        this.inputType = "string";
        this.outputType = "ArrayBuffer";
        this.manualBake = true;
        this.args = [];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {ArrayBuffer}
     */
    async run(input, args) {
        const uri = input.trim();
        if (!uri.startsWith("gs://")) {
            throw new OperationError("Input must be a GCS URI starting with gs://");
        }

        try {
            return await readGCSFile(uri);
        } catch (e) {
            if (e.name === "OperationError") throw e;
            throw new OperationError(e.message || e.toString());
        }
    }

}

export default GCloudReadFile;
