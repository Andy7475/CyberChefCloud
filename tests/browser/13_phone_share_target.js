/**
 * Tests for shared input (issue #23): a Web Share Target POST (as Android's Share menu sends)
 * goes through the service worker into the input, the stored copy is deleted, and the recipe
 * picker runs a saved recipe. Runs against a production build (`npx grunt prod`) on its own
 * port; skips when there is no build.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

const server = utils.prodBuildServer(8098);

/**
 * Reads the output as text.
 *
 * @param {Browser} browser
 * @param {Function} callback
 */
function readOutput(browser, callback) {
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], ({value}) => callback(value));
}

module.exports = {

    before: async () => {
        if (server.available) await server.start();
    },

    "Setup: phone layout, service worker in control, a saved recipe": browser => {
        if (!server.available) {
            browser.assert.ok(true, "Skipped: no production build in build/prod (run `npx grunt prod`)");
            return;
        }
        browser
            .resizeWindow(390, 844)
            .url(server.origin)
            .waitForElementNotPresent("#preloader", 30000);
        browser.executeAsync(function (done) {
            localStorage.savedRecipes = JSON.stringify([{id: 1, name: "Shout", recipe: "[{\"op\":\"To Upper case\",\"args\":[\"All\"]}]"}]);
            localStorage.recipeId = 1;
            navigator.serviceWorker.ready.then(() => done());
        });
        utils.setPhoneLayout(browser);
        browser.refresh().waitForElementNotPresent("#preloader", 30000);
        browser.execute(function () {
            return Boolean(navigator.serviceWorker.controller);
        }, [], ({value}) => browser.assert.strictEqual(value, true, "the page is controlled by the service worker"));
    },

    "The manifest declares the share target": browser => {
        if (!server.available) return;
        browser.executeAsync(function (done) {
            fetch("manifest.webmanifest").then(r => r.json()).then(m => done(m.share_target));
        }, [], ({value}) => {
            browser.assert.strictEqual(value.action, "./share-target");
            browser.assert.strictEqual(value.method, "POST");
            browser.assert.strictEqual(value.enctype, "multipart/form-data");
            browser.assert.deepStrictEqual(value.params.files[0].accept, ["image/*", "audio/*", "application/pdf", "text/*"]);
        });
    },

    "Shared text and a file arrive in the input and the recipe picker opens": browser => {
        if (!server.available) return;
        // What Android sends: a multipart POST to the share action
        browser.execute(function () {
            const form = document.createElement("form");
            form.method = "POST";
            form.action = "share-target";
            form.enctype = "multipart/form-data";
            const add = (name, value) => {
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = name;
                input.value = value;
                form.appendChild(input);
            };
            add("title", "A note");
            add("text", "hello shared https://example.com/x");
            add("url", "https://example.com/x");
            const file = document.createElement("input");
            file.type = "file";
            file.name = "files";
            const dt = new DataTransfer();
            dt.items.add(new File(["file body"], "note.txt", {type: "text/plain"}));
            file.files = dt.files;
            form.appendChild(file);
            document.body.appendChild(form);
            form.submit();
        });
        browser
            .pause(1000)
            .waitForElementNotPresent("#preloader", 30000)
            .waitForElementVisible("#phone-share-sheet", 15000);

        browser.expect.element("#phone-share-summary").text.to.equal("Received text and note.txt.");
        browser.expect.element("#phone-share-list li:first-child .phone-pick-name").text.to.equal("Current recipe");
        browser.expect.element("#phone-share-list li:nth-child(2) .phone-pick-name").text.to.equal("Shout");
        browser.expect.element("#phone-input-position").text.to.equal("2 / 2");
        browser.url(({value}) => browser.assert.ok(!value.includes("share="), "the share id is removed from the URL"));
        browser.executeAsync(function (done) {
            caches.has("ccc-shared-input").then(done);
        }, [], ({value}) => browser.assert.strictEqual(value, false, "the stored share is deleted"));
    },

    "Choosing a saved recipe runs it on the shared input": browser => {
        if (!server.available) return;
        browser
            .click("#phone-share-list .phone-pick[data-id='1']")
            .waitForElementNotVisible("#phone-share-sheet", 5000)
            .pause(2000);
        readOutput(browser, out => browser.assert.strictEqual(out, "FILE BODY", "the file input is baked"));

        browser.click("#phone-input-prev").pause(1500);
        browser.expect.element("#phone-input-position").text.to.equal("1 / 2");
        readOutput(browser, out => browser.assert.strictEqual(out, "A NOTE\nHELLO SHARED HTTPS://EXAMPLE.COM/X",
            "the text input (title and text, the URL not repeated) is baked"));
    },

    after: async browser => {
        if (server.available) {
            utils.clearServiceWorkers(browser);
            browser.execute(function () {
                localStorage.clear();
            });
            browser.perform(() => server.stop());
        } else {
            await server.stop();
        }
        browser.end();
    }
};
