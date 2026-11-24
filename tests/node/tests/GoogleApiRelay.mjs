/**
 * Offline tests for googleFetch, which sends every Google API call through the CyberChefCloud
 * relay (infrastructure/google-api-proxy/). fetch is stubbed to act as the relay.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import TestRegister from "../../lib/TestRegister.mjs";
import it from "../assertionHandler.mjs";
import assert from "assert";
import {googleFetch, setGcpCredentials, getGcpCredentials, GOOGLE_API_RELAY} from "../../../src/core/lib/GoogleCloud.mjs";

const TOKEN_CREDS = {authType: "Access Token", authString: "tok", quotaProject: "proj", defaultRegion: "us-central1", apiKey: ""};

/**
 * Runs a callback with fetch stubbed by `relay` and the given credentials, then restores both.
 *
 * @param {Object} creds
 * @param {Function} relay - (url, config) => Promise<{ok, status, text}>
 * @param {Function} run
 * @returns {Promise<*>}
 */
async function withRelay(creds, relay, run) {
    const savedFetch = globalThis.fetch;
    const savedCreds = getGcpCredentials();
    globalThis.fetch = relay;
    setGcpCredentials(creds);
    try {
        return await run();
    } finally {
        globalThis.fetch = savedFetch;
        setGcpCredentials(savedCreds);
    }
}

/**
 * A relay reply.
 *
 * @param {Object} body
 * @param {number} [status]
 * @returns {Object}
 */
function reply(body, status = 200) {
    return {ok: status < 300, status, statusText: "", text: async () => JSON.stringify(body)};
}

TestRegister.addApiTests([
    it("Google API relay: sends the request to the relay with the caller's token", async () => {
        let call;
        const res = await withRelay(TOKEN_CREDS, async (url, config) => {
            call = {url, config, payload: JSON.parse(config.body)};
            return reply({status: 200, contentType: "application/json", bodyBase64: Buffer.from("{\"a\":1}").toString("base64")});
        }, () => googleFetch("https://vision.googleapis.com/v1/images:annotate", {
            method: "POST",
            headers: {"Authorization": "Bearer tok", "x-goog-user-project": "proj"},
            body: "{\"requests\":[]}"
        }));
        assert.strictEqual(call.url, GOOGLE_API_RELAY);
        assert.strictEqual(call.config.headers.Authorization, "Bearer tok");
        assert.deepStrictEqual(call.payload, {
            url: "https://vision.googleapis.com/v1/images:annotate",
            method: "POST",
            headers: {"Authorization": "Bearer tok", "x-goog-user-project": "proj"},
            body: "{\"requests\":[]}"
        });
        assert.strictEqual(res.ok, true);
        assert.deepStrictEqual(await res.json(), {a: 1});
        assert.strictEqual(res.headers.get("Content-Type"), "application/json");
    }),

    it("Google API relay: binary bodies go both ways as Base64", async () => {
        const upload = new Uint8Array([0, 255, 1, 254, 128]);
        let payload;
        const res = await withRelay(TOKEN_CREDS, async (url, config) => {
            payload = JSON.parse(config.body);
            return reply({status: 200, contentType: "image/png", bodyBase64: Buffer.from([137, 80, 78, 71, 0, 255]).toString("base64")});
        }, () => googleFetch("https://storage.googleapis.com/upload/storage/v1/b/b/o?uploadType=media&name=x", {
            method: "POST", body: upload.buffer
        }));
        assert.strictEqual(payload.bodyBase64, Buffer.from(upload).toString("base64"));
        assert.strictEqual(payload.body, undefined);
        assert.deepStrictEqual(Array.from(new Uint8Array(await res.arrayBuffer())), [137, 80, 78, 71, 0, 255]);
    }),

    it("Google API relay: Google's own errors come back as a normal response", async () => {
        const res = await withRelay(TOKEN_CREDS, async () => reply({
            status: 403, contentType: "application/json",
            bodyBase64: Buffer.from(JSON.stringify({error: {message: "API not enabled"}})).toString("base64")
        }), () => googleFetch("https://speech.googleapis.com/v1/speech:recognize", {method: "POST", body: "{}"}));
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.status, 403);
        assert.strictEqual((await res.json()).error.message, "API not enabled");
    }),

    it("Google API relay: a relay refusal becomes a readable error", async () => {
        await assert.rejects(() => withRelay(TOKEN_CREDS, async () => reply({error: "Not authorised for the Google API relay."}, 403),
            () => googleFetch("https://speech.googleapis.com/v1/x")), /Google API relay: Not authorised/);
    }),

    it("Google API relay: API-key-only sign-in is refused before any request", async () => {
        let called = false;
        await assert.rejects(() => withRelay({...TOKEN_CREDS, authType: "API Key"}, async () => {
            called = true;
            return reply({});
        }, () => googleFetch("https://vision.googleapis.com/v1/x")), /OAuth or an access token/);
        assert.strictEqual(called, false);
    }),
]);
