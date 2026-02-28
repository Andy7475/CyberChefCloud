# How to Test with an LLM

When developing agentic AI integrations—especially those interacting with Complex UIs and Cloud APIs—automated testing is the only way for the LLM to verify that its own code modifications are successful. 

This document summarizes critical lessons learned during the implementation and verification of the Cloud API (Google Translate) integration using Nightwatch.js as the E2E verification framework. Following these guidelines ensures an LLM can quickly and reliably verify application outputs autonomously.

## 1. Headless Browser Environments
Agents typically operate inside containers, WSL (Windows Subsystem for Linux), or headless virtual machines that lack graphical display servers (X11/Wayland).
*   **Actionable Advice**: Webdrivers (like ChromeDriver) must be configured explicitly to run without a GUI. Always inject the following Chrome options into the `nightwatch.json` configuration:
    *   `--headless`
    *   `--no-sandbox` (Critical for running as root in Docker/WSL)
    *   `--disable-gpu`
    *   `--disable-dev-shm-usage` (Prevents memory crashes in containerized `/dev/shm`)

## 2. Secure Credential Management for Agents
E2E testing against live Cloud APIs requires real credentials, but these must never be committed to source control or logged in the agent's chat history.
*   **Actionable Advice**: Use the `dotenv` package.
    *   Provide an `.env.template` so the human operator knows what variables to supply (e.g., `CYBERCHEF_GCP_TEST_KEY=YOUR_API_KEY_HERE`).
    *   Ensure `.env` is strongly `.gitignore`d.
    *   **Graceful Skips**: If the script detects the API key is missing or is exactly the template string, the test block should `return;` or gracefully skip rather than throw a hard failure. This allows public CI pipelines to continue passing.

## 3. UI Obfuscation vs Data Structures
CyberChef provides UI arguments like `toggleString` which are specifically designed to mask sensitive inputs (like API keys turning into `****` on screen). However, changing a UI parameter type fundamentally changes the shape of the data passed to the backend functions.
*   **Actionable Advice**: An LLM might assume an argument is a plain string. If a UI masking attribute is introduced, the test framework *must* be updated to pass the correct object payload (e.g., passing `{ option: "UTF8", string: "AIzaSy..." }` instead of `"AIzaSy..."`), and the backend worker code must be updated to unpack `authStringObj.string` prior to network fetching.
*   *Failure to map the data object correctly results in Web Worker crashes or infinite hangs that the test framework cannot concisely diagnose.*

## 4. Bypassing Legacy Test Utilities
Test framework abstractions (such as wrapper polling functions in `browserUtils.js`) can easily break or mask the root cause of an error. In our case, `expectOutput` attempted to check the length of an unresolved promise state, throwing a "Timeout Error" even though the UI had populated the data perfectly.
*   **Actionable Advice**: When an LLM is getting unhelpful "Timeout" errors despite visually verifying the UI is acting correctly, bypass the utility framework. Write raw Javascript to evaluate state inside the browser context, and return it to the Node runner for standard validation:
    ```javascript
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], function ({ value }) {
        browser.assert.equal(value, "Expected String");
    });
    ```

## 5. Giving the LLM "Eyes"
When an E2E test fails, the LLM only sees a terminal stack trace. It cannot see the state of the UI (e.g., did an error snackbar pop up? Did a preloader hang?).
*   **Actionable Advice**: Instruct the LLM to aggressively implement screenshot captures during test runs (`browser.saveScreenshot("tests/browser/output/debug.png");`), particularly right before an assertion is about to be checked. The LLM can then visually parse the exact state of the UI grid, inputs, outputs, and overlays, bridging the gap between a generic "TimeoutError" and a specific visual bug.
