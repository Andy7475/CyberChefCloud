/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Utils from "../Utils.mjs";
import { toBase64 } from "../lib/Base64.mjs";
import { applyGCPAuth, generateGCSDestinationUri, gcpFetch, googleFetch } from "../lib/GoogleCloud.mjs";

/** The synchronous recognize API accepts at most 10 MB of request and about one minute of audio */
const MAX_INLINE_BASE64 = 10 * 1024 * 1024 - 1024;
const MAX_INLINE_SECONDS = 60;

/**
 * Prepares raw audio input for the API's audio.content field. Audio files (bytes) are
 * Base64-encoded here; input that is already Base64 text is passed through unchanged.
 *
 * @param {ArrayBuffer} input
 * @returns {string} Base64 audio
 */
export function audioContentFromInput(input) {
    if (!looksLikeAudioFile(input)) {
        const text = Utils.arrayBufferToStr(input).trim();
        if (text && /^[A-Za-z0-9+/=\s]+$/.test(text)) return text.replace(/\s+/g, "");
    }
    return toBase64(new Uint8Array(input));
}

/**
 * Whether the input starts with the signature of a common audio file (WAV, MP3, Ogg, FLAC, MP4/M4A, WebM).
 *
 * @param {ArrayBuffer} input
 * @returns {boolean}
 */
export function looksLikeAudioFile(input) {
    const b = new Uint8Array(input.slice(0, 12));
    const ascii = (start, str) => [...str].every((c, i) => b[start + i] === c.charCodeAt(0));
    return ascii(0, "RIFF") || ascii(0, "ID3") || ascii(0, "OggS") || ascii(0, "fLaC") || ascii(4, "ftyp") ||
        (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) || (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3);
}

/**
 * The length in seconds of a PCM WAV file, from its header, or null if it is not one.
 *
 * @param {ArrayBuffer} input
 * @returns {number|null}
 */
export function wavSeconds(input) {
    if (input.byteLength < 44) return null;
    const view = new DataView(input);
    const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    const byteRate = view.getUint32(28, true);
    if (!byteRate) return null;
    return (input.byteLength - 44) / byteRate;
}

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

    const response = await googleFetch(authed.url, {
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
            "Transcribes audio files into text using the Google Cloud Speech-to-Text API.",
            "<br><br>",
            "<b>Inputs:</b> An audio file (for example a recording from the Microphone) or a GCS URI, depending on the Input Mode.",
            "<br>",
            "Raw audio is sent directly and is limited to about one minute and 10 MB; for longer audio, upload it to GCS and use GCS URI mode.",
            "<br>",
            "<b>Outputs:</b> A textual transcript of the spoken audio.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input an mp3 file, and receive the spoken words as text.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/speech-to-text/docs/reference/rest";
        this.inputType = "ArrayBuffer";
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
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [
            inputMode, languageCode, model, outputDest, outputDirectory, maxPollMinutes
        ] = args;

        if (!input || !input.byteLength) throw new OperationError("Please provide a GCS URI or an audio file.");
        // An audio file (such as a Microphone recording) is sent as raw audio whichever mode is chosen
        const gcsMode = inputMode === "GCS URI (gs://...)" && !looksLikeAudioFile(input);
        const uri = gcsMode ? Utils.arrayBufferToStr(input).trim() : "";

        const maxMs = maxPollMinutes * 60 * 1000;
        let transcript;

        if (gcsMode) {
            if (!uri.startsWith("gs://")) {
                throw new OperationError("Input Mode is set to GCS URI but input does not start with gs://");
            }
            transcript = await this._transcribeGcsUri(uri, languageCode, model, maxMs);
        } else {
            // Raw audio: an audio file, or Base64 text of one
            const seconds = wavSeconds(input);
            if (seconds !== null && seconds > MAX_INLINE_SECONDS) {
                throw new OperationError(`This recording is ${Math.round(seconds)} seconds long. Raw audio is limited to ` +
                    `${MAX_INLINE_SECONDS} seconds: record a shorter clip, or upload the file to GCS and use GCS URI mode.`);
            }
            const content = audioContentFromInput(input);
            if (content.length > MAX_INLINE_BASE64) {
                throw new OperationError("This audio is too large to send directly (the limit is 10 MB). " +
                    "Upload it to GCS and use GCS URI mode.");
            }
            transcript = await this._transcribeRawAudio(content, languageCode, model);
        }

        if (outputDest === "Write to GCS") {
            // Generate full destination GCS URI using the core utility
            const virtualInputUri = gcsMode ? uri : "gs://raw-audio-bucket/raw_audio.raw";
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
