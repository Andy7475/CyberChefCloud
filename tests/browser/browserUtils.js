/**
 * Utility functions for browser tests.
 *
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2023
 * @license Apache-2.0
 */

/** @function
 * Clears the recipe and inpu
 *
 * @param {Browser} browser - Nightwatch clien
 */
function clear(browser) {
    browser
        .useCss()
        .click("#clr-recipe")
        .click("#clr-io")
        .waitForElementNotPresent("#rec-list li.operation")
        .expect.element("#input-text .cm-content").text.that.equals("");
}

/** @function
 * Sets the input to the desired string
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string} input - The text to populate the input with
 * @param {boolean} [type=true] - Whether to type the characters in by using sendKeys,
 *      or to set the value of the editor directly (useful for special characters)
 */
function setInput(browser, input, type = true) {
    clear(browser);
    if (type) {
        browser
            .useCss()
            .sendKeys("#input-text .cm-content", input)
            .pause(100);
    } else {
        browser.execute(text => {
            window.app.setInput(text);
        }, [input]);
        browser.pause(100);
    }
    expectInput(browser, input);
}

/** @function
 * Triggers a bake
 *
 * @param {Browser} browser - Nightwatch clien
 */
function bake(browser) {
    browser
        // Ensure we're not currently busy
        .waitForElementNotVisible("#output-loader", 5000)
        .expect.element("#bake span").text.to.equal("BAKE!");

    browser
        .click("#bake")
        .waitForElementNotVisible("#stale-indicator", 5000)
        .waitForElementNotVisible("#output-loader", 5000);
}

/** @function
 * Sets the character encoding in the input or outpu
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string} io - Either "input" or "output"
 * @param {string} enc - The encoding to be se
 */
function setChrEnc(browser, io, enc) {
    io = `#${io}-text`;
    browser
        .useCss()
        .waitForElementNotVisible("#snackbar-container", 6000)
        .click(io + " .chr-enc-value")
        .waitForElementVisible(io + " .chr-enc-select .cm-status-bar-select-scroll")
        .click("link text", enc)
        .waitForElementNotVisible(io + " .chr-enc-select .cm-status-bar-select-scroll")
        .expect.element(io + " .chr-enc-value").text.that.equals(enc);
}

/** @function
 * Sets the end of line sequence in the input or outpu
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string} io - Either "input" or "output"
 * @param {string} eol - The sequence to se
 */
function setEOLSeq(browser, io, eol) {
    io = `#${io}-text`;
    browser
        .useCss()
        .waitForElementNotVisible("#snackbar-container", 6000)
        .click(io + " .eol-value")
        .waitForElementVisible(io + " .eol-select .cm-status-bar-select-content")
        .click(`${io} .cm-status-bar-select-content a[data-val=${eol}]`)
        .waitForElementNotVisible(io + " .eol-select .cm-status-bar-select-content")
        .expect.element(io + " .eol-value").text.that.equals(eol);
}

/** @function
 * Copies whatever is currently selected
 *
 * @param {Browser} browser - Nightwatch clien
 */
function copy(browser) {
    browser.perform(function () {
        const actions = this.actions({ async: true });

        // Ctrl + Ins used as this works on Windows, Linux and Mac
        return actions
            .keyDown(browser.Keys.CONTROL)
            .keyDown(browser.Keys.INSERT)
            .keyUp(browser.Keys.INSERT)
            .keyUp(browser.Keys.CONTROL);
    });
}

/** @function
 * Pastes into the target elemen
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string} el - Target element selector
 */
function paste(browser, el) {
    browser
        .click(el)
        .perform(function () {
            const actions = this.actions({ async: true });

            // Shift + Ins used as this works on Windows, Linux and Mac
            return actions
                .keyDown(browser.Keys.SHIFT)
                .keyDown(browser.Keys.INSERT)
                .keyUp(browser.Keys.INSERT)
                .keyUp(browser.Keys.SHIFT);
        })
        .pause(100);
}

/** @function
 * Loads a recipe and inpu
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string|Array<string>} opName - name of operation to be loaded, array for multiple ops
 * @param {string} input - input text for tes
 * @param {Array<string>|Array<Array<string>>} args - arguments, nested if multiple ops
 */
