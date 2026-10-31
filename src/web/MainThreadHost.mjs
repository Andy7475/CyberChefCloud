/**
 * Main-thread side of the worker bridge (see src/core/lib/MainThreadBridge.mjs).
 *
 * Handles `mainThreadRequest` messages from a ChefWorker for browser APIs that
 * only exist on `window`, and posts a `mainThreadResponse` back.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/**
 * Returns Chrome's built-in Prompt API entry point, if the browser has one.
 *
 * @returns {Object|undefined}
 */
function getLanguageModel() {
    // eslint-disable-next-line no-undef
    return typeof LanguageModel !== "undefined" ? LanguageModel : undefined;
}

/**
 * Builds the `expectedInputs` list Chrome needs to load the right model parts.
 *
 * @param {Object} [media]
 * @returns {Object[]}
 */
function expectedInputsFor(media) {
    const inputs = [{ type: "text", languages: ["en"] }];
    if (media) inputs.push({ type: media.mimeType.split("/")[0] });
    return inputs;
}

const SERVICES = {
    /**
     * Reports whether Chrome's built-in model can be used.
     *
     * @param {Object} payload
     * @returns {Promise<string>} "unavailable" | "downloadable" | "downloading" | "available" | "unsupported"
     */
    async "chromeLLM.availability"(payload) {
        const LM = getLanguageModel();
        if (!LM) return "unsupported";
        return LM.availability({
            expectedInputs: expectedInputsFor(payload.media),
            expectedOutputs: [{ type: "text", languages: ["en"] }]
        });
    },

    /**
     * Runs one stateless prompt against Chrome's built-in model.
     *
     * @param {Object} payload - {systemPrompt, text, media: {mimeType, bytes}, responseConstraint}
     * @param {function(Object)} progress - Sends a progress update to the worker.
     * @returns {Promise<string>}
     */
    async "chromeLLM.prompt"(payload, progress) {
        const LM = getLanguageModel();
        if (!LM) {
            throw new Error("This browser has no built-in LanguageModel (Prompt API). Use a recent desktop Chrome with the Gemini Nano model enabled, or pick the GGUF backend.");
        }

        const options = {
            expectedInputs: expectedInputsFor(payload.media),
            expectedOutputs: [{ type: "text", languages: ["en"] }],
            /**
             * Forwards model download progress to the worker.
             *
             * @param {EventTarget} m
             */
            monitor(m) {
                m.addEventListener("downloadprogress", e => progress({ loaded: e.loaded }));
            }
        };
        if (payload.systemPrompt) {
            options.initialPrompts = [{ role: "system", content: payload.systemPrompt }];
        }

        const session = await LM.create(options);
        try {
            const content = [];
            if (payload.text) content.push({ type: "text", value: payload.text });
            if (payload.media) {
                content.push({
                    type: payload.media.mimeType.split("/")[0],
                    value: new Blob([payload.media.bytes], { type: payload.media.mimeType })
                });
            }
            if (!content.length) content.push({ type: "text", value: "Please respond to the system instructions." });
            const promptOptions = payload.responseConstraint ? { responseConstraint: payload.responseConstraint } : {};
            return await session.prompt([{ role: "user", content }], promptOptions);
        } finally {
            session.destroy();
        }
    }
};

/**
 * Handles a `mainThreadRequest` from a ChefWorker.
 *
 * @param {Object} data - {id, service, payload}
 * @param {Worker} worker - The worker to reply to.
 */
export async function handleMainThreadRequest(data, worker) {
    const { id, service, payload } = data;
    const reply = msg => worker.postMessage({ action: "mainThreadResponse", data: { id, ...msg } });

    const fn = SERVICES[service];
    if (!fn) {
        reply({ error: `Unknown main-thread service '${service}'.` });
        return;
    }

    try {
        const result = await fn(payload, p => reply({ progress: true, result: p }));
        reply({ result });
    } catch (e) {
        reply({ error: e && e.message ? e.message : String(e) });
    }
}
