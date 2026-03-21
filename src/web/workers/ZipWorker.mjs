/**
 * Web Worker to handle zipping the outputs for download.
 *
 * @author j433866 [j433866@gmail.com]
 * @copyright Crown Copyright 2019
 * @license Apache-2.0
 */

import zip from "zlibjs/bin/zip.min.js";
import Utils from "../../core/Utils.mjs";
import Dish from "../../core/Dish.mjs";
import {detectFileType} from "../../core/lib/FileType.mjs";
import loglevelMessagePrefix from "loglevel-message-prefix";

loglevelMessagePrefix(log, {
    prefixes: [],
    staticPrefixes: ["ZipWorker"],
});

const Zlib = zip.Zlib;

/**
 * Respond to message from parent thread.
 */
self.addEventListener("message", function(e) {
    // Handle message from the main thread
    const r = e.data;
    log.debug(`Receiving command '${r.action}'`);

    switch (r.action) {
        case "zipFiles":
            self.zipFiles(r.data);
            break;
        case "setLogLevel":
            log.setLevel(r.data, false);
            break;
        default:
            log.error(`Unknown action: '${r.action}'`);
    }
});

self.setOption = function(...args) {};

/**
 * Compress the files into a zip file and send the zip back
 * to the OutputWaiter.
 *
 * @param {object} outputs
 * @param {string} filename
 * @param {string} fileExtension
 */
self.zipFiles = async function(data) {
    const zip = new Zlib.Zip();
    const filename = data.filename;

    if (data.files) {
        for (let i = 0; i < data.files.length; i++) {
            const file = data.files[i];
            const encoder = new TextEncoder();
            const output = encoder.encode(file.content);
            const name = Utils.strToByteArray(file.name);
            zip.addFile(output, {filename: name});
        }
    } else {
        const outputs = data.outputs;
        const fileExtension = data.fileExtension;
        const inputNums = Object.keys(outputs);

        for (let i = 0; i < inputNums.length; i++) {
            const iNum = inputNums[i];
            let ext = fileExtension;

            const cloned = new Dish(outputs[iNum].data.dish);
            const output = new Uint8Array(await cloned.get(Dish.ARRAY_BUFFER));

            if (fileExtension === undefined || fileExtension === "") {
                // Detect automatically
                const types = detectFileType(output);
                if (!types.length) {
                    ext = ".dat";
                } else {
                    ext = `.${types[0].extension.split(",", 1)[0]}`;
                }
            }
            const name = Utils.strToByteArray(iNum + ext);

            zip.addFile(output, {filename: name});
        }
    }

    const zippedFile = zip.compress();
    self.postMessage({
        zippedFile: zippedFile.buffer,
        filename: filename
    }, [zippedFile.buffer]);
};
