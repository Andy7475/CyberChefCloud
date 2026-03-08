/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Utils from "../Utils.mjs";
import { applyGCPAuth } from "../lib/GoogleCloud.mjs";

const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

/**
 * Generates a random UUID v4 for the session token.
 * 
 * @returns {string} UUID
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Calls the Places API Autocomplete endpoint.
 *
 * @param {string} input - The text string on which to search.
 * @param {string} sessionToken - The session token for billing.
 * @param {string} countryCode - Optional two-letter country code restriction.
 * @returns {Promise<Object>} The parsed API response body.
 */
async function placesAutocomplete(input, sessionToken, countryCode) {
    const url = PLACES_AUTOCOMPLETE_URL;
    const headers = new Headers();
    headers.set("Content-Type", "application/json; charset=utf-8");
    const authed = applyGCPAuth(url, headers);

    const bodyObj = {
        input: input,
        sessionToken: sessionToken
    };

    if (countryCode) {
        bodyObj.includedRegionCodes = [countryCode];
    }

    const response = await fetch(authed.url, {
        method: "POST",
        headers: authed.headers,
        body: JSON.stringify(bodyObj),
        mode: "cors",
        cache: "no-cache"
    });

    const rawText = await response.text();
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        throw new OperationError(
            `GCloud Places Autocomplete: Failed to parse API response (HTTP ${response.status}).\nRaw: ${rawText.substring(0, 500)}`
        );
    }

    if (!response.ok) {
        const msg = data?.error?.message || response.statusText;
        throw new OperationError(
            `GCloud Places Autocomplete: API error (${response.status} ${response.statusText}): ${msg}\nEndpoint: ${url}`
        );
    }

    return data;
}

/**
 * GCloud Places Autocomplete operation
 */
class GCloudPlacesAutocomplete extends Operation {

    /**
     * GCloudPlacesAutocomplete constructor
     */
    constructor() {
        super();

        this.name = "GCloud Places Autocomplete";
        this.module = "Cloud";
        this.description = [
            "Returns place predictions in response to an HTTP request using the <b>Google Places API (New)</b>.",
            "<br><br>",
            "<b>Input:</b> Partial place string (one per line).",
            "<br><br>",
            "<b>Output Modes:</b>",
            "<ul>",
            "<li><code>Lat/Long + Label JSON</code> — Fast mode: queries <code>autocomplete</code> for placeId, then <code>places:details</code> for lat/long. Returns <code>[{lat, lng, label, placeId}]</code> array for the map.</li>",
            "<li><code>Text Summary</code> — Human-readable list of predicted places.</li>",
            "<li><code>JSON</code> — Raw prediction API response.</li>",
            "</ul>",
            "<br>",
            "<i>Note:</i> To get latitude and longitude for a prediction, the operation must make a secondary call to the Place Details API using the returned Place ID. This is done automatically in <code>Lat/Long + Label JSON</code> mode.",
            "<br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation using an API Key with Maps Platform API access."
        ].join("");
        this.infoURL = "https://developers.google.com/maps/documentation/places/web-service/place-autocomplete";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                "name": "Output Format",
                "type": "option",
                "value": ["Text Summary", "Lat/Long + Label JSON", "JSON"]
            },
            {
                "name": "Country Restriction",
                "type": "string",
                "value": "",
                "hint": "e.g. 'US', 'GB'"
            },
            {
                "name": "Max Candidates Per Line",
                "type": "number",
                "value": 1
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [outputFormat, countryRestriction, maxCandidatesRaw] = args;
        const maxCandidates = Math.max(1, Math.min(5, parseInt(maxCandidatesRaw, 10) || 1));

        if (!input || input.trim() === "") return "";

        const queries = input.split("\n").map(q => q.trim()).filter(q => q.length > 0);
        const results = [];
        const jsonOutput = []; // For Lat/Long + Label JSON

        // Generate one session token for this entire run
        const sessionToken = generateUUID();

        for (const query of queries) {
            const data = await placesAutocomplete(query, sessionToken, countryRestriction);

            if (outputFormat === "JSON") {
                results.push(JSON.stringify(data, null, 2));
            } else if (!data.suggestions || data.suggestions.length === 0) {
                if (outputFormat === "Text Summary") {
                    results.push(`[No predictions for "${query}"]`);
                }
            } else {
                const candidates = data.suggestions.slice(0, maxCandidates);
                const placePredictions = candidates.filter(s => s.placePrediction).map(s => s.placePrediction);

                if (outputFormat === "Text Summary") {
                    results.push(`Query: "${query}"`);
                    for (const p of placePredictions) {
                        results.push(`  - ${p.text.text} (ID: ${p.placeId})`);
                    }
                } else if (outputFormat === "Lat/Long + Label JSON") {
                    // For each prediction we need the Lat/Long, so we must call Place Details
                    // Note: session token is included by omitting fields in autocomplete,
                    // but calling place details with a Place ID and session token consumes the token.
                    // We generate a new one if we fetch details so we don't invalidate our batch loop if it matters.

                    for (const p of placePredictions) {
                        const detailsUrl = `https://places.googleapis.com/v1/places/${p.placeId}`;
                        const hdrs = new Headers();
                        hdrs.set("X-Goog-FieldMask", "id,location,displayName,formattedAddress");
                        const authed = applyGCPAuth(detailsUrl, hdrs);
                        const numTokens = generateUUID(); // consume a new session token for the details fetch

                        const detailRes = await fetch(authed.url + "?sessionToken=" + numTokens, {
                            method: "GET",
                            headers: authed.headers,
                            mode: "cors"
                        });

                        if (detailRes.ok) {
                            const dData = await detailRes.json();
                            if (dData.location) {
                                jsonOutput.push({
                                    lat: dData.location.latitude,
                                    lng: dData.location.longitude,
                                    label: dData.formattedAddress || dData.displayName?.text || p.text.text,
                                    placeId: dData.id
                                });
                            }
                        }
                    }
                }
            }
        }

        if (outputFormat === "Lat/Long + Label JSON") {
            return JSON.stringify(jsonOutput, null, 2);
        } else if (outputFormat === "JSON") {
            return `[\n` + results.map(r => `  ${r.replace(/\n/g, "\n  ")}`).join(",\n") + `\n]`;
        }

        return results.join("\n");
    }

}

export default GCloudPlacesAutocomplete;
