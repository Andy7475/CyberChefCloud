---
description: How to test a new CyberChef ingredient (operation)
---
# How to Test a New Ingredient

When developing new ingredients for CyberChef Cloud—especially those interacting with Complex UIs or external Cloud APIs—automated verification using Nightwatch.js is critical.

## 1. Headless Browser Environments
Agents typically operate in headless environments (like Docker or WSL) that lack graphical display servers.
- Always configure Webdrivers (like ChromeDriver) explicitly to run without a GUI.
- In your `nightwatch.json` configuration, include Chrome options: `--headless`, `--no-sandbox` (critical in WSL/Containers), `--disable-gpu`, and `--disable-dev-shm-usage`.

## 2. Secure Credential Management
Testing live Cloud APIs requires real credentials, but these must not be committed to source control.
- Use the `dotenv` package for environment variables.
- Read credentials from a local `.env` and provide an `.env.template` for users.
- Strongly ensure `.env` is listed in your `.gitignore` to avoid leaking credentials.
- Gracefully skip test blocks (e.g., using `return;`) if an API key is missing or set to the template string, so CI pipelines can continue passing.

## 3. Handling UI Obfuscation (Data Structures)
CyberChef UI arguments like `toggleString` fundamentally alter the data structure sent to backend functions.
- If using `toggleString` instead of a plain string, your test must pass an object structure containing the expected properties (e.g., `{ option: "UTF8", string: "..." }`), rather than just a string.
- The web worker code must unpack this object (e.g., `authStringObj.string`). Assuming a plain string input will cause worker crashes or hangs.

## 4. Bypassing Legacy Test Utilities
Test utilities (e.g., in `browserUtils.js`) might abstract away the actual issue or throw generic "Timeout" errors.
- If getting unhelpful "Timeout" errors despite expected behavior, bypass the wrapper utilities. Write raw JavaScript using `browser.execute()` to evaluate state inside the browser context, then return and strictly assert it back in the test runner.

## 5. Capturing Screenshots
When test iterations fail, LLM agents only see terminal traces without visual context.
- Use `browser.saveScreenshot("tests/browser/output/debug-<step>.png");` heavily during the run and directly before assertions. This captures the exact state of the UI, overlays, and error snackbars, allowing for accurate visual diagnosis of generic UI issues.
