/**
 * Local LLM provider for GGUF model files, run with wllama (llama.cpp compiled
 * to WebAssembly, with WebGPU acceleration where the browser supports it).
 *
 * GGUF is the format used by llama.cpp, Ollama and LM Studio, and most open
 * models on Hugging Face (Gemma, Llama, Qwen, Phi, Mistral...) are published
 * as GGUF. The model files come from the browser model store (OPFS).
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import { Wllama } from "@wllama/wllama/esm/index.js";
import OperationError from "../../errors/OperationError.mjs";
import { getModelFiles, listModels } from "../LocalModelStore.mjs";

// A loaded model is kept between bakes: loading a multi-GB file takes seconds.
let loaded = null; // {key, wllama}

/**
 * Returns the URL of the wllama WebAssembly binary copied by webpack.
 *
 * @returns {string}
 */
function wasmUrl() {
    const base = (typeof self !== "undefined" && self.docURL) ? self.docURL : ".";
    return `${base}/assets/wllama/wllama.wasm`;
}

/**
 * Loads (or reuses) a model.
 *
 * @param {string} modelName
 * @param {number} contextSize
 * @param {function(string)} [onStatus]
 * @returns {Promise<Wllama>}
 */
async function getModel(modelName, contextSize, onStatus) {
    const key = `${modelName}|${contextSize}`;
    if (loaded && loaded.key === key) return loaded.wllama;

    if (loaded) {
        await loaded.wllama.exit().catch(() => {});
        loaded = null;
    }

    const files = await getModelFiles(modelName);
    if (onStatus) onStatus(`Loading local model ${modelName}...`);

    const wllama = new Wllama({ default: wasmUrl() }, { suppressNativeLog: true });
    try {
        // eslint-disable-next-line camelcase
        await wllama.loadModel(files, { n_ctx: contextSize });
    } catch (e) {
        await wllama.exit().catch(() => {});
        throw new OperationError(`Could not load GGUF model '${modelName}': ${e.message}`);
    }
    loaded = { key, wllama };
    return wllama;
}

const WllamaProvider = {
    id: "gguf",
    label: "GGUF model (wllama / llama.cpp)",
    formats: ["gguf"],

    /**
     * Whether this provider can take this input type.
     *
     * @param {string} mimeType
     * @returns {boolean}
     */
    supportsMime(mimeType) {
        return mimeType.startsWith("text/");
    },

    /**
     * @returns {Promise<string>}
     */
    async status() {
        try {
            const models = (await listModels()).filter(m => m.format === "gguf");
            const gpu = typeof navigator !== "undefined" && navigator.gpu ? "WebGPU" : "CPU only";
            return models.length ?
                `available (${models.length} GGUF model${models.length > 1 ? "s" : ""} stored, ${gpu})` :
                "no GGUF models stored";
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
        if (!req.model) {
            throw new OperationError("Choose a stored GGUF model in the 'Model' argument. Use 'Local LLM Models' to download or import one.");
        }
        const wllama = await getModel(req.model, req.contextSize, req.onStatus);
        if (req.onStatus) req.onStatus(`Generating with ${req.model}...`);

        const messages = [];
        if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
        messages.push({ role: "user", content: req.text || "Please respond to the system instructions." });

        const response = await wllama.createChatCompletion({
            messages,
            // eslint-disable-next-line camelcase
            max_tokens: req.maxTokens,
            temperature: req.temperature
        });
        return response.choices[0].message.content;
    }
};

export default WllamaProvider;
