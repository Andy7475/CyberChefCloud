/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, getGcpCredentials, vertexGeminiUrl } from "../lib/GoogleCloud.mjs";
import { resolveMimeType } from "../lib/FileType.mjs";
import { toBase64 } from "../lib/Base64.mjs";

/**
 * Prompt LLM operation
 */
class PromptLLM extends Operation {

    /**
     * PromptLLM constructor
     */
    constructor() {
        super();

        this.name = "Prompt LLM";
        this.module = "Cloud";
        this.description = [
            "Prompts a Google Cloud Vertex AI (Gemini) model to generate content based on text or media.",
            "<br><br>",
            "<b>Inputs:</b> The user's prompt or media payload (e.g. text, image, audio, or PDF).",
            "<br>",
            "<b>Outputs:</b> The generated text response from the LLM.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input an image and ask the model to describe what it sees in the System Prompt.</li></ul>",
            "<br>",
            "<b>Location:</b> Most Gemini 3.x models are only served from the <code>global</code> location (the default). Choose <code>Default Region</code> to use the region set in <code>Authenticate Google Cloud</code> when data must stay in one region; gemini-3.5-flash is available regionally (e.g. europe-west2).",
            "<br><br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.publishers.models/generateContent";
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
                "name": "Model",
                "type": "editableOption",
                "value": [
                    { name: "gemini-3.8-flash", value: "gemini-3.8-flash" },
                    { name: "gemini-3.1-pro-preview", value: "gemini-3.1-pro-preview" },
                    { name: "gemini-3.5-flash", value: "gemini-3.5-flash" },
                    { name: "gemini-3.5-flash-lite", value: "gemini-3.5-flash-lite" },
                    { name: "gemini-3.1-flash-image", value: "gemini-3.1-flash-image" },
                    { name: "gemini-3-pro-image", value: "gemini-3-pro-image" }
                ]
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
                    { name: "application/pdf", value: "application/pdf" },
                    { name: "audio/mp3", value: "audio/mp3" },
                    { name: "video/mp4", value: "video/mp4" }
                ]
            },
            {
                "name": "Max Tokens",
                "type": "number",
                "value": 8192
            },
            {
                "name": "Temperature",
                "type": "number",
                "value": 1.0
            },
            {
                "name": "Location",
                "type": "editableOption",
                "value": [
                    { name: "global", value: "global" },
                    { name: "Default Region", value: "Default Region" }
                ]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [systemPrompt, modelName, mimeTypeArg, maxTokens, temperature, locationArg = "global"] = args;
        const mimeType = resolveMimeType(input, mimeTypeArg);

        const hasInput = input && input.byteLength > 0;

        if (!hasInput && !systemPrompt.trim()) {
            throw new OperationError("Please provide either a user prompt (via input) or a system prompt.");
        }

        const creds = getGcpCredentials();
        const location = locationArg === "Default Region" ? creds?.defaultRegion : locationArg;
        if (!creds || !creds.quotaProject || !location) {
            throw new OperationError("Please configure a Quota Project (and a Default Region if Location is 'Default Region') in the 'Authenticate Google Cloud' operation before using this ingredient.");
        }

        const url = vertexGeminiUrl(creds.quotaProject, location, modelName);

        const requestBody = {
            contents: [],
            systemInstruction: undefined,
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: temperature
            }
        };

        if (systemPrompt && systemPrompt.trim()) {
            requestBody.systemInstruction = {
                role: "system",
                parts: [{ text: systemPrompt }]
            };
        }

        if (hasInput) {
            const arr = new Uint8Array(input);
            if (mimeType === "text/plain") {
                const text = new TextDecoder().decode(arr);
                requestBody.contents.push({
                    role: "user",
                    parts: [{ text: text }]
                });
            } else {
                const base64Data = toBase64(Array.from(arr));
                requestBody.contents.push({
                    role: "user",
                    parts: [{
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    }]
                });
            }
        } else {
            // The Vertex Gemini API requires at least one user content block.
            // If the user only provided a system prompt and no input, we must provide a generic user start message.
            requestBody.contents.push({
                role: "user",
                parts: [{ text: "Please respond to the system instructions." }]
            });
        }

        let data;
        try {
            data = await gcpFetch(url, {
                method: "POST",
                body: requestBody
            });
        } catch (e) {
            throw new OperationError(`Prompt LLM: API Error: ${e.message}\nEndpoint: ${url}`);
        }

        // Parse the generated text from the response
        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                return candidate.content.parts.map(p => p.text).join("");
            }
        }

        return "No content generated.";
    }

}

export default PromptLLM;
