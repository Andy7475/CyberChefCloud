/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { gcpFetch } from "../lib/GoogleCloud.mjs";

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
    const headers = new Headers();
    headers.set("X-Goog-FieldMask", fields);

    return await gcpFetch(`${PLACES_DETAILS_URL}${encodeURIComponent(placeId)}`, {
        params: language ? { languageCode: language } : {},
        headers: headers
    });
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
            "Fetches comprehensive details for a specific Google Place ID (e.g. reviews, opening hours, exact location).",
            "<br><br>",
            "<b>Inputs:</b> A Google Place ID (e.g. <code>ChIJN1t_tDeuEmsRUsoyG83frY4</code>).",
            "<br>",
            "<b>Outputs:</b> A rich JSON object containing all requested details for the place.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input a Place ID gathered from Places Search to see its full address and ratings.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
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

        let placeIds = [];
        try {
            // Handle the incoming Knowledge Graph result array
            const cleanedInput = input.replace(/^\[\s*|\s*\]$/g, "");
            const parsed = JSON.parse(cleanedInput);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            placeIds = arr.filter(loc => typeof loc.placeId === "string")
                .map(loc => loc.placeId);
        } catch (e) {
            placeIds = input.split("\n").map(q => q.trim()).filter(q => q.length > 0);
        }
        if (placeIds.length === 0) {
            placeIds = input.split("\n").map(q => q.trim()).filter(q => q.length > 0);
        }
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
