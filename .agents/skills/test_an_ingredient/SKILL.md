---
description: How to test a new CyberChef ingredient (operation)
---
# How to Test a New Ingredient

When developing new ingredients for CyberChef Cloud—especially those interacting with Complex UIs or external Cloud APIs—automated verification using Nightwatch.js is critical.

## 1. Headless Browser Environments
Agents typically operate in headless environments (like Docker or WSL) that lack graphical display servers.
- Always configure Webdrivers (like ChromeDriver) explicitly to run without a GUI.
- In your `nightwatch.json` configuration, include Chrome options: `--headless`, `--no-sandbox` (critical in WSL/Containers), `--disable-gpu`, and `--disable-dev-shm-usage`.


## 2. Secure Credential Management & Dynamic PATs
Testing live Cloud APIs requires real credentials, but these **must not** be committed to source control. CyberChef Cloud enforces a dynamic Personal Access Token (PAT) generation strategy to avoid relying on long-lived API keys.

1. **File Structure**: Create a distinct, separate Nightwatch test file for each new ingredient (e.g., `tests/browser/MyNewIngredient.js`). Never bundle multiple unrelated ingredients into a single massive test file.
2. **Dynamic Tokens**: Use the provided `browserUtils.getTestPAT()` helper. This function automatically calls `gcloud auth print-access-token` on the host to generate an ephemeral, short-lived token to run the tests.
   ```javascript
   const testToken = browserUtils.getTestPAT();
   if (!testToken) {
       console.log("Skipping live API test: No PAT available.");
       return;
   }
   ```
3. **Graceful Skips**: Ensure your test gracefully skips (`return;`) if `testToken` is null, so CI pipelines can continue passing without throwing hard errors when credentials aren't present.
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
