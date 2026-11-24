/**
 * Tests for the phone layout's operation picker (issue #16): "+" opens a full-screen picker,
 * a single tap adds an operation, Undo removes it, favourites are shared with the desktop,
 * and scrolling the list never adds anything.
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
 * Reads the names of the operations in the recipe strip.
 *
 * @param {Browser} browser
 * @param {Function} callback - Called with an array of names.
 */
function readStrip(browser, callback) {
    browser.execute(function () {
        return Array.from(document.querySelectorAll("#phone-recipe-ops .phone-recipe-op")).map(li => li.textContent);
    }, [], ({value}) => callback(value));
}

/**
 * Opens the picker with "+".
 *
 * @param {Browser} browser
 */
function openPicker(browser) {
    browser
        .click("#phone-add-op")
        .waitForElementVisible("#phone-picker-sheet", 5000);
}

/**
 * Types into the picker's search field.
 *
 * @param {Browser} browser
 * @param {string} text
 */
function search(browser, text) {
    browser
        .clearValue("#phone-picker-search")
        .sendKeys("#phone-picker-search", text)
        .pause(300);
}

/**
 * Sends a touch gesture through the Chrome DevTools protocol: a finger goes down on the
 * centre of an element, optionally moves upwards by `distance` pixels, and lifts.
 *
 * @param {Browser} browser
 * @param {string} selector
 * @param {number} distance - 0 for a tap; more for a scroll
 */
