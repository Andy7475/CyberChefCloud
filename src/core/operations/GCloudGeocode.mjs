/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth } from "../lib/GoogleCloud.mjs";

const GEOCODING_API_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Calls the Geocoding API.
 *
 * @param {string} query - The address or latlng to geocode.
 * @param {string} language - Optional language code.
 * @param {string} region - Optional region code.
 * @param {boolean} isReverse - True to reverse geocode (latlng -> address).
 * @returns {Promise<Object>} The parsed API response body.
 */
async function geocodeAddress(query, language, region, isReverse) {
    const url = new URL(GEOCODING_API_URL);
    if (isReverse) {
        url.searchParams.append("latlng", query);
    } else {
        url.searchParams.append("address", query);
    }
    if (language) url.searchParams.append("language", language);
    if (region) url.searchParams.append("region", region);

    const headers = new Headers();
    const authed = applyGCPAuth(url.toString(), headers);

    const response = await fetch(authed.url, {
        method: "GET",
        headers: authed.headers,
        mode: "cors",
        cache: "no-cache"
    });

    const rawText = await response.text();
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        throw new OperationError(
            `GCloud Geocode: Failed to parse API response (HTTP ${response.status}).\nRaw: ${rawText.substring(0, 500)}`
        );
    }

    if (!response.ok || (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS")) {
        const msg = data.error_message || data.status || response.statusText;
        throw new OperationError(
            `GCloud Geocode: API error (${response.status} ${response.statusText}): ${msg}\nEndpoint: ${url}`
        );
    }

    return data;
}

/**
 * GCloud Geocode operation
 */
class GCloudGeocode extends Operation {

    /**
     * GCloudGeocode constructor
     */
    constructor() {
        super();

        this.name = "GCloud Geocode";
        this.module = "Cloud";
        this.description = [
            "Converts addresses (like '1600 Amphitheatre Parkway, Mountain View, CA') into geographic coordinates ",
            "(latitude and longitude) using the <b>Google Maps Geocoding API</b>.",
            "<br><br>",
            "<b>Input:</b>",
            "<ul>",
            "<li>For <i>Geocode</i>: One address per line.</li>",
            "<li>For <i>Reverse Geocode</i>: <code>lat, long</code> per line OR a JSON array of objects with <code>lat</code> and <code>lng</code> properties (matches the <code>Lat/Long + Label JSON</code> output of other operations).</li>",
            "</ul>",
            "<br>",
            "<b>Output Modes:</b>",
            "<ul>",
            "<li><code>Lat/Long + Label JSON</code> — Outputs a JSON array of objects compatible with <code>GCloud Show on Map</code>.</li>",
            "<li><code>Lat/Long (for Show on Map)</code> — Outputs one <code>lat, long</code> pair per line, compatible with the classic <code>Show on Map</code> operation.</li>",
            "<li><code>Text Summary</code> — Human-readable summary.</li>",
            "<li><code>JSON</code> — Raw API response.</li>",
            "</ul>",
            "<br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation using either an API Key with Maps Platform API access, or an OAuth token."
        ].join("");
        this.infoURL = "https://developers.google.com/maps/documentation/geocoding/overview";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                "name": "Output Format",
                "type": "option",
                "value": ["Lat/Long + Label JSON", "Lat/Long (for Show on Map)", "Text Summary", "JSON"]
            },
            {
                "name": "Language (Optional)",
                "type": "string",
                "value": "",
                "hint": "e.g. 'en', 'fr'"
            },
            {
                "name": "Region (Optional)",
                "type": "string",
                "value": "",
                "hint": "e.g. 'US', 'GB'"
            },
            {
                "name": "Action",
                "type": "option",
                "value": ["Geocode (Address to Lat/Long)", "Reverse Geocode (Lat/Long to Address)"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [outputFormat, language, region, action] = args;
        const isReverse = action === "Reverse Geocode (Lat/Long to Address)";

        if (!input || input.trim() === "") return "";

        let lines = [];
        if (isReverse) {
            // Attempt to parse as JSON array of location objects (like Lat/Long + Label JSON)
            try {
                const cleanedInput = input.trim().replace(/\]\s*,?\s*\[/g, ",");
                const parsed = JSON.parse(cleanedInput);
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                lines = arr.filter(loc => typeof loc.lat === "number" && typeof loc.lng === "number")
                    .map(loc => `${loc.lat},${loc.lng}`);
            } catch (e) {
                // Fallback to splitting by line for plain lat,lng strings
                lines = input.split("\n").map(a => a.trim()).filter(a => a.length > 0);
            }
            if (lines.length === 0) {
                // If JSON parsing yielded no items, fallback to string split just in case
                lines = input.split("\n").map(a => a.trim()).filter(a => a.length > 0);
            }
        } else {
            lines = input.split("\n").map(a => a.trim()).filter(a => a.length > 0);
        }
        const results = [];
        const jsonOutput = []; // For Lat/Long + Label JSON

        for (const line of lines) {
            const data = await geocodeAddress(line, language, region, isReverse);

            if (outputFormat === "JSON") {
                results.push(JSON.stringify(data, null, 2));
            } else if (data.status === "ZERO_RESULTS" || !data.results || data.results.length === 0) {
                if (outputFormat === "Text Summary") {
                    results.push(`[No results found for "${line}"]`);
                } else if (outputFormat === "Lat/Long (for Show on Map)") {
                    results.push(`0, 0`); // Fallback for map
                }
            } else {
                // Take top result
                const topResult = data.results[0];
                const lat = topResult.geometry.location.lat;
                const lng = topResult.geometry.location.lng;
                const formatted = topResult.formatted_address;
                const placeId = topResult.place_id;

                if (outputFormat === "Text Summary") {
                    if (isReverse) {
                        results.push(`${lat}, ${lng} →`);
                        for (let i = 0; i < data.results.length; i++) {
                            results.push(`  ${i + 1}. ${data.results[i].formatted_address}`);
                        }
                    } else {
                        results.push(`${line} → ${lat}, ${lng}  (${formatted})`);
                    }
                } else if (outputFormat === "Lat/Long (for Show on Map)") {
                    results.push(`${lat}, ${lng}`);
                } else if (outputFormat === "Lat/Long + Label JSON") {
                    jsonOutput.push({
                        lat: lat,
                        lng: lng,
                        label: formatted,
                        placeId: placeId
                    });
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

export default GCloudGeocode;
