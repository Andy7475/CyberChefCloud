/**
 * Offline tests for GCloud Speech to Text's raw audio handling: an audio file (such as a phone
 * microphone recording) must reach the API as Base64 of its exact bytes. fetch is stubbed, so
 * no Google credentials or network are needed.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import TestRegister from "../../lib/TestRegister.mjs";
import it from "../assertionHandler.mjs";
import assert from "assert";
import GCloudSpeechToText, {audioContentFromInput, looksLikeAudioFile, wavSeconds} from "../../../src/core/operations/GCloudSpeechToText.mjs";
import {setGcpCredentials, getGcpCredentials} from "../../../src/core/lib/GoogleCloud.mjs";

/**
 * A 16 kHz mono 16-bit WAV of the given length, with bytes that are not valid UTF-8.
 *
 * @param {number} seconds
 * @returns {ArrayBuffer}
 */
function wav(seconds) {
    const samples = Math.round(16000 * seconds);
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, (i * 997) % 65536 - 32768, true);
    return buffer;
}

/**
 * Runs the operation with fetch stubbed, and returns the request body it sent.
 *
 * @param {ArrayBuffer} input
 * @param {string} mode
 * @returns {Promise<{body: Object, output: string}>}
 */
async function runWithStub(input, mode) {
    const savedFetch = globalThis.fetch;
    const savedHeaders = globalThis.Headers;
    const savedCreds = getGcpCredentials();
    // The node tests run without Node's built-in fetch (--no-experimental-fetch), so no Headers either
    if (!globalThis.Headers) {
        globalThis.Headers = class extends Map {
            /** @param {string} k @returns {string} */
            get(k) {
                return super.get(k.toLowerCase());
            }
            /** @param {string} k @param {string} v @returns {Map} */
            set(k, v) {
                return super.set(k.toLowerCase(), v);
            }
            /** @param {string} k @returns {boolean} */
            has(k) {
                return super.has(k.toLowerCase());
            }
        };
    }
    let sent = null;
    globalThis.fetch = async (url, config) => {
        sent = {url, body: JSON.parse(config.body)};
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({results: [{alternatives: [{transcript: "hello world"}]}]})
        };
    };
    setGcpCredentials({authType: "API Key", authString: "test-key", quotaProject: "", defaultRegion: "us-central1", apiKey: ""});
    try {
        const output = await new GCloudSpeechToText().run(input, [mode, "en-GB", "latest_short", "Return to CyberChef", "", 1]);
        return {sent, output};
    } finally {
        globalThis.fetch = savedFetch;
        globalThis.Headers = savedHeaders;
        setGcpCredentials(savedCreds);
    }
}

TestRegister.addApiTests([
    it("GCloud Speech to Text: a WAV recording is sent as Base64 of its exact bytes", async () => {
        const audio = wav(1);
        const {sent, output} = await runWithStub(audio, "Raw Audio Bytes (Base64)");
        assert.strictEqual(sent.url.split("?")[0], "https://speech.googleapis.com/v1/speech:recognize");
        assert.strictEqual(sent.body.audio.content, Buffer.from(audio).toString("base64"));
        assert.strictEqual(sent.body.config.languageCode, "en-GB");
        assert.strictEqual(output, "hello world");
    }),

    it("GCloud Speech to Text: an audio file is sent as raw audio even in GCS URI mode", async () => {
        const audio = wav(0.5);
        const {sent} = await runWithStub(audio, "GCS URI (gs://...)");
        assert.strictEqual(sent.body.audio.content, Buffer.from(audio).toString("base64"));
    }),

    it("GCloud Speech to Text: Base64 text input is passed through unchanged", async () => {
        const b64 = Buffer.from(wav(0.2)).toString("base64");
        const input = new TextEncoder().encode(b64 + "\n").buffer;
        assert.strictEqual(audioContentFromInput(input), b64);
    }),

    it("GCloud Speech to Text: recordings over a minute ask for GCS instead", async () => {
        assert.strictEqual(Math.round(wavSeconds(wav(61))), 61);
        await assert.rejects(() => runWithStub(wav(61), "Raw Audio Bytes (Base64)"), /61 seconds long/);
    }),

    it("GCloud Speech to Text: recognises audio file signatures", () => {
        assert.strictEqual(looksLikeAudioFile(wav(0.1)), true);
        assert.strictEqual(looksLikeAudioFile(new TextEncoder().encode("gs://bucket/a.wav").buffer), false);
        assert.strictEqual(looksLikeAudioFile(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), true);
    }),
]);
