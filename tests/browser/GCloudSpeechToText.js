/**
 * End-to-end tests for the GCloud Speech to Text Operation via Nightwatch.
 * 
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");
require('dotenv').config();

module.exports = {

    before: browser => {
        browser
            .resizeWindow(1280, 800)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000)
            .click("#auto-bake-label");
    },

    "GCloud Speech to Text: GCS URI mode returns transcription to browser": function (browser) {
        const testToken = browserUtils.getTestPAT();
        if (!testToken) {
            console.log("Skipping live API test: No PAT available.");
            return;
        }

        const gcsUri = "gs://cyber-chef-cloud-examples/audio/she_achieves_great_results_f55548.mp3";

        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "Personal Access Token (PAT)",
                    { option: "UTF8", string: testToken },
                    "cyberchefcloud",
                    true
                ]
            },
            {
                op: "GCloud Speech to Text",
                args: [
                    "GCS URI (gs://...)",
                    "en-US",
                    "latest_long",
                    "Return to CyberChef",
                    "cyber-chef-cloud-examples",
                    30
                ]
            }
        ], gcsUri);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        // LRO jobs on short files typically complete in ~5 seconds; allow up to 30s here
        browser.pause(30000);
        browser.saveScreenshot("tests/browser/output/speech_to_text_browser.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(
                value.toLowerCase().includes("she achieves great results"),
                `Expected transcript, got: ${value}`
            );
        });
    },

    "GCloud Speech to Text: GCS URI mode writes transcript to GCS output/ bucket": function (browser) {
        const testToken = browserUtils.getTestPAT();
        if (!testToken) {
            console.log("Skipping live API test: No PAT available.");
            return;
        }

        const gcsUri = "gs://cyber-chef-cloud-examples/audio/she_achieves_great_results_f55548.mp3";

        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "Personal Access Token (PAT)",
                    { option: "UTF8", string: testToken },
                    "cyberchefcloud",
                    true
                ]
            },
            {
                op: "GCloud Speech to Text",
                args: [
                    "GCS URI (gs://...)",
                    "en-US",
                    "latest_long",
                    "Write to GCS",
                    "cyber-chef-cloud-examples",
                    30
                ]
            }
        ], gcsUri);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(30000);
        browser.saveScreenshot("tests/browser/output/speech_to_text_gcs_write.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(
                value.includes("gs://cyber-chef-cloud-examples/output/audio/she_achieves_great_results_f55548.mp3/speech-to-text/text.txt"),
                `Expected GCS output URI, got: ${value}`
            );
        });
    },

    after: function (browser) {
        browser.end();
    }
};
