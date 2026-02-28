/**
 * End-to-end tests for Cloud Operations via Nightwatch.
 * 
 * NOTE: Tests that execute real API calls will be skipped if the required API keys
 * are not found in the environment variables (e.g. running in a public CI pipeline).
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

    "Google Translate: Missing Key Validation": function (browser) {
        browserUtils.loadRecipe(browser, "Google Translate", "Hello World", [
            "en",
            "es",
            "API Key",
            { option: "UTF8", string: "" },
            ""
        ]);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(2000);
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("Please provide a valid GCP Auth String"));
        });
    },

    "Google Translate: Successful OAuth Token Translation": function (browser) {
        let testToken = process.env.CYBERCHEF_GCP_TEST_TOKEN;

        if (!testToken || testToken === "YOUR_OAUTH_TOKEN_HERE") {
            try {
                testToken = require('child_process').execSync('gcloud auth print-access-token', { stdio: 'pipe', encoding: 'utf-8' }).trim();
            } catch (e) {
                console.log("No valid CYBERCHEF_GCP_TEST_TOKEN found and gcloud failed. Skipping live API test.");
                return;
            }
        }

        browserUtils.loadRecipe(browser, "Google Translate", "Hello", [
            "en",
            "es",
            "OAuth Token",
            { option: "UTF8", string: testToken },
            "cyberchefcloud"
        ]);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(2000);
        browser.saveScreenshot("tests/browser/output/success_oauth_debug.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.equal(value, "Hola");
        });
    },

    "Google Translate: Successful API Key Translation": function (browser) {
        const testKey = process.env.CYBERCHEF_GCP_TEST_KEY;

        if (!testKey || testKey === "YOUR_API_KEY_HERE") {
            console.log("No valid CYBERCHEF_GCP_TEST_KEY found in environment variables. Skipping live API test.");
            return;
        }

        browserUtils.loadRecipe(browser, "Google Translate", "Hello", [
            "en",
            "es",
            "API Key",
            { option: "UTF8", string: testKey },
            ""
        ]);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(2000);
        browser.saveScreenshot("tests/browser/output/success_apikey_debug.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.equal(value, "Hola");
        });
    },

    after: function (browser) {
        browser.end();
    }
};
