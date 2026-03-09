/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth } from "../lib/GoogleCloud.mjs";

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/**
 * Calls the Places API Text Search endpoint.
 *
 * @param {string} textQuery - The text string on which to search.
 * @param {string} fields - Comma-separated field mask.
 * @param {number} maxResultCount - Max results per query.
 * @param {string} locationBias - Optional "lat,lng,radius_m" string.
 * @returns {Promise<Object>} The parsed API response body.
 */
export async function placesSearchText(textQuery, fields, maxResultCount, locationBias) {
    const url = PLACES_SEARCH_URL;
    const headers = new Headers();
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("X-Goog-FieldMask", fields);

    const authed = applyGCPAuth(url, headers);

    const bodyObj = {
        textQuery: textQuery,
        maxResultCount: maxResultCount
    };

    if (locationBias) {
        // Parse lat,lng,radius
        const parts = locationBias.split(",");
        if (parts.length === 3) {
            const lat = parseFloat(parts[0].trim());
            const lng = parseFloat(parts[1].trim());
            const rad = parseFloat(parts[2].trim());
            if (!isNaN(lat) && !isNaN(lng) && !isNaN(rad)) {
                bodyObj.locationBias = {
                    circle: {
                        center: { latitude: lat, longitude: lng },
                        radius: rad
                    }
                };
            }
        }
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
            `GCloud Places Search: Failed to parse API response (HTTP ${response.status}).\nRaw: ${rawText.substring(0, 500)}`
        );
    }

    if (!response.ok) {
        const msg = data?.error?.message || response.statusText;
        throw new OperationError(
            `GCloud Places Search: API error (${response.status} ${response.statusText}): ${msg}\nEndpoint: ${url}`
        );
    }

    return data;
}

/**
 * GCloud Places Search operation
 */
class GCloudPlacesSearch extends Operation {

    /**
     * GCloudPlacesSearch constructor
     */
    constructor() {
        super();

        this.name = "GCloud Places Search";
        this.module = "Cloud";
        this.description = [
            "Searches for places using a free-text string (e.g. 'Spicy Vegetarian Food in Sydney') using the <b>Google Places API (New)</b>.",
            "<br><br>",
            "<b>Input:</b> One free-text query per line.",
            "<br><br>",
            "<b>Output Modes:</b>",
            "<ul>",
            "<li><code>Lat/Long + Label JSON</code> — Outputs a JSON array of objects compatible with <code>GCloud Show on Map</code>.</li>",
            "<li><code>Text Summary</code> — Human-readable ranked list of results.</li>",
            "<li><code>JSON</code> — Raw API response.</li>",
            "</ul>",
            "<br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation using an API Key with Maps Platform API access."
        ].join("");
        this.infoURL = "https://developers.google.com/maps/documentation/places/web-service/text-search";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                "name": "Output Format",
                "type": "option",
                "value": ["Text Summary", "Lat/Long + Label JSON", "JSON"]
            },
            {
                "name": "Location Bias",
                "type": "string",
                "value": "",
                "hint": "lat,lng,radius_m (e.g. '51.5,-0.1,5000' for London)"
            },
            {
                "name": "Max Results Per Line",
                "type": "number",
                "value": 3
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [outputFormat, locationBias, maxResultsRaw] = args;
        const maxResults = Math.max(1, Math.min(20, parseInt(maxResultsRaw, 10) || 3));

        if (!input || input.trim() === "") return "";

        const queries = input.split("\n").map(q => q.trim()).filter(q => q.length > 0);
        const results = [];
        const jsonOutput = []; // For Lat/Long + Label JSON

        // Always request these fields to support all output types
        const fieldMask = "places.id,places.formattedAddress,places.location,places.displayName";

        for (const query of queries) {
            const data = await placesSearchText(query, fieldMask, maxResults, locationBias);

            if (outputFormat === "JSON") {
                results.push(JSON.stringify(data, null, 2));
            } else if (!data.places || data.places.length === 0) {
                if (outputFormat === "Text Summary") {
                    results.push(`[No places found for "${query}"]`);
                }
            } else {
                if (outputFormat === "Text Summary") {
                    results.push(`Search: "${query}"`);
                    for (const p of data.places) {
                        const name = p.displayName?.text || "(Unknown name)";
                        const address = p.formattedAddress || "";
                        results.push(`  - ${name}`);
                        if (address) results.push(`    Address: ${address}`);
                        if (p.location) results.push(`    Location: ${p.location.latitude}, ${p.location.longitude}`);
                        results.push(`    Place ID: ${p.id}\n`);
                    }
                } else if (outputFormat === "Lat/Long + Label JSON") {
                    for (const p of data.places) {
                        if (p.location) {
                            jsonOutput.push({
                                lat: p.location.latitude,
                                lng: p.location.longitude,
                                label: `${p.displayName?.text || ""} - ${p.formattedAddress || ""}`.trim().replace(/^- |- $/g, ""),
                                placeId: p.id
                            });
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

        return results.join("\n").trim();
    }

}

export default GCloudPlacesSearch;
