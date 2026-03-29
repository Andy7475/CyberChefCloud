/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { setGcpCredentials, getGcpCredentials } from "../lib/GoogleCloud.mjs";
import { isWorkerEnvironment } from "../Utils.mjs";

/**
 * Authenticate Google Cloud operation
 */
class AuthenticateGoogleCloud extends Operation {

    /**
     * AuthenticateGoogleCloud constructor
     */
    constructor() {
        super();

        this.name = "Authenticate Google Cloud";
        this.module = "Cloud";
        this.description = [
            "Authenticates CyberChef with Google Cloud using an API Key, OAuth, or Personal Access Token.",
            "<br><br>",
            "<b>Inputs:</b> Any data (data is passed through unmodified).",
            "<br>",
            "<b>Outputs:</b> The exact same data as the input.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Set 'Auth Type' to 'OAuth' and input your Project ID to enable other Google Cloud operations.</li></ul>",
            "<br>",
            "<b>Requirements:</b> This must be the first step in the recipe before calling other Google Cloud operations."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/docs/authentication";
        this.inputType = "ArrayBuffer";
        this.outputType = "ArrayBuffer";
        this.presentType = "html";
        this.manualBake = true; // AutoBake must be disabled to prevent spamming the OAuth API
        this.args = [
            {
                "name": "Auth Type",
                "type": "option",
                "value": ["OAuth 2.0 (Web Application: PKCE)", "Personal Access Token (PAT)", "API Key"]
            },
            {
                "name": "Credentials (Client ID, PAT, or API Key)",
                "type": "toggleString",
                "value": "",
                "toggleValues": ["UTF8", "Latin1", "Base64", "Hex"],
                "autocomplete": "gcp-credentials"
            },
            {
                "name": "Quota Project (OAuth only)",
                "type": "string",
                "value": "",
                "autocomplete": "gcp-quota-project"
            },
            {
                "name": "Default Region",
                "type": "string",
                "value": "us-central1"
            },
            {
                "name": "API Key (For strict API Key endpoints)",
                "type": "toggleString",
                "value": "",
                "toggleValues": ["UTF8", "Latin1", "Base64", "Hex"]
            },
            {
                "name": "Output Logs",
                "type": "boolean",
                "value": true
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {ArrayBuffer}
     */
    async run(input, args) {
        const [authType, credObj, quotaProject, defaultRegion, mapsKeyObj, outputLogs] = args;
        const credString = typeof credObj === "string" ? credObj : (credObj.string || "");
        const mapsKeyString = typeof mapsKeyObj === "string" ? mapsKeyObj : (mapsKeyObj.string || "");

        if (!credString) {
            throw new OperationError("Please provide Google Cloud credentials (Client ID, PAT, or API Key).");
        }

        let logs = "";
        const log = (msg) => {
            logs += msg + "\n";
            // Also send to the UI status bar if in worker
            if (isWorkerEnvironment()) self.sendStatusMessage(msg);
        };
        this._authLogs = ""; // reset

        log("Starting Google Cloud Authentication...");

        // If not using the Web App PKCE Flow, just cache the PAT/API Key and return.
        if (authType !== "OAuth 2.0 (Web Application: PKCE)") {
            setGcpCredentials({
                authType: authType,
                authString: credString,
                apiKey: mapsKeyString, // Capture optional Maps key
                quotaProject: quotaProject,
                defaultRegion: defaultRegion
            });
            log(`Successfully configured ${authType}.`);
            if (mapsKeyString) log(`Stored fallback API Key for endpoints that reject OAuth.`);
            if (outputLogs) this._authLogs = logs;
            return input;
        }

        // --- OAuth 2.0 Web Application (PKCE) Flow ---

        // 1. Check if we already have a valid token for this Client ID in the session
        const existingCreds = getGcpCredentials();
        if (existingCreds && existingCreds.authType === "OAuth 2.0 (Web Application: PKCE)" && existingCreds.clientId === credString) {
            if (existingCreds.expiresAt > Date.now()) {
                log("Reusing valid existing OAuth session token.");
                if (outputLogs) this._authLogs = logs;
                return input;
            }
            log("Existing OAuth token expired. A new authorization is required.");
        }

        // 2. Pause the Web Worker and ask the Main UI to pop the GIS login window
        log("Requesting Google Login Popup (Check your browser windows)...");

        // We use a Promise to halt the `run` method until the UI sends back the token
        const tokenData = await new Promise((resolve, reject) => {

            // Temporary message listener to catch the response from the UI
            const messageHandler = function (e) {
                const r = e.data;
                if (r.action === "gcpAuthResponse") {
                    self.removeEventListener("message", messageHandler);
                    if (r.data.error) {
                        reject(new OperationError(`Google OAuth Error: ${r.data.error}`));
                    } else if (r.data.token) {
                        resolve(r.data);
                    } else {
                        reject(new OperationError("Google OAuth Error: UI returned unexpected empty token payload."));
                    }
                }
            };
            self.addEventListener("message", messageHandler);

            // Trigger the UI
            // Assuming this operation is executed within a ChefWorker, we bubble up `gcpAuthRequest`
            // and we must include `inputNum` so WorkerWaiter knows which worker to send the response back to.
            if (!isWorkerEnvironment()) {
                reject(new OperationError("OAuth PKCE Flow can only run in a Web Worker environment. For manual node testing, use PAT or API Key auth types."));
                return;
            }

            self.postMessage({
                action: "gcpAuthRequest",
                data: {
                    clientId: credString,
                    inputNum: self.inputNum || 0
                }
            });
        });

        log("Authorization successful!");
        log(`Access token retrieved. Expires in ${tokenData.expiresIn} seconds.`);

        // 3. Cache the credentials for downstream operations
        setGcpCredentials({
            authType: "OAuth 2.0 (Web Application: PKCE)",
            authString: tokenData.token,
            apiKey: mapsKeyString, // Capture optional Maps key
            quotaProject: quotaProject,
            defaultRegion: defaultRegion,
            clientId: credString,
            expiresAt: Date.now() + (tokenData.expiresIn * 1000)
        });

        if (mapsKeyString) log(`Stored fallback API Key for endpoints that reject OAuth.`);
        if (outputLogs) this._authLogs = logs;
        return input;
    }

    /**
     * Presents the auth status log and passes the raw data through for the next operation.
     * @param {ArrayBuffer} data
     * @returns {string}
     */
    present(data) {
        const logText = this._authLogs || "";
        let dataDisplay = "";
        if (data && data.byteLength > 0) {
            try {
                const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
                dataDisplay = `<pre style="margin-top:8px;border-top:1px solid #555;padding-top:8px">${text.replace(/</g, "&lt;")}</pre>`;
            } catch (e) {
                dataDisplay = `<p><em>(Binary data — ${data.byteLength} bytes passed through to next operation)</em></p>`;
            }
        }
        if (logText) {
            return `<pre>${logText.replace(/</g, "&lt;")}</pre>${dataDisplay}`;
        }
        return dataDisplay;
    }

}

export default AuthenticateGoogleCloud;
