/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, getGcpCredentials } from "../lib/GoogleCloud.mjs";
import { resolveMimeType } from "../lib/FileType.mjs";
import { isWorkerEnvironment } from "../Utils.mjs";
// NOTE: operations/index.mjs is loaded lazily via dynamic import inside run()
// to avoid a circular dependency (index.mjs imports AIAgent.mjs) and to prevent
// heavyweight WASM operations (e.g. Jq) from initialising at Cloud module load time.

/**
 * AI Agent operation
 */
class AIAgent extends Operation {

    /**
     * AIAgent constructor
     */
    constructor() {
        super();

        this.name = "AI Agent";
        this.module = "Cloud";
        this.description = [
            "Instantiates an autonomous AI Agent powered by Vertex AI that can intelligently chain Operations.",
            "<br><br>",
            "<b>Inputs:</b> The initial context or payload you want the Agent to process.",
            "<br>",
            "<b>Outputs:</b> The final result formulated by the Agent or the full iterative flow log.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Ask the agent to 'Extract the domain and resolve its IP address', and the agent will use CyberChef tools seamlessly.</li></ul>",
            "<br>",
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
                "value": "You are a helpful data analysis agent. Use the provided tools to transform and analyse the data. Think step by step about which tools to call and in what order."
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
                    { name: "gemini-1.5-pro", value: "gemini-1.5-pro" }
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
                "name": "Tools (comma-separated operation names)",
                "type": "text",
                "value": "From Base64, To Base64, From Hex, To Hex, Regular expression, URL Decode, GCloud Vision Analyze"
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
                "name": "Max Agent Iterations",
                "type": "number",
                "value": 10
            },
            {
                "name": "Output Mode",
                "type": "option",
                "value": ["Pure Output", "AI Agent Flow & Output"]
            }
        ];
    }

    /**
     * Maps a CyberChef argument type to a Vertex AI JSON schema type.
     * @param {string} argType - CyberChef argument type string
     * @returns {string} Vertex AI type string, or null to skip
     */
    _ccArgTypeToVertexType(argType) {
        switch (argType) {
            case "string":
            case "shortString":
            case "text":
            case "binaryString":
            case "editableOption":
            case "option":
            case "toggleString":
                return "STRING";
            case "number":
                return "NUMBER";
            case "boolean":
                return "BOOLEAN";
            default:
                // byteArray, populateOption etc. can't be cleanly serialised - skip
                return null;
        }
    }

    /**
     * Builds a Vertex AI FunctionDeclaration from a CyberChef operation instance.
     * @param {Operation} op - An instantiated CyberChef operation
     * @returns {Object|null} A Vertex AI FunctionDeclaration, or null if not usable
     */
    _buildFunctionDeclaration(op) {
        if (op.flowControl) return null;

        const isBinary = op.inputType === "ArrayBuffer" ||
                         op.inputType === "File" ||
                         op.inputType.startsWith("List");

        const properties = {};
        const required = [];

        for (const arg of op.args) {
            const vertexType = this._ccArgTypeToVertexType(arg.type);
            if (!vertexType) continue;

            const propDef = {
                type: vertexType,
                description: `${arg.name} (default: ${JSON.stringify(arg.value)})`
            };

            // Add enum for option/editableOption types
            if ((arg.type === "option" || arg.type === "editableOption") && Array.isArray(arg.value)) {
                const enumVals = arg.value.map(v => (typeof v === "object" ? v.value : v)).filter(v => typeof v === "string");
                if (enumVals.length > 0) propDef.enum = enumVals;
            }

            properties[arg.name] = propDef;
        }

        const binaryNote = isBinary ?
            "[BINARY TOOL] This tool operates directly on the current pipeline data (file bytes). Do NOT pass file content as an argument — only provide the operation-specific parameters listed below. " :
            "";

        return {
            name: op.name.replace(/[^a-zA-Z0-9_]/g, "_"),
            description: binaryNote + (op.description || op.name).replace(/<[^>]*>/g, "").slice(0, 300),
            parameters: {
                type: "OBJECT",
                properties: Object.keys(properties).length > 0 ? properties : { _noop: { type: "STRING", description: "This operation has no configurable parameters. Pass an empty string." } },
                required
            },
            // Store metadata for the bridge
            _ccName: op.name,
            _isBinary: isBinary
        };
    }

    /**
     * Executes a CyberChef operation as a tool call from the LLM.
     * @param {string} opName - The CyberChef operation name
     * @param {Object} llmArgs - Key-value arguments from the LLM (keyed by arg name)
     * @param {ArrayBuffer} pipelineBuffer - The current binary pipeline data
     * @param {string} currentText - The current text pipeline data
     * @param {Object} operations - The dynamically-loaded operations index module
     * @returns {Promise<{result: string, updatedText: string}>}
     */
    async _executeTool(opName, llmArgs, pipelineBuffer, currentText, operations) {
        // Find the operation class by name from the operations index
        let OpClass = null;
        for (const key of Object.keys(operations)) {
            try {
                const candidate = operations[key];
                if (typeof candidate === "function") {
                    const inst = new candidate();
                    if (inst.name === opName) {
                        OpClass = candidate;
                        break;
                    }
                }
            } catch (e) {
                // Skip operations that can't be instantiated
            }
        }

        if (!OpClass) {
            throw new OperationError(`AI Agent: Tool '${opName}' not found in the CyberChef operation registry.`);
        }

        const op = new OpClass();

        if (op.flowControl) {
            throw new OperationError(`AI Agent: Tool '${opName}' is a flow-control operation and cannot be called as an agent tool.`);
        }

        // Map LLM args object to an ordered ingValues array using op.args as schema
        const ingValues = op.args.map(arg => {
            const val = llmArgs[arg.name];
            if (val !== undefined && val !== null) {
                // Type coerce if needed
                if (arg.type === "number") return Number(val);
                if (arg.type === "boolean") return Boolean(val);
                return val;
            }
            // Fall back to default value
            return Array.isArray(arg.value) ? (arg.value[0]?.value ?? arg.value[0] ?? "") : arg.value;
        });

        const isBinary = op.inputType === "ArrayBuffer" ||
                         op.inputType === "File" ||
                         op.inputType.startsWith("List");

        let rawResult;
        if (isBinary) {
            rawResult = await op.run(pipelineBuffer, ingValues);
        } else {
            const inputData = op.inputType === "string" ?
                currentText :
                new TextEncoder().encode(currentText).buffer;
            rawResult = await op.run(inputData, ingValues);
        }

        // Coerce result to string.
        // CyberChef ops can return: string, ArrayBuffer, Uint8Array,
        // byteArray (plain JS Array of 0-255 numbers), or a plain object (JSON).
        let resultStr;
        if (rawResult instanceof ArrayBuffer) {
            resultStr = new TextDecoder("utf-8", { fatal: false }).decode(rawResult);
        } else if (rawResult instanceof Uint8Array) {
            resultStr = new TextDecoder("utf-8", { fatal: false }).decode(rawResult);
        } else if (Array.isArray(rawResult)) {
            // byteArray output (e.g. From Base64) — decode as UTF-8 text
            resultStr = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(rawResult));
        } else if (typeof rawResult === "object" && rawResult !== null) {
            // Plain object / JSON (e.g. GCloud Vision response)
            resultStr = JSON.stringify(rawResult, null, 2);
        } else {
            resultStr = String(rawResult ?? "");
        }

        // Push this tool call into the audit log so it appears alongside regular operation entries
        if (isWorkerEnvironment() && self.chef && self.chef.auditLog) {
            const truncatedResult = resultStr.length > 5000000 ?
                resultStr.substring(0, 5000000) + "\n... [truncated for memory]" :
                resultStr;
            self.chef.auditLog.push({
                ingredient: `AI Agent → ${opName}`,
                input: currentText.length > 5000000 ? currentText.substring(0, 5000000) : currentText,
                args: llmArgs || {},
                output: truncatedResult,
                forkId: 0,
                agentTool: true
            });
        }

        return { result: resultStr, updatedText: resultStr };
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [systemPrompt, modelName, mimeTypeArg, toolsArg, maxTokens, temperature, maxIterations, outputMode] = args;
        const mimeType = resolveMimeType(input, mimeTypeArg);

        // Dynamically import the operations index to avoid a circular dependency
        // (index.mjs already imports AIAgent.mjs) and to prevent WASM-heavy operations
        // like Jq from initialising when the Cloud worker module first loads.
        let operations;
        try {
            operations = await import("./index.mjs");
        } catch (e) {
            throw new OperationError(`AI Agent: Failed to load operation registry: ${e.message}`);
        }

        const creds = getGcpCredentials();
        if (!creds || !creds.quotaProject || !creds.defaultRegion) {
            throw new OperationError("Please configure a Quota Project and Default Region in the 'Authenticate Google Cloud' operation before using this ingredient.");
        }

        // Store original binary data for binary-input tools
        const pipelineBuffer = input;
        let currentText = new TextDecoder("utf-8", { fatal: false }).decode(input);

        // === Build tool schemas ===
        const toolNames = toolsArg.split(",").map(s => s.trim()).filter(Boolean);
        const functionDeclarations = [];
        const funcDeclByVertexName = {}; // vertex function name → { _ccName, _isBinary }

        for (const toolName of toolNames) {
            // Find the op by name from the dynamically loaded index
            let OpClass = null;
            for (const key of Object.keys(operations)) {
                try {
                    const candidate = operations[key];
                    if (typeof candidate === "function") {
                        const inst = new candidate();
                        if (inst.name === toolName) {
                            OpClass = candidate;
                            break;
                        }
                    }
                } catch (e) { /* skip */ }
            }
            if (!OpClass) {
                if (isWorkerEnvironment()) self.sendStatusMessage(`⚠️ Tool '${toolName}' not found, skipping.`);
                continue;
            }
            const op = new OpClass();
            const decl = this._buildFunctionDeclaration(op);
            if (!decl) {
                if (isWorkerEnvironment()) self.sendStatusMessage(`⚠️ Tool '${toolName}' is a flow-control op, skipping.`);
                continue;
            }
            const meta = { _ccName: decl._ccName, _isBinary: decl._isBinary };
            delete decl._ccName;
            delete decl._isBinary;
            functionDeclarations.push(decl);
            funcDeclByVertexName[decl.name] = meta;
        }

        if (functionDeclarations.length === 0) {
            throw new OperationError("AI Agent: No valid tools could be built. Check that the operation names are spelled correctly (case-sensitive, spaces included).");
        }

        // === Build system prompt with context injection ===
        const sizeKB = (input.byteLength / 1024).toFixed(1);
        const contextNote = [
            `[Context] The current pipeline data is ${mimeType}, ${sizeKB} KB.`,
            "Binary tools (e.g. GCloud Vision Analyze, GCloud Speech to Text) operate directly on this pipeline data — you do NOT need to pass file bytes as arguments, only provide the operation-specific parameters listed in each tool's schema.",
            "Text tools operate on the current text output of the pipeline.",
            "After each tool call you will receive the result and can decide what to do next.",
            "When you have a final answer, respond with text only (no further tool calls)."
        ].join(" ");

        const project = creds.quotaProject;
        const region = creds.defaultRegion;
        const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/google/models/${encodeURIComponent(modelName)}:generateContent`;

        // === Initial user message ===
        const userMessageText = mimeType === "text/plain" ?
            currentText :
            `[${mimeType} data available in pipeline, ${sizeKB} KB]`;

        const contents = [
            { role: "user", parts: [{ text: userMessageText }] }
        ];

        const toolCallLog = []; // Each entry: { name, args, result }
        let iterations = 0;

        // === Agent loop ===
        while (iterations < maxIterations) {
            iterations++;

            let data;
            try {
                data = await gcpFetch(url, {
                    method: "POST",
                    body: {
                        contents,
                        systemInstruction: {
                            role: "system",
                            parts: [{ text: `${contextNote}\n\n${systemPrompt}` }]
                        },
                        tools: [{ functionDeclarations }],
                        generationConfig: {
                            maxOutputTokens: maxTokens,
                            temperature
                        }
                    }
                });
            } catch (e) {
                throw new OperationError(`AI Agent: Vertex AI API error on iteration ${iterations}: ${e.message}`);
            }

            if (!data.candidates || data.candidates.length === 0) {
                throw new OperationError("AI Agent: No candidates returned from Vertex AI.");
            }

            const candidate = data.candidates[0];
            const parts = candidate?.content?.parts ?? [];

            // Collect all function calls in this turn (Gemini may request multiple)
            const functionCalls = parts.filter(p => p.functionCall);
            const textParts = parts.filter(p => p.text);

            if (functionCalls.length === 0 && textParts.length > 0) {
                // Final text answer — done
                const llmAnswer = textParts.map(p => p.text).join("");

                if (outputMode === "AI Agent Flow & Output") {
                    return JSON.stringify({
                        "ai_agent": {
                            iterations,
                            tools: toolCallLog.map((t, i) => ({
                                step: i + 1,
                                name: t.name,
                                args: t.args,
                                result: t.result
                            })),
                            "llm_answer": llmAnswer
                        },
                        output: currentText
                    }, null, 2);
                }

                // Pure Output — return exactly what the last tool produced
                return currentText;
            }

            if (functionCalls.length === 0) {
                // No function calls and no text — unexpected, break
                break;
            }

            // Add the model's response turn (with all function calls)
            contents.push({ role: "model", parts });

            // Execute each tool call and build the function response parts
            const responseParts = [];
            for (const fc of functionCalls) {
                const { name: vertexName, args: llmArgs } = fc.functionCall;
                const meta = funcDeclByVertexName[vertexName];

                if (!meta) {
                    responseParts.push({
                        functionResponse: {
                            name: vertexName,
                            response: { error: `Unknown tool: ${vertexName}` }
                        }
                    });
                    continue;
                }

                const ccName = meta._ccName;
                if (isWorkerEnvironment()) self.sendStatusMessage(`🔧 Calling tool: ${ccName}...`);

                let resultStr;
                try {
                    const { result, updatedText } = await this._executeTool(
                        ccName, llmArgs || {}, pipelineBuffer, currentText, operations
                    );
                    resultStr = result;
                    currentText = updatedText;
                } catch (e) {
                    resultStr = `Error executing ${ccName}: ${e.message}`;
                }

                const snippet = resultStr.slice(0, 200) + (resultStr.length > 200 ? "…" : "");
                if (isWorkerEnvironment()) self.sendStatusMessage(`✅ ${ccName} → ${snippet}`);
                toolCallLog.push({
                    name: ccName,
                    args: llmArgs || {},
                    result: snippet
                });

                responseParts.push({
                    functionResponse: {
                        name: vertexName,
                        response: {
                            result: resultStr.slice(0, 8000) // Cap to avoid context window issues
                        }
                    }
                });
            }

            // Add the tool responses as a user turn
            contents.push({ role: "user", parts: responseParts });
        }

        // Max iterations reached
        if (outputMode === "AI Agent Flow & Output") {
            return JSON.stringify({
                "ai_agent": {
                    iterations,
                    stopped: "max_iterations",
                    tools: toolCallLog.map((t, i) => ({
                        step: i + 1,
                        name: t.name,
                        args: t.args,
                        result: t.result
                    }))
                },
                output: currentText
            }, null, 2);
        }

        // Pure Output — return the last tool result even if max iterations hit
        return currentText;
    }

}

export default AIAgent;
