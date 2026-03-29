/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { gcpFetch } from "../lib/GoogleCloud.mjs";

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
    return await gcpFetch(GEOCODING_API_URL, {
        params: {
            [isReverse ? "latlng" : "address"]: query,
            language: language,
            region: region
        }
    });
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
            "Converts human-readable addresses into geographic coordinates (Geocoding) or vice versa (Reverse Geocoding) using Google Maps API.",
            "<br><br>",
            "<b>Inputs:</b> A text address (e.g. <code>1600 Amphitheatre Parkway</code>) or coordinates (e.g. <code>37.42,-122.08</code>).",
            "<br>",
            "<b>Outputs:</b> Latitude/Longitude pairs or formatted addresses.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input <code>London</code> -> Output <code>51.5072, -0.1276</code>.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
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
