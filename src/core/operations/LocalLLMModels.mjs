/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { isWorkerEnvironment } from "../Utils.mjs";
import { PROVIDERS } from "../lib/LocalLLM.mjs";
import {
    listModels, saveModelFile, deleteModel, storageInfo, formatBytes, formatForFile
} from "../lib/LocalModelStore.mjs";

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

/**
 * Local LLM Models operation
 */
class LocalLLMModels extends Operation {

    /**
     * LocalLLMModels constructor
     */
    constructor() {
        super();

        this.name = "Local LLM Models";
        this.module = "LocalAI";
        this.description = [
            "Manages the model files used by <code>Prompt Local LLM</code>. Models are stored in this browser's private file system (OPFS) for this site, persist across reloads, and never leave the device.",
            "<br><br>",
            "<b>Actions:</b>",
            "<ul>",
            "<li><b>List models</b>: stored models, their format and size, and storage quota.</li>",
            "<li><b>Backend status</b>: whether each backend (Chrome built-in, GGUF) can run here.</li>",
            "<li><b>Download from URL</b>: streams a model file into storage, e.g. <code>https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf</code>. For a split GGUF, give the <code>-00001-of-0000N.gguf</code> URL and every part is downloaded.</li>",
            "<li><b>Import input as model</b>: saves the input (e.g. a <code>.gguf</code> file dropped into the input pane) under <code>File Name</code>. Files over 2 GB must be split with <code>llama-gguf-split</code> first.</li>",
            "<li><b>Delete model</b>: removes the model named in <code>File Name</code>.</li>",
            "</ul>",
            "Supported format today: GGUF (<code>.gguf</code>). Use a quantised model (Q4_K_M or similar) between 0.5 and 4 B parameters for usable speed.",
            "<br><br>",
            "Downloads are only allowed from hosts in the page's Content Security Policy (Hugging Face by default)."
        ].join("\n");
        this.infoURL = "https://huggingface.co/models?library=gguf";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Action",
                "type": "option",
                "value": ["List models", "Backend status", "Download from URL", "Import input as model", "Delete model"]
            },
            {
                "name": "URL",
                "type": "string",
                "value": ""
            },
            {
                "name": "File Name",
                "type": "string",
                "value": ""
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [action, url, fileName] = args;

        switch (action) {
            case "List models":
                return this.listText();
            case "Backend status":
                return this.statusText();
            case "Download from URL":
                return this.download(url.trim(), fileName.trim());
            case "Import input as model": {
                if (!input || !input.byteLength) throw new OperationError("The input is empty. Drop a model file into the input pane first.");
                if (!fileName.trim()) throw new OperationError("Set 'File Name' (e.g. my-model-Q4_K_M.gguf); the extension decides which backend can load it.");
                await saveModelFile(fileName.trim(), input);
                const list = await this.listText();
                return `Saved ${fileName.trim()} (${formatBytes(input.byteLength)}).\n\n${list}`;
            }
            case "Delete model": {
                if (!fileName.trim()) throw new OperationError("Set 'File Name' to the model name to delete.");
                const n = await deleteModel(fileName.trim());
                const list = await this.listText();
                return `Deleted ${fileName.trim()} (${n} file${n > 1 ? "s" : ""}).\n\n${list}`;
            }
            default:
                throw new OperationError(`Unknown action '${action}'.`);
        }
    }

    /**
     * Lists stored models and storage usage.
     *
     * @returns {Promise<string>}
     */
    async listText() {
        const models = await listModels();
        const { usage, quota, persisted } = await storageInfo();
        const lines = models.length ?
            models.map(m => `${m.name}\t${m.format}\t${formatBytes(m.size)}${m.files.length > 1 ? `\t(${m.files.length} parts)` : ""}`) :
            ["No models stored. Use 'Download from URL' or 'Import input as model'."];
        lines.push("", `Storage used: ${formatBytes(usage)} of ${formatBytes(quota)}${persisted ? " (persistent)" : " (may be evicted under storage pressure)"}`);
        return lines.join("\n");
    }

    /**
     * Reports each backend's availability.
     *
     * @returns {Promise<string>}
     */
    async statusText() {
        const lines = [];
        for (const p of PROVIDERS) {
            const status = await p.status();
            lines.push(`${p.label}: ${status}`);
        }
        return lines.join("\n");
    }

    /**
     * Streams a model (and any further split-GGUF parts) into the store.
     *
     * @param {string} url
     * @param {string} fileName - Optional override for single-file downloads.
     * @returns {Promise<string>}
     */
    async download(url, fileName) {
        if (!/^https:\/\//i.test(url)) throw new OperationError("Enter an https:// URL to a model file.");

        const urls = [url];
        const shard = url.match(SHARD_RE);
        if (shard) {
            const total = parseInt(shard[2], 10);
            for (let i = 2; i <= total; i++) {
                urls.push(url.replace(SHARD_RE, `-${String(i).padStart(5, "0")}-of-${shard[2]}.gguf`));
            }
        }

        const saved = [];
        for (const u of urls) {
            const name = (urls.length === 1 && fileName) ? fileName : decodeURIComponent(new URL(u).pathname.split("/").pop());
            if (formatForFile(name) === "unknown") {
                throw new OperationError(`'${name}' has no recognised model extension (.gguf, .task, .litertlm, .onnx). Set 'File Name' to name it.`);
            }
            const bytes = await this.fetchToStore(u, name);
            saved.push(`${name} (${formatBytes(bytes)})`);
        }
        const list = await this.listText();
        return `Downloaded ${saved.join(", ")}.\n\n${list}`;
    }

    /**
     * Fetches one URL into the store, reporting progress.
     *
     * @param {string} url
     * @param {string} name
     * @returns {Promise<number>} Bytes written.
     */
    async fetchToStore(url, name) {
        let res;
        try {
            res = await fetch(url);
        } catch (e) {
            throw new OperationError(`Download of ${url} failed: ${e.message}. If the host is not in the page's Content Security Policy (connect-src), the browser blocks it.`);
        }
        if (!res.ok || !res.body) throw new OperationError(`Download of ${url} failed: HTTP ${res.status}.`);

        const total = parseInt(res.headers.get("content-length") || "0", 10);
        let lastReport = 0;
        return saveModelFile(name, res.body, written => {
            if (!isWorkerEnvironment() || written - lastReport < 8 * 1024 * 1024) return;
            lastReport = written;
            self.sendStatusMessage(`Downloading ${name}: ${formatBytes(written)}${total ? ` of ${formatBytes(total)} (${Math.round(written * 100 / total)}%)` : ""}`);
        });
    }

}

export default LocalLLMModels;
