/**
 * End-to-end tests for the GCloud List Bucket Operation via Nightwatch.
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

    "GCloud List Bucket: Missing Creds Validation": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "API Key",
                    { option: "UTF8", string: "" },
                    "",
                    true
                ]
            },
            {
                op: "GCloud List Bucket",
                args: [
                    "audio/",
                    "GCS URIs (one per line)"
                ]
            }
        ], "cyber-chef-cloud-examples");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(2000);
        browser.saveScreenshot("tests/browser/output/list_bucket_no_key.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("No Google Cloud credentials found") || value.includes("Please provide Google Cloud credentials"));
        });
    },

    "GCloud List Bucket: Lists audio/ files from cyber-chef-cloud-examples": function (browser) {
        const testToken = browserUtils.getTestPAT();
        if (!testToken) {
            console.log("Skipping live API test: No PAT available.");
            return;
        }

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
                op: "GCloud List Bucket",
                args: [
                    "audio/",
                    "GCS URIs (one per line)"
                ]
            }
        ], "cyber-chef-cloud-examples");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(5000);
        browser.saveScreenshot("tests/browser/output/list_bucket_live.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("gs://cyber-chef-cloud-examples/audio/"), `Expected gs:// URIs, got: ${value}`);
            browser.assert.ok(value.includes("she_achieves_great_results_f55548.mp3"), `Expected audio filename in output, got: ${value}`);
        });
    },

    after: function (browser) {
        browser.end();
    }
};
