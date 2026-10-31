/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Dish from "../Dish.mjs";
import { gcpFetch, getGcpCredentials, vertexGeminiUrl } from "../lib/GoogleCloud.mjs";
import { resolveMimeType } from "../lib/FileType.mjs";
import { fuzzyMatch } from "../lib/FuzzyMatch.mjs";
import { isWorkerEnvironment } from "../Utils.mjs";

// A Model value of "local:chrome" or "local:<stored GGUF model>" runs the agent in the browser.
const LOCAL_PREFIX = "local:";
const LOCAL_CONTEXT_SIZE = 8192;
const LOCAL_TOOL_PROTOCOL = [
    "You cannot call tools directly. To call a tool, reply with ONLY a JSON object, with no other text:",
    "{\"tool\": \"<tool name>\", \"args\": {\"<arg name>\": <value>}}",
    "Call one tool per reply. You will then be shown the tool result.",
    "When you have the final answer, reply with ONLY: {\"answer\": \"<your answer>\"}"
].join("\n");

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
            "Instantiates an autonomous AI Agent powered by Vertex AI Gemini, or by a model running in your browser, that can intelligently chain Operations.",
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
            "<li><b>AI Agent Flow & Output:</b> A JSON payload containing the full trace of tool calls, the LLM answer, the recipe and the final ingredient result.</li>",
            "<li><b>Recipe:</b> The tool calls that produced the final ingredient, as CyberChef recipe JSON. Undone, reset and failed steps are left out. Paste it into <i>Load recipe</i> to rerun the same steps without the LLM.</li>",
            "</ul>",
            "<br>",
            "<b>Location:</b> Most Gemini 3.x models are only served from the <code>global</code> location (the default). Choose <code>Default Region</code> to use the region set in <code>Authenticate Google Cloud</code> when data must stay in one region; gemini-3.5-flash is available regionally (e.g. europe-west2).",
            "<br><br>",
            "<b>Local models:</b> Set <code>Model</code> to <code>local:chrome</code> for Chrome's built-in Gemini Nano, or <code>local:&lt;name&gt;</code> for a GGUF model stored with <code>Local LLM Models</code>. Nothing is sent to Vertex AI and no authentication is needed (cloud tools still need it). Small models follow tool instructions less reliably than Gemini.",
            "<br><br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation, unless a local model is used."
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
                    { name: "gemini-3.8-flash", value: "gemini-3.8-flash" },
                    { name: "gemini-3.1-pro-preview", value: "gemini-3.1-pro-preview" },
                    { name: "gemini-3.5-flash", value: "gemini-3.5-flash" },
                    { name: "gemini-3.5-flash-lite", value: "gemini-3.5-flash-lite" },
                    { name: "Local: Chrome built-in (Gemini Nano)", value: "local:chrome" }
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
                        name: "Text Manipulation",
                        value: "Regular expression, Find / Replace, Remove whitespace, To Upper case, To Lower case, Reverse, Count occurrences, To Base64, From Base64, URL Encode, URL Decode, Escape string, Unescape string"
                    },
                    {
                        name: "List Manipulation",
                        value: "Split, Find / Replace, Sort, Unique, Filter, Head, Tail, Add line numbers, Remove line numbers, Set Difference, Set Intersection, Set Union, Symmetric Difference, Cartesian Product"
                    },
                    {
                        name: "JSON Manipulation",
                        value: "Jsonata Query, Jq, JPath expression, JSON Beautify, JSON Minify, JSON to CSV, CSV to JSON, JSON to YAML, YAML to JSON, Regular expression, Find / Replace"
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
                "acceptsOperations": true,
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
                "value": ["Agent Answer", "Final Ingredient", "AI Agent Flow & Output", "Recipe"]
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
     * Returns the value an argument takes when the LLM leaves it out: the
     * first choice for list arguments, otherwise the configured value.
     * @param {Object} arg - CyberChef argument definition
     * @returns {*}
     */
    _defaultArgValue(arg) {
        return Array.isArray(arg.value) ? (arg.value[0]?.value ?? arg.value[0] ?? "") : arg.value;
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
                description: `${arg.name} (default: ${JSON.stringify(this._defaultArgValue(arg))})` +
                    (arg.type === "toggleString" ? ` [interpreted as ${arg.toggleValues[0]}]` : "")
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
     * @returns {Promise<{result: string, updatedText: string, updatedBuffer: ArrayBuffer, step: {op: string, args: Array}}>}
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
            let val = llmArgs[arg.name];
            if (val === undefined || val === null) {
                val = this._defaultArgValue(arg);
            } else if (arg.type === "number") {
                val = Number(val);
            } else if (arg.type === "boolean") {
                val = Boolean(val);
            } else if (arg.type === "option") {
                // Accept any capitalisation, otherwise tell the model the valid values.
                const allowed = arg.value.map(v => (typeof v === "object" ? v.value ?? v.name : v));
                const match = allowed.find(v => String(v).toLowerCase() === String(val).toLowerCase());
                if (match === undefined) {
                    throw new OperationError(`'${arg.name}' must be one of: ${allowed.join(", ")}.`);
                }
                val = match;
            }
            // Ops (and saved recipes) expect toggleString values as {option, string}.
            if (arg.type === "toggleString" && typeof val !== "object") {
                val = { option: arg.toggleValues[0], string: String(val) };
            }
            return val;
        });

        // Convert between pipeline bytes and the op's input/output types the
        // same way a recipe does (e.g. HTML output is stripped to plain text).
        // Setting ingValues prepares them as a recipe does (e.g. "\n" escapes in binaryString args).
        op.ingValues = ingValues;
        const dish = new Dish(currentBuffer, Dish.ARRAY_BUFFER);
        dish.set(await op.run(await dish.get(op.inputType), op.ingValues), op.outputType);
        const updatedBuffer = await dish.get(Dish.ARRAY_BUFFER);
        const resultStr = new TextDecoder("utf-8", { fatal: false }).decode(updatedBuffer);

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

        return { result: resultStr, updatedText: resultStr, updatedBuffer, step: { op: opName, args: ingValues } };
    }

    /**
     * Runs one agent turn on a browser-local model.
     *
     * Local models have no native function calling, so the tools and the
     * conversation so far are rendered as text and the model replies in JSON.
     * The reply is converted back into Gemini-style parts, so the agent loop
     * treats both backends the same way.
     *
     * @param {string} localModel - "chrome", or the name of a stored GGUF model.
     * @param {string} systemText - System instruction.
     * @param {Object[]} contents - Conversation in Vertex AI `contents` format.
     * @param {Object[]} functionDeclarations - Available tools.
     * @param {number} maxTokens
     * @param {number} temperature
     * @returns {Promise<Object[]>} Gemini-style parts: [{functionCall}] or [{text}].
     */
    async _promptLocal(localModel, systemText, contents, functionDeclarations, maxTokens, temperature) {
        const { promptLocalLLM, AUTO_BACKEND } = await import("../lib/LocalLLM.mjs");

        const toolList = functionDeclarations
            .map(d => `- ${d.name}: ${d.description}\n  args: ${JSON.stringify(d.parameters.properties)}`)
            .join("\n");
        const transcript = contents.map(c => c.parts.map(p => {
            if (p.functionCall) return `Assistant: ${JSON.stringify({ tool: p.functionCall.name, args: p.functionCall.args })}`;
            if (p.functionResponse) {
                const r = p.functionResponse.response;
                return `Tool result (${p.functionResponse.name}): ${r.result ?? `ERROR: ${r.error}`}`;
            }
            return `${c.role === "model" ? "Assistant" : "User"}: ${p.text}`;
        }).join("\n")).join("\n\n");

        const isChrome = localModel === "chrome";
        const reply = await promptLocalLLM({
            backend: isChrome ? "chrome" : AUTO_BACKEND,
            model: isChrome ? "" : localModel,
            systemPrompt: `${systemText}\n\n${LOCAL_TOOL_PROTOCOL}\n\nTools:\n${toolList}`,
            text: transcript,
            mimeType: "text/plain",
            maxTokens,
            temperature,
            contextSize: LOCAL_CONTEXT_SIZE,
            // Chrome constrains decoding to this schema, so its replies always parse.
            responseConstraint: {
                type: "object",
                properties: {
                    tool: { type: "string", enum: functionDeclarations.map(d => d.name) },
                    args: { type: "object" },
                    answer: { type: "string" }
                },
                additionalProperties: false
            },
            onStatus: msg => {
                if (isWorkerEnvironment()) self.sendStatusMessage(msg);
            }
        });
        return this._parseLocalReply(reply);
    }

    /**
     * Converts a local model's text reply into Gemini-style parts. A JSON
     * object with a "tool" key becomes a function call; {"answer": ...} or
     * plain text is the final answer.
     *
     * @param {string} reply
     * @returns {Object[]}
     */
    _parseLocalReply(reply) {
        try {
            const obj = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
            if (typeof obj.tool === "string") {
                return [{ functionCall: { name: obj.tool.replace(/[^a-zA-Z0-9_]/g, "_"), args: obj.args || {} } }];
            }
            if (typeof obj.answer === "string") return [{ text: obj.answer }];
        } catch (e) {
            // Not JSON: a plain-text final answer.
        }
        return [{ text: reply }];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [systemPrompt, modelName, mimeTypeArg, , toolsArg, maxTokens, temperature, maxIterations, outputMode, locationArg = "global"] = args;
        const mimeType = resolveMimeType(input, mimeTypeArg);

        let operations;
        try {
            operations = await import("./index.mjs");
        } catch (e) {
            throw new OperationError(`AI Agent: Failed to load operation registry: ${e.message}`);
        }

        const localModel = modelName.startsWith(LOCAL_PREFIX) ? modelName.slice(LOCAL_PREFIX.length).trim() : null;

        let url;
        if (localModel === null) {
            const creds = getGcpCredentials();
            const location = locationArg === "Default Region" ? creds?.defaultRegion : locationArg;
            if (!creds || !creds.quotaProject || !location) {
                throw new OperationError("Please configure a Quota Project (and a Default Region if Location is 'Default Region') in the 'Authenticate Google Cloud' operation before using this ingredient.");
            }
            url = vertexGeminiUrl(creds.quotaProject, location, modelName);
        }

        let currentBuffer = input;
        let currentText = new TextDecoder("utf-8", { fatal: false }).decode(input);

        // Initialize state tracking for both text and binary data. Each later
        // entry also holds the recipe step that produced it, so Undo/Reset
        // remove steps from the recipe too.
        let pipelineStateHistory = [{ text: currentText, buffer: currentBuffer }];
        const recipe = () => pipelineStateHistory.slice(1).map(s => s.step);

        const toolNames = toolsArg.split(",").map(s => s.trim()).filter(Boolean);
        const functionDeclarations = [];
        const funcDeclByVertexName = {};

        const opsByName = new Map();
        for (const candidate of Object.values(operations)) {
            try {
                if (typeof candidate === "function") opsByName.set(new candidate().name, candidate);
            } catch (e) { /* skip */ }
        }
        const opNames = [...opsByName.keys()];

        const unknownTools = [];
        for (const toolName of toolNames) {
            const ccName = opsByName.has(toolName) ? toolName : opNames.find(n => n.toLowerCase() === toolName.toLowerCase());
            if (!ccName) {
                const suggestions = opNames
                    .map(n => [n, fuzzyMatch(toolName, n)])
                    .filter(([, m]) => m[0])
                    .sort((a, b) => b[1][1] - a[1][1])
                    .slice(0, 3)
                    .map(([n]) => `'${n}'`);
                unknownTools.push(`'${toolName}'` + (suggestions.length ? ` (did you mean ${suggestions.join(", ")}?)` : ""));
                continue;
            }
            const op = new (opsByName.get(ccName))();
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

        if (unknownTools.length) {
            throw new OperationError(`AI Agent: Unknown tool${unknownTools.length > 1 ? "s" : ""} ${unknownTools.join(", ")}. Names must match operation names; you can drag an operation onto the Tools box to add it.`);
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
        const systemText = `${contextNote}\n\n${systemPrompt}`;

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

            let parts;
            if (localModel !== null) {
                parts = await this._promptLocal(localModel, systemText, contents, functionDeclarations, maxTokens, temperature);
            } else {
                const body = {
                    contents,
                    systemInstruction: {
                        role: "system",
                        parts: [{ text: systemText }]
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

                parts = data.candidates[0]?.content?.parts ?? [];
            }

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
                        recipe: recipe(),
                        output: currentText
                    }, null, 2);
                } else if (outputMode === "Agent Answer") {
                    return llmAnswer;
                } else if (outputMode === "Recipe") {
                    return JSON.stringify(recipe(), null, 2);
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
                    const { result, updatedText, updatedBuffer, step } = await this._executeTool(
                        ccName, llmArgs || {}, currentBuffer, currentText, operations
                    );
                    resultStr = result;
                    currentText = updatedText;
                    currentBuffer = updatedBuffer;

                    // Save the new state to history upon success
                    pipelineStateHistory.push({
                        text: currentText,
                        buffer: currentBuffer,
                        step
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
                recipe: recipe(),
                output: currentText
            }, null, 2);
        } else if (outputMode === "Recipe") {
            return JSON.stringify(recipe(), null, 2);
        } else if (outputMode === "Agent Answer") {
            return "Agent stopped due to hitting Max Iterations limit prior to answering. Check the CyberChef output audit logs for more details on tool usage up to this point.";
        }

        return currentText;
    }

}

export default AIAgent;