function loadRecipe(browser, opName, input, args) {
    let recipeConfig;

    if (typeof (opName) === "string") {
        recipeConfig = JSON.stringify([{
            "op": opName,
            "args": args
        }]);
    } else if (opName instanceof Array) {
        recipeConfig = JSON.stringify(
            opName.map((op, i) => {
                return {
                    op: op,
                    args: args.length ? args[i] : []
                };
            })
        );
    } else {
        throw new Error("Invalid operation type. Must be string or array of strings. Received: " + typeof (opName));
    }

    setInput(browser, input, false);
    browser
        .urlHash("recipe=" + recipeConfig)
        .waitForElementPresent("#rec-list li.operation");
}

/** @function
 * Loads a recipe from a full config array and input
 *
 * @param {Browser} browser - Nightwatch client
 * @param {Array<Object>} config - array of op config objects
 * @param {string} input - input text for test
 */
function loadRecipeConfig(browser, config, input) {
    const recipeConfig = JSON.stringify(config);
    setInput(browser, input, false);
    browser
        .urlHash("recipe=" + recipeConfig)
        .waitForElementPresent("#rec-list li.operation");
}

/** @function
 * Tests whether the output matches a given value
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string|RegExp} expected - The expected output value
 * @param {boolean} [waitNotNull=false] - Wait for the output to not be empty before testing the value
 * @param {number} [waitWindow=1000] - The number of milliseconds to wait for the output to be correc
 */
