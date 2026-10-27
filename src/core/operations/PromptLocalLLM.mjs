/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { isWorkerEnvironment } from "../Utils.mjs";
import { resolveMimeType } from "../lib/FileType.mjs";
import { promptLocalLLM, PROVIDERS, AUTO_BACKEND } from "../lib/LocalLLM.mjs";

/**
 * Prompt Local LLM operation
 */
class PromptLocalLLM extends Operation {

    /**
     * PromptLocalLLM constructor
     */
    constructor() {
        super();

        this.name = "Prompt Local LLM";
        this.module = "LocalAI";
        this.description = [
            "Prompts a language model that runs entirely inside your browser. Nothing is sent to a server and no Google Cloud authentication is needed.",
            "<br><br>",
            "<b>Backends:</b>",
            "<ul>",
            "<li><b>Chrome built-in (Gemini Nano)</b>: the model Chrome downloads and manages itself (about 4 GB, one-off). Needs desktop Chrome with the Prompt API. Accepts text, image and audio input.</li>",
            "<li><b>GGUF model</b>: any GGUF file (Gemma, Llama, Qwen, Phi, Mistral...) stored with the <code>Local LLM Models</code> operation. Runs with llama.cpp in WebAssembly, using WebGPU when available. Text input only.</li>",
            "<li><b>Auto</b>: uses the backend that matches the stored model named in <code>Model</code>, or Chrome built-in if <code>Model</code> is empty.</li>",
            "</ul>",
            "<b>Inputs:</b> The user prompt (text), or an image/audio file for Chrome built-in.",
            "<br>",
            "<b>Outputs:</b> The model's response.",
            "<br><br>",
            "<code>Max Tokens</code>, <code>Temperature</code> and <code>Context Size</code> apply to GGUF models; Chrome does not let web pages set them."
        ].join("\n");
        this.infoURL = "https://github.com/webmachinelearning/prompt-api";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "System Prompt",
                "type": "text",
                "value": "You are a helpful AI assistant."
            },
            {
                "name": "Backend",
                "type": "option",
                "value": [AUTO_BACKEND, ...PROVIDERS.map(p => p.label)]
            },
            {
                "name": "Model",
                "type": "string",
                "value": ""
            },
            {
                "name": "Input MIME Type",
                "type": "editableOption",
                "value": [
                    { name: "Auto", value: "Auto" },
                    { name: "text/plain", value: "text/plain" },
                    { name: "image/jpeg", value: "image/jpeg" },
                    { name: "image/png", value: "image/png" },
                    { name: "image/webp", value: "image/webp" },
                    { name: "audio/wav", value: "audio/wav" },
                    { name: "audio/mpeg", value: "audio/mpeg" }
                ]
            },
            {
                "name": "Max Tokens",
                "type": "number",
                "value": 1024
            },
            {
                "name": "Temperature",
                "type": "number",
                "value": 0.7
            },
            {
                "name": "Context Size",
                "type": "number",
                "value": 4096
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [systemPrompt, backend, model, mimeTypeArg, maxTokens, temperature, contextSize] = args;
        const hasInput = input && input.byteLength > 0;

        if (!hasInput && !systemPrompt.trim()) {
            throw new OperationError("Please provide either a user prompt (via input) or a system prompt.");
        }

        const mimeType = hasInput ? resolveMimeType(input, mimeTypeArg) : "text/plain";
        const isText = mimeType.startsWith("text/");

        return promptLocalLLM({
            backend,
            model: model.trim(),
            systemPrompt: systemPrompt.trim(),
            mimeType,
            text: hasInput && isText ? new TextDecoder().decode(new Uint8Array(input)) : "",
            media: hasInput && !isText ? { mimeType, bytes: input } : undefined,
            maxTokens,
            temperature,
            contextSize,
            onStatus: msg => {
                if (isWorkerEnvironment()) self.sendStatusMessage(msg);
            }
        });
    }

}

export default PromptLocalLLM;
