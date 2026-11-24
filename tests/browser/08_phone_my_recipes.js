/**
 * Tests for My recipes in the phone layout (issue #19): save a recipe from the ⋯ menu,
 * list, load, rename and delete saved recipes, shared with the desktop Save/Load, with
 * keys and tokens never saved.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

/**
 * Reads the saved recipes from local storage.
 *
 * @param {Browser} browser
 * @param {Function} callback - Called with the array of saved recipes.
 */
function readSaved(browser, callback) {
    browser.execute(function () {
        return JSON.parse(localStorage.savedRecipes || "[]");
    }, [], ({value}) => callback(value));
}

/**
 * Saves the current recipe from the ⋯ menu under a name.
 *
 * @param {Browser} browser
 * @param {string} name
 */
function saveAs(browser, name) {
    browser
        .click("#phone-menu-btn")
        .waitForElementVisible("#phone-menu-sheet", 5000)
        .click("#phone-menu-items [data-phone-action='save']")
        .waitForElementVisible("#phone-name-sheet", 5000)
        .waitForElementNotVisible("#phone-menu-sheet", 5000)
        .clearValue("#phone-name-input")
        .sendKeys("#phone-name-input", name)
        .click("#phone-name-submit")
        .waitForElementNotVisible("#phone-name-sheet", 5000);
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
            localStorage.removeItem("savedRecipes");
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
        });
    },

    "My recipes shows an empty state": browser => {
        browser
            .click("#phone-recipes-btn")
            .waitForElementVisible("#phone-recipes-sheet", 5000)
            .waitForElementVisible("#phone-recipes-empty", 5000);
        browser.expect.element("#phone-recipes-empty").text.to.contain("Save recipe");
        browser.back().waitForElementNotVisible("#phone-recipes-sheet", 5000);
    },

    "Save recipe from the ⋯ menu stores it in the desktop's saved recipes": browser => {
        browser.execute(function () {
            window.app.setRecipeConfig([{op: "To Hex", args: ["Space", 0]}, {op: "To Upper case", args: ["All"]}]);
            window.app.setInput("hi");
        }).pause(500);
        saveAs(browser, "Hex & shout");
        browser.expect.element("#phone-toast .phone-toast-text").text.to.equal("Saved as Hex & shout");
        readSaved(browser, saved => {
            browser.assert.strictEqual(saved.length, 1);
            browser.assert.strictEqual(saved[0].name, "Hex &amp; shout", "name is stored HTML-escaped, as on the desktop");
            browser.assert.deepStrictEqual(JSON.parse(saved[0].recipe).map(op => op.op), ["To Hex", "To Upper case"]);
        });
    },

    "Loading a saved recipe from My recipes restores it and returns to the run screen": browser => {
        browser.execute(function () {
            window.app.manager.recipe.clearRecipe();
            window.app.setInput("hi");
        }).pause(300);
        browser.expect.elements("#phone-recipe-ops .phone-recipe-op").count.to.equal(0);

        browser
            .click("#phone-recipes-btn")
            .waitForElementVisible("#phone-recipes-list .phone-recipe-load", 5000);
        browser.expect.element("#phone-recipes-list .phone-recipe-load").to.have.attribute("aria-label").equals("Load Hex & shout");
        browser.expect.element("#phone-recipes-list .phone-recipe-load .phone-pick-desc").text.to.equal("To Hex → To Upper case");
        browser.execute(function () {
            const r = document.querySelector("#phone-recipes-list .phone-recipe-load").getBoundingClientRect();
            const m = document.querySelector("#phone-recipes-list .phone-recipe-more").getBoundingClientRect();
            return Math.min(r.height, m.height, m.width);
        }, [], ({value}) => browser.assert.ok(value >= 44, `row tap targets are at least 44px (${value})`));

        browser
            .click("#phone-recipes-list .phone-recipe-load")
            .waitForElementNotVisible("#phone-recipes-sheet", 5000)
            .pause(1000);
        browser.execute(function () {
            return [
                Array.from(document.querySelectorAll("#phone-recipe-ops .phone-recipe-op")).map(li => li.textContent),
                window.app.manager.output.outputEditorView.state.doc.toString()
            ];
        }, [], ({value}) => {
            browser.assert.deepStrictEqual(value[0], ["To Hex", "To Upper case"]);
            browser.assert.strictEqual(value[1], "68 69");
        });
    },

    "Rename and delete (with Undo) a saved recipe": browser => {
        browser
            .click("#phone-recipes-btn")
            .waitForElementVisible("#phone-recipes-list .phone-recipe-more", 5000)
            .click("#phone-recipes-list .phone-recipe-more")
            .waitForElementVisible("#phone-recipe-row-sheet", 5000)
            .click("#phone-recipe-rename")
            .waitForElementVisible("#phone-name-sheet", 5000)
            .clearValue("#phone-name-input")
            .sendKeys("#phone-name-input", "Renamed")
            .click("#phone-name-submit")
            .waitForElementNotVisible("#phone-name-sheet", 5000);
        browser.expect.element("#phone-recipes-sheet").to.be.visible;
        browser.expect.element("#phone-recipes-list .phone-pick-name").text.to.equal("Renamed");
        readSaved(browser, saved => browser.assert.strictEqual(saved[0].name, "Renamed"));

        browser
            .click("#phone-recipes-list .phone-recipe-more")
            .waitForElementVisible("#phone-recipe-row-sheet", 5000)
            .click("#phone-recipe-delete")
            .waitForElementNotVisible("#phone-recipe-row-sheet", 5000)
            .waitForElementVisible("#phone-recipes-empty", 5000);
        readSaved(browser, saved => browser.assert.strictEqual(saved.length, 0));

        browser
            .waitForElementVisible("#phone-toast .phone-toast-action", 5000)
            .click("#phone-toast .phone-toast-action")
            .waitForElementVisible("#phone-recipes-list .phone-recipe-load", 5000);
        readSaved(browser, saved => browser.assert.strictEqual(saved.length, 1, "Undo restores it"));
        browser.back().waitForElementNotVisible("#phone-recipes-sheet", 5000);
    },

    "A recipe saved on the desktop appears in My recipes": browser => {
        browser.execute(function () {
            const list = JSON.parse(localStorage.savedRecipes);
            list.push({id: 99, name: "From desktop", recipe: "[{\"op\":\"ROT13\",\"args\":[true,true,false,13]}]"});
            localStorage.savedRecipes = JSON.stringify(list);
        });
        browser
            .click("#phone-recipes-btn")
            .waitForElementVisible("#phone-recipes-list .phone-recipe-load", 5000);
        browser.expect.elements("#phone-recipes-list .phone-recipe-load").count.to.equal(2);
        browser.expect.element("#phone-recipes-list li:first-child .phone-pick-name").text.to.equal("From desktop");
        browser.back().waitForElementNotVisible("#phone-recipes-sheet", 5000);
    },

    "Keys and tokens are never saved": browser => {
        browser.execute(function () {
            window.app.setRecipeConfig([{
                op: "Authenticate Google Cloud",
                args: ["API Key", {option: "UTF8", string: "AIzaDummyKey123"}, "", "us-central1",
                       {option: "UTF8", string: "AIzaSecondKey456"}, true]
            }]);
        }).pause(500);
        saveAs(browser, "Auth");
        readSaved(browser, saved => {
            const auth = saved.find(r => r.name === "Auth");
            browser.assert.ok(auth, "saved");
            browser.assert.ok(!auth.recipe.includes("AIza"), "no key in the saved recipe");
            const args = JSON.parse(auth.recipe)[0].args;
            browser.assert.strictEqual(args[1].string, "");
            browser.assert.strictEqual(args[4].string, "");
        });
    },

    after: browser => {
        browser.execute(function () {
            localStorage.removeItem("savedRecipes");
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
        });
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
