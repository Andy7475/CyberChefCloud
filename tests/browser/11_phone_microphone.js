/**
 * Tests for microphone input in the phone layout (issue #22): record about a second and check
 * the input is a 16 kHz mono 16-bit PCM WAV file of about that length. Chrome's fake media
 * device stands in for a microphone, for this test file only.
 * Design: docs/MobileUI.md, docs/adr/0002-captured-audio-as-wav-photos-shrunk.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

// The repository's Chrome arguments, then the fake microphone. Nightwatch merges these into
// the configured capabilities array by position, so the first four must stay the same.
const CHROME_ARGS = [
    "--no-sandbox",
    "--headless",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"
];

/**
 * Reads the active input file and parses its WAV header.
 *
 * @param {Browser} browser
 * @param {Function} callback
 */
function readWav(browser, callback) {
    browser.executeAsync(function (done) {
        const num = window.app.manager.tabs.getActiveTab("input");
        window.app.manager.input.getInputObj(num).then(obj => {
            const view = new DataView(obj.buffer);
            const text = (o, n) => String.fromCharCode(...new Uint8Array(obj.buffer, o, n));
            done({
                name: obj.file.name,
                type: obj.file.type,
                riff: text(0, 4),
                wave: text(8, 4),
                format: view.getUint16(20, true),
                channels: view.getUint16(22, true),
                sampleRate: view.getUint32(24, true),
                bits: view.getUint16(34, true),
                data: text(36, 4),
                dataSize: view.getUint32(40, true),
                size: obj.buffer.byteLength
            });
        });
    }, [], ({value}) => callback(value));
}

module.exports = {

    "@desiredCapabilities": {
        "chromeOptions": {args: CHROME_ARGS},
        "goog:chromeOptions": {args: CHROME_ARGS}
    },

    before: browser => {
        browser
            .resizeWindow(390, 844)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000);
        utils.setPhoneLayout(browser);
    },

    "The Microphone button is last in the input-source row": browser => {
        browser.execute(function () {
            return Array.from(document.querySelectorAll("#phone-input-sources button")).map(b => b.id);
        }, [], ({value}) => browser.assert.deepStrictEqual(value,
            ["phone-input-paste", "phone-input-file", "phone-input-camera", "phone-input-mic"]));
    },

    "Recording about a second gives a 16 kHz mono 16-bit WAV in the input": browser => {
        browser
            .click("#phone-input-mic")
            .waitForElementVisible("#phone-recorder-sheet", 10000)
            .pause(1200);
        browser.expect.element("#phone-recorder-time").text.to.match(/^0:0[1-2]$/);
        browser
            .click("#phone-recorder-stop")
            .waitForElementNotVisible("#phone-recorder-sheet", 5000)
            .waitForElementPresent("#input-text .cm-file-details", 10000)
            .pause(1000);

        readWav(browser, wav => {
            browser.assert.ok(/^recording-\d{8}T\d{6}\.wav$/.test(wav.name), `file name ${wav.name}`);
            browser.assert.strictEqual(wav.riff, "RIFF");
            browser.assert.strictEqual(wav.wave, "WAVE");
            browser.assert.strictEqual(wav.format, 1, "PCM");
            browser.assert.strictEqual(wav.channels, 1, "mono");
            browser.assert.strictEqual(wav.sampleRate, 16000, "16 kHz");
            browser.assert.strictEqual(wav.bits, 16, "16 bits per sample");
            browser.assert.strictEqual(wav.data, "data");
            browser.assert.strictEqual(wav.size, 44 + wav.dataSize, "data length matches the file");
            const seconds = wav.dataSize / 2 / 16000;
            browser.assert.ok(seconds > 0.8 && seconds < 2.5, `about a second recorded (${seconds.toFixed(2)}s)`);
        });
        browser.expect.element("#input").to.have.attribute("data-phone-state").equals("summary");
        browser.execute(function () {
            return window.app.manager.phone.microphone.isRecording();
        }, [], ({value}) => browser.assert.strictEqual(value, false, "the microphone is released"));
    },

    "Back cancels a recording and releases the microphone": browser => {
        browser.execute(function () {
            document.getElementById("clr-io").click();
        }).pause(500);
        browser
            .click("#phone-input-mic")
            .waitForElementVisible("#phone-recorder-sheet", 10000)
            .pause(500)
            .back()
            .waitForElementNotVisible("#phone-recorder-sheet", 5000)
            .pause(500);
        browser.execute(function () {
            return window.app.manager.phone.microphone.isRecording();
        }, [], ({value}) => browser.assert.strictEqual(value, false, "not recording"));
        browser.expect.element("#input-text .cm-file-details").to.not.be.present;
    },

    "A refused microphone gives a readable message": browser => {
        browser.execute(function () {
            navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
        });
        browser.click("#phone-input-mic");
        browser.waitForElementVisible("#snackbar-container .snackbar", 5000);
        browser.expect.element("#snackbar-container").text.to.contain("Microphone access was refused");
        browser.expect.element("#phone-recorder-sheet").to.not.be.visible;
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
