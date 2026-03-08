/**
 * End-to-end tests for the GCloud Geocode Operation via Nightwatch.
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

    "GCloud Geocode: Returns Lat/Long for an address": function (browser) {
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
                op: "GCloud Geocode",
                args: [
                    "Lat/Long (for Show on Map)",
                    "", // language
                    ""  // region
                ]
            }
        ], "1600 Amphitheatre Parkway, Mountain View, CA");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(5000); // Wait for API call

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("37.42"), `Expected lat to start with 37.42, got: ${value}`);
            browser.assert.ok(value.includes("-122.08"), `Expected lng to start with -122.08, got: ${value}`);
        });
    },

    "GCloud Geocode: Returns Text Summary": function (browser) {
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
                op: "GCloud Geocode",
                args: [
                    "Text Summary",
                    "", // language
                    ""  // region
                ]
            }
        ], "10 Downing St, London");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(4000); // Wait for API call

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("10 Downing St, London \u2192"), `Expected Text Summary arrow, got: ${value}`);
            browser.assert.ok(value.includes("London"), `Expected London in response, got: ${value}`);
        });
    },

    after: function (browser) {
        browser.end();
    }
};
