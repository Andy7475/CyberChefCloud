/**
 * Browser-local model file store, backed by the Origin Private File System (OPFS).
 *
 * OPFS is per-origin storage that works in both the UI thread and Web Workers,
 * handles multi-GB files, and can be written as a stream, so a model never has
 * to sit in memory in one piece while it is downloaded. Files persist across
 * page reloads until deleted (or evicted by the browser under storage pressure,
 * unless persistent storage has been granted).
 *
 * Split GGUF files (`name-00001-of-00003.gguf`) are grouped into one model.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../errors/OperationError.mjs";

const STORE_DIR = "ccc-local-models";
const SHARD_RE = /-(\d{5})-of-(\d{5})(\.[^.]+)$/;

/**
 * Model file extensions and the format each one implies.
 * Only formats with a registered provider can be prompted; the rest can still
 * be stored so that a future provider can use them.
 */
export const MODEL_FORMATS = {
    ".gguf": "gguf",
    ".task": "litert",
    ".litertlm": "litert",
    ".onnx": "onnx",
    ".bin": "binary"
};

/**
 * Returns the format name for a model file name, or "unknown".
 *
 * @param {string} fileName
 * @returns {string}
 */
export function formatForFile(fileName) {
    const lower = fileName.toLowerCase();
    const ext = Object.keys(MODEL_FORMATS).find(e => lower.endsWith(e));
    return ext ? MODEL_FORMATS[ext] : "unknown";
}

/**
 * Returns the model name for a file name (strips the split-GGUF shard suffix).
 *
 * @param {string} fileName
 * @returns {string}
 */
export function modelNameForFile(fileName) {
    return fileName.replace(SHARD_RE, "$3");
}

/**
 * Rejects file names that could escape the store directory or are empty.
 *
 * @param {string} fileName
 * @returns {string}
 */
function checkFileName(fileName) {
    const name = (fileName || "").trim();
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
        throw new OperationError(`Invalid model file name '${fileName}'. Use a plain file name such as 'gemma-3-1b-it-Q4_K_M.gguf'.`);
    }
    return name;
}

/**
 * Opens (creating if needed) the model directory in OPFS.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getStoreDir() {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.getDirectory) {
        throw new OperationError("Local model storage needs a browser with the Origin Private File System (recent Chrome, Edge, Firefox or Safari).");
    }
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(STORE_DIR, { create: true });
}

/**
 * Lists stored models, grouping split GGUF shards.
 *
 * @returns {Promise<Object[]>} [{name, format, size, files: [{name, size}]}]
 */
export async function listModels() {
    const dir = await getStoreDir();
    const models = new Map();
    for await (const [fileName, handle] of dir.entries()) {
        if (handle.kind !== "file" || fileName.endsWith(".crswap")) continue;
        const file = await handle.getFile();
        const name = modelNameForFile(fileName);
        if (!models.has(name)) {
            models.set(name, { name, format: formatForFile(fileName), size: 0, files: [] });
        }
        const model = models.get(name);
        model.size += file.size;
        model.files.push({ name: fileName, size: file.size });
    }
    const list = [...models.values()];
    list.forEach(m => m.files.sort((a, b) => a.name.localeCompare(b.name)));
    return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Writes one model file into the store.
 *
 * @param {string} fileName
 * @param {ArrayBuffer|ReadableStream<Uint8Array>} data
 * @param {function(number)} [onProgress] - Called with bytes written so far.
 * @returns {Promise<number>} Bytes written.
 */
export async function saveModelFile(fileName, data, onProgress) {
    const name = checkFileName(fileName);
    const dir = await getStoreDir();
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let written = 0;
    try {
        if (data instanceof ArrayBuffer) {
            await writable.write(data);
            written = data.byteLength;
        } else {
            const reader = data.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                await writable.write(value);
                written += value.byteLength;
                if (onProgress) onProgress(written);
            }
        }
        await writable.close();
    } catch (e) {
        await writable.abort().catch(() => {});
        await dir.removeEntry(name).catch(() => {});
        throw e;
    }
    return written;
}

/**
 * Returns the stored files of a model, in shard order, as Blobs.
 *
 * @param {string} modelName - Model name as returned by listModels().
 * @returns {Promise<File[]>}
 */
export async function getModelFiles(modelName) {
    const model = (await listModels()).find(m => m.name === modelName);
    if (!model) {
        throw new OperationError(`No local model named '${modelName}'. Use 'Local LLM Models' to list, import or download models.`);
    }
    const dir = await getStoreDir();
    return Promise.all(model.files.map(async f => (await dir.getFileHandle(f.name)).getFile()));
}

/**
 * Deletes every file of a model.
 *
 * @param {string} modelName
 * @returns {Promise<number>} Number of files removed.
 */
export async function deleteModel(modelName) {
    const model = (await listModels()).find(m => m.name === modelName);
    if (!model) throw new OperationError(`No local model named '${modelName}'.`);
    const dir = await getStoreDir();
    for (const f of model.files) await dir.removeEntry(f.name);
    return model.files.length;
}

/**
 * Returns browser storage usage and quota for this origin.
 *
 * @returns {Promise<{usage: number, quota: number, persisted: boolean}>}
 */
export async function storageInfo() {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate) {
        return { usage: 0, quota: 0, persisted: false };
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage, quota, persisted };
}

/**
 * Formats a byte count for display.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
