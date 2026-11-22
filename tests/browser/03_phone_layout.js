/**
 * Tests for the phone layout's run screen (issue #13): when the layout is used,
 * the recipe strip, the floating Bake button and the ⋯ menu sheet.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

/**
 * Reads the output as text.
 *
 * @param {Browser} browser
 * @param {Function} callback - Called with the output string.
 */
function readOutput(browser, callback) {
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], ({value}) => callback(value));
}

/**
 * Whether the page is using the phone layout.
 *
 * @param {Browser} browser
 * @param {boolean} expected
 */
function expectPhoneLayout(browser, expected) {
    browser.execute(function () {
        return document.body.classList.contains("mobile");
    }, [], ({value}) => {
        browser.assert.strictEqual(value, expected, `phone layout ${expected ? "on" : "off"}`);
    });
}

/**
 * Loads a recipe and input through the URL, as a shared recipe link would.
 * Avoid "=" in argument values: CyberChef's URL parameter parsing splits on it.
 *
 * @param {Browser} browser
 * @param {Object[]} config - Recipe config
 * @param {string} input
 */
function loadFromUrl(browser, config, input) {
    browser.execute(function (text) {
        window.app.setInput(text);
    }, [input]);
    browser
        .urlHash("recipe=" + JSON.stringify(config))
        .waitForElementPresent("#rec-list li.operation", 5000)
        .pause(300);
}

module.exports = {

    before: browser => {
        browser
            .resizeWindow(390, 844)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000);
    },

    "Small screen uses the phone layout with Layout = Auto": browser => {
        expectPhoneLayout(browser, true);
        browser
            .waitForElementVisible("#phone-header", 5000)
            .waitForElementVisible("#phone-recipe-strip", 5000)
            .waitForElementVisible("#phone-bake", 5000)
            .waitForElementVisible("#input-text", 5000)
            .waitForElementVisible("#output-text", 5000)
            .expect.element("#operations").to.not.be.visible;
        browser.expect.element("#recipe").to.not.be.visible;
        browser.expect.element("#banner").to.not.be.visible;
        browser.expect.element(".gutter").to.not.be.present;
    },

    "Layout option overrides the screen size, without a reload": browser => {
        utils.setLayoutOption(browser, "desktop");
        expectPhoneLayout(browser, false);
        browser
            .waitForElementVisible("#operations", 5000)
            .waitForElementVisible("#recipe", 5000)
            .expect.element("#phone-header").to.not.be.visible;
        browser.expect.elements(".gutter").count.to.equal(3);

        utils.setLayoutOption(browser, "auto");
        expectPhoneLayout(browser, true);

        browser.resizeWindow(1280, 800).pause(500);
        expectPhoneLayout(browser, false);

        utils.setPhoneLayout(browser);
        expectPhoneLayout(browser, true);
    },

    "The Layout option is remembered": browser => {
        browser.execute(function () {
            return JSON.parse(localStorage.options).layout;
        }, [], ({value}) => browser.assert.strictEqual(value, "phone"));
    },

    "Recipe strip shows the loaded recipe, including disabled operations and breakpoints": browser => {
        loadFromUrl(browser, [
            {op: "To Hex", args: ["Space", 0]},
            {op: "ROT13", args: [true, true, false, 13], disabled: true},
            {op: "To Upper case", args: ["All"], breakpoint: true}
        ], "Hello world");

        browser.expect.elements("#phone-recipe-ops .phone-recipe-op").count.to.equal(3);
        browser.expect.element("#phone-recipe-ops .phone-recipe-op:nth-child(1)").text.to.equal("To Hex");
        browser.expect.element("#phone-recipe-ops .phone-recipe-op:nth-child(2)").to.have.attribute("class").which.contains("disabled");
        browser.expect.element("#phone-recipe-ops .phone-recipe-op:nth-child(2)").to.have.attribute("aria-label").which.contains("disabled");
        browser.expect.element("#phone-recipe-ops .phone-recipe-op:nth-child(3)").to.have.attribute("class").which.contains("breakpoint");
    },

    "Recipe strip updates when the recipe changes": browser => {
        browser.execute(function () {
            // Remove the last operation the way the desktop recipe list does (double-click)
            document.querySelector("#rec-list li.operation:last-child")
                .dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        });
        browser.pause(300);
        browser.expect.elements("#phone-recipe-ops .phone-recipe-op").count.to.equal(2);
    },

    "Floating Bake button bakes when Auto Bake is off": browser => {
        loadFromUrl(browser, [{op: "To Hex", args: ["Space", 0]}], "Hello");

        // Turn Auto Bake off from the ⋯ menu
        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .execute(function () {
                const toggle = document.getElementById("phone-auto-bake");
                if (toggle.checked) toggle.click();
            })
            .pause(200);
        browser.execute(function () {
            return document.getElementById("auto-bake").checked;
        }, [], ({value}) => browser.assert.strictEqual(value, false, "Auto Bake is off"));
        browser.back().waitForElementNotVisible("#phone-menu-sheet", 5000);

        browser.execute(function (text) {
            window.app.setInput(text);
        }, ["CyberChef"]).pause(500);

        browser
            .waitForElementVisible("#phone-bake", 5000)
            .click("#phone-bake")
            .pause(1500);
        readOutput(browser, out => browser.assert.strictEqual(out, "43 79 62 65 72 43 68 65 66"));
    },

    "⋯ menu opens as a sheet and Back closes it without leaving the page": browser => {
        let urlBefore;
        browser.url(({value}) => {
            urlBefore = value;
        });

        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .waitForElementVisible("#phone-sheet-backdrop", 5000)
            .back()
            .waitForElementNotVisible("#phone-menu-sheet", 5000)
            .waitForElementNotVisible("#phone-sheet-backdrop", 5000);

        browser.url(({value}) => browser.assert.strictEqual(value, urlBefore, "same page and recipe after Back"));
        expectPhoneLayout(browser, true);
        browser.expect.elements("#phone-recipe-ops .phone-recipe-op").count.to.equal(1);
    },

    "⋯ menu closes when the backdrop is tapped, and Escape closes it": browser => {
        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .execute(function () {
                document.getElementById("phone-sheet-backdrop").click();
            })
            .waitForElementNotVisible("#phone-menu-sheet", 5000);

        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .sendKeys("#phone-menu-items [data-phone-action='options']", browser.Keys.ESCAPE)
            .waitForElementNotVisible("#phone-menu-sheet", 5000);
    },

    "⋯ menu items use the desktop controls": browser => {
        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .click("#phone-menu-items [data-phone-action='options']")
            .waitForElementVisible("#options-modal", 5000)
            .click("#options-modal .modal-footer button[data-dismiss='modal']")
            .waitForElementNotVisible("#options-modal", 5000);

        browser
            .click("#phone-menu-btn")
            .waitForElementVisible("#phone-menu-sheet", 5000)
            .click("#phone-menu-items [data-phone-action='clear']")
            .waitForElementNotPresent("#rec-list li.operation", 5000)
            .waitForElementVisible("#phone-recipe-ops .phone-recipe-empty", 5000);
    },

    "Changing the theme keeps the phone layout": browser => {
        browser.execute(function () {
            const theme = document.getElementById("theme");
            theme.value = "dark";
            theme.dispatchEvent(new Event("change", {bubbles: true}));
        }).pause(200);
        expectPhoneLayout(browser, true);
        browser.execute(function () {
            return document.documentElement.className;
        }, [], ({value}) => browser.assert.strictEqual(value, "dark"));
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
