/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { getGcpCredentials } from "../lib/GoogleCloud.mjs";

/**
 * Google HTTP Request operation
 */
class GoogleHTTPRequest extends Operation {

    /**
     * GoogleHTTPRequest constructor
     */
    constructor() {
        super();

        this.name = "Google HTTP Request";
        this.module = "Cloud";
        this.description = [
            "Makes an HTTP request via a Google Cloud Run proxy, bypassing browser CORS and CSP restrictions.",
            "<br><br>",
            "The input to this operation should be the target URL.",
            "<br><br>",
            "You can add headers line by line in the format <code>Key: Value</code>",
            "<br><br>",
            "Optionally provide a Max Characters value to truncate the returned response body.",
        ].join("\n");
        this.infoURL = "https://wikipedia.org/wiki/List_of_HTTP_header_fields#Request_fields";
        this.inputType = "string";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Method",
                "type": "option",
                "value": [
                    "GET", "POST", "HEAD",
                    "PUT", "PATCH", "DELETE", "OPTIONS"
                ]
            },
            {
                "name": "Headers",
                "type": "text",
                "value": ""
            },
            {
                "name": "Body",
                "type": "text",
                "value": ""
            },
            {
                "name": "Max Characters",
                "type": "shortString",
                "value": ""
            },
            {
                "name": "Show response metadata",
                "type": "boolean",
                "value": false
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [method, headersText, bodyText, maxCharacters, showResponseMetadata] = args;
        const targetUrl = input.trim();

        if (targetUrl.length === 0) return "";

        const creds = getGcpCredentials();
        const authHeader = creds?.authString ? `Bearer ${creds.authString}` : "";

        const headers = {};
        headersText.split(/\r?\n/).forEach(line => {
            line = line.trim();
            if (line.length === 0) return;
            const split = line.split(":");
            if (split.length < 2) throw new OperationError(`Could not parse header in line: ${line}`);
            const key = split[0].trim();
            const value = split.slice(1).join(":").trim();
            headers[key] = value;
        });

        let maxCharsNum = parseInt(maxCharacters, 10);
        if (isNaN(maxCharsNum) || maxCharsNum < 0) maxCharsNum = 0;

        const requestPayload = {
            targetUrl: targetUrl,
            method: method,
            headers: headers,
            body: (method !== "GET" && method !== "HEAD") ? bodyText : undefined,
            maxCharacters: maxCharsNum,
            showResponseMetadata: showResponseMetadata
        };

        // Deployed Cloud Run URL
        const proxyUrl = "https://google-http-proxy-593556123914.europe-west2.run.app";

        try {
            const response = await fetch(proxyUrl, {
                method: "POST",
                mode: "cors",
                cache: "no-cache",
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    ...(authHeader && { "Authorization": authHeader })
                },
                body: JSON.stringify(requestPayload)
            });

            const rawText = await response.text();

            if (showResponseMetadata) {
                let data;
                try {
                    data = JSON.parse(rawText);
                } catch (e) {
                    data = { error: rawText };
                }

                if (!response.ok) {
                    throw new OperationError(`Google HTTP Request Error (${response.status}): ${data?.error || response.statusText}`);
                }

                let exposedHeaders = "";
                if (data.headers) {
                    for (const [key, value] of Object.entries(data.headers)) {
                        exposedHeaders += `    ${key}: ${value}\n`;
                    }
                }
                return "####\n  Status: " + data.status + " " + data.statusText +
                       "\n  Exposed headers:\n" + exposedHeaders + "####\n\n" + data.body;
            }

            if (!response.ok) {
                let errData;
                try {
                    errData = JSON.parse(rawText);
                } catch (e) {
                    // Ignore parse errors for raw text
                }
                throw new OperationError(`Google HTTP Request Error (${response.status}): ${errData?.error || rawText}`);
            }

            return rawText;

        } catch (e) {
            if (e instanceof OperationError) throw e;
            throw new OperationError(`Google HTTP Request proxy request failed: ${e.message}`);
        }
    }
}

export default GoogleHTTPRequest;
