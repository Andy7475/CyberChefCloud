/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Utils from "../Utils.mjs";
import { applyGCPAuth } from "../lib/GoogleCloud.mjs";

const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places/";

/**
 * Calls the Places API Place Details endpoint.
 *
 * @param {string} placeId - The unique ID of the place.
 * @param {string} fields - Comma-separated field mask.
 * @param {string} language - Optional language code.
 * @returns {Promise<Object>} The parsed API response body.
 */
async function placeDetails(placeId, fields, language) {
    const url = new URL(`${PLACES_DETAILS_URL}${encodeURIComponent(placeId)}`);
    if (language) url.searchParams.append("languageCode", language);

    const headers = new Headers();
    headers.set("X-Goog-FieldMask", fields);

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
            `GCloud Place Details: Failed to parse API response (HTTP ${response.status}).\nRaw: ${rawText.substring(0, 500)}`
        );
    }

    if (!response.ok) {
        const msg = data?.error?.message || response.statusText;
        throw new OperationError(
            `GCloud Place Details: API error (${response.status} ${response.statusText}): ${msg}\nEndpoint: ${url}`
        );
    }

    return data;
}

/**
 * GCloud Place Details operation
 */
class GCloudPlaceDetails extends Operation {

    /**
     * GCloudPlaceDetails constructor
     */
    constructor() {
        super();

        this.name = "GCloud Place Details";
        this.module = "Cloud";
        this.description = [
            "Gets detailed information about a place given its Place ID using the <b>Google Places API (New)</b>.",
            "<br><br>",
            "<b>Input:</b> One Place ID per line.",
            "<br><br>",
            "<b>Output Modes:</b>",
            "<ul>",
            "<li><code>Lat/Long + Label JSON</code> — Outputs a JSON array of objects compatible with <code>GCloud Show on Map</code>.</li>",
            "<li><code>Text Summary</code> — Human-readable summary (Name, Address, Phone, Website, etc.).</li>",
            "<li><code>JSON</code> — Raw API response.</li>",
            "</ul>",
            "<br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation using an API Key with Maps Platform API access."
        ].join("");
        this.infoURL = "https://developers.google.com/maps/documentation/places/web-service/place-details";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                "name": "Output Format",
                "type": "option",
                "value": ["Text Summary", "Lat/Long + Label JSON", "JSON"]
            },
            {
                "name": "Fields Mask",
                "type": "string",
                "value": "id,displayName,formattedAddress,location,nationalPhoneNumber,websiteUri,regularOpeningHours,rating,userRatingCount,types",
                "hint": "Comma-separated list of fields (controls billing costs)"
            },
            {
                "name": "Language (Optional)",
                "type": "string",
                "value": "",
                "hint": "e.g. 'en', 'fr'"
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [outputFormat, fieldsMask, language] = args;
        const fields = fieldsMask || "id,displayName,formattedAddress,location";

        if (!input || input.trim() === "") return "";

        const placeIds = input.split("\n").map(q => q.trim()).filter(q => q.length > 0);
        const results = [];
        const jsonOutput = []; // For Lat/Long + Label JSON

        for (const placeId of placeIds) {
            const data = await placeDetails(placeId, fields, language);

            if (outputFormat === "JSON") {
                results.push(JSON.stringify(data, null, 2));
            } else if (!data.id) {
                if (outputFormat === "Text Summary") {
                    results.push(`[No details found for Place ID "${placeId}"]`);
                }
            } else {
                if (outputFormat === "Text Summary") {
                    const name = data.displayName?.text || "(Unknown name)";
                    results.push(`====== ${name} ======`);
                    if (data.formattedAddress) results.push(`Address: ${data.formattedAddress}`);
                    if (data.nationalPhoneNumber) results.push(`Phone:   ${data.nationalPhoneNumber}`);
                    if (data.websiteUri) results.push(`Website: ${data.websiteUri}`);
                    if (data.types) results.push(`Types:   ${data.types.join(", ")}`);
                    if (data.rating) results.push(`Rating:  ${data.rating}★ (${data.userRatingCount} reviews)`);
                    if (data.location) results.push(`Location: ${data.location.latitude}, ${data.location.longitude}`);
                    if (data.regularOpeningHours && data.regularOpeningHours.weekdayDescriptions) {
                        results.push(`Hours:`);
                        for (const d of data.regularOpeningHours.weekdayDescriptions) {
                            results.push(`  ${d}`);
                        }
                    }
                    results.push(""); // blank line separation
                } else if (outputFormat === "Lat/Long + Label JSON") {
                    if (data.location) {
                        jsonOutput.push({
                            lat: data.location.latitude,
                            lng: data.location.longitude,
                            label: `${data.displayName?.text || ""} - ${data.formattedAddress || ""}`.trim().replace(/^- |- $/g, ""),
                            placeId: data.id
                        });
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

export default GCloudPlaceDetails;
