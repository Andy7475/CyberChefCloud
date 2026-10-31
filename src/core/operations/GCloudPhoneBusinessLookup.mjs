/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { placesSearchText } from "./GCloudPlacesSearch.mjs";
import { requireGcpCredentials } from "../lib/GoogleCloud.mjs";
import { parseWithRepair, normaliseRegion } from "../lib/PhoneNumber.mjs";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const FIELD_MASK = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.internationalPhoneNumber",
    "places.nationalPhoneNumber",
    "places.primaryTypeDisplayName",
    "places.businessStatus",
    "places.websiteUri",
    "places.googleMapsUri"
].join(",");

const MAX_RESULTS = 5;

/**
 * Converts a phone number returned by Places to E.164 so it can be compared with the query.
 *
 * @param {Object} place
 * @returns {string}
 */
function placeE164(place) {
    if (!place.internationalPhoneNumber) return "";
    const p = parsePhoneNumberFromString(place.internationalPhoneNumber);
    return p ? p.number : "";
}

/**
 * GCloud Phone Business Lookup operation
 */
class GCloudPhoneBusinessLookup extends Operation {

    /**
     * GCloudPhoneBusinessLookup constructor
     */
    constructor() {
        super();

        this.name = "GCloud Phone Business Lookup";
        this.module = "Cloud";
        this.description = [
            "Looks up which businesses or organisations listed on Google Maps use a phone number, via the Google Places API.",
            "<br><br>",
            "<b>Inputs:</b> Phone numbers, one per line, in any common format (e.g. <code>020 7323 8000</code>, <code>+442073238000</code>).",
            "<br>",
            "<b>Outputs:</b> Businesses whose listed phone number exactly matches, with name, type, address, status, website and Maps link.",
            "<br><br>",
            "Places Text Search is a fuzzy text search, not a phone directory: it often returns nearby or similar businesses with different numbers. This operation compares each result&apos;s listed number with the query and reports only exact matches unless <b>Include Non-matching Results</b> is on.",
            "<br><br>",
            "Each number is normalised offline first (as <code>Parse Phone Number</code> does, using <b>Default Region</b> for national-format numbers) and searched in international format, then national format if there is no exact match. No match means no Google Maps listing uses the number; it says nothing about personal or unlisted numbers.",
            "<br><br>",
            "<b>Note:</b> the numbers are sent to Google.",
            "<br><br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation and the Places API (New) enabled in the project."
        ].join("\n");
        this.infoURL = "https://developers.google.com/maps/documentation/places/web-service/text-search";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Default Region",
                type: "string",
                value: "GB"
            },
            {
                name: "Output Format",
                type: "option",
                value: ["Text Summary", "Lat/Long + Label JSON", "JSON"]
            },
            {
                name: "Include Non-matching Results",
                type: "boolean",
                value: false
            }
        ];
    }

    /**
     * Searches Places for one number, trying international then national format.
     *
     * @param {Object} phone - libphonenumber PhoneNumber.
     * @returns {Promise<{queries: string[], matches: Object[], others: Object[]}>}
     */
    async lookup(phone) {
        const queries = [];
        const seen = new Map();
        const formats = [phone.formatInternational(), phone.formatNational()];

        for (const query of formats) {
            if (queries.includes(query)) continue;
            queries.push(query);
            const data = await placesSearchText(query, FIELD_MASK, MAX_RESULTS, "");
            for (const place of data.places || []) {
                if (!seen.has(place.id)) seen.set(place.id, place);
            }
            if ([...seen.values()].some(p => placeE164(p) === phone.number)) break;
        }

        const places = [...seen.values()];
        return {
            queries,
            matches: places.filter(p => placeE164(p) === phone.number),
            others: places.filter(p => placeE164(p) !== phone.number)
        };
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [regionArg, outputFormat, includeOthers] = args;
        const region = normaliseRegion(regionArg);

        const lines = input.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (!lines.length) return "";
        requireGcpCredentials();

        const results = [];
        for (const line of lines) {
            const { phone } = parseWithRepair(line, region, true);
            if (!phone || !phone.isPossible()) {
                results.push({ input: line, e164: "", error: "Could not read this as a phone number", queries: [], matches: [], others: [] });
                continue;
            }
            const found = await this.lookup(phone);
            results.push({ input: line, e164: phone.number, ...found, others: includeOthers ? found.others : [] });
        }

        if (outputFormat === "JSON") {
            return JSON.stringify(results, null, 2);
        }

        if (outputFormat === "Lat/Long + Label JSON") {
            const points = [];
            for (const r of results) {
                for (const p of [...r.matches, ...r.others]) {
                    if (!p.location) continue;
                    points.push({
                        lat: p.location.latitude,
                        lng: p.location.longitude,
                        label: `${r.e164}: ${p.displayName?.text || ""} - ${p.formattedAddress || ""}`,
                        placeId: p.id
                    });
                }
            }
            return JSON.stringify(points, null, 2);
        }

        /**
         * Formats one place for the text summary.
         *
         * @param {Object} p
         * @returns {string[]}
         */
        const describe = p => {
            const out = [`  - ${p.displayName?.text || "(Unknown name)"}${p.primaryTypeDisplayName ? ` [${p.primaryTypeDisplayName.text}]` : ""}`];
            if (p.internationalPhoneNumber) out.push(`    Phone:   ${p.internationalPhoneNumber}`);
            if (p.formattedAddress) out.push(`    Address: ${p.formattedAddress}`);
            if (p.businessStatus && p.businessStatus !== "OPERATIONAL") out.push(`    Status:  ${p.businessStatus}`);
            if (p.websiteUri) out.push(`    Website: ${p.websiteUri}`);
            if (p.googleMapsUri) out.push(`    Maps:    ${p.googleMapsUri}`);
            return out;
        };

        return results.map(r => {
            const out = [r.e164 && r.e164 !== r.input ? `${r.input} (${r.e164})` : r.input];
            if (r.error) {
                out.push(`  ${r.error}`);
                return out.join("\n");
            }
            if (r.matches.length) {
                out.push(`  Exact matches (${r.matches.length}):`);
                r.matches.forEach(p => out.push(...describe(p)));
            } else {
                out.push("  No Google Maps listing found with this number.");
            }
            if (r.others.length) {
                out.push(`  Other results, different number (${r.others.length}):`);
                r.others.forEach(p => out.push(...describe(p)));
            }
            return out.join("\n");
        }).join("\n\n");
    }

}

export default GCloudPhoneBusinessLookup;
