/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, getGcpCredentials } from "../lib/GoogleCloud.mjs";
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
            "Prompts a Google Cloud Vertex AI (Gemini) model to generate content based on the input text or media.",
            "<br><br>",
            "Provide the system prompt and the model name to use. You can select a model or type your own. The CyberChef input will be sent as the user's prompt or media payload.",
            "<br><br>",
            "Ensure you have added the <code>Authenticate Google Cloud</code> operation first, and that your Quota Project has the <code>Vertex AI API</code> (aiplatform.googleapis.com) enabled."
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
                    { name: "gemini-2.5-flash", value: "gemini-2.5-flash" },
                    { name: "gemini-2.5-pro", value: "gemini-2.5-pro" },
                    { name: "gemini-2.5-flash-lite", value: "gemini-2.5-flash-lite" },
                    { name: "gemini-2.0-flash", value: "gemini-2.0-flash" },
                    { name: "gemini-2.0-flash-lite", value: "gemini-2.0-flash-lite" },
                    { name: "gemini-1.5-flash", value: "gemini-1.5-flash" },
                    { name: "gemini-1.5-pro", value: "gemini-1.5-pro" },
                    { name: "gemini-1.5-pro-latest", value: "gemini-1.5-pro-latest" },
                    { name: "gemini-pro-latest", value: "gemini-pro-latest" }
                ]
            },
            {
                "name": "Input MIME Type",
                "type": "editableOption",
                "value": [
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
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [systemPrompt, modelName, mimeType, maxTokens, temperature] = args;

        const hasInput = input && input.byteLength > 0;

        if (!hasInput && !systemPrompt.trim()) {
            throw new OperationError("Please provide either a user prompt (via input) or a system prompt.");
        }

        const creds = getGcpCredentials();
        if (!creds || !creds.quotaProject || !creds.defaultRegion) {
            throw new OperationError("Please configure a Quota Project and Default Region in the 'Authenticate Google Cloud' operation before using this ingredient.");
        }

        const project = creds.quotaProject;
        const region = creds.defaultRegion;
        const publisher = "google";

        const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/${encodeURIComponent(publisher)}/models/${encodeURIComponent(modelName)}:generateContent`;

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
