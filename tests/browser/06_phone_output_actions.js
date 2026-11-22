/**
 * Tests for the phone layout's output actions (issue #18): Share (Web Share API), Copy, Save,
 * "Replace input with output" in the ⋯ menu, and wide HTML output scrolling inside the output area.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

/**
 * Replaces the recipe and the input, then bakes.
 *
 * @param {Browser} browser
 * @param {Object[]} config - Recipe config
 * @param {string} input
 */
function loadRecipe(browser, config, input) {
    browser.execute(function (cfg, text) {
        window.app.setRecipeConfig(cfg);
        window.app.setInput(text);
        window.app.bake();
    }, [config, input]).pause(1000);
}

/**
 * Reads the active input as text.
 *
 * @param {Browser} browser
 * @param {Function} callback - Called with the input string.
 */
function readInput(browser, callback) {
    browser.execute(function () {
        return window.app.manager.input.inputEditorView.state.doc.toString();
    }, [], ({value}) => callback(value));
}

module.exports = {

    before: browser => {
        browser
            .resizeWindow(390, 844)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000);

        // Headless Chrome has no Share menu: stub the Web Share API, then enter the phone layout,
        // which decides whether to show Share
        browser.execute(function () {
            window.sharedData = [];
            navigator.share = data => {
                window.sharedData.push(data);
                return Promise.resolve();
            };
            navigator.canShare = () => true;
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
        });
        utils.setLayoutOption(browser, "desktop");
        utils.setPhoneLayout(browser);
    },

    "Share, Copy and Save are shown as 44px buttons; Replace input with output moves to the ⋯ menu": browser => {
        browser
            .waitForElementVisible("#phone-share-output", 5000)
            .waitForElementVisible("#copy-output", 5000)
            .waitForElementVisible("#save-to-file", 5000)
            .expect.element("#switch").to.not.be.visible;
        browser.expect.element("#phone-share-output").to.have.attribute("aria-label").equals("Share output");

        browser.execute(function () {
            return ["phone-share-output", "copy-output", "save-to-file"].map(id => {
                const r = document.getElementById(id).getBoundingClientRect();
                return Math.min(r.width, r.height);
            });
        }, [], ({value}) => browser.assert.ok(value.every(size => size >= 44), `tap targets ${value.join(", ")} are at least 44px`));
    },

    "Share sends text output as text": browser => {
        loadRecipe(browser, [{op: "To Upper case", args: ["All"]}], "share me");
        browser.click("#phone-share-output").pause(500);
        browser.execute(function () {
            return window.sharedData.map(d => ({text: d.text, files: d.files ? d.files.length : 0}));
        }, [], ({value}) => browser.assert.deepStrictEqual(value, [{text: "SHARE ME", files: 0}]));
    },

    "Share sends file output as a file": browser => {
        // A one-pixel PNG, as hex
        loadRecipe(browser, [{op: "From Hex", args: ["Auto"]}],
            "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
            "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082");
        browser.execute(function () {
            window.sharedData = [];
        });
        browser.click("#phone-share-output").pause(500);
        browser.execute(function () {
            const d = window.sharedData[0];
            return d && d.files ? {name: d.files[0].name, type: d.files[0].type, text: d.text || null} : null;
        }, [], ({value}) => browser.assert.deepStrictEqual(value, {name: "output.png", type: "image/png", text: null}));
    },

    "Copy and Save use the desktop output code": browser => {
        loadRecipe(browser, [{op: "To Upper case", args: ["All"]}], "copy me");
        browser.execute(function () {
            const out = window.app.manager.output;
            window.calls = [];
            // Replace the handlers' targets so the test needs no clipboard permission or download
            navigator.clipboard.writeText = text => {
                window.calls.push(["copy", text]);
                return Promise.resolve();
            };
            out.downloadFile = () => window.calls.push(["save"]);
        });
        browser.click("#copy-output").click("#save-to-file").pause(500);
        browser.execute(function () {
            return window.calls;
        }, [], ({value}) => browser.assert.deepStrictEqual(value, [["copy", "COPY ME"], ["save"]]));
    },

    "⋯ menu: Replace input with output moves the output into the input": browser => {
        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .click("#phone-menu-items [data-phone-action='switch']")
            .waitForElementNotVisible("#phone-menu-sheet", 5000)
            .pause(1000);
        readInput(browser, input => browser.assert.strictEqual(input, "COPY ME"));
    },

    "Wide HTML output scrolls inside the output area, not the page": browser => {
        loadRecipe(browser, [{op: "To Table", args: [",", "\\r\\n", false, "HTML"]}],
            "alpha,bravo,charlie,delta,echo,foxtrot,golf,hotel,india,juliet,kilo,lima\n1,2,3,4,5,6,7,8,9,10,11,12");
        browser.waitForElementPresent("#output-html table", 5000);
        browser.execute(function () {
            const html = document.getElementById("output-html");
            let el = html, scrolls = false;
            // Some element between the table and the output pane scrolls sideways
            while (el && el.id !== "output") {
                if (el.scrollWidth > el.clientWidth && ["auto", "scroll"].includes(getComputedStyle(el).overflowX)) scrolls = true;
                el = el.parentElement;
            }
            return {page: document.scrollingElement.scrollWidth, width: window.innerWidth, scrolls};
        }, [], ({value}) => {
            browser.assert.ok(value.page <= value.width, `page is not wider than the screen (${value.page} <= ${value.width})`);
            browser.assert.strictEqual(value.scrolls, true, "the table scrolls sideways inside the output area");
        });
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
