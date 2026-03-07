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
 * @returns {Object|null} { authType, authString, quotaProject, defaultRegion }
 */
export function getGcpCredentials() {
    if (globalThis.__gcpAuthStore) {
        return globalThis.__gcpAuthStore;
    }
    return null;
}

/**
 * Sets the active GCP credentials for the web worker session.
 * @param {Object} credObj { authType, authString, quotaProject, defaultRegion }
 */
export function setGcpCredentials(credObj) {
    globalThis.__gcpAuthStore = credObj;
}


/**
 * Validates and applies GCP authentication to a URL and Headers object
 * using the globally cached credentials from AuthenticateGoogleCloud.
 * @param {string} url - The base URL of the API endpoint.
 * @param {Headers} headers - The Headers object for the request.
 * @returns {Object} An object containing the modified { url, headers }
 */
export function applyGCPAuth(url, headers) {
    const creds = getGcpCredentials();

    if (!creds || !creds.authString) {
        throw new OperationError("No Google Cloud credentials found. Please add the 'Authenticate Google Cloud' operation before this one.");
    }

    if (creds.authType === "API Key") {
        url += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(creds.authString)}`;
    } else if (creds.authType === "OAuth 2.0 (Web Application: PKCE)" || creds.authType === "Personal Access Token (PAT)") {
        headers.set("Authorization", `Bearer ${creds.authString}`);
        if (creds.quotaProject) {
            headers.set("x-goog-user-project", creds.quotaProject);
        }
    }

    return { url, headers };
}

/**
 * Parses an input GCS URI and a destination directory string to generate
 * a fully resolved destination URI. If the destination directory is blank,
 * it writes to the original directory but suffixes the filename (before the extension).
 *
 * @param {string} inputUri - The source `gs://` URI.
 * @param {string} destDir - The requested destination directory `gs://...` (or blank).
 * @param {string} suffix - The mandatory suffix to append if destDir is blank (e.g., `_ccc_stt`).
 * @param {string} [extensionOverride] - If provided, forcibly sets the final extension (e.g., `.txt`).
 * @returns {Object} An object containing the derived { bucket, objectPath, gcsUri }
 */
export function generateGCSDestinationUri(inputUri, destDir, suffix, extensionOverride) {
    const match = inputUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new OperationError(`Invalid input GCS URI: ${inputUri}`);
    const [, inputBucket, inputObject] = match;

    let destBucket = inputBucket;
    let destObject = inputObject;

    // Handle extraction of basename and extension
    const lastSlashIndex = destObject.lastIndexOf("/");
    const pathPrefix = lastSlashIndex !== -1 ? destObject.substring(0, lastSlashIndex + 1) : "";
    const filename = lastSlashIndex !== -1 ? destObject.substring(lastSlashIndex + 1) : destObject;

    let extension = "";
    let baseFilename = filename;
    const lastDotIndex = filename.lastIndexOf(".");
    if (lastDotIndex !== -1 && lastDotIndex > 0) {
        baseFilename = filename.substring(0, lastDotIndex);
        extension = filename.substring(lastDotIndex);
    }

    if (extensionOverride) {
        extension = extensionOverride.startsWith(".") ? extensionOverride : `.${extensionOverride}`;
    }

    if (destDir && destDir.trim().length > 0) {
        // User provided an explicit Destination Directory (e.g. gs://new-bucket/reports/)
        const destMatch = destDir.match(/^gs:\/\/([^/]+)\/?(.*)$/);
        if (!destMatch) throw new OperationError(`Invalid output directory GCS URI: ${destDir}`);

        destBucket = destMatch[1];
        let newPrefix = destMatch[2];
        if (newPrefix && !newPrefix.endsWith("/")) newPrefix += "/";

        // When providing explicit directory, we preserve the exact filename (or just swap extension)
        destObject = `${newPrefix}${baseFilename}${extension}`;
    } else {
        // Default Behavior: Same directory, but MUST append suffix
        destObject = `${pathPrefix}${baseFilename}${suffix}${extension}`;
    }

    return {
        bucket: destBucket,
        objectPath: destObject,
        gcsUri: `gs://${destBucket}/${destObject}`
    };
}
