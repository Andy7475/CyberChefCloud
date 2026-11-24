/**
 * Tests for the recipe strip's gestures and the password-manager profile sheet in the phone
 * layout: double tap deletes an operation (with Undo), press and hold then drag moves it, and
 * the key icons open a sign-in form that password managers can save and fill.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

/**
 * The recipe's operation names and the output.
 *
 * @param {Browser} browser
 * @param {Function} callback
 */
function readRecipe(browser, callback) {
    browser.execute(function () {
        return {
            ops: window.app.getRecipeConfig().map(op => op.op),
            strip: Array.from(document.querySelectorAll("#phone-recipe-ops .phone-recipe-op")).map(li => li.textContent),
            output: window.app.manager.output.outputEditorView.state.doc.toString()
        };
    }, [], ({value}) => callback(value));
}

/**
 * Sends a touch sequence through the Chrome DevTools protocol.
 *
 * @param {Browser} browser
 * @param {string} from - Selector where the finger goes down
 * @param {string} [to] - Selector where it ends; none for a tap
 * @param {number} [hold] - Milliseconds to hold before moving
 */
function touch(browser, from, to, hold = 0) {
    browser.execute(function (a, b) {
        const centre = sel => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};
        };
        return {start: centre(a), end: b ? centre(b) : null};
    }, [from, to || null], async ({value: {start, end}}) => {
        const send = (type, points) => browser.chrome.sendAndGetDevToolsCommand("Input.dispatchTouchEvent", {type, touchPoints: points});
        await send("touchStart", [start]);
        if (hold) await new Promise(r => setTimeout(r, hold));
        if (end) {
            const steps = 12;
            for (let i = 1; i <= steps; i++) {
                await send("touchMove", [{x: Math.round(start.x + (end.x - start.x) * i / steps), y: start.y}]);
                await new Promise(r => setTimeout(r, 16));
            }
            // Past the target's centre, so the list reorders
            await send("touchMove", [{x: end.x + 20, y: start.y}]);
        }
        await send("touchEnd", []);
    });
    browser.pause(800);
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

    "A single tap opens the operation's arguments": browser => {
        touch(browser, "#phone-recipe-ops .phone-recipe-op:nth-child(2)");
        browser.waitForElementVisible("#phone-arg-sheet", 5000);
        browser.expect.element("#phone-arg-title").text.to.equal("To Upper case");
        browser.back().waitForElementNotVisible("#phone-arg-sheet", 5000);
    },

    "A double tap deletes the operation, and Undo puts it back": browser => {
        browser.execute(function () {
            const el = document.querySelector("#phone-recipe-ops .phone-recipe-op:nth-child(3)");
            const r = el.getBoundingClientRect();
            const opts = {bubbles: true, clientX: r.left + 10, clientY: r.top + 10, pointerType: "touch"};
            for (let i = 0; i < 2; i++) {
                el.dispatchEvent(new PointerEvent("pointerdown", opts));
                el.dispatchEvent(new PointerEvent("pointerup", opts));
            }
        }).pause(800);
        readRecipe(browser, r => {
            browser.assert.deepStrictEqual(r.ops, ["Reverse", "To Upper case"]);
            browser.assert.strictEqual(r.output, "CBA");
        });
        browser.expect.element("#phone-arg-sheet").to.not.be.visible;
        browser.expect.element("#phone-toast .phone-toast-text").text.to.equal("Deleted Find / Replace");

        browser.click("#phone-toast .phone-toast-action").pause(1000);
        readRecipe(browser, r => {
            browser.assert.deepStrictEqual(r.ops, ["Reverse", "To Upper case", "Find / Replace"]);
            browser.assert.deepStrictEqual(r.strip, ["Reverse", "To Upper case", "Find / Replace"]);
            browser.assert.strictEqual(r.output, "xBA");
        });
    },

    "Press and hold, then drag, moves an operation in the strip": browser => {
        touch(browser, "#phone-recipe-ops .phone-recipe-op:nth-child(1)", "#phone-recipe-ops .phone-recipe-op:nth-child(2)", 500);
        readRecipe(browser, r => {
            browser.assert.deepStrictEqual(r.ops, ["To Upper case", "Reverse", "Find / Replace"]);
            browser.assert.deepStrictEqual(r.strip, r.ops, "the strip shows the new order");
            // To Upper case and Reverse give the same result in either order
            browser.assert.strictEqual(r.output, "xBA");
        });
        browser.expect.element("#phone-arg-sheet").to.not.be.visible;
    },

    "The key icons open a sign-in form the password manager can save and fill": browser => {
        browser.execute(function () {
            window.app.setRecipeConfig([{
                op: "Authenticate Google Cloud",
                args: ["API Key", {option: "UTF8", string: "AIzaTestKey"}, "my-project", "europe-west2",
                       {option: "UTF8", string: ""}, true]
            }]);
        }).pause(500);
        browser
            .click("#phone-recipe-ops .phone-recipe-op:nth-child(1)")
            .waitForElementVisible("#phone-arg-sheet", 5000);
        browser.execute(function () {
            return Boolean(window.PasswordCredential);
        }, [], ({value}) => {
            if (!value) browser.assert.ok(true, "Skipped: no PasswordCredential, so no key icons");
        });

        // Save: the form holds the settings as the password
        browser.click("#phone-arg-sheet .save-creds-icon").waitForElementVisible("#phone-profile-sheet", 5000);
        browser.expect.element("#phone-profile-name").to.have.attribute("autocomplete").equals("username");
        browser.expect.element("#phone-profile-secret").to.have.attribute("autocomplete").equals("current-password");
        let saved;
        browser.execute(function () {
            return document.getElementById("phone-profile-secret").value;
        }, [], ({value}) => {
            saved = value;
            const profile = JSON.parse(value);
            browser.assert.strictEqual(profile.op, "Authenticate Google Cloud");
            browser.assert.strictEqual(profile.args["Quota Project (OAuth only)"], "my-project");
        });
        browser.sendKeys("#phone-profile-name", "my-project").click("#phone-profile-submit");
        browser.waitForElementNotVisible("#phone-profile-sheet", 5000);
        browser.expect.element("#phone-arg-sheet").to.be.visible;

        // Change a setting, then fill from the "saved" profile, as the keyboard suggestion would
        browser.execute(function () {
            const field = document.querySelectorAll("#phone-arg-sheet li.phone-editing input.arg")[1];
            field.value = "changed";
            field.dispatchEvent(new Event("input", {bubbles: true}));
        });
        browser.click("#phone-arg-sheet .fill-creds-icon").waitForElementVisible("#phone-profile-sheet", 5000);
        browser.expect.element("#phone-profile-submit").text.to.equal("FILL");
        browser.perform(() => {
            browser.execute(function (secret) {
                document.getElementById("phone-profile-name").value = "my-project";
                document.getElementById("phone-profile-secret").value = secret;
            }, [saved]);
        });
        browser.click("#phone-profile-submit").waitForElementNotVisible("#phone-profile-sheet", 5000);
        browser.execute(function () {
            return window.app.getRecipeConfig()[0].args[2];
        }, [], ({value}) => browser.assert.strictEqual(value, "my-project", "filled from the profile"));
        browser.back().waitForElementNotVisible("#phone-arg-sheet", 5000);
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
