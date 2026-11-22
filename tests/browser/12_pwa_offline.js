/**
 * Tests for the installable app (issue #14): the manifest, the service worker, and baking a
 * local operation offline. Runs against a production build (`npx grunt prod`), served by this
 * test on its own port so it can be stopped to go offline. Skips when there is no build.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

const server = utils.prodBuildServer(8099);

/**
 * Waits for the app to finish loading.
 *
 * @param {Browser} browser
 */
function waitForApp(browser) {
    browser.waitForElementNotPresent("#preloader", 30000);
}

/**
 * Bakes To Base64 on "hello" and checks the output.
 *
 * @param {Browser} browser
 * @param {string} message
 */
function bakeBase64(browser, message) {
    browser.execute(function () {
        window.app.setRecipeConfig([{op: "To Base64", args: ["A-Za-z0-9+/="]}]);
        window.app.setInput("hello");
        window.app.bake();
    }).pause(3000);
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], ({value}) => browser.assert.strictEqual(value, "aGVsbG8=", message));
}

module.exports = {

    before: async () => {
        if (server.available) await server.start();
    },

    // The server is stopped by the offline test

    "The manifest is served with the app's scope": browser => {
        if (!server.available) {
            browser.assert.ok(true, "Skipped: no production build in build/prod (run `npx grunt prod`)");
            return;
        }
        browser.url(server.origin);
        waitForApp(browser);
        browser.expect.element("link[rel='manifest']").to.be.present;
        browser.executeAsync(function (done) {
            fetch(document.querySelector("link[rel='manifest']").href).then(r => r.json()).then(done);
        }, [], ({value}) => {
            browser.assert.strictEqual(value.scope, "./");
            browser.assert.strictEqual(value.start_url, "./");
            browser.assert.strictEqual(value.display, "standalone");
            browser.assert.ok(value.icons.some(i => i.sizes === "512x512"), "has a 512px icon");
        });
    },

    "The service worker registers and controls the page": browser => {
        if (!server.available) return;
        browser.executeAsync(function (done) {
            navigator.serviceWorker.ready.then(reg => done(reg.scope));
        }, [], ({value}) => browser.assert.strictEqual(value, server.origin));

        // A reload under the worker's control caches the app's files
        browser.refresh();
        waitForApp(browser);
        browser.execute(function () {
            return Boolean(navigator.serviceWorker.controller);
        }, [], ({value}) => browser.assert.strictEqual(value, true, "the page is controlled"));
        bakeBase64(browser, "bakes online");
    },

    "Offline, a reload still opens the app and a local operation bakes": async browser => {
        if (!server.available) return;
        await server.stop();
        browser.refresh();
        waitForApp(browser);
        bakeBase64(browser, "bakes offline");
    },

    after: browser => {
        if (server.available) {
            // Clearing needs the page, which the worker serves from cache even with the server down
            utils.clearServiceWorkers(browser);
            browser.perform(() => server.stop());
        }
        browser.end();
    }
};
