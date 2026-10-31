# Local LLMs in the browser

The **Local AI** category has two operations that run a language model inside the browser:

- **Prompt Local LLM**: sends the input (and a system prompt) to a local model and outputs the reply.
- **Local LLM Models**: lists, downloads, imports and deletes model files kept in the browser.

These operations make no Google Cloud calls and need no `Authenticate Google Cloud` step. The model runs on the user's device and the prompt is not sent to any server. The only network traffic is the one-off model download.

## Backends

| Backend | Where the model comes from | Model format | Input | Runs on |
| :--- | :--- | :--- | :--- | :--- |
| **Chrome built-in (Gemini Nano)** | Chrome downloads and manages it (about 4 GB, shared by all sites) | Chrome-internal; not loadable by pages | text, image, audio | Chrome's own runtime (GPU or CPU) |
| **GGUF model (wllama / llama.cpp)** | The browser model store (OPFS), filled with `Local LLM Models` | `.gguf` (single or split) | text | llama.cpp compiled to WebAssembly, WebGPU when available |

`Backend = Auto` picks the GGUF backend when `Model` names a stored model, and Chrome built-in when `Model` is empty.

### Chrome built-in model

- Uses the [Prompt API](https://github.com/webmachinelearning/prompt-api) (`LanguageModel.availability()`, `LanguageModel.create()`, `session.prompt()`).
- Needs desktop Chrome on hardware Chrome accepts (it checks GPU memory or CPU/RAM). If `availability()` returns `unavailable`, the device or input type is not supported. On some Chrome versions the API must be turned on at `chrome://flags/#prompt-api-for-gemini-nano`.
- **Pages cannot load their own model into this API.** It only runs the model Chrome supplies. To use any other model, use the GGUF backend.
- Web pages cannot set temperature or top-K (Chrome ignores them outside extensions), so those arguments only apply to GGUF.
- `LanguageModel` exists on `window` but not in Web Workers. CyberChef operations run in a ChefWorker, so the operation sends a `mainThreadRequest` message and the UI thread makes the call (see [Worker bridge](#worker-bridge)).
- The first `create()` may start the 4 GB download. Chrome can require a recent user click to start a download. `Prompt Local LLM` is a manual-bake operation, so the Bake button click comes just before the call.

### GGUF backend

- Uses [wllama](https://github.com/ngxson/wllama) (`@wllama/wllama`), which is llama.cpp built for WebAssembly with a WebGPU backend. Webpack copies `wllama.wasm` to `assets/wllama/`.
- GGUF is the format of llama.cpp, Ollama and LM Studio. Most open models (Gemma, Llama, Qwen, Phi, Mistral, SmolLM) are published in GGUF on Hugging Face. The chat template stored in the GGUF file is used to format the messages.
- A loaded model stays in memory between bakes. It is reloaded only when `Model` or `Context Size` changes.
- One file can be at most 2 GB (the `ArrayBuffer` size limit). For larger models, split the file with llama.cpp's `llama-gguf-split --split-max-size 512M in.gguf out` and store all the parts. Parts named `*-00001-of-0000N.gguf` are grouped as one model.
- Multi-threaded WebAssembly needs the page to be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Without them wllama runs single-threaded on CPU. WebGPU does not need these headers.
- Recommended size: 0.5 to 4 billion parameters, quantised to Q4_K_M (roughly 0.4 to 2.5 GB). Larger models work but are slow and may exceed GPU memory.

Example models (the URL goes in `Local LLM Models` → `Download from URL`):

- `https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf`
- `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf`

## Model formats and browser runtimes

Browsers cannot run model files by themselves. Each format needs a JavaScript/WebAssembly runtime that understands it. The table lists the formats that have a browser runtime today.

| Format | Files | Browser runtime | Status here | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **GGUF** | one `.gguf` file (or split parts) | wllama (llama.cpp WASM + WebGPU) | **supported** | Widest model choice; one file per model makes import simple. |
| **ONNX** | `model.onnx` + `config.json`, `tokenizer.json`, `generation_config.json` | Transformers.js (ONNX Runtime Web, WebGPU/WASM) | store accepts `.onnx`; no backend yet | Needs a folder of files; models must be exported for ONNX (the `onnx-community` org on Hugging Face has many). |
| **MLC** | sharded weights + `mlc-chat-config.json` + a compiled model library `.wasm` | WebLLM (WebGPU only) | not supported | Each model needs a library compiled for it, so arbitrary uploads do not work. |
| **LiteRT-LM / MediaPipe** | one `.litertlm` or `.task` file | MediaPipe LLM Inference (`@mediapipe/tasks-genai`, WebGPU) | store accepts `.task`/`.litertlm`; no backend yet | Google's format for Gemma on-device models. Single file, like GGUF. |
| **safetensors / PyTorch** | `.safetensors`, `.bin`, `.pt` | none | not supported | Training formats. Convert to GGUF with llama.cpp's `convert_hf_to_gguf.py`, or to ONNX with Optimum. |

## How a model gets into the browser

Model files are kept in the **Origin Private File System (OPFS)**, in a folder named `ccc-local-models`.

- OPFS works in Web Workers, handles multi-GB files, and can be written as a stream, so a download is written to disk in chunks and never held in memory in one piece.
- The files belong to the site origin (for example `http://localhost:8080` and the production URL each have their own store). They stay across reloads, until they are deleted with `Local LLM Models` → `Delete model`, until site data is cleared, or until the browser evicts them under storage pressure. `List models` shows the quota and whether storage is persistent.
- Other ways of storing data are worse for this: `localStorage` holds only a few MB, IndexedDB has to read a file back as one blob, and the Cache API ties a file to a URL.

There are two ways to add a model:

1. **Download from URL**: the operation streams the response into OPFS and shows progress. The host must be in the CSP `connect-src` list in `src/web/html/index.html`. Hugging Face (`huggingface.co`, `*.huggingface.co`, `*.hf.co`) is allowed. To allow another host, add it there and to `docs/AuthorizedEndpoints.md`.
2. **Import input as model**: drop the model file into CyberChef's input pane, set `File Name` (the extension decides the format), and bake. CyberChef reads the whole file into memory first, so this path suits files up to about 2 GB.

## Code layout

| File | Purpose |
| :--- | :--- |
| `src/core/operations/PromptLocalLLM.mjs` | The prompt operation (module `LocalAI`). |
| `src/core/operations/LocalLLMModels.mjs` | Model store operation: list, status, download, import, delete. |
| `src/core/lib/LocalLLM.mjs` | Provider registry, backend selection (`resolveProvider`) and `promptLocalLLM`. |
| `src/core/lib/localllm/ChromeBuiltinProvider.mjs` | Chrome Prompt API provider. |
| `src/core/lib/localllm/WllamaProvider.mjs` | GGUF provider. |
| `src/core/lib/LocalModelStore.mjs` | OPFS model store. |
| `src/core/lib/MainThreadBridge.mjs` | Worker side of the worker → UI thread request/response bridge. |
| `src/web/MainThreadHost.mjs` | UI side of the bridge; holds the `chromeLLM.*` services. |

### Worker bridge

`requestMainThread(service, payload, {onProgress})` posts `{action: "mainThreadRequest", data: {id, service, payload, inputNum}}`. `WorkerWaiter` passes it to `handleMainThreadRequest`, which runs `SERVICES[service]` and replies with `mainThreadResponse` messages carrying the same `id`. Messages with `progress: true` go to `onProgress` and do not end the request. Any other operation that needs a `window`-only API can add a service to `MainThreadHost.mjs` and call `requestMainThread`.

### Adding a provider

1. Create `src/core/lib/localllm/<Name>Provider.mjs` exporting an object with:
   - `id`, `label`
   - `formats`: store formats it loads (values of `MODEL_FORMATS` in `LocalModelStore.mjs`, e.g. `"gguf"`), or `[]` if the browser supplies the model
   - `supportsMime(mimeType)`
   - `status()`: a short availability string for `Local LLM Models` → `Backend status`
   - `prompt(req)`: returns the reply text. `req` has `model`, `systemPrompt`, `text`, `media`, `mimeType`, `maxTokens`, `temperature`, `contextSize` and `onStatus`.
2. Add it to `PROVIDERS` in `src/core/lib/LocalLLM.mjs`. Its label appears in the `Backend` argument, and `Auto` uses it for stored models of its format.
3. If its runtime ships `.wasm` or worker files, copy them with `CopyWebpackPlugin` in `webpack.config.js` and load them from `${self.docURL}/assets/...`.
4. If the store needs a new file extension, add it to `MODEL_FORMATS`.

A provider for a multi-file format (ONNX) would store the files under one model name, for example as `<model>/<file>` entries. The store currently keeps a flat list of files, so it would need a folder per model first.

### Use with AI Agent

`AI Agent` runs on a local model when its `Model` argument is `local:chrome` (Chrome built-in) or `local:<stored model name>` (a GGUF model, chosen by `Auto`). Local providers have no native function calling, so `AIAgent._promptLocal` renders the tool list and the conversation as text, asks the model to reply with `{"tool": ..., "args": {...}}` or `{"answer": ...}`, and converts the reply back into Gemini-style `functionCall`/`text` parts. The rest of the agent loop (tool execution, undo/reset, output modes) is shared with the Vertex AI path. The context window is fixed at 8192 tokens (`LOCAL_CONTEXT_SIZE`). The request also carries a JSON Schema in `req.responseConstraint` (tool name as an enum, `args`, `answer`). The Chrome provider passes it to `session.prompt()` as `responseConstraint` (Chrome 137+), so Gemini Nano can only produce valid tool calls or answers. The GGUF provider ignores it and falls back to parsing the first JSON object in the reply, treating anything else as plain text.

## Testing

- `tests/operations/tests/LocalLLM.mjs` checks argument handling and the messages shown when browser features (OPFS, `LanguageModel`) are missing. Node has neither, so no model is run there.
- To test by hand: `npm run start`, open http://localhost:8080 in desktop Chrome, add `Local LLM Models` with `Backend status`, then try `Prompt Local LLM` with `Backend = Chrome built-in`. For GGUF, download a small model such as the Gemma 3 1B URL above, set `Model` to its file name, and bake.
- Headless Chromium in CI has no Gemini Nano, and a GGUF test would download hundreds of MB, so there is no Nightwatch test yet.
