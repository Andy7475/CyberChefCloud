/**
 * Tests for the phone layout's input bar (issue #17): summary / compact / full sizes, the
 * ‹ n / N › switcher, Paste, Open file and the shared loadFiles() path for generated files.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

/**
 * Checks the input area's size.
 *
 * @param {Browser} browser
 * @param {string} expected - "summary", "compact" or "full"
 * @param {string} [message]
 */
function expectState(browser, expected, message) {
    browser.expect.element("#input").to.have.attribute("data-phone-state").equals(expected);
    if (message) browser.assert.ok(true, message);
}

/**
 * Sets the input text, as loading or pasting would (the editor does not have focus).
 *
 * @param {Browser} browser
 * @param {string} text
 */
function setInput(browser, text) {
    browser.execute(function (t) {
        document.activeElement.blur();
        window.app.setInput(t);
    }, [text]).pause(500);
}

module.exports = {

    before: browser => {
        browser
            .resizeWindow(390, 844)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000);
        utils.setPhoneLayout(browser);
        browser.waitForElementVisible("#phone-input-bar", 5000);
    },

    "The input-source row has the fixed order, with slots for Camera and Microphone": browser => {
        browser.execute(function () {
            return Array.from(document.getElementById("phone-input-sources").children)
                .map(el => el.id || `slot:${el.dataset.slot}`);
        }, [], ({value}) => browser.assert.deepStrictEqual(value,
            ["phone-input-paste", "phone-input-file", "slot:camera", "slot:microphone"]));

        browser.execute(function () {
            return ["phone-input-toggle", "phone-input-paste", "phone-input-file", "phone-input-clear"].map(id => {
                const r = document.getElementById(id).getBoundingClientRect();
                return Math.round(r.height);
            });
        }, [], ({value}) => browser.assert.ok(value.every(h => h >= 44), `tap targets ${value.join(", ")} are at least 44px tall`));
    },

    "Short text gives the compact input, with a summary of the text": browser => {
        setInput(browser, "find the cat\nin the hat");
        expectState(browser, "compact");
        browser.expect.element("#phone-input-toggle .phone-input-summary").text.to.equal("find the cat · 23 chars");
        browser.expect.element("#phone-input-toggle").to.have.attribute("aria-label").which.contains("Text, 23 characters");
        browser.expect.element("#input-text").to.be.visible;
    },

    "Long text gives the summary bar": browser => {
        setInput(browser, Array.from({length: 30}, (_, i) => `line ${i + 1}`).join("\n"));
        expectState(browser, "summary");
        browser.expect.element("#input-text").to.not.be.visible;
        browser.expect.element("#phone-input-toggle").to.have.attribute("aria-expanded").equals("false");
    },

    "Tapping the bar cycles summary, compact, full; the choice holds until the input changes": browser => {
        browser.click("#phone-input-toggle").pause(200);
        expectState(browser, "compact");
        browser.click("#phone-input-toggle").pause(200);
        expectState(browser, "full");
        browser.execute(function () {
            const input = document.getElementById("input").getBoundingClientRect().height;
            const output = document.getElementById("output").getBoundingClientRect().height;
            return input > output;
        }, [], ({value}) => browser.assert.ok(value, "full input is taller than the output"));

        // Typing in the editor keeps the chosen size
        browser.execute(function () {
            window.app.manager.input.inputEditorView.focus();
        });
        browser.sendKeys("#input-text .cm-content", " more").pause(500);
        expectState(browser, "full");

        browser.click("#phone-input-toggle").pause(200);
        expectState(browser, "summary");

        // New content resets to the default for that content
        browser.pause(1000);
        setInput(browser, "short");
        expectState(browser, "compact");
    },

    "Paste puts the clipboard text into the input": browser => {
        browser.execute(function () {
            navigator.clipboard.readText = () => Promise.resolve("from the clipboard");
        });
        browser.click("#phone-input-paste").pause(800);
        browser.execute(function () {
            return window.app.manager.input.inputEditorView.state.doc.toString();
        }, [], ({value}) => browser.assert.strictEqual(value, "from the clipboard"));
    },

    "Open file loads through the file-upload path and gives the summary bar": browser => {
        const filepath = require("path").resolve(__dirname + "/../samples/files/TowelDay.jpeg");
        browser.execute(function () {
            const el = document.getElementById("phone-open-file");
            el.hidden = false;
        });
        browser.setValue("#phone-open-file", filepath).pause(100);
        browser.execute(function () {
            document.getElementById("phone-open-file").hidden = true;
        });
        browser.waitForElementPresent("#input-text .cm-file-details", 10000).pause(500);
        expectState(browser, "summary");
        browser.expect.element("#phone-input-toggle .phone-input-summary").text.to.contain("TowelDay.jpeg");
        browser.expect.element("#phone-input-toggle .phone-input-type").text.to.equal("image");
    },

    "Generated files go through loadFiles(); two inputs show the ‹ 1 / 2 › switcher": browser => {
        browser.click("#phone-input-clear").pause(1000);
        browser.expect.element("#phone-input-switcher").to.not.be.visible;

        browser.execute(function () {
            window.app.setRecipeConfig([{op: "To Upper case", args: ["All"]}]);
            const autoBake = document.getElementById("auto-bake");
            if (!autoBake.checked) autoBake.click();
        });
        browser.execute(function () {
            window.app.manager.phone.input.loadFiles([
                new File(["first file"], "first.txt", {type: "text/plain"}),
                new File(["second file"], "second.txt", {type: "text/plain"})
            ]);
        });
        // As on the desktop, the last file loaded becomes the active input
        browser
            .waitForElementVisible("#phone-input-switcher", 10000)
            .pause(1000)
            .expect.element("#phone-input-position").text.to.equal("2 / 2");
        browser.expect.element("#phone-input-position").to.have.attribute("aria-label").equals("Input 2 of 2");
        browser.expect.element("#phone-input-toggle .phone-input-summary").text.to.contain("second.txt");

        browser.click("#phone-input-prev").pause(1000);
        browser.expect.element("#phone-input-position").text.to.equal("1 / 2");
        browser.expect.element("#phone-input-toggle .phone-input-summary").text.to.contain("first.txt");
        browser.execute(function () {
            const tabs = window.app.manager.tabs;
            return [tabs.getActiveTab("input"), tabs.getActiveTab("output")];
        }, [], ({value}) => browser.assert.strictEqual(value[0], value[1], "the output tab follows the active input"));
        browser.click("#phone-bake").pause(1500);
        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], ({value}) => browser.assert.strictEqual(value, "FIRST FILE", "the output is for the active input"));

        browser.click("#phone-input-next").pause(1000);
        browser.expect.element("#phone-input-position").text.to.equal("2 / 2");
        browser.expect.element("#phone-input-toggle .phone-input-summary").text.to.contain("second.txt");
    },

    "Clear goes back to one empty input": browser => {
        browser.click("#phone-input-clear").pause(1000);
        browser.expect.element("#phone-input-switcher").to.not.be.visible;
        browser.expect.element("#phone-input-toggle .phone-input-summary").text.to.equal("Empty input");
        expectState(browser, "compact");
    },

    after: browser => {
        utils.setLayoutOption(browser, "auto");
        browser.end();
    }
};
