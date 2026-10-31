/**
 * End-to-end tests for the offline phone number operations via Nightwatch.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");

/**
 * Loads a recipe, bakes it and checks the output contains every expected substring.
 *
 * @param {Browser} browser
 * @param {Object[]} recipe
 * @param {string} input
 * @param {string[]} expected
 */
function bakeAndCheck(browser, recipe, input, expected) {
    browserUtils.loadRecipeConfig(browser, recipe, input);
    browserUtils.bake(browser);
    browser.pause(3000);
    browser.saveScreenshot("tests/browser/output/PhoneNumberOps.png");
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], function ({ value }) {
        for (const e of expected) {
            browser.assert.ok(value.includes(e), `Expected "${e}", got: ${value}`);
        }
    });
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

    "Parse Phone Number: UK mobile with missing +": function (browser) {
        bakeAndCheck(browser,
            [{ op: "Parse Phone Number", args: ["GB", true, false, "Text Summary"] }],
            "447400123456",
            ["+447400123456", "United Kingdom (GB, +44)", "Mobile"]);
    },

    "Extract Phone Numbers chained into Parse Phone Number": function (browser) {
        bakeAndCheck(browser,
            [
                { op: "Extract Phone Numbers", args: ["GB, FR", true, true, "E.164", false, false, true] },
                { op: "Parse Phone Number", args: ["GB", true, false, "CSV"] }
            ],
            "Ring 07400 123456 or 0033 6 12 34 56 78",
            ["+447400123456,+447400123456,true", "+33612345678,+33612345678,true,true,FR,France"]);
    },

    "Extract Phone Numbers: blank Regions searches every region": function (browser) {
        bakeAndCheck(browser,
            [{ op: "Extract Phone Numbers", args: ["", true, true, "JSON", false, false, false] }],
            "UK embassy Bangkok 2 305 8333",
            ["\"TH\"", "\"e164\": \"+6623058333\""]);
    },

    after: browser => browser.end()
};
