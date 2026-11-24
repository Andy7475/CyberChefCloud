/**
 * Tests for the phone layout's recipe editor (issue #20): move up and down, disable,
 * breakpoint, delete, and opening an operation's argument sheet from the editor.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

/**
 * Checks the recipe's operations and the output.
 *
 * @param {Browser} browser
 * @param {string[]} ops - Operation names, in order
 * @param {string} output
 */
function expectRecipe(browser, ops, output) {
    browser.pause(800);
    browser.execute(function () {
        return [
            window.app.getRecipeConfig().map(op => op.op),
            window.app.manager.output.outputEditorView.state.doc.toString(),
            decodeURIComponent(window.location.hash)
        ];
    }, [], ({value}) => {
        browser.assert.deepStrictEqual(value[0], ops);
        browser.assert.strictEqual(value[1], output);
        browser.assert.ok(value[2].includes(ops.join("")) || value[2].includes(ops[0]), "the URL holds the recipe");
    });
}

/**
 * A control on the nth operation in the editor.
 *
 * @param {number} n - 1-based position
 * @param {string} action - up, down, disable, breakpoint or delete
 * @returns {string} selector
 */
function control(n, action) {
    return `#phone-editor-body #rec-list li.operation:nth-child(${n}) .phone-op-controls [data-action='${action}']`;
}

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
            window.app.setRecipeConfig([
                {op: "Reverse", args: ["Character"]},
                {op: "To Upper case", args: ["All"]},
                {op: "Find / Replace", args: [{option: "Simple string", string: "C"}, "x", true, false, true, false]}
            ]);
            window.app.setInput("abc");
            window.app.bake();
        }).pause(1000);
    },

    "Edit recipe opens the editor with every operation and its controls": browser => {
        browser
            .click("#phone-editor-btn")
            .waitForElementVisible("#phone-editor-sheet", 5000);
        browser.expect.elements("#phone-editor-body #rec-list li.operation").count.to.equal(3);
        browser.expect.element(control(1, "up")).to.have.attribute("aria-label").equals("Move Reverse up");
        browser.expect.element(control(3, "delete")).to.have.attribute("aria-label").equals("Delete Find / Replace");
        browser.expect.element(control(1, "up")).to.not.be.enabled;
        browser.expect.element(control(3, "down")).to.not.be.enabled;
        browser.expect.element("#phone-editor-body #rec-list .ingredients").to.not.be.visible;
        browser.execute(function () {
            return Array.from(document.querySelectorAll("#phone-editor-body .phone-op-controls button, #phone-editor-body .op-title"))
                .map(el => Math.round(Math.min(el.getBoundingClientRect().height, el.getBoundingClientRect().width)));
        }, [], ({value}) => browser.assert.ok(value.every(v => v >= 44), `tap targets are at least 44px (smallest ${Math.min(...value)})`));
        expectRecipe(browser, ["Reverse", "To Upper case", "Find / Replace"], "xBA");
    },

    "↑ and ↓ move an operation and update the recipe and output": browser => {
        browser.click(control(3, "up"));
        expectRecipe(browser, ["Reverse", "Find / Replace", "To Upper case"], "CBA");
        browser.expect.element(control(2, "up")).to.be.active;

        browser.click(control(2, "down"));
        expectRecipe(browser, ["Reverse", "To Upper case", "Find / Replace"], "xBA");
        browser.expect.elements("#phone-recipe-ops .phone-recipe-op").count.to.equal(3);
    },

    "Disable, breakpoint and delete work and show in the recipe strip": browser => {
        browser.click(control(1, "disable"));
        expectRecipe(browser, ["Reverse", "To Upper case", "Find / Replace"], "ABx");
        browser.expect.element(control(1, "disable")).to.have.attribute("aria-pressed").equals("true");
        browser.expect.element("#phone-recipe-ops .phone-recipe-op:nth-child(1)").to.have.attribute("class").which.contains("disabled");

        browser.click(control(2, "breakpoint")).pause(300);
        browser.expect.element(control(2, "breakpoint")).to.have.attribute("aria-pressed").equals("true");
        browser.expect.element("#phone-recipe-ops .phone-recipe-op:nth-child(2)").to.have.attribute("class").which.contains("breakpoint");
        browser.click(control(2, "breakpoint")).pause(300);

        browser.click(control(2, "delete"));
        expectRecipe(browser, ["Reverse", "Find / Replace"], "abc");
        browser.expect.elements("#phone-recipe-ops .phone-recipe-op").count.to.equal(2);
    },

    "Tapping an operation's name shows its arguments in place, to edit them in the editor": browser => {
        const op = "#phone-editor-body #rec-list li.operation:nth-child(2)";
        browser.expect.element(`${op} .ingredients`).to.not.be.visible;
        browser.click(`${op} .op-title`).pause(300);
        browser.expect.element(`${op} .ingredients`).to.be.visible;
        browser.expect.element(`${op} .op-title`).to.have.attribute("aria-expanded").equals("true");
        browser.expect.element("#phone-arg-sheet").to.not.be.visible;

        // Find / Replace: replace "C" with "z" instead of "x"; the recipe is Reverse (disabled), Find / Replace
        browser.execute(function () {
            const field = document.querySelectorAll("#phone-editor-body #rec-list li.operation:nth-child(2) input.arg")[1];
            field.value = "z";
            field.dispatchEvent(new Event("input", {bubbles: true}));
        });
        browser.execute(function () {
            const findField = document.querySelectorAll("#phone-editor-body #rec-list li.operation:nth-child(2) input.arg")[0];
            findField.value = "a";
            findField.dispatchEvent(new Event("input", {bubbles: true}));
        });
        expectRecipe(browser, ["Reverse", "Find / Replace"], "zbc");

        browser.click(`${op} .op-title`).pause(300);
        browser.expect.element(`${op} .ingredients`).to.not.be.visible;
    },

    "Back closes the editor and leaves the desktop recipe list as it was": browser => {
        browser.back().waitForElementNotVisible("#phone-editor-sheet", 5000);
        browser.execute(function () {
            const recList = document.getElementById("rec-list");
            return {
                parent: recList.parentNode.id,
                controls: recList.querySelectorAll(".phone-op-controls").length,
                tabindex: recList.querySelectorAll(".op-title[tabindex]").length
            };
        }, [], ({value}) => {
            browser.assert.strictEqual(value.parent, "recipe");
            browser.assert.strictEqual(value.controls, 0, "no phone controls left in the recipe list");
            browser.assert.strictEqual(value.tabindex, 0);
        });
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
