/**
 * End-to-end tests for the GCloud Phone Business Lookup Operation via Nightwatch.
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

    "GCloud Phone Business Lookup: finds exact matches for national and international numbers": function (browser) {
        // Places rejects the x-goog-user-project CORS header, so browser calls need an API key
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
                    "", // quota project (OAuth only)
                    ""  // default region
                ]
            },
            {
                op: "GCloud Phone Business Lookup",
                args: ["GB", "Text Summary", false]
            }
        ], "020 7323 8000\n+1 650 253 0000");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(8000); // Wait for up to four Places calls

        browser.saveScreenshot("tests/browser/output/GCloudPhoneBusinessLookup.png");
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("020 7323 8000 (+442073238000)"), `Expected normalised number, got: ${value}`);
            browser.assert.ok(value.includes("British Museum"), `Expected British Museum, got: ${value}`);
            browser.assert.ok(value.includes("Googleplex"), `Expected Googleplex, got: ${value}`);
            browser.assert.ok(!value.includes("Other results"), `Expected non-matching results to be hidden, got: ${value}`);
        });
    },

    after: browser => browser.end()
};
