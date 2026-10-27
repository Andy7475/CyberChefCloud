/**
 * Request/response messaging from the ChefWorker to the main UI thread.
 *
 * Some browser APIs (for example Chrome's built-in `LanguageModel`) are only
 * exposed on `window`, not inside Web Workers. Operations run in a worker, so
 * they post a `mainThreadRequest` message and wait for the matching
 * `mainThreadResponse`. The UI side lives in `src/web/MainThreadHost.mjs`.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../errors/OperationError.mjs";
import { isWorkerEnvironment } from "../Utils.mjs";

let nextRequestId = 1;

/**
 * Sends a request to the main thread and resolves with its result.
 *
 * Messages with `progress: true` are forwarded to `onProgress` (e.g. model
 * download progress) and do not settle the promise.
 *
 * @param {string} service - Handler name registered in MainThreadHost.
 * @param {Object} payload - Structured-cloneable request data.
 * @param {Object} [options]
 * @param {function(Object)} [options.onProgress] - Called with progress payloads.
 * @param {Transferable[]} [options.transfer] - Objects to transfer, not copy.
 * @returns {Promise<*>}
 */
export function requestMainThread(service, payload, { onProgress, transfer = [] } = {}) {
    if (!isWorkerEnvironment()) {
        return Promise.reject(new OperationError(
            `This feature needs the browser UI thread (service '${service}') and only works in the CyberChefCloud web app.`));
    }

    const id = nextRequestId++;

    return new Promise((resolve, reject) => {
        /**
         * Handles responses for this request id.
         *
         * @param {MessageEvent} e
         */
        const handler = function (e) {
            const r = e.data;
            if (!r || r.action !== "mainThreadResponse" || r.data.id !== id) return;

            if (r.data.progress) {
                if (onProgress) onProgress(r.data.result);
                return;
            }

            self.removeEventListener("message", handler);
            if (r.data.error) {
                reject(new OperationError(r.data.error));
            } else {
                resolve(r.data.result);
            }
        };
        self.addEventListener("message", handler);

        self.postMessage({
            action: "mainThreadRequest",
            data: {
                id,
                service,
                payload,
                // WorkerWaiter uses inputNum to route the response back to this worker
                inputNum: self.inputNum || 0
            }
        }, transfer);
    });
}
