/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../errors/OperationError.mjs";

/**
 * Global store for GCP credentials in this web worker session.
 */
globalThis.__gcpAuthStore = globalThis.__gcpAuthStore || null;

/**
 * Retrieves the currently active GCP credentials.
 * @returns {Object|null} { authType, authString, quotaProject }
 */
export function get_gcp_credentials() {
    if (globalThis.__gcpAuthStore) {
        return globalThis.__gcpAuthStore;
    }
    return null;
}

/**
 * Sets the active GCP credentials for the web worker session.
 * @param {Object} credObj { authType, authString, quotaProject }
 */
export function set_gcp_credentials(credObj) {
    globalThis.__gcpAuthStore = credObj;
}


/**
 * Validates and applies GCP authentication to a URL and Headers object
 * using the globally cached credentials from AuthenticateGoogleCloud.
 * 
 * @param {string} url - The base URL of the API endpoint.
 * @param {Headers} headers - The Headers object for the request.
 * @returns {Object} An object containing the modified { url, headers }
 */
export function applyGCPAuth(url, headers) {
    const creds = get_gcp_credentials();

    if (!creds || !creds.authString) {
        throw new OperationError("No Google Cloud credentials found. Please add the 'Authenticate Google Cloud' operation before this one.");
    }

    if (creds.authType === "API Key") {
        url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(creds.authString)}`;
    } else if (creds.authType === "OAuth 2.0 (Web Application: PKCE)" || creds.authType === "Personal Access Token (PAT)") {
        headers.set("Authorization", `Bearer ${creds.authString}`);
        if (creds.quotaProject) {
            headers.set("x-goog-user-project", creds.quotaProject);
        }
    }

    return { url, headers };
}
