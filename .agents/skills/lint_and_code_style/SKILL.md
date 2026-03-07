---
description: Linting and code style guidelines for CyberChefCloud operations
---
# Linting & Code Style Guidelines

CyberChefCloud uses **ESLint 9** with a flat config (`eslint.config.mjs`). All `.mjs` operation and library files must pass linting before being considered complete. The rules below are enforced as **errors** unless noted as warnings.

## Running the Linter

```bash
# Lint all source files
npm run lint

# Or directly via grunt (same thing)
npx grunt lint
```

Fix lint errors before committing. The build will fail on lint errors.

## Key Rules to Know

### Naming Conventions
- **`camelcase: error`** — all variable and property names must be camelCase.
  - ❌ `response.expires_in`, `i.gs_uri`, `const authed_url`
  - ✅ `response.expiresIn`, `i.gsUri`, `const authedUrl`
  - **Common pitfall:** External API responses often use `snake_case` (e.g. Google APIs). When reading those fields into local variables or storing them, always rename to camelCase. When passing them back to the API in a request body, `camelcase` rules still apply to your own code but you can use quoted object keys for API-dictated names (e.g. `{ "language_code": value }`).

### Variable Declarations
- **`no-var: error`** — never use `var`. Always use `const` or `let`.
- **`prefer-const: error`** — use `const` for anything not reassigned.
  - ❌ `let url = "..."; /* url never changes */`
  - ✅ `const url = "...";`

### Quoting
- **`quotes: ["error", "double"]`** — use double quotes for strings.
  - Template literals (`` ` `` backticks) are always allowed.
  - Single quotes are only allowed to avoid escaping (e.g. `"it's"` would need `'it\'s'` otherwise).

### Semicolons
- **`semi: ["error", "always"]`** — every statement must end with `;`.

### Indentation
- **`indent: ["error", 4]`** — 4-space indentation (no tabs).
  - Array expressions are aligned to the first element.
  - `switch/case` bodies are indented one level (4 spaces) inside the `switch`.

### Equality
- **`eqeqeq: ["error", "smart"]`** — use `===` / `!==`; only `==` with `null` is allowed.
  - ❌ `if (x == undefined)`
  - ✅ `if (x === undefined)` or `if (x == null)` (catches both null and undefined)

### Unused Variables
- **`no-unused-vars: error`** — remove variables that are declared but never read.
  - Exception: caught error parameters are allowed to be unused (e.g. `catch (e) { /* ignore */ }`).
  - Exception: function parameters are exempt — you don't need to use every argument.

### Console Logging
- **`no-console: error`** — do not use `console.log` / `console.error` in operation code.
  - In operations, use `self.sendStatusMessage(msg)` (inside web workers) for user-visible progress messages.
  - In tests (`tests/**/*`), `no-console` is turned off.

### JSDoc Comments
- **`jsdoc/require-jsdoc: error`** — JSDoc is required for:
  - All `function` declarations (named, non-arrow, top-level or exported).
  - All class declarations.
  - All class method definitions.
  - Arrow functions at the top level are **exempt**.
- Format:
  ```javascript
  /**
   * Short description of what the function does.
   *
   * @param {string} bucket - The GCS bucket name.
   * @param {string} prefix - Optional folder prefix.
   * @returns {Promise<Array>} Array of GCS object metadata.
   */
  async function listGCSBucket(bucket, prefix) { ... }
  ```

### Other Style Rules
- **`brace-style: ["error", "1tbs"]`** — opening brace on the same line, not a new line.
- **`eol-last: error`** — files must end with a newline.
- **`linebreak-style: ["error", "unix"]`** — LF line endings only (no CRLF).
- **`no-trailing-spaces: warn`** — no trailing whitespace.
- **`spaced-comment: error`** — comments must have a space after `//` (e.g. `// comment`, not `//comment`).
- **`no-multiple-empty-lines`** — max 2 consecutive blank lines; 0 at start of file; 1 at end.

## Common Pitfalls in GCloud Operations

### `applyGCPAuth` Return Value
`applyGCPAuth(url, headers)` mutates `headers` in-place **and** returns `{ url, headers }`. The returned `url` may differ from the input when using API Key auth (query param appended). The `headers` object is the same reference — it does **not** need to be reassigned.

Always declare `url` with `let` (it may change) and `headers` with `const` (mutated in-place). Only capture `url`:
```javascript
// ✅ Correct
let url = "https://...";
const headers = new Headers();
({ url } = applyGCPAuth(url, headers));
const response = await fetch(url, { headers, ... });

// ❌ Wrong — tries to reassign const headers → "headers is read-only" runtime error
const headers = new Headers();
({ url, headers } = applyGCPAuth(url, headers));

// ❌ Wrong — discards returned url; API Key auth silently uses wrong URL
applyGCPAuth(url, headers);
const response = await fetch(url, ...);
```

### `toggleString` Arguments
When an operation arg uses `type: "toggleString"`, the value is an object `{ string: "...", option: "..." }` — not a plain string. Always extract it safely:
```javascript
// In run(input, args):
const credString = typeof credObj === "string" ? credObj : (credObj.string || "");
```

### `expiresIn` vs `expires_in`
Google Identity Services returns `expires_in` (snake_case) in its OAuth callback. When this is forwarded via Worker `postMessage`, it must be renamed to camelCase (`expiresIn`) to satisfy `camelcase: error`. The `WorkerWaiter.mjs` already does this — any code reading the response must use `tokenData.expiresIn`, not `tokenData.expires_in`.
