/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth, generateGCSDestinationUri, gcpFetch } from "../lib/GoogleCloud.mjs";

/**
 * Writes text content to a GCS object.
 *
 * @param {string} bucket - Destination bucket name (without gs://).
 * @param {string} objectPath - Destination object path within the bucket.
 * @param {string} content - Text content to write.
 * @returns {Promise<string>} The gs:// URI of the written file.
 */
async function writeGCSFile(bucket, objectPath, content) {
    const encodedObject = encodeURIComponent(objectPath).replace(/%2F/g, "%2F");
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodedObject}`;

    const headers = new Headers();
    headers.set("Content-Type", "text/plain; charset=utf-8");
    const authed = applyGCPAuth(url, headers);

    const response = await fetch(authed.url, {
        method: "POST",
        headers: authed.headers,
        body: content,
        mode: "cors",
        cache: "no-cache"
    });
    if (!response.ok) {
        let msg = response.statusText;
        try {
            const d = await response.json();
            msg = d?.error?.message || msg;
        } catch (e) {
            /* ignore */
        }
        throw new OperationError(`GCloud Write File: GCS API Error (${response.status}): ${msg}`);
    }
    return `gs://${bucket}/${objectPath}`;
}

/**
 * Polls a Google Cloud long-running operation until it completes.
 *
 * @param {string} operationName - The operation ID (numeric string from the API response).
 * @param {string} pollUrl - The base polling URL (e.g. https://speech.googleapis.com/v1/operations/).
 * @param {number} maxMs - Maximum wait time in milliseconds (default 30 minutes).
 * @param {number} intervalMs - Poll interval in milliseconds (default 10 seconds).
 * @param {Function} onProgress - Optional callback(elapsedSeconds) called on each poll tick.
 * @returns {Promise<Object>} The completed operation response object.
 */
async function pollLongRunningOperation(operationName, pollUrl, maxMs = 30 * 60 * 1000, intervalMs = 10000, onProgress = null) {
    const startTime = Date.now();
    const url = `${pollUrl}${operationName}`;

    while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxMs) {
            throw new OperationError(`GCloud: Operation timed out after ${Math.round(elapsed / 60000)} minutes. Operation ID: ${operationName}`);
        }

        let data;
        try {
            data = await gcpFetch(url);
        } catch (e) {
            throw new OperationError(`GCloud: Operation polling error: ${e.message}`);
        }

        if (data.done) return data;

        const elapsedSec = Math.round(elapsed / 1000);
        if (onProgress) onProgress(elapsedSec);

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

/**
 * GCloud Speech to Text operation
 */
class GCloudSpeechToText extends Operation {

    /**
     * GCloudSpeechToText constructor
     */
    constructor() {
        super();

        this.name = "GCloud Speech to Text";
        this.module = "Cloud";
        this.description = [
            "Transcribes audio using the Google Cloud Speech-to-Text API.",
            "<br><br>",
            "<b>GCS URI mode (recommended for large files):</b> Input a <code>gs://</code> URI ",
            "(e.g. <code>gs://my-bucket/audio/file.mp3</code>). The audio is processed entirely within ",
            "Google Cloud — the raw audio never passes through the browser. Suitable for files of any size. ",
            "Uses the asynchronous <code>longrunningrecognize</code> API with internal polling.",
            "<br><br>",
            "<b>Raw Audio mode:</b> Provide Base64-encoded audio bytes directly. Only suitable for short ",
            "clips (under ~1 minute). Uses the synchronous <code>recognize</code> API.",
            "<br><br>",
            "<b>Write to GCS mode:</b> Instead of returning the transcript to CyberChef, writes it to a ",
            "structured path in a GCS bucket and returns the destination <code>gs://</code> URI. This is ",
            "ideal for batch processing with Fork — each fork branch writes its transcript and returns a URI, ",
            "which can be saved and used as input to a later recipe.",
            "<br><br>",
            "<b>Output Directory:</b> If left blank, the transcript is written to the same directory as the input file ",
            "but with a <code>_ccc_stt.txt</code> suffix to prevent overwriting. If you provide a <code>gs://</code> URI ",
            "directory, it will write the file there preserving the original filename.",
        ].join("\n");
        this.infoURL = "https://cloud.google.com/speech-to-text/docs/reference/rest";
        this.inputType = "string";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["GCS URI (gs://...)", "Raw Audio Bytes (Base64)"]
            },
            {
                "name": "Language Code",
                "type": "string",
                "value": "en-US"
            },
            {
                "name": "Model",
                "type": "option",
                "value": ["latest_long", "latest_short", "telephony", "medical_dictation", "default"]
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
            },
            {
                "name": "Max Poll Minutes",
                "type": "number",
                "value": 30
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [
            inputMode, languageCode, model, outputDest, outputDirectory, maxPollMinutes
        ] = args;

        const uri = input.trim();
        if (!uri) throw new OperationError("Please provide a GCS URI or Base64 audio input.");

        const maxMs = maxPollMinutes * 60 * 1000;
        let transcript;

        if (inputMode === "GCS URI (gs://...)") {
            if (!uri.startsWith("gs://")) {
                throw new OperationError("Input Mode is set to GCS URI but input does not start with gs://");
            }
            transcript = await this._transcribeGcsUri(uri, languageCode, model, maxMs);
        } else {
            // Raw audio bytes (Base64)
            transcript = await this._transcribeRawAudio(uri, languageCode, model);
        }

        if (outputDest === "Write to GCS") {
            // Generate full destination GCS URI using the core utility
            const virtualInputUri = inputMode === "GCS URI (gs://...)" ? uri : "gs://raw-audio-bucket/raw_audio.raw";
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_stt", ".txt");

            await writeGCSFile(dest.bucket, dest.objectPath, transcript);
            return dest.gcsUri;
        }

        return transcript;
    }

