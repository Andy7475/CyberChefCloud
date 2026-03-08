/**
 * End-to-end tests for the GCloud Places Autocomplete Operation via Nightwatch.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");
require("dotenv").config();

module.exports = {

    before: browser => {
        browser
            .resizeWindow(1280, 800)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000)
            .click("#auto-bake-label");
    },

    "GCloud Places Autocomplete: Returns matches": function (browser) {
        const testToken = browserUtils.getTestAPIKey();
        if (!testToken) {
            console.log("Skipping live API test: No API Key available.");
            return;
        }

        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "API Key",
                    { option: "UTF8", string: testToken },
                    "",
                    true
                ]
            },
            {
                op: "GCloud Places Autocomplete",
                args: [
                    "Text Summary",
                    "GB", // Country
                    3     // Max candidates
                ]
            }
        ], "Big Ben");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(5000); // Wait for API call

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("Big Ben"), `Expected Big Ben in text, got: ${value}`);
            browser.assert.ok(value.includes("ID: "), `Expected place ID in text, got: ${value}`);
        });
    },

    after: function (browser) {
        browser.end();
    }
};
