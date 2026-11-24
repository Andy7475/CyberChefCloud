/**
 * Tests for the phone layout's argument sheet (issue #15): tapping an operation in the
 * recipe strip shows its arguments, editing them updates the output, and closing the
 * sheet puts the recipe list back where the desktop layout expects it.
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
 * Sets an argument field in the operation shown in the argument sheet, as typing would.
 *
 * @param {Browser} browser
 * @param {number} argIndex - Position among the operation's input.arg fields
 * @param {string} value
 */
function typeArg(browser, argIndex, value) {
    browser.execute(function (i, v) {
        const field = document.querySelectorAll("#phone-arg-sheet li.phone-editing input.arg")[i];
        field.focus();
        field.value = v;
        field.dispatchEvent(new Event("input", {bubbles: true}));
    }, [argIndex, value]).pause(1000);
}

const FIND_REPLACE = [{
    op: "Find / Replace",
    args: [{option: "Simple string", string: "a"}, "b", true, false, true, false]
}];

module.exports = {

    before: browser => {
        browser
            .resizeWindow(390, 844)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000);
        utils.setPhoneLayout(browser);
        browser.execute(function () {
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
        });
    },

    "Tapping an operation in the recipe strip opens its argument sheet": browser => {
        loadRecipe(browser, FIND_REPLACE, "banana");
        readOutput(browser, out => browser.assert.strictEqual(out, "bbnbnb"));

        browser
            .click("#phone-recipe-ops .phone-recipe-op:nth-child(1)")
            .waitForElementVisible("#phone-arg-sheet", 5000)
            .expect.element("#phone-arg-title").text.to.equal("Find / Replace");
        browser.expect.element("#phone-arg-sheet li.operation.phone-editing").to.be.visible;
        browser.expect.element("#phone-arg-done").to.be.active;
        browser.execute(function () {
            return document.getElementById("rec-list").parentNode.id;
        }, [], ({value}) => browser.assert.strictEqual(value, "phone-arg-body", "recipe list is in the sheet"));
    },

    "Editing an argument updates the output live": browser => {
        typeArg(browser, 1, "o");
        readOutput(browser, out => browser.assert.strictEqual(out, "bonono"));
        browser.expect.element("#phone-arg-sheet").to.be.visible;
    },

    "A double tap inside the sheet does not remove the operation": browser => {
        browser.execute(function () {
            document.querySelector("#phone-arg-sheet li.phone-editing .op-title")
                .dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        }).pause(300);
        browser.expect.elements("#rec-list li.operation").count.to.equal(1);
    },

    "Back closes the sheet and puts the recipe list back": browser => {
        browser
            .back()
            .waitForElementNotVisible("#phone-arg-sheet", 5000)
            .waitForElementNotVisible("#phone-sheet-backdrop", 5000);
        browser.execute(function () {
            const recList = document.getElementById("rec-list");
            return {
                parent: recList.parentNode.id,
                editing: recList.querySelectorAll(".phone-editing").length,
                focused: document.activeElement.classList.contains("phone-recipe-op")
            };
        }, [], ({value}) => {
            browser.assert.strictEqual(value.parent, "recipe", "recipe list is back in the recipe pane");
            browser.assert.strictEqual(value.editing, 0, "no operation is marked as being edited");
            browser.assert.strictEqual(value.focused, true, "focus is back on the recipe strip");
        });
        readOutput(browser, out => browser.assert.strictEqual(out, "bonono", "the edit is kept"));
    },

    "Tapping outside the sheet or Done closes it": browser => {
        browser
            .click("#phone-recipe-ops .phone-recipe-op:nth-child(1)")
            .waitForElementVisible("#phone-arg-sheet", 5000)
            .execute(function () {
                document.getElementById("phone-sheet-backdrop").click();
            })
            .waitForElementNotVisible("#phone-arg-sheet", 5000);

        browser
            .click("#phone-recipe-ops .phone-recipe-op:nth-child(1)")
            .waitForElementVisible("#phone-arg-sheet", 5000)
            .click("#phone-arg-done")
            .waitForElementNotVisible("#phone-arg-sheet", 5000);
    },

    "A dropdown that fills another field still fills it": browser => {
        loadRecipe(browser, [
            {op: "To Upper case", args: ["All"]},
            {op: "Regular expression", args: ["User defined", "", true, true, false, false, false, false, "List matches"]}
        ], "Mail me at test@example.com please");

        browser
            .click("#phone-recipe-ops .phone-recipe-op:nth-child(2)")
            .waitForElementVisible("#phone-arg-sheet", 5000)
            .expect.element("#phone-arg-title").text.to.equal("Regular expression");
        browser.execute(function () {
            return Array.from(document.querySelectorAll("#rec-list li.operation"))
                .filter(li => li.offsetParent !== null).length;
        }, [], ({value}) => browser.assert.strictEqual(value, 1, "only the edited operation is shown"));

        browser.execute(function () {
            const select = document.querySelector("#phone-arg-sheet li.phone-editing select.arg");
            select.value = Array.from(select.options).find(o => o.textContent === "Email address").value;
            select.dispatchEvent(new Event("change", {bubbles: true}));
        }).pause(1000);
        browser.execute(function () {
            return document.querySelector("#phone-arg-sheet li.phone-editing textarea.arg").value;
        }, [], ({value}) => browser.assert.ok(value.includes("@"), "the regex field is filled"));
        // Regular expression returns HTML, which is shown in #output-html rather than the editor
        browser.execute(function () {
            return document.getElementById("output-html").textContent.trim();
        }, [], ({value}) => browser.assert.ok(value.includes("TEST@EXAMPLE.COM"), "output lists the match"));

        browser.back().waitForElementNotVisible("#phone-arg-sheet", 5000);
    },

    "The desktop layout is unaffected after using the sheet": browser => {
        // At phone width the desktop recipe column has no room, so use a desktop-sized window
        browser.resizeWindow(1280, 800);
        utils.setLayoutOption(browser, "desktop");
        browser
            .waitForElementVisible("#recipe", 5000)
            .waitForElementVisible("#rec-list li.operation:nth-child(1)", 5000)
            .waitForElementVisible("#rec-list li.operation:nth-child(2)", 5000);
        browser.expect.elements(".gutter").count.to.equal(3);
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
