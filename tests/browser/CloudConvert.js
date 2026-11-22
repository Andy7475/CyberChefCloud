/**
 * End-to-end tests for the Cloud Convert operation via Nightwatch.
 * The live test uses one CloudConvert conversion credit.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");
require("dotenv").config();

/**
 * Loads an Authenticate Google Cloud + Cloud Convert (txt -> pdf, bytes in and out) recipe.
 *
 * @param {Object} browser
 * @param {string} authType
 * @param {string} credential
 */
function loadTxtToPdfRecipe(browser, authType, credential) {
    browserUtils.loadRecipeConfig(browser, [
        {
            op: "Authenticate Google Cloud",
            args: [authType, { option: "UTF8", string: credential }, "cyberchefcloud", "europe-west2", true]
        },
        {
            op: "Cloud Convert",
            args: ["txt", "pdf", "Browser (Bytes)", "Return to CyberChef", ""]
        }
    ], "Hello from the CyberChefCloud Cloud Convert live test.");
}

module.exports = {
    before: browser => {
        browser
            .resizeWindow(1280, 800)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000)
            .click("#auto-bake-label");
    },

    "Cloud Convert: API key auth is refused": function (browser) {
        loadTxtToPdfRecipe(browser, "API Key", "not-a-real-key");

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(2000);

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.includes("needs OAuth or an access token"), `Got: ${value}`);
        });
    },

    "Cloud Convert: txt to pdf with an access token": function (browser) {
        const testToken = browserUtils.getTestPAT();
        if (!testToken) {
            console.log("Skipping live Cloud Convert test: no access token available.");
            return;
        }

        loadTxtToPdfRecipe(browser, "Access Token", testToken);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(15000); // CloudConvert job: upload, convert, download
        browser.saveScreenshot("tests/browser/output/cloud_convert_txt_pdf.png");

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(value.startsWith("%PDF-"), `Expected a PDF, got: ${value.slice(0, 200)}`);
        });
    },

    after: browser => browser.end()
};
