/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch } from "../lib/GoogleCloud.mjs";

/**
 * Lists objects in a GCS bucket under a given prefix.
 *
 * @param {string} bucket - The GCS bucket name (without gs://).
 * @param {string} prefix - The folder prefix to filter by (e.g. "audio/").
 * @returns {Promise<Array>} Array of GCS object metadata { name, gs_uri, size, contentType }.
 */
async function listGCSBucket(bucket, prefix) {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
    const params = { fields: "items(name,size,contentType)" };
    if (prefix) params.prefix = prefix;

    let data;
    try {
        data = await gcpFetch(url, { params });
    } catch (e) {
        throw new OperationError(`GCloud List Bucket: ${e.message}`);
    }

    const items = data.items || [];
    return items
        .filter(item => !item.name.endsWith("/")) // exclude folder placeholder objects
        .map(item => ({
            name: item.name,
            gsUri: `gs://${bucket}/${item.name}`,
            size: item.size,
            contentType: item.contentType
        }));
}

/**
 * GCloud List Bucket operation
 */
class GCloudListBucket extends Operation {

    /**
     * GCloudListBucket constructor
     */
    constructor() {
        super();

        this.name = "GCloud List Bucket";
        this.module = "Cloud";
        this.description = [
            "Lists objects within a Google Cloud Storage (GCS) bucket.",
            "<br><br>",
            "<b>Inputs:</b> A GCS bucket URI (e.g. <code>gs://my-bucket/</code>).",
            "<br>",
            "<b>Outputs:</b> A list of file URIs or a JSON array of objects.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input: <code>gs://my-bucket/reports/</code> to list all reports.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/storage/docs/json_api/v1/objects/list";
        this.inputType = "string";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Folder Prefix",
                "type": "string",
                "value": "audio/"
            },
            {
                "name": "Output Format",
                "type": "option",
                "value": ["GCS URIs (one per line)", "Filenames only", "JSON"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [prefix, outputFormat] = args;

        if (!input || !input.trim()) throw new OperationError("Please provide a GCS bucket name.");

        // Normalise: strip gs:// if present, strip trailing slash
        const bucket = input.trim().replace(/^gs:\/\//, "").split("/")[0];

        try {
            const items = await listGCSBucket(bucket, prefix);

            if (items.length === 0) {
                return `No objects found in gs://${bucket}/${prefix || ""}`;
            }

            switch (outputFormat) {
                case "GCS URIs (gs://...)":
                    return items.map(i => `gs://${bucket}/${i.name}`).join("\n");
                case "Filenames only":
                    return items.map(i => i.name.split("/").pop()).join("\n");
                case "JSON":
                    return JSON.stringify(items.map(i => ({
                        name: i.name,
                        size: i.size,
                        updated: i.updated,
                        gsUri: `gs://${bucket}/${i.name}`
                    })), null, 2);
                default: // "GCS URIs (one per line)"
                    return items.map(i => i.gsUri).join("\n");
            }
        } catch (e) {
            if (e.name === "OperationError") throw e;
            throw new OperationError(e.message || e.toString());
        }
    }

}

export default GCloudListBucket;