function touchGesture(browser, selector, distance) {
    browser.execute(function (sel) {
        const r = document.querySelector(sel).getBoundingClientRect();
        return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};
    }, [selector], async ({value: {x, y}}) => {
        const touch = (type, points) =>
            browser.chrome.sendAndGetDevToolsCommand("Input.dispatchTouchEvent", {type, touchPoints: points});
        await touch("touchStart", [{x, y}]);
        const steps = 10;
        for (let i = 1; distance && i <= steps; i++) {
            await touch("touchMove", [{x, y: y - Math.round(distance * i / steps)}]);
        }
        await touch("touchEnd", []);
    });
    browser.pause(500);
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
            localStorage.removeItem("phoneRecentOperations");
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
            window.app.manager.recipe.clearRecipe();
            window.app.setInput("Hello");
        }).pause(300);
    },

    "+ opens the picker with the search field focused, favourites first, then categories": browser => {
        openPicker(browser);
        browser.expect.element("#phone-picker-search").to.be.active;
        browser.execute(function () {
            return Array.from(document.querySelectorAll("#phone-picker-results .phone-pick-heading")).map(h => h.textContent);
        }, [], ({value}) => browser.assert.deepStrictEqual(value, ["Favourites", "Categories"]));
        browser.expect.elements("#phone-picker-results .phone-pick-category").count.to.not.equal(0);
    },

    "Search highlights matches, and a tap adds the operation and bakes": browser => {
        search(browser, "base64");
        browser.expect.element("#phone-picker-results .phone-pick[data-op='To Base64'] .phone-pick-name b").to.be.present;
        browser.expect.element("#phone-picker-results .phone-pick[data-op='To Base64']").to.have.attribute("aria-label").equals("Add To Base64");

        browser
            .click("#phone-picker-results .phone-pick[data-op='To Base64']")
            .waitForElementNotVisible("#phone-picker-sheet", 5000)
            .pause(1000);
        readStrip(browser, ops => browser.assert.deepStrictEqual(ops, ["To Base64"]));
        readOutput(browser, out => browser.assert.strictEqual(out, "SGVsbG8="));
        browser.expect.element("#phone-toast").to.be.visible;
        browser.expect.element("#phone-toast .phone-toast-text").text.to.equal("Added To Base64");
    },

    "Undo removes the added operation": browser => {
        browser
            .click("#phone-toast .phone-toast-action")
            .waitForElementNotVisible("#phone-toast", 5000)
            .waitForElementVisible("#phone-recipe-ops .phone-recipe-empty", 5000);
        browser.expect.elements("#rec-list li.operation").count.to.equal(0);
    },

    "Recently used operations are listed after favourites": browser => {
        openPicker(browser);
        browser.execute(function () {
            return Array.from(document.querySelectorAll("#phone-picker-results .phone-pick-heading")).map(h => h.textContent);
        }, [], ({value}) => browser.assert.deepStrictEqual(value, ["Favourites", "Recently used", "Categories"]));
        browser.expect.element("#phone-picker-results ul[aria-label='Recently used'] .phone-pick[data-op='To Base64']").to.be.present;
    },

    "Scrolling the list never adds an operation, but a tap does": browser => {
        // Open a long category so the list can scroll
        browser
            .click("#phone-picker-results .phone-pick-category[data-category='Data format'] > summary")
            .waitForElementVisible("#phone-picker-results .phone-pick-category[open] .phone-pick", 5000);

        const target = "#phone-picker-results .phone-pick-category[open] .phone-pick-row:nth-child(3) .phone-pick";
        browser.execute(function (sel) {
            document.querySelector(sel).scrollIntoView({block: "center"});
        }, [target]).pause(200);
        touchGesture(browser, target, 200);
        browser.expect.element("#phone-picker-sheet").to.be.visible;
        browser.expect.elements("#rec-list li.operation").count.to.equal(0);
        browser.execute(function () {
            return document.getElementById("phone-picker-results").scrollTop;
        }, [], ({value}) => browser.assert.ok(value > 0, "the list scrolled"));

        // Control: the same kind of touch without moving is a tap, and adds the operation
        browser.execute(function (sel) {
            document.querySelector(sel).scrollIntoView({block: "center"});
        }, [target]).pause(200);
        touchGesture(browser, target, 0);
        browser.waitForElementNotVisible("#phone-picker-sheet", 5000);
        browser.expect.elements("#rec-list li.operation").count.to.equal(1);
        browser.click("#phone-toast .phone-toast-action").waitForElementNotVisible("#phone-toast", 5000);
    },

    "An operation can be favourited and unfavourited from the picker": browser => {
        const fav = "#phone-picker-results .phone-pick-fav[data-op='ROT13']";
        const isFavourite = expected => browser.execute(function () {
            return JSON.parse(localStorage.favourites).includes("ROT13");
        }, [], ({value}) => browser.assert.strictEqual(value, expected, `ROT13 ${expected ? "is" : "is not"} a favourite`));

        openPicker(browser);
        search(browser, "rot13");
        isFavourite(false);
        browser.click(fav).pause(300);
        browser.expect.element(fav).to.have.attribute("aria-pressed").equals("true");
        isFavourite(true);
        browser.execute(function () {
            // The desktop Favourites category is the first operation list
            return Array.from(document.querySelectorAll("#categories .op-list")[0].children)
                .some(li => li.textContent === "ROT13");
        }, [], ({value}) => browser.assert.strictEqual(value, true, "ROT13 is in the desktop Favourites category"));

        browser.click(fav).pause(300);
        browser.expect.element(fav).to.have.attribute("aria-pressed").equals("false");
        isFavourite(false);
    },

    "Back closes the picker": browser => {
        browser
            .back()
            .waitForElementNotVisible("#phone-picker-sheet", 5000);
        browser.expect.elements("#rec-list li.operation").count.to.equal(0);
    },

    "Adding a manualBake operation switches Auto Bake off, as on the desktop": browser => {
        openPicker(browser);
        search(browser, "DNS over HTTPS");
        browser
            .click("#phone-picker-results .phone-pick[data-op='DNS over HTTPS']")
            .waitForElementNotVisible("#phone-picker-sheet", 5000)
            .pause(300);
        browser.execute(function () {
            return document.getElementById("auto-bake").checked;
        }, [], ({value}) => browser.assert.strictEqual(value, false, "Auto Bake is off"));
        browser.click("#phone-toast .phone-toast-action").waitForElementNotVisible("#phone-toast", 5000);
    },

    after: browser => {
        browser.execute(function () {
            localStorage.removeItem("phoneRecentOperations");
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
        });
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
