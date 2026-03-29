/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { gcpFetch } from "../lib/GoogleCloud.mjs";

const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

/**
 * Generates a random UUID v4 for the session token.
 *
 * @returns {string} UUID
 */
function generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
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
    const bodyObj = { input, sessionToken };
    if (countryCode) {
        bodyObj.includedRegionCodes = [countryCode];
    }
    return await gcpFetch(PLACES_AUTOCOMPLETE_URL, {
        method: "POST",
        body: bodyObj
    });
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
            "Returns place predictions/suggestions for partial text queries using the Google Places API.",
            "<br><br>",
            "<b>Inputs:</b> A partial text query (e.g. <code>Trafalgar Squ</code>).",
            "<br>",
            "<b>Outputs:</b> A list of suggested place names and their Place IDs.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input <code>Pizza in New Yo</code> -> Returns autocompleted place suggestions.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
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
                "name": "Results (up to 5)",
                "type": "number",
                "value": 5
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
        const maxCandidates = Math.min(5, parseInt(maxCandidatesRaw, 10) || 1);

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
                        const numTokens = generateUUID(); // consume a new session token for the details fetch

                        try {
                            const dData = await gcpFetch(detailsUrl, {
                                params: { sessionToken: numTokens },
                                headers: hdrs
                            });
                            if (dData.location) {
                                jsonOutput.push({
                                    lat: dData.location.latitude,
                                    lng: dData.location.longitude,
                                    label: dData.formattedAddress || dData.displayName?.text || p.text.text,
                                    placeId: dData.id
                                });
                            }
                        } catch (e) {
                            // ignore errors for individual place lookups
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
