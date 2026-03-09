/**
 * End-to-end tests for the Prompt LLM Operation via Nightwatch.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");
require("dotenv").config();

module.exports = {

    before: browser => {
        browser
            .resizeWindow(1280, 800)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000)
            .click("#auto-bake-label");
    },

    "Prompt LLM: Text generation with system prompt and input": function (browser) {
        const testToken = browserUtils.getTestPAT();
        if (!testToken) {
            console.log("Skipping live API test: No PAT available.");
            return;
        }

        const inputStr = "Hello, what is your name?";

        browserUtils.loadRecipeConfig(browser, [
            {
                op: "Authenticate Google Cloud",
                args: [
                    "Personal Access Token (PAT)",
                    { option: "UTF8", string: testToken },
                    "cyberchefcloud",
                    "us-central1",
                    true
                ]
            },
            {
                op: "Prompt LLM",
                args: [
                    "You are a test automaton. You must always reply with exactly 'I am a robot.'",
                    "gemini-2.5-flash",
                    "text/plain",
                    8192,
                    1.0
                ]
            }
        ], inputStr);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);

        // Give Gemini plenty of time to respond
        browser.pause(10000);
        browser.saveScreenshot("tests/browser/output/prompt_llm_text.png");

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            browser.assert.ok(
                value.includes("I am a robot."),
                `Expected robot response, got: ${value}`
            );
        });
    },

    "Prompt LLM: Base64 image payload (multimodal)": function (browser) {
        const testToken = browserUtils.getTestPAT();
        if (!testToken) {
            console.log("Skipping live API test: No PAT available.");
            return;
        }

        // 1-pixel transparent PNG in raw binary form (approximate for test)
        // Nightwatch `.loadRecipeConfig` will treat the string input as text.
        // We will fake an image byte array by providing its base64, then decoding it inline before the Prompt step.
        const base64Pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

        browserUtils.loadRecipeConfig(browser, [
            {
                op: "From Base64",
                args: []
            },
            {
                op: "Authenticate Google Cloud",
                args: [
                    "Personal Access Token (PAT)",
                    { option: "UTF8", string: testToken },
                    "cyberchefcloud",
                    "us-central1",
                    true
                ]
            },
            {
                op: "Prompt LLM",
                args: [
                    "What size is this image?",
                    "gemini-2.5-flash",
                    "image/png",
                    8192,
                    1.0
                ]
            }
        ], base64Pixel);

        browser.waitForElementNotVisible("#snackbar-container", 6000);
        browserUtils.bake(browser);
        browser.pause(10000);
        browser.saveScreenshot("tests/browser/output/prompt_llm_image.png");

        browser.execute(function () {
            return window.app.manager.output.outputEditorView.state.doc.toString();
        }, [], function ({ value }) {
            const valLower = value.toLowerCase();
            browser.assert.ok(
                valLower.includes("1x1") || valLower.includes("1 x 1") || valLower.includes("pixel"),
                `Expected LLM to recognize 1x1 image size, got: ${value}`
            );
        });
    },

    after: function (browser) {
        browser.end();
    }
};
