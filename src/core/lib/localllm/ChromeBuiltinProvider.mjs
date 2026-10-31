/**
 * Local LLM provider for Chrome's built-in model (Gemini Nano via the Prompt API).
 *
 * The model is downloaded and managed by Chrome itself (about 4 GB, shared by
 * every site), so nothing is stored by CyberChefCloud. The `LanguageModel` API
 * is only exposed on `window`, so calls go through the main-thread bridge.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../../errors/OperationError.mjs";
import { requestMainThread } from "../MainThreadBridge.mjs";

const ChromeBuiltinProvider = {
    id: "chrome",
    label: "Chrome built-in (Gemini Nano)",
    formats: [],

    /**
     * Whether this provider can take this input type.
     *
     * @param {string} mimeType
     * @returns {boolean}
     */
    supportsMime(mimeType) {
        return mimeType.startsWith("text/") || mimeType.startsWith("image/") || mimeType.startsWith("audio/");
    },

    /**
     * @returns {Promise<string>} Availability string from Chrome, or "unsupported".
     */
    async status() {
        try {
            return await requestMainThread("chromeLLM.availability", {});
        } catch (e) {
            return `unsupported (${e.message})`;
        }
    },

    /**
     * Runs a single prompt.
     *
     * @param {Object} req - See LocalLLM.promptLocalLLM.
     * @returns {Promise<string>}
     */
    async prompt(req) {
        const payload = { systemPrompt: req.systemPrompt, text: req.text, media: req.media, responseConstraint: req.responseConstraint };
        const availability = await requestMainThread("chromeLLM.availability", payload);

        if (availability === "unsupported" || availability === "unavailable") {
            throw new OperationError(
                "Chrome's built-in model is not available in this browser" +
                (availability === "unavailable" ? " (the device does not meet the hardware requirements, or this input type is not supported)" : "") +
                ". Use desktop Chrome with the Prompt API enabled (chrome://flags/#prompt-api-for-gemini-nano), or choose the GGUF backend with a downloaded model.");
        }
        if (availability !== "available" && req.onStatus) {
            req.onStatus("Chrome is downloading its built-in model (about 4 GB, one-off). This can take several minutes...");
        }

        return requestMainThread("chromeLLM.prompt", payload, {
            onProgress: p => {
                if (req.onStatus) req.onStatus(`Downloading Chrome built-in model: ${Math.round(p.loaded * 100)}%`);
            }
        });
    }
};

export default ChromeBuiltinProvider;
