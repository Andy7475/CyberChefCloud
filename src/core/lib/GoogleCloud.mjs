/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../errors/OperationError.mjs";

/**
 * Common arguments for Google Cloud Platform operations
 * 
 * Spread these into the `args` array of any new GCP operation.
 */
export const GCP_AUTH_ARGS = [
    {
        "name": "Auth Type",
        "type": "option",
        "value": ["API Key", "OAuth Token"]
    },
    {
        "name": "GCP Auth String",
        "type": "toggleString",
        "value": "",
        "toggleValues": ["UTF8", "Latin1", "Base64", "Hex"]
    },
    {
        "name": "Quota Project (ADC only)",
        "type": "string",
        "value": ""
    }
];

/**
 * Validates and applies GCP authentication to a URL and Headers object.
 * 
 * @param {string} url - The base URL of the API endpoint.
 * @param {Headers} headers - The Headers object for the request.
 * @param {string} authType - "API Key" or "OAuth Token".
 * @param {Object|string} authStringObj - The authentication string (can be a toggleString object).
 * @param {string} quotaProject - Optional quota project for ADC OAuth tokens.
 * @returns {Object} An object containing the modified { url, headers }
 */
export function applyGCPAuth(url, headers, authType, authStringObj, quotaProject) {
    const authString = typeof authStringObj === "string" ? authStringObj : (authStringObj.string || "");

    if (!authString) {
        throw new OperationError("Error: Please provide a valid GCP Auth String (API Key or OAuth Token).");
    }

    if (authType === "API Key") {
        url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(authString)}`;
    } else if (authType === "OAuth Token") {
        headers.set("Authorization", `Bearer ${authString}`);
        if (quotaProject) {
            headers.set("x-goog-user-project", quotaProject);
        }
    }

    return { url, headers };
}
