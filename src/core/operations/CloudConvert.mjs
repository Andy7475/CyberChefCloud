/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { getGcpCredentials, generateGCSDestinationUri } from "../lib/GoogleCloud.mjs";

/* eslint-disable camelcase */

/**
 * Cloud Convert operation
 */
class CloudConvert extends Operation {

    /**
     * CloudConvert constructor
     */
    constructor() {
        super();

        this.name = "Cloud Convert";
        this.module = "Cloud";
        this.description = "Converts files between different formats via CloudConvert proxy on Google Cloud Run.";
        this.infoURL = "https://cloudconvert.com/";
        this.inputType = "ArrayBuffer";
        this.outputType = "ArrayBuffer";
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Format",
                "type": "editableOption",
                "value": [
                    { name: "pdf", value: "pdf" },
                    { name: "png", value: "png" },
                    { name: "jpg", value: "jpg" },
                    { name: "docx", value: "docx" },
                    { name: "txt", value: "txt" },
                    { name: "csv", value: "csv" },
                    { name: "wav", value: "wav" },
                    { name: "mp4", value: "mp4" }
                ]
            },
            {
                "name": "Output Format",
                "type": "editableOption",
                "value": [
                    { name: "pdf", value: "pdf" },
                    { name: "png", value: "png" },
                    { name: "jpg", value: "jpg" },
                    { name: "docx", value: "docx" },
                    { name: "txt", value: "txt" },
                    { name: "csv", value: "csv" },
                    { name: "wav", value: "wav" },
                    { name: "mp4", value: "mp4" }
                ]
            },
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["Browser (Bytes)", "GCS URI (gs://...)"]
            },
            {
                "name": "Output Destination",
                "type": "option",
                "value": ["Return to CyberChef", "Write to GCS"]
            },
            {
                "name": "Output Directory",
                "type": "string",
                "value": ""
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string|ArrayBuffer}
     */
    async run(input, args) {
        const [inputType, outputType, inputMode, outputDestination, outputDirectory] = args;

        if (!inputType || !outputType) {
            throw new OperationError("Cloud Convert: Both Input Format and Output Format must be specified.");
        }

        const creds = getGcpCredentials();
        if (!creds || !creds.authString) {
            throw new OperationError("Cloud Convert: Please run 'Authenticate Google Cloud' first.");
        }

        const requestPayload = {
            input_type: inputType.toLowerCase(),
            output_type: outputType.toLowerCase(),
            source: inputMode === "Browser (Bytes)" ? "bytes" : "gcs",
            destination: outputDestination === "Return to CyberChef" ? "bytes" : "gcs"
        };

        // Construct source payload
        let dummyUriForGeneration = `gs://unknown-bucket/converted_file.${inputType}`;
        if (requestPayload.source === "bytes") {
            const bytes = new Uint8Array(input);
            if (bytes.length === 0) {
                throw new OperationError("Cloud Convert: Input is empty.");
            }
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            requestPayload.file_data = btoa(binary);
        } else {
            const inputUri = new TextDecoder("utf-8", { fatal: false }).decode(input).trim();
            if (!inputUri.startsWith("gs://")) {
                throw new OperationError("Cloud Convert: Input Mode is 'GCS URI' but the input does not start with gs://");
            }
            dummyUriForGeneration = inputUri;
            const match = inputUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
            if (!match) throw new OperationError(`Cloud Convert: Invalid GCS URI: ${inputUri}`);
            requestPayload.input_bucket = match[1];
            requestPayload.input_file_name = match[2];
        }

        // Construct destination payload
        if (requestPayload.destination === "gcs") {
            if (requestPayload.source === "bytes" && !outputDirectory.trim()) {
                throw new OperationError("Cloud Convert: When Input Mode is 'Browser (Bytes)' and Output Destination is 'Write to GCS', you must specify an Output Directory (e.g., gs://my-bucket/outputs/)");
            }
            const dest = generateGCSDestinationUri(dummyUriForGeneration, outputDirectory, "_converted", requestPayload.output_type);
            requestPayload.output_bucket = dest.bucket;
            requestPayload.output_file_name = dest.objectPath;
        }

        const url = "https://cyber-chef-cloud-convert-593556123914.europe-west2.run.app";

        try {
            const response = await fetch(url, {
                method: "POST",
                mode: "cors",
                cache: "no-cache",
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Authorization": `Bearer ${creds.authString}`
                },
                body: JSON.stringify(requestPayload)
            });

            const rawText = await response.text();
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (e) {
                data = { error: rawText };
            }

            if (!response.ok) {
                throw new OperationError(data?.error || response.statusText);
            }

            if (requestPayload.destination === "bytes") {
                if (!data.file_data) {
                    throw new OperationError("Cloud Convert: Expected file_data in response but got nothing.");
                }
                const binaryStr = atob(data.file_data);
                const resultBytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    resultBytes[i] = binaryStr.charCodeAt(i);
                }
                return resultBytes.buffer;
            } else {
                return `gs://${requestPayload.output_bucket}/${requestPayload.output_file_name}`;
            }

        } catch (e) {
            throw new OperationError(`Cloud Convert request failed: ${e.message}`);
        }
    }

}

export default CloudConvert;