    /**
     * Transcribes audio from a GCS URI using the longrunningrecognize API.
     *
     * @param {string} gcsUri
     * @param {string} languageCode
     * @param {string} model
     * @param {number} maxMs
     * @returns {Promise<string>}
     */
    async _transcribeGcsUri(gcsUri, languageCode, model, maxMs) {
        const url = "https://speech.googleapis.com/v1/speech:longrunningrecognize";
        const body = {
            config: {
                languageCode,
                model,
                enableAutomaticPunctuation: true,
            },
            audio: { uri: gcsUri }
        };

        let responseData;
        try {
            responseData = await gcpFetch(url, { method: "POST", body });
        } catch (e) {
            throw new OperationError(`GCloud Speech to Text: API Error: ${e.message}`);
        }

        const operationName = responseData.name;
        if (!operationName) throw new OperationError("GCloud Speech to Text: No operation name returned from API.");

        // Poll for completion
        const POLL_URL = "https://speech.googleapis.com/v1/operations/";
        const completed = await pollLongRunningOperation(
            operationName,
            POLL_URL,
            maxMs,
            10000,
            (elapsedSec) => {
                // onProgress — not easily surfaced in CyberChef output mid-bake,
                // but available for future UI integration
                void elapsedSec;
            }
        );

        return this._extractTranscript(completed);
    }

    /**
     * Transcribes audio from raw Base64 bytes using the synchronous recognize API.
     *
     * @param {string} base64Audio
     * @param {string} languageCode
     * @param {string} model
     * @returns {Promise<string>}
     */
    async _transcribeRawAudio(base64Audio, languageCode, model) {
        const url = "https://speech.googleapis.com/v1/speech:recognize";
        const body = {
            config: {
                languageCode,
                model,
                enableAutomaticPunctuation: true,
            },
            audio: { content: base64Audio }
        };

        let responseData;
        try {
            responseData = await gcpFetch(url, { method: "POST", body });
        } catch (e) {
            throw new OperationError(`GCloud Speech to Text: API Error: ${e.message}`);
        }

        return this._extractTranscript({ response: responseData });
    }

    /**
     * Extracts a joined transcript string from a completed LRO response or synchronous response.
     *
     * @param {Object} completed - The operation response object.
     * @returns {string} Joined transcript text.
     */
    _extractTranscript(completed) {
        const results = completed?.response?.results;
        if (!results || results.length === 0) {
            return "(No speech detected)";
        }
        return results
            .map(r => r.alternatives?.[0]?.transcript || "")
            .filter(t => t.length > 0)
            .join(" ")
            .trim();
    }

}

export default GCloudSpeechToText;
