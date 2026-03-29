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
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodedObject}?alt=media`;

    const headers = new Headers();
    const authed = applyGCPAuth(url, headers);

    const response = await fetch(authed.url, { method: "GET", headers: authed.headers, mode: "cors", cache: "no-cache" });
    if (!response.ok) {
        let msg = response.statusText;
        try {
            const d = await response.json();
            msg = d?.error?.message || msg;
        } catch (e) {
            /* ignore */
        }
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
            "Reads the contents of a file from Google Cloud Storage (GCS).",
            "<br><br>",
            "<b>Inputs:</b> A Google Cloud Storage URI (e.g. <code>gs://my-bucket/file.txt</code>).",
            "<br>",
            "<b>Outputs:</b> The raw binary or text data of the file.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input: <code>gs://my-bucket/data.csv</code> -> Output: The CSV file contents.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
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