function expectOutput(browser, expected, waitNotNull = false, waitWindow = 1000) {
    if (waitNotNull && expected !== "") {
        browser.waitUntil(async function () {
            const result = await this.execute(function () {
                return window.app.manager.output.outputEditorView.state.doc.toString();
            });
            const output = result && result.value !== undefined ? result.value : result;
            return typeof output === "string" && output.length > 0;
        }, waitWindow);
    }

    browser.execute(expected => {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [expected], function ({ value }) {
        if (expected instanceof RegExp) {
            browser.expect(value).match(expected);
        } else {
            browser.expect(value).to.be.equal(expected);
        }
    });
}

/** @function
 * Tests whether the input matches a given value
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string|RegExp} expected - The expected input value
 */
function expectInput(browser, expected) {
    browser.execute(expected => {
        return window.app.manager.input.inputEditorView.state.doc.toString();
    }, [expected], function ({ value }) {
        if (expected instanceof RegExp) {
            browser.expect(value).match(expected);
        } else {
            browser.expect(value).to.be.equal(expected);
        }
    });
}

/** @function
 * Uploads a file using the #open-file inpu
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string} filename - A path to a file in the samples directory
 */
function uploadFile(browser, filename) {
    const filepath = require("path").resolve(__dirname + "/../samples/" + filename);

    // The file input cannot be interacted with by nightwatch while it is hidden,
    // so we temporarily expose it for the purposes of this test.
    browser.execute(() => {
        document.getElementById("open-file").style.display = "block";
    });
    browser
        .pause(100)
        .setValue("#open-file", filepath)
        .pause(100);
    browser.execute(() => {
        document.getElementById("open-file").style.display = "none";
    });
    browser.waitForElementVisible("#input-text .cm-file-details");
}

/** @function
 * Uploads a folder using the #open-folder inpu
 *
 * @param {Browser} browser - Nightwatch clien
 * @param {string} foldername - A path to a folder in the samples directory
 */
function uploadFolder(browser, foldername) {
    const folderpath = require("path").resolve(__dirname + "/../samples/" + foldername);

    // The folder input cannot be interacted with by nightwatch while it is hidden,
    // so we temporarily expose it for the purposes of this test.
    browser.execute(() => {
        document.getElementById("open-folder").style.display = "block";
    });
    browser
        .pause(100)
        .setValue("#open-folder", folderpath)
        .pause(500);
    browser.execute(() => {
        document.getElementById("open-folder").style.display = "none";
    });
    browser.waitForElementVisible("#input-text .cm-file-details");
}


/** @function
 * Helper function to retrieve a Google Cloud access token for testing purposes.
 * First checks for CYBERCHEF_GCP_TEST_TOKEN environment variable. If not found or empty,
 * attempts to dynamically generate one using `gcloud auth print-access-token`.
 *
 * @returns {string|null} The token string, or null if generation fails.
 */
function getTestPAT() {
    let testToken = process.env.CYBERCHEF_GCP_TEST_TOKEN;
    if (!testToken || testToken === "YOUR_OAUTH_TOKEN_HERE") {
        try {
            testToken = require("child_process").execSync("gcloud auth print-access-token", { stdio: "pipe", encoding: "utf-8" }).trim();
        } catch (e) {
            console.log("No valid token found and gcloud failed to generate one.");
            return null;
        }
    }
    return testToken;
}

/** @function
 * Helper function to retrieve a Google Cloud API Key for testing purposes.
 * Checks for CYBERCHEF_GCP_TEST_API_KEY environment variable
 * (falling back to the older CYBERCHEF_GCP_TEST_KEY name).
 *
 * @returns {string|null} The API Key string, or null if not found.
 */
function getTestAPIKey() {
    const testKey = process.env.CYBERCHEF_GCP_TEST_API_KEY || process.env.CYBERCHEF_GCP_TEST_KEY;
    if (!testKey || testKey === "YOUR_API_KEY_HERE") {
        return null;
    }
    return testKey;
}

/** @function
 * Sets the Layout option (Options > Layout) as a user would, through its select.
 *
 * @param {Browser} browser - Nightwatch client
 * @param {string} value - "auto", "phone" or "desktop"
 */
function setLayoutOption(browser, value) {
    browser.execute(function (val) {
        const select = document.getElementById("layout");
        select.value = val;
        select.dispatchEvent(new Event("change", {bubbles: true}));
    }, [value]);
    browser.pause(200);
}

/** @function
 * Uses the phone layout: a 390x844 window with Options > Layout set to Phone.
 * See docs/MobileUI.md.
 *
 * @param {Browser} browser - Nightwatch client
 */
function setPhoneLayout(browser) {
    browser.resizeWindow(390, 844);
    setLayoutOption(browser, "phone");
    browser.waitForElementVisible("#phone-header", 5000);
}

/** @function
 * Serves the production build (build/prod) on its own port, for tests of the installable app
 * (service worker, offline, share target). Stopping the server takes the site offline.
 *
 * @param {number} port
 * @returns {{available: boolean, origin: string, requests: string[], start: Function, stop: Function}}
 *   `available` is false when there is no production build; start() and stop() return promises;
 *   `requests` lists the URLs requested so far.
 */
function prodBuildServer(port) {
    const http = require("http");
    const fs = require("fs");
    const path = require("path");
    const build = path.resolve(__dirname, "../../build/prod");
    const origin = `http://localhost:${port}/`;
    const types = {
        ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon",
        ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff",
        ".ttf": "font/ttf"
    };
    let server = null;
    const sockets = new Set();
    const requests = [];

    return {
        requests,
        available: fs.existsSync(path.join(build, "index.html")) && fs.existsSync(path.join(build, "sw.js")),
        origin,
        start() {
            server = http.createServer((req, res) => {
                requests.push(req.url);
                let file = decodeURIComponent(new URL(req.url, origin).pathname);
                if (file.endsWith("/")) file += "index.html";
                const full = path.join(build, path.normalize(file));
                if (!full.startsWith(build) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, {"Content-Type": types[path.extname(full)] || "application/octet-stream"});
                fs.createReadStream(full).pipe(res);
            });
            server.on("connection", s => {
                sockets.add(s);
                s.on("close", () => sockets.delete(s));
            });
            return new Promise(resolve => server.listen(port, resolve));
        },
        stop() {
            if (!server) return Promise.resolve();
            sockets.forEach(s => s.destroy());
            return new Promise(resolve => server.close(() => {
                server = null;
                resolve();
            }));
        }
    };
}

/** @function
 * Removes service workers and caches from the current origin, so later tests start clean.
 *
 * @param {Browser} browser
 */
function clearServiceWorkers(browser) {
    browser.executeAsync(function (done) {
        navigator.serviceWorker.getRegistrations()
            .then(regs => Promise.all(regs.map(r => r.unregister())))
            .then(() => caches.keys())
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => done(), () => done());
    });
}

module.exports = {
    clear: clear,
    setInput: setInput,
    bake: bake,
    setChrEnc: setChrEnc,
    setEOLSeq: setEOLSeq,
    copy: copy,
    paste: paste,
    loadRecipe: loadRecipe,
    loadRecipeConfig: loadRecipeConfig,
    expectOutput: expectOutput,
    expectInput: expectInput,
    uploadFile: uploadFile,
    uploadFolder: uploadFolder,
    getTestPAT: getTestPAT,
    getTestAPIKey: getTestAPIKey,
    setLayoutOption: setLayoutOption,
    setPhoneLayout: setPhoneLayout,
    prodBuildServer: prodBuildServer,
    clearServiceWorkers: clearServiceWorkers
};
