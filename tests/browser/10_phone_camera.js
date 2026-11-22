/**
 * Tests for camera input in the phone layout (issue #21): a photo is shrunk to a 2048px long
 * edge and re-encoded as JPEG without EXIF data by default, or loaded unchanged with
 * Camera photo size = Original.
 * Design: docs/MobileUI.md, docs/adr/0002-captured-audio-as-wav-photos-shrunk.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const utils = require("./browserUtils.js");

// A 3000×2000 JPEG with EXIF GPS data (51°30'N, 0°7'W)
const SAMPLE = path.resolve(__dirname, "../samples/files/camera-gps-3000x2000.jpg");

/**
 * "Takes a photo": gives the camera's file input the sample file.
 *
 * @param {Browser} browser
 */
function takePhoto(browser) {
    browser.execute(function () {
        document.getElementById("phone-camera-file").hidden = false;
    });
    browser.setValue("#phone-camera-file", SAMPLE);
    browser.execute(function () {
        document.getElementById("phone-camera-file").hidden = true;
    });
    browser.waitForElementPresent("#input-text .cm-file-details", 10000).pause(1500);
}

/**
 * Reads the active input file's name, size, SHA-256 and image dimensions.
 *
 * @param {Browser} browser
 * @param {Function} callback
 */
function readPhoto(browser, callback) {
    browser.executeAsync(function (done) {
        const input = window.app.manager.input;
        const num = window.app.manager.tabs.getActiveTab("input");
        input.getInputObj(num).then(async obj => {
            const buffer = obj.buffer;
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)))
                .map(b => b.toString(16).padStart(2, "0")).join("");
            const bitmap = await createImageBitmap(new Blob([buffer]));
            done({name: obj.file.name, type: obj.file.type, size: buffer.byteLength, hash, width: bitmap.width, height: bitmap.height});
        });
    }, [], ({value}) => callback(value));
}

/**
 * Bakes Extract EXIF on the input and reads the output.
 *
 * @param {Browser} browser
 * @param {Function} callback
 */
function extractExif(browser, callback) {
    browser.execute(function () {
        window.app.setRecipeConfig([{op: "Extract EXIF", args: []}]);
        window.app.bake();
    }).pause(1500);
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], ({value}) => callback(value));
}

module.exports = {

    before: browser => {
        browser
            .resizeWindow(390, 844)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000);
        utils.setPhoneLayout(browser);
        browser.execute(function () {
            const select = document.getElementById("cameraPhotoSize");
            select.value = "2048";
            select.dispatchEvent(new Event("change", {bubbles: true}));
        });
    },

    "The Camera button is in its reserved place and opens the camera": browser => {
        browser.execute(function () {
            const row = Array.from(document.querySelectorAll("#phone-input-sources button")).map(b => b.id);
            const file = document.getElementById("phone-camera-file");
            return {row, accept: file.accept, capture: file.getAttribute("capture")};
        }, [], ({value}) => {
            browser.assert.deepStrictEqual(value.row.slice(0, 3), ["phone-input-paste", "phone-input-file", "phone-input-camera"]);
            browser.assert.strictEqual(value.accept, "image/*");
            browser.assert.strictEqual(value.capture, "environment");
        });
    },

    "By default a photo is shrunk to 2048px and has no EXIF GPS data": browser => {
        extractExif(browser, () => {});
        takePhoto(browser);
        readPhoto(browser, photo => {
            browser.assert.ok(/^photo-\d{8}T\d{6}\.jpg$/.test(photo.name), `file name ${photo.name}`);
            browser.assert.strictEqual(photo.type, "image/jpeg");
            browser.assert.strictEqual(photo.width, 2048);
            browser.assert.strictEqual(photo.height, 1365);
        });
        browser.expect.element("#input").to.have.attribute("data-phone-state").equals("summary");
        extractExif(browser, out => {
            browser.assert.ok(!/GPS/i.test(out), "Extract EXIF finds no GPS data");
            browser.assert.ok(!/TestCam/.test(out), "Extract EXIF finds no camera make");
        });
    },

    "Camera photo size = Original loads the file unchanged": browser => {
        const expected = crypto.createHash("sha256").update(fs.readFileSync(SAMPLE)).digest("hex");
        browser.execute(function () {
            const select = document.getElementById("cameraPhotoSize");
            select.value = "original";
            select.dispatchEvent(new Event("change", {bubbles: true}));
            document.getElementById("clr-io").click();
        }).pause(1000);
        browser.execute(function () {
            return JSON.parse(localStorage.options).cameraPhotoSize;
        }, [], ({value}) => browser.assert.strictEqual(value, "original", "the option is remembered"));

        takePhoto(browser);
        readPhoto(browser, photo => {
            browser.assert.strictEqual(photo.hash, expected, "byte-identical to the camera's file");
            browser.assert.strictEqual(photo.width, 3000);
        });
        extractExif(browser, out => browser.assert.ok(/GPS/i.test(out), "the original keeps its GPS data"));
    },

    "An unreadable image gives a readable error": browser => {
        browser.execute(function () {
            const select = document.getElementById("cameraPhotoSize");
            select.value = "2048";
            select.dispatchEvent(new Event("change", {bubbles: true}));
        });
        browser.pause(200);
        browser.execute(function () {
            window.app.manager.phone.camera.useFile(new File(["not an image"], "x.jpg", {type: "image/jpeg"}));
        });
        browser.waitForElementVisible("#snackbar-container .snackbar", 5000);
        browser.expect.element("#snackbar-container").text.to.contain("The photo could not be used");
    },

    after: browser => {
        browser.execute(function () {
            const select = document.getElementById("cameraPhotoSize");
            select.value = "2048";
            select.dispatchEvent(new Event("change", {bubbles: true}));
        });
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
