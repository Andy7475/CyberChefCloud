/**
 * Registry of browser-local LLM providers.
 *
 * A provider runs a prompt against a model that lives in the browser, with no
 * cloud account or authentication. To add one (e.g. ONNX via Transformers.js,
 * MLC via WebLLM, LiteRT via MediaPipe), implement the interface below and add
 * it to PROVIDERS. See docs/LocalLLM.md.
 *
 * Provider interface:
 *   id          {string}    Short stable id, used to pick the provider.
 *   label       {string}    Name shown in the 'Backend' argument.
 *   formats     {string[]}  Model store formats it can load (see LocalModelStore.MODEL_FORMATS),
 *                           or [] if the browser supplies the model.
 *   supportsMime(mimeType)  -> boolean
 *   status()                -> Promise<string>  Human-readable availability.
 *   prompt(req)             -> Promise<string>  See promptLocalLLM for `req`.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../errors/OperationError.mjs";
import { listModels } from "./LocalModelStore.mjs";
import ChromeBuiltinProvider from "./localllm/ChromeBuiltinProvider.mjs";
import WllamaProvider from "./localllm/WllamaProvider.mjs";

export const PROVIDERS = [ChromeBuiltinProvider, WllamaProvider];

export const AUTO_BACKEND = "Auto";

/**
 * Finds a provider by id or label.
 *
 * @param {string} idOrLabel
 * @returns {Object|undefined}
 */
export function getProvider(idOrLabel) {
    return PROVIDERS.find(p => p.id === idOrLabel || p.label === idOrLabel);
}

/**
 * Picks a provider for a request.
 *
 * - An explicit backend is used as given.
 * - "Auto" with a model name uses the provider for that stored model's format.
 * - "Auto" without a model uses Chrome's built-in model.
 *
 * @param {string} backend - Provider id/label, or "Auto".
 * @param {string} modelName
 * @returns {Promise<Object>}
 */
export async function resolveProvider(backend, modelName) {
    if (backend && backend !== AUTO_BACKEND) {
        const provider = getProvider(backend);
        if (!provider) throw new OperationError(`Unknown local LLM backend '${backend}'.`);
        return provider;
    }
    if (!modelName) return ChromeBuiltinProvider;

    const model = (await listModels()).find(m => m.name === modelName);
    if (!model) {
        throw new OperationError(`No local model named '${modelName}'. Use 'Local LLM Models' to list, import or download models, or clear the Model argument to use Chrome's built-in model.`);
    }
    const provider = PROVIDERS.find(p => p.formats.includes(model.format));
    if (!provider) {
        throw new OperationError(`Model '${modelName}' is in '${model.format}' format, which no installed backend can run yet. Supported formats: ${PROVIDERS.flatMap(p => p.formats).join(", ")}.`);
    }
    return provider;
}

/**
 * Runs a prompt on a local model.
 *
 * @param {Object} req
 * @param {string} req.backend - Provider id/label, or "Auto".
 * @param {string} req.model - Stored model name (ignored by providers that bring their own model).
 * @param {string} req.systemPrompt
 * @param {string} req.text - User text, if the input is text.
 * @param {Object} [req.media] - {mimeType, bytes: ArrayBuffer} for non-text input.
 * @param {string} req.mimeType - Input MIME type.
 * @param {number} req.maxTokens
 * @param {number} req.temperature
 * @param {number} req.contextSize
 * @param {function(string)} [req.onStatus] - Progress messages for the UI.
 * @returns {Promise<string>}
 */
export async function promptLocalLLM(req) {
    const provider = await resolveProvider(req.backend, req.model);
    if (!provider.supportsMime(req.mimeType)) {
        throw new OperationError(`The '${provider.label}' backend cannot take '${req.mimeType}' input. Text input works with every backend; images and audio need Chrome's built-in model.`);
    }
    return provider.prompt(req);
}
