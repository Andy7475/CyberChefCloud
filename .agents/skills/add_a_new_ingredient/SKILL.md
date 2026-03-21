---
description: How to add a new CyberChef ingredient (operation) for Google Cloud
---
# How to Add a New Google Cloud Ingredient

When adding a new Google Cloud integration (ingredient or operation) to CyberChef Cloud, it's important to strictly separate core authentication logic from specific application logic, and follow CyberChef's standard operation creation process.

## 1. Creating the Operation

The easiest way to create a new operation is using the CyberChef quickstart script:
1. Run `npm run newop` in your terminal. This will walk you through the configuration and create your boilerplate `*.mjs` file in the `src/core/operations/` directory.
2. Add your new operation to `src/core/config/Categories.json` so it appears in the desired menu(s) in the UI.
3. Run `npm start` to start the development server. It will automatically rebuild when you save files. View your changes at `http://localhost:8080`.

## 2. Code Structure & Placement

- **Core Cloud Components (`src/core/lib/GoogleCloud.mjs`)**: This file should *only* contain common Google Cloud logic that is shared across multiple ingredients, namely credential management, the `gcpFetch` utility, and the GCS URI generator. Do not place specific API feature implementations here.
- **Specific Ingredient Code (`src/core/operations/[OperationName].mjs`)**: The majority of the logic for any new Google Cloud ingredient must be encapsulated inside its separate `*.mjs` file.

## 3. Communication with Google Cloud APIs (`gcpFetch`)

For any Google Cloud API that communicates via JSON (e.g. Vision, Maps, Translation, Vertex AI), you **MUST** use the unified `gcpFetch` helper imported from `../lib/GoogleCloud.mjs`.

`gcpFetch(url, options)` automatically handles:
- Applying GCP authentication headers (OAuth or API Key + Quota Project matching).
- Serializing JSON bodies (`body` option).
- Appending query parameters (`params` option).
- Standardized error handling and throwing verbose `OperationError`s.
- Parsing the JSON response.

**Example:**
```javascript
import { gcpFetch } from "../lib/GoogleCloud.mjs";

const data = await gcpFetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    params: { someParam: "value" }, // becomes ?someParam=value
    body: { requests: [...] } // automatically JSON.stringified
});
return data.responses[0];
```

*Note: For operations that upload or download raw binary data (like raw images or ArrayBuffers from/to Google Cloud Storage), you should use standard `fetch` combined with `applyGCPAuth` from `GoogleCloud.mjs` instead of `gcpFetch`, since `gcpFetch` strictly expects and parses JSON.*

## 4. CyberChef Data Types & Arguments

- **Input/Output Types**: Operations can accept and return nine data types: `string`, `byteArray`, `number`, `html`, `ArrayBuffer`, `BigNumber`, `JSON`, `File`, and `List<File>`.
- **Argument Types**: CyberChef UI arguments can be `string`, `shortString`, `binaryString`, `text`, `byteArray`, `number`, `boolean`, `option` (dropdown), `editableOption`, `populateOption`, or `toggleString`.

## 5. Presenting Complex Data

If your operation generates complex data (like a large JSON structure), but you want the user to see a friendly formatted view in the output pane, use the `present` lifecycle function.
- Define `this.presentType = "html"` (or `"string"`) in the constructor.
- Add a `present(data, args)` function that formats the raw output of `run()` into friendly HTML or text.
- This ensures follow-on operations in a recipe receive the raw, easy-to-parse data from `run()`, but the final user sees the pretty output from `present()`.

## 6. Content Security Policy (CSP) & Whitelisting 

CyberChef Cloud employs a strict Content Security Policy. If your new ingredient communicates with a new Google Cloud API endpoint (e.g., `https://language.googleapis.com`), you **must**:
1. Open `src/web/html/index.html` and append the endpoint to the `connect-src` directive in the `<meta http-equiv="Content-Security-Policy">` tag.
2. Add the endpoint to `docs/AuthorizedEndpoints.md`.

## 7. Input & Output Strategies (Google Cloud Storage)

When interacting with large media/datasets that cannot fit in browser memory, accept GCS URIs as input and write back to GCS as output. Operations must adhere to the **Hybrid Target Directory Pattern**:

### Required Arguments:
1. **Output Destination (Dropdown)**: `["Return to CyberChef", "Write to GCS"]`
2. **Output Directory (Optional String)**: `gs://my-bucket/outputs/`
   - **If blank**: Write the output file to the *exact same directory* as the input file, but suffix the filename with a distinct operation string (e.g., `_ccc_ocr`).

You **MUST** use the `generateGCSDestinationUri(inputUri, destDir, suffix, extensionOverride)` utility from `src/core/lib/GoogleCloud.mjs` to systematically generate the correct final destination.

When "Write to GCS" succeeds, the ingredient **must** return the full destination GCS URI (`gs://...`) back to the CyberChef output for pipelining.

## 8. Error Handling & Verbose Output

If you manually use `fetch` (for binary APIs), ensure you catch errors and throw an `OperationError` containing HTTP Status, Status Text, and raw error text. `gcpFetch` does this automatically for JSON APIs. These verbose errors bubble up to the UI so users can effectively diagnose IAM permissions or incorrect inputs.
