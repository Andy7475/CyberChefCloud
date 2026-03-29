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
            "<b>Output Modes:</b>",
            "<ul>",
            "<li><b>Agent Answer:</b> The final text explanation or answer provided by the LLM itself.</li>",
            "<li><b>Final Ingredient:</b> The exact raw bytes/text returned by the last tool the Agent used.</li>",
            "<li><b>AI Agent Flow & Output:</b> A JSON payload containing the full trace of tool calls, the LLM answer, and the final ingredient result.</li>",
            "</ul>",
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
                    { name: "gemini-2.5-pro", value: "gemini-2.5-pro" }
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
                "name": "Prefilled Tool Examples",
                "type": "populateAppendOption",
                "value": [
                    {
                        name: "User defined",
                        value: "From Base64, To Base64, From Hex, To Hex, Extract email addresses"
                    },
                    {
                        name: "Image Analysis",
                        value: "GCloud Vision Analyze, Prompt LLM, Extract EXIF, Extract LSB, Extract RGBA, Extract ID3, Randomize Colour Palette, Split Colour Channels, View Bit Plane, GCloud Vision OCR, Detect File Type"
                    },
                    {
                        name: "Video Analysis",
                        value: "GCloud Video Intelligence, Google Translate, GCloud Natural Language, Prompt LLM, Regular expression"
                    },
                    {
                        name: "Intelligence Analyst",
                        value: "GCloud Video Intelligence, GCloud Vision Analyze, GCloud Vision OCR, GCloud Speech to Text, Google Translate, GCloud Natural Language, GCloud Knowledge Graph, GCloud Document AI, GCloud Geocode, GCloud Place Details, GCloud Places Search, Prompt LLM, Extract EXIF, Extract email addresses, Extract IP addresses, Extract MAC addresses, Extract domains, Extract URLs, Regular expression, Find / Replace, URL Encode, URL Decode, Detect File Type"
                    }
                ],
                "target": 4
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
                "value": ["Agent Answer", "Final Ingredient", "AI Agent Flow & Output"]
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
            _ccName: op.name,
            _isBinary: isBinary
        };
    }

    /**
     * Executes a CyberChef operation as a tool call from the LLM.
     * @param {string} opName - The CyberChef operation name
     * @param {Object} llmArgs - Key-value arguments from the LLM
     * @param {ArrayBuffer} currentBuffer - The current binary pipeline data
     * @param {string} currentText - The current text pipeline data
     * @param {Object} operations - The dynamically-loaded operations index module
     * @returns {Promise<{result: string, updatedText: string, updatedBuffer: ArrayBuffer}>}
     */
    async _executeTool(opName, llmArgs, currentBuffer, currentText, operations) {
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
                // Skip
            }
        }

        if (!OpClass) {
            throw new OperationError(`AI Agent: Tool '${opName}' not found in the CyberChef operation registry.`);
        }

        const op = new OpClass();

        if (op.flowControl) {
            throw new OperationError(`AI Agent: Tool '${opName}' is a flow-control operation and cannot be called as an agent tool.`);
        }

        const ingValues = op.args.map(arg => {
            const val = llmArgs[arg.name];
            if (val !== undefined && val !== null) {
                if (arg.type === "number") return Number(val);
                if (arg.type === "boolean") return Boolean(val);
                return val;
            }
            return Array.isArray(arg.value) ? (arg.value[0]?.value ?? arg.value[0] ?? "") : arg.value;
        });

        const isBinary = op.inputType === "ArrayBuffer" ||
            op.inputType === "File" ||
            op.inputType.startsWith("List");

        let rawResult;
        if (isBinary) {
            rawResult = await op.run(currentBuffer, ingValues);
        } else {
            const inputData = op.inputType === "string" ?
                currentText :
                new TextEncoder().encode(currentText).buffer;
            rawResult = await op.run(inputData, ingValues);
        }

        let resultStr;
        let updatedBuffer;

        if (rawResult instanceof ArrayBuffer) {
            resultStr = new TextDecoder("utf-8", { fatal: false }).decode(rawResult);
            updatedBuffer = rawResult;
        } else if (rawResult instanceof Uint8Array) {
            resultStr = new TextDecoder("utf-8", { fatal: false }).decode(rawResult);
            updatedBuffer = rawResult.buffer;
        } else if (Array.isArray(rawResult)) {
            resultStr = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(rawResult));
            updatedBuffer = new Uint8Array(rawResult).buffer;
        } else if (typeof rawResult === "object" && rawResult !== null) {
            resultStr = JSON.stringify(rawResult, null, 2);
            updatedBuffer = new TextEncoder().encode(resultStr).buffer;
        } else {
            resultStr = String(rawResult ?? "");
            updatedBuffer = new TextEncoder().encode(resultStr).buffer;
        }

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

        return { result: resultStr, updatedText: resultStr, updatedBuffer };
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [systemPrompt, modelName, mimeTypeArg, , toolsArg, maxTokens, temperature, maxIterations, outputMode] = args;
        const mimeType = resolveMimeType(input, mimeTypeArg);

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

        let currentBuffer = input;
        let currentText = new TextDecoder("utf-8", { fatal: false }).decode(input);

        // Initialize state tracking for both text and binary data
        let pipelineStateHistory = [{ text: currentText, buffer: currentBuffer }];

        const toolNames = toolsArg.split(",").map(s => s.trim()).filter(Boolean);
        const functionDeclarations = [];
        const funcDeclByVertexName = {};

        for (const toolName of toolNames) {
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

        // Inject Built-in Meta-Tools
        const builtinTools = [
            {
                name: "Undo_Last_Step",
                description: "Reverts the pipeline data to the state it was before the previous tool was called. Use this if a tool produces garbage, throws an error, or gives incorrect output.",
                parameters: { type: "OBJECT", properties: { reason: { type: "STRING", description: "Why are you undoing?" } } }
            },
            {
                name: "Reset_Pipeline",
                description: "Reverts the pipeline data completely back to the original raw input data.",
                parameters: { type: "OBJECT", properties: { reason: { type: "STRING", description: "Why are you resetting?" } } }
            }
        ];
        functionDeclarations.push(...builtinTools);

        if (functionDeclarations.length === 0) {
            throw new OperationError(`AI Agent: No valid tools could be built. Check that the operation names are spelled correctly.`);
        }

        const sizeKB = (input.byteLength / 1024).toFixed(1);
        const contextNote = [
            `[Context] The initial pipeline data is ${mimeType}, ${sizeKB} KB.`,
            "Binary tools operate directly on the current pipeline data — you do NOT need to pass file bytes as arguments.",
            "Text tools operate on the current text output of the pipeline.",
            "After each tool call you will receive the result and can decide what to do next. If a tool fails or produces garbage, use Undo_Last_Step to revert the pipeline.",
            "When you have a final answer, respond with text only (no further tool calls)."
        ].join(" ");

        const project = creds.quotaProject;
        const region = creds.defaultRegion;
        const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/google/models/${encodeURIComponent(modelName)}:generateContent`;

        const userMessageText = mimeType === "text/plain" ?
            currentText :
            `[${mimeType} data available in pipeline, ${sizeKB} KB]`;

        const contents = [
            { role: "user", parts: [{ text: userMessageText }] }
        ];

        const toolCallLog = [];
        let iterations = 0;

        while (iterations < maxIterations) {
            iterations++;

            const body = {
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
            };

            let data;
            try {
                data = await gcpFetch(url, {
                    method: "POST",
                    body
                });
            } catch (e) {
                throw new OperationError(`AI Agent: Vertex AI API error on iteration ${iterations}: ${e.message}`);
            }

            if (!data.candidates || data.candidates.length === 0) {
                throw new OperationError("AI Agent: No candidates returned from Vertex AI.");
            }

            const candidate = data.candidates[0];
            const parts = candidate?.content?.parts ?? [];

            const functionCalls = parts.filter(p => p.functionCall);
            const textParts = parts.filter(p => p.text);

            if (functionCalls.length === 0 && textParts.length > 0) {
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
                } else if (outputMode === "Agent Answer") {
                    return llmAnswer;
                }
                return currentText;
            }

            if (functionCalls.length === 0) break;

            contents.push({ role: "model", parts });

            const responseParts = [];
            for (const fc of functionCalls) {
                const { name: vertexName, args: llmArgs } = fc.functionCall;
                let resultStr;

                // Intercept Built-in Meta-Tools
                if (vertexName === "Undo_Last_Step") {
                    if (pipelineStateHistory.length > 1) {
                        pipelineStateHistory.pop(); // Remove the current state
                        const previousState = pipelineStateHistory[pipelineStateHistory.length - 1];
                        currentText = previousState.text;
                        currentBuffer = previousState.buffer;
                        resultStr = `SUCCESS: Pipeline reverted. Reason provided: ${llmArgs?.reason || "none"}`;
                    } else {
                        resultStr = "ERROR: Cannot undo. You are already at the original input.";
                    }

                    if (isWorkerEnvironment()) self.sendStatusMessage(`⏪ Undoing last step...`);
                    toolCallLog.push({ name: vertexName, args: llmArgs || {}, result: resultStr });
                    responseParts.push({ functionResponse: { name: vertexName, response: { result: resultStr } } });
                    continue;
                }

                if (vertexName === "Reset_Pipeline") {
                    const originalState = pipelineStateHistory[0];
                    currentText = originalState.text;
                    currentBuffer = originalState.buffer;
                    pipelineStateHistory = [originalState];
                    resultStr = `SUCCESS: Pipeline reset to original raw input. Reason provided: ${llmArgs?.reason || "none"}`;

                    if (isWorkerEnvironment()) self.sendStatusMessage(`🔄 Resetting pipeline...`);
                    toolCallLog.push({ name: vertexName, args: llmArgs || {}, result: resultStr });
                    responseParts.push({ functionResponse: { name: vertexName, response: { result: resultStr } } });
                    continue;
                }

                // Standard CyberChef Tools
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

                try {
                    const { result, updatedText, updatedBuffer } = await this._executeTool(
                        ccName, llmArgs || {}, currentBuffer, currentText, operations
                    );
                    resultStr = result;
                    currentText = updatedText;
                    currentBuffer = updatedBuffer;

                    // Save the new state to history upon success
                    pipelineStateHistory.push({
                        text: currentText,
                        buffer: currentBuffer
                    });
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
                            result: resultStr.slice(0, 8000)
                        }
                    }
                });
            }

            contents.push({ role: "user", parts: responseParts });
        }

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
        } else if (outputMode === "Agent Answer") {
            return "Agent stopped due to hitting Max Iterations limit prior to answering. Check the CyberChef output audit logs for more details on tool usage up to this point.";
        }

        return currentText;
    }

}

export default AIAgent;
