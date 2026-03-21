/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, getGcpCredentials } from "../lib/GoogleCloud.mjs";

/**
 * Polls a Google Cloud long-running operation until it completes.
 *
 * @param {string} operationName - The operation full name.
 * @param {string} pollBaseUrl - The base polling URL.
 * @param {number} maxMs - Maximum wait time in milliseconds.
 * @param {number} intervalMs - Poll interval in milliseconds.
 * @returns {Promise<Object>} The completed operation response object.
 */
async function pollLongRunningOperation(operationName, pollBaseUrl, maxMs = 30 * 60 * 1000, intervalMs = 10000) {
    const startTime = Date.now();
    const url = `${pollBaseUrl}${operationName}`;

    while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxMs) {
            throw new OperationError(`GCloud: Operation timed out after ${Math.round(elapsed / 60000)} minutes. Operation Name: ${operationName}`);
        }

        let data;
        try {
            data = await gcpFetch(url);
        } catch (e) {
            throw new OperationError(`GCloud: Operation polling error: ${e.message}`);
        }

        if (data.done) {
            if (data.error) {
                throw new OperationError(`GCloud: Long Audio Synthesis failed: ${data.error.message || JSON.stringify(data.error)}`);
            }
            return data;
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

/**
 * GCloud Text to Speech operation
 */
class GCloudTextToSpeech extends Operation {

    /**
     * GCloudTextToSpeech constructor
     */
    constructor() {
        super();

        this.name = "GCloud Text to Speech";
        this.module = "Cloud";
        this.description = [
            "Synthesizes natural-sounding speech from text using the Google Cloud Text-to-Speech API.",
            "<br><br>",
            "<b>Return to CyberChef mode:</b> Generates a standard audio response that is returned to CyberChef as raw bytes. ",
            "This can then be piped into the 'Play Media' operation to listen to the generated speech in your browser.",
            "<br><br>",
            "<b>Write to GCS (Longform) mode:</b> Uses the Synthesize Long Audio API. This allows processing ",
            "very large amounts of text (up to 1 million bytes) and writes the generated audio directly to a ",
            "Google Cloud Storage bucket. Returns the destination <code>gs://</code> URI.",
        ].join("\n");
        this.infoURL = "https://cloud.google.com/text-to-speech";
        this.inputType = "string";
        this.outputType = "byteArray";
        this.manualBake = true;
        this.args = [
            {
                "name": "Voice ID",
                "type": "editableOption",
                "value": [
                    {
                        "name": "en-GB-Chirp3-HD-Algenib",
                        "value": "en-GB-Chirp3-HD-Algenib"
                    },
                    {
                        "name": "en-GB-Chirp3-HD-Callirrhoe",
                        "value": "en-GB-Chirp3-HD-Callirrhoe"
                    }
                ]
            },
            {
                "name": "Output Destination",
                "type": "option",
                "value": ["Return to CyberChef", "Write to GCS (Longform)"]
            },
            {
                "name": "Output Bucket (*.wav for longform)",
                "type": "string",
                "value": ""
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {ArrayBuffer|string}
     */
    async run(input, args) {
        const [voiceId, outputDest, outputBucket] = args;

        const text = input.trim();
        if (!text) {
            throw new OperationError("Please provide text input to synthesize.");
        }

        if (outputDest === "Write to GCS (Longform)") {
            const trimmedBucket = outputBucket.trim();
            if (!trimmedBucket || !trimmedBucket.startsWith("gs://")) {
                throw new OperationError("Please provide a valid Output Bucket GCS URI (e.g., gs://my-bucket/audio.wav) to save the Long Audio output.");
            }

            if (!trimmedBucket.endsWith("/") && !trimmedBucket.toLowerCase().endsWith(".wav")) {
                throw new OperationError("Longform audio uses LINEAR16 encoding and must be saved as a .wav file. Please ensure your GCS URI ends with `.wav` or a trailing slash `/`.");
            }

            const targetUri = trimmedBucket.endsWith("/") ? `${trimmedBucket}output_ccc_tts.wav` : trimmedBucket;

            const creds = getGcpCredentials();
            if (!creds || !creds.quotaProject) {
                throw new OperationError("Google Cloud credentials with an explicitly configured Project ID (quotaProject) are required for Long Audio Synthesis.");
            }

            const project = creds.quotaProject;
            const region = creds.defaultRegion || "global";

            const url = `https://texttospeech.googleapis.com/v1/projects/${project}/locations/${region}:synthesizeLongAudio`;

            const body = {
                input: { text: text },
                voice: { name: voiceId, languageCode: voiceId.split("-").slice(0, 2).join("-") },
                audioConfig: { audioEncoding: "LINEAR16" },
                outputGcsUri: targetUri
            };

            let responseData;
            try {
                responseData = await gcpFetch(url, { method: "POST", body });
            } catch (e) {
                throw new OperationError(`GCloud Text to Speech: Long Audio API Error: ${e.message}`);
            }

            const operationName = responseData.name;
            if (!operationName) {
                throw new OperationError("GCloud Text to Speech: Local API returned no operation name.");
            }

            const pollBaseUrl = "https://texttospeech.googleapis.com/v1/";
            await pollLongRunningOperation(operationName, pollBaseUrl);

            // Convert the GCS URI string to a byte array to satisfy the operation's strict outputType
            const uriBytes = new Uint8Array(targetUri.length);
            for (let i = 0; i < targetUri.length; i++) {
                uriBytes[i] = targetUri.charCodeAt(i);
            }
            return Array.from(uriBytes);

        } else {
            // Standard Return to CyberChef
            const url = "https://texttospeech.googleapis.com/v1/text:synthesize";
            const languageCode = voiceId.split("-").slice(0, 2).join("-");

            const body = {
                input: { text: text },
                voice: { name: voiceId, languageCode: languageCode },
                audioConfig: { audioEncoding: "MP3" }
            };

            let responseData;
            try {
                responseData = await gcpFetch(url, { method: "POST", body });
            } catch (e) {
                throw new OperationError(`GCloud Text to Speech: API Error: ${e.message}`);
            }

            if (!responseData.audioContent) {
                throw new OperationError("GCloud Text to Speech: No audio content was returned from the API.");
            }

            // Decode base64 to ArrayBuffer
            const binaryString = atob(responseData.audioContent);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // If it doesn't start with ID3 (0x49 0x44 0x33) or MPEG sync (0xFF 0xFB),
            // prepend a dummy ID3 tag so CyberChef's strict signature checks recognize it as MP3.
            if ((bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) &&
                (bytes[0] !== 0xFF || bytes[1] !== 0xFB)) {

                const id3Header = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                const combined = new Uint8Array(id3Header.length + bytes.length);
                combined.set(id3Header);
                combined.set(bytes, id3Header.length);
                return Array.from(combined);
            }

            return Array.from(bytes);
        }
    }
}

export default GCloudTextToSpeech;
