/**
 * Local AI operation tests (Prompt Local LLM, Local LLM Models).
 *
 * The models themselves only run in a browser, so these cover argument
 * checks and the messages shown when the browser features are missing.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */
import TestRegister from "../../lib/TestRegister.mjs";

const PROMPT_ARGS = ["You are a helpful AI assistant.", "Auto", "", "Auto", 1024, 0.7, 4096];
const NO_OPFS = "Local model storage needs a browser with the Origin Private File System (recent Chrome, Edge, Firefox or Safari).";

TestRegister.addTests([
    {
        name: "Prompt Local LLM: needs input or system prompt",
        input: "",
        expectedOutput: "Please provide either a user prompt (via input) or a system prompt.",
        recipeConfig: [{ op: "Prompt Local LLM", args: ["", ...PROMPT_ARGS.slice(1)] }]
    },
    {
        name: "Prompt Local LLM: Chrome built-in needs the web app",
        input: "Hello",
        expectedOutput: "This feature needs the browser UI thread (service 'chromeLLM.availability') and only works in the CyberChefCloud web app.",
        recipeConfig: [{ op: "Prompt Local LLM", args: PROMPT_ARGS }]
    },
    {
        name: "Prompt Local LLM: GGUF backend needs a model name",
        input: "Hello",
        expectedOutput: "Choose a stored GGUF model in the 'Model' argument. Use 'Local LLM Models' to download or import one.",
        recipeConfig: [{ op: "Prompt Local LLM", args: [PROMPT_ARGS[0], "GGUF model (wllama / llama.cpp)", ...PROMPT_ARGS.slice(2)] }]
    },
    {
        name: "Prompt Local LLM: Auto with a model needs the model store",
        input: "Hello",
        expectedOutput: NO_OPFS,
        recipeConfig: [{ op: "Prompt Local LLM", args: [PROMPT_ARGS[0], "Auto", "model.gguf", ...PROMPT_ARGS.slice(3)] }]
    },
    {
        name: "Local LLM Models: list needs the model store",
        input: "",
        expectedOutput: NO_OPFS,
        recipeConfig: [{ op: "Local LLM Models", args: ["List models", "", ""] }]
    },
    {
        name: "Local LLM Models: import needs a file name",
        input: "GGUF",
        expectedOutput: "Set 'File Name' (e.g. my-model-Q4_K_M.gguf); the extension decides which backend can load it.",
        recipeConfig: [{ op: "Local LLM Models", args: ["Import input as model", "", ""] }]
    },
    {
        name: "Local LLM Models: download needs an https URL",
        input: "",
        expectedOutput: "Enter an https:// URL to a model file.",
        recipeConfig: [{ op: "Local LLM Models", args: ["Download from URL", "http://example.com/m.gguf", ""] }]
    }
]);
