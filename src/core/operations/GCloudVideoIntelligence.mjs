/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, applyGCPAuth, generateGCSDestinationUri, writeGCSText } from "../lib/GoogleCloud.mjs";
import { toBase64 } from "../lib/Base64.mjs";

/**
 * Polls a Google Cloud long-running operation until it completes.
 *
 * @param {string} operationName - The operation ID
 * @param {string} pollUrl - The base polling URL
 * @param {number} maxMs - Maximum wait time in milliseconds
 * @param {number} intervalMs - Poll interval in milliseconds
 * @returns {Promise<Object>} The completed operation response object.
 */
async function pollLongRunningOperation(operationName, pollUrl, maxMs = 30 * 60 * 1000, intervalMs = 10000) {
    const startTime = Date.now();
    const url = `${pollUrl}${operationName}`;

    while (true) {
        if (Date.now() - startTime > maxMs) {
            throw new OperationError(`GCloud: Operation timed out. Operation ID: ${operationName}`);
        }

        let data;
        try {
            data = await gcpFetch(url);
        } catch (e) {
            throw new OperationError(`GCloud: Operation polling error: ${e.message}`);
        }

        if (data.done) return data;

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

/**
 * GCloud Video Intelligence operation
 */
class GCloudVideoIntelligence extends Operation {

    /**
     * GCloudVideoIntelligence constructor
     */
    constructor() {
        super();

        this.name = "GCloud Video Intelligence";
        this.module = "Cloud";
        this.description = [
            "Analyzes video using the Google Cloud Video Intelligence API.",
            "<br><br>",
            "<b>Inputs:</b> You can provide a GCS URI (<code>gs://...</code>), or a raw video file by loading it into CyberChef.",
            "If providing a raw file, it will be uploaded as Base64. Google Cloud limits Base64 video sizes, so for large videos, use a <code>gs://</code> URI.",
            "<br><br>",
            "If <b>Include Media in Output</b> is checked, the raw video bytes will be embedded in the output JSON. This allows downstream operations (like <code>Play Media with Annotations</code>) to play the video."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/video-intelligence/docs";
        this.inputType = "ArrayBuffer";
        this.outputType = "JSON";
        this.manualBake = true;
        this.args = [
            {
                "name": "Person Detection",
                "type": "boolean",
                "value": true
            },
            {
                "name": "Explicit Content Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Label Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Shot Change Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Speech Transcription",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Speech Language Code",
                "type": "string",
                "value": "en-US"
            },
            {
                "name": "Text Detection",
                "type": "boolean",
                "value": false
            },
            {
                "name": "Include Media in Output",
                "type": "boolean",
                "value": true
            },
            {
                "name": "Output GCS Directory (gs://.../)",
                "type": "string",
                "value": ""
            },
            {
                "name": "Max Poll Minutes",
                "type": "number",
                "value": 30
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {JSON}
     */
    async run(input, args) {
        const [
            personDetection, explicitDetection, labelDetection, shotDetection, speechTranscription, speechLanguageCode, textDetection,
            includeMedia, outputGcsDir, maxPollMinutes
        ] = args;

        if (!input.byteLength) throw new OperationError("No input data provided.");

        let isGcsUri = false;
        let gcsUri = "";
        let base64Media = "";

        // Check if input is a small text string starting with gs://
        if (input.byteLength < 2500) {
            try {
                const decoder = new TextDecoder("utf-8");
                const text = decoder.decode(input).trim();
                if (text.startsWith("gs://")) {
                    isGcsUri = true;
                    gcsUri = text;
                }
            } catch (e) {
                // Not valid text
            }
        }

        const features = [];
        if (personDetection) features.push("PERSON_DETECTION");
        if (explicitDetection) features.push("EXPLICIT_CONTENT_DETECTION");
        if (labelDetection) features.push("LABEL_DETECTION");
        if (shotDetection) features.push("SHOT_CHANGE_DETECTION");
        if (speechTranscription) features.push("SPEECH_TRANSCRIPTION");
        if (textDetection) features.push("TEXT_DETECTION");

        if (features.length === 0) {
            throw new OperationError("Please select at least one detection feature.");
        }

        const url = "https://videointelligence.googleapis.com/v1/videos:annotate";
        const body = { features };

        // Attach videoContext if speech transcription is requested
        if (speechTranscription) {
            body.videoContext = {
                speechTranscriptionConfig: {
                    languageCode: speechLanguageCode || "en-US",
                    enableAutomaticPunctuation: true
                }
            };
        }

        if (isGcsUri) {
            body.inputUri = gcsUri;
        } else {
            // Encode the ArrayBuffer directly to Base64
            const byteArray = new Uint8Array(input);
            base64Media = toBase64(byteArray);
            body.inputContent = base64Media;
        }

        let responseData;
        try {
            responseData = await gcpFetch(url, { method: "POST", body });
        } catch (e) {
            throw new OperationError(`GCloud Video Intelligence: API Error: ${e.message}`);
        }

        const operationName = responseData.name;
        if (!operationName) throw new OperationError("GCloud Video Intelligence: No operation name returned from API.");

        const maxMs = maxPollMinutes * 60 * 1000;
        const POLL_URL = "https://videointelligence.googleapis.com/v1/";
        const completed = await pollLongRunningOperation(operationName, POLL_URL, maxMs, 10000);

        let finalMediaBase64 = null;
        if (includeMedia) {
            if (isGcsUri) {
                // Need to download the GCS file into base64
                finalMediaBase64 = await this._downloadGcsUriAsBase64(gcsUri);
            } else {
                finalMediaBase64 = base64Media;
            }
        }

        // Return a structured JSON containing the results, plus the media
        const outputJson = {
            media: finalMediaBase64,
            mimeType: "video/mp4", // Default fallback, browsers usually detect accurately
            isGcsUri: isGcsUri,
            originalUri: gcsUri,
            annotations: completed.response?.annotationResults?.[0] || {}
        };

        let shouldWriteGcs = false;
        let destBucket, destPath;

        if (isGcsUri) {
            shouldWriteGcs = true;
            const dest = generateGCSDestinationUri(gcsUri, outputGcsDir, "_ccc_video_intel", ".json");
            destBucket = dest.bucket;
            destPath = dest.objectPath;
        } else if (outputGcsDir && outputGcsDir.trim().length > 0) {
            shouldWriteGcs = true;
            const destMatch = outputGcsDir.trim().match(/^gs:\/\/([^/]+)\/?(.*)$/);
            if (!destMatch) throw new OperationError(`Invalid output directory GCS URI: ${outputGcsDir}`);
            destBucket = destMatch[1];
            let prefix = destMatch[2];
            if (prefix && !prefix.endsWith("/")) prefix += "/";
            destPath = `${prefix}video_annotations_${Date.now()}.json`;
        }

        if (shouldWriteGcs) {
            await writeGCSText(destBucket, destPath, JSON.stringify(outputJson), "application/json");
        }

        return outputJson;
    }

    /**
     * Downloads a GCS URI using standard fetch + GCP Auth, and converts to Base64
     * @param {string} uri
     * @returns {Promise<string>}
     */
    async _downloadGcsUriAsBase64(uri) {
        const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
        if (!match) throw new OperationError(`Invalid GCS URI: ${uri}`);

        const bucket = match[1];
        const objectPath = match[2];
        const encodedObject = encodeURIComponent(objectPath).replace(/%2F/g, "%2F");
        const fetchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodedObject}?alt=media`;

        const auth = applyGCPAuth(fetchUrl, new Headers());
        let resp;
        try {
            resp = await fetch(auth.url, { headers: auth.headers });
        } catch (e) {
            throw new OperationError(`Failed to fetch video from GCS: ${e.message}`);
        }

        if (!resp.ok) {
            throw new OperationError(`Failed to fetch video from GCS: ${resp.status} ${resp.statusText}`);
        }

        const arrayBuf = await resp.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuf);
        return toBase64(byteArray);
    }
}

export default GCloudVideoIntelligence;
