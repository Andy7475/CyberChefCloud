/**
 * End-to-end tests for saving Authenticate Google Cloud settings to the
 * browser password manager, and keeping credentials out of the URL.
 *
 * These tests replace navigator.credentials with a stub, because the browser's
 * own save and account-chooser prompts cannot be driven from Nightwatch.
 * No live credentials are needed.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");

const CLIENT_ID = "123-test.apps.googleusercontent.com";
const API_KEY = "AIzaTestKeyNotReal";

module.exports = {

    before: browser => {
        browser
            .resizeWindow(1280, 800)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000)
            .click("#auto-bake-label");
    },

    "Authenticate Google Cloud: credentials are left out of the URL and saved recipes": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "OAuth 2.0 (Web Application: PKCE)",
                    { option: "UTF8", string: CLIENT_ID },
                    "my-quota-project",
                    "europe-west2",
                    { option: "UTF8", string: API_KEY },
                    true
                ]
            }
        ], "");

        browser.execute(function () {
            window.app.updateURL(false);
            window.app.manager.controls.saveClick();
            const result = {
                url: decodeURIComponent(window.location.hash),
                saved: document.getElementById("save-text-compact").value,
                recipe: window.app.getRecipeConfig()
            };
            return result;
        }, [], function ({ value }) {
            browser.assert.ok(value.url.includes("my-quota-project"), "Non-sensitive args are kept in the URL");
            browser.assert.ok(!value.url.includes(CLIENT_ID), "Client ID is not in the URL");
            browser.assert.ok(!value.url.includes(API_KEY), "API key is not in the URL");
            browser.assert.ok(!value.saved.includes(API_KEY), "API key is not in the saved recipe text");
            browser.assert.strictEqual(value.recipe[0].args[4].string, API_KEY, "API key is still in the live recipe used for baking");
        });

        // saveClick opens the save dialog; close it once its fade-in has finished
        browser.waitForElementVisible("#save-modal", 5000).pause(500);
        browser.execute(function () {
            $("#save-modal").modal("hide");
        });
        browser.waitForElementNotPresent(".modal-backdrop", 5000);
    },

    "Authenticate Google Cloud: save and fill settings via the browser password manager": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "OAuth 2.0 (Web Application: PKCE)",
                    { option: "UTF8", string: CLIENT_ID },
                    "my-quota-project",
                    "europe-west2",
                    { option: "UTF8", string: API_KEY },
                    true
                ]
            }
        ], "");

        browser.expect.element("#rec-list .save-creds-icon").to.be.present;
        browser.expect.element("#rec-list .fill-creds-icon").to.be.present;

        // Stub the Credential Management API and the label prompt
        browser.execute(function () {
            window.__storedCred = null;
            window.prompt = () => "my-profile";
            Object.defineProperty(navigator, "credentials", {
                configurable: true,
                value: {
                    store: async cred => {
                        window.__storedCred = {id: cred.id, password: cred.password};
                        return cred;
                    },
                    get: async () => window.__storedCred && {type: "password", ...window.__storedCred}
                }
            });
        });

        browser.click("#rec-list .save-creds-icon");
        browser.pause(500);

        browser.execute(function () {
            return window.__storedCred;
        }, [], function ({ value }) {
            browser.assert.strictEqual(value.id, "my-profile", "Profile is stored under the chosen label");
            const saved = JSON.parse(value.password);
            browser.assert.strictEqual(saved.op, "Authenticate Google Cloud");
            browser.assert.strictEqual(saved.args["Credentials (Client ID, PAT, or API Key)"].string, CLIENT_ID);
            browser.assert.strictEqual(saved.args["API Key (For strict API Key endpoints)"].string, API_KEY);
            browser.assert.strictEqual(saved.args["Default Region"], "europe-west2");
        });

        // Clear the operation, then fill it from the stored profile
        browser.execute(function () {
            window.app.setRecipeConfig([{op: "Authenticate Google Cloud", args: []}]);
        });
        browser.click("#rec-list .fill-creds-icon");
        browser.pause(500);

        browser.execute(function () {
            return window.app.getRecipeConfig()[0].args;
        }, [], function ({ value }) {
            browser.assert.strictEqual(value[0], "OAuth 2.0 (Web Application: PKCE)");
            browser.assert.strictEqual(value[1].string, CLIENT_ID, "Client ID is filled");
            browser.assert.strictEqual(value[2], "my-quota-project", "Quota project is filled");
            browser.assert.strictEqual(value[3], "europe-west2", "Region is filled");
            browser.assert.strictEqual(value[4].string, API_KEY, "API key is filled");
        });
        browser.saveScreenshot("tests/browser/output/auth_gcp_fill.png");
    },

    after: browser => {
        browser.end();
    }
};
