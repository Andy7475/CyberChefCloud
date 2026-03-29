/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { getGcpCredentials, gcpFetch } from "../lib/GoogleCloud.mjs";
import { placesSearchText } from "./GCloudPlacesSearch.mjs";

/**
 * Calls the Google Knowledge Graph Search API (Public).
 *
 * @param {string} queryOrId - The text query or mid (e.g. /m/xxxx or c-xxxx).
 * @param {boolean} isLookup - True if queryOrId is a MID, False for text search.
 * @param {number} limit - Max results.
 * @param {string} language - Optional language code.
 * @param {string} apiKey - Optional but recommended API Key.
 * @param {string} project - The Quota Project ID.
 * @param {string} typeFilter - Optional schema type filter.
 * @returns {Promise<Object>} The parsed API response body.
 */
async function kgSearch(queryOrId, isLookup, limit, language, apiKey, project, typeFilter) {
    const baseUrl = `https://enterpriseknowledgegraph.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/publicKnowledgeGraphEntities`;
    const params = {};
    let endpoint = "";

    if (isLookup) {
        endpoint = `${baseUrl}:Lookup`;
        params.ids = queryOrId;
    } else {
        endpoint = `${baseUrl}:Search`;
        params.query = queryOrId;
        if (typeFilter) params.types = [typeFilter];
        if (limit > 0) params.limit = limit.toString();
    }
    if (language) params.languages = language;
    if (apiKey) params.key = apiKey;

    return await gcpFetch(endpoint, {
        params: params
    });
}

/**
 * Formats a Knowledge Graph search result item into a human readable summary.
 */
function formatEntitySummary(item) {
    const result = item.result;
    if (!result) return "(Invalid result object)";

    const lines = [];
    const name = result.name || "(Unnamed)";
    const score = item.resultScore ? ` [Score: ${item.resultScore}]` : "";
    lines.push(`===== ${name}${score} =====`);

    if (result["@id"]) {
        lines.push(`ID:          ${result["@id"].replace(/^kg:/, "")}`);
    }
    if (result.identifier && Array.isArray(result.identifier)) {
        const midObj = result.identifier.find(id => id.propertyID === "googleKgMID");
        if (midObj && midObj.value) {
            lines.push(`MID:         ${midObj.value}`);
        }
    }

    if (result["@type"]) {
        const types = Array.isArray(result["@type"]) ? result["@type"].join(", ") : result["@type"];
        lines.push(`Type:        ${types}`);
    }
    if (result.description) {
        lines.push(`Subtitle:    ${result.description}`);
    }
    if (result.detailedDescription) {
        let desc = result.detailedDescription.articleBody || "";
        // Wrap at 80 cols roughly
        desc = desc.replace(/(?![^\n]{1,80}$)([^\n]{1,80})\s/g, "$1\n             ");
        lines.push(`Description: ${desc}`);
        if (result.detailedDescription.url) {
            lines.push(`Wikipedia:   ${result.detailedDescription.url}`);
        }
    }
    if (result.image && result.image.contentUrl) {
        lines.push(`Image:       ${result.image.contentUrl}`);
    }
    if (result.url) {
        lines.push(`URL:         ${result.url}`);
    }

    return lines.join("\n");
}

/**
 * GCloud Knowledge Graph operation
 */
class GCloudKnowledgeGraph extends Operation {

    /**
     * GCloudKnowledgeGraph constructor
     */
    constructor() {
        super();

        this.name = "GCloud Knowledge Graph";
        this.module = "Cloud";
        this.description = [
            "Searches or looks up entities in the Google Enterprise Knowledge Graph.",
            "<br><br>",
            "<b>Inputs:</b> A text search query (e.g. <code>Taylor Swift</code>) or a Machine ID (e.g. <code>c-0260160kc</code> or <code>/m/0dl567</code>).",
            "<br>",
            "<b>Outputs:</b> A textual summary of the entity (description, type, ID) or raw JSON-LD.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input <code>Dune</code> and filter by <code>Book</code> type to retrieve details about the novel.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://developers.google.com/knowledge-graph/";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                "name": "Output Format",
                "type": "option",
                "value": ["Text Summary", "Lat/Long + Label JSON", "JSON"]
            },
            {
                "name": "Type Filter",
                "type": "editableOption",
                "value": [
                    {name: "Any (No filter)", value: ""},
                    {name: "Person", value: "Person"},
                    {name: "Organization", value: "Organization"},
                    {name: "Place", value: "Place"},
                    {name: "LocalBusiness", value: "LocalBusiness"},
                    {name: "Product", value: "Product"},
                    {name: "Book", value: "Book"},
                    {name: "Movie", value: "Movie"},
                    {name: "MusicAlbum", value: "MusicAlbum"},
                    {name: "Event", value: "Event"},
                    {name: "Recipe", value: "Recipe"}
                ]
            },
            {
                "name": "Search Limit",
                "type": "number",
                "value": 1,
                "hint": "Max results for text search (ignored for MID lookup)"
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
        const [outputFormat, typeFilter, limitRaw, language] = args;
        const limit = parseInt(limitRaw, 10) || 1;

        if (!input || input.trim() === "") return "";

        const creds = getGcpCredentials();
        if (!creds || !creds.quotaProject) {
            throw new OperationError("Please configure a Quota Project in the 'Authenticate Google Cloud' operation before using this ingredient.");
        }
        const project = creds.quotaProject;

        let apiKey = "";
        if (creds) {
            if (creds.authType === "API Key" && creds.authString) {
                apiKey = creds.authString;
            } else if (creds.apiKey) {
                apiKey = creds.apiKey; // Fallback to secondary dual-auth API key
            }
        }

        const queries = input.split("\n").map(q => q.trim()).filter(q => q.length > 0);
        const results = [];
        const jsonOutput = []; // For Lat/Long + Label JSON

        for (const query of queries) {
            const isLookup = query.startsWith("/m/") || query.startsWith("/g/") || query.startsWith("c-");
            const data = await kgSearch(query, isLookup, limit, language, apiKey, project, typeFilter);

            if (outputFormat === "JSON") {
                results.push(JSON.stringify(data, null, 2));
            } else if (!data.itemListElement || data.itemListElement.length === 0) {
                if (outputFormat === "Text Summary") {
                    results.push(`[No Knowledge Graph entities found for "${query}"]`);
                }
            } else {
                if (outputFormat === "Text Summary") {
                    results.push(`Query: "${query}"`);
                    for (const item of data.itemListElement) {
                        results.push(formatEntitySummary(item));
                        results.push(""); // blank
                    }
                } else if (outputFormat === "Lat/Long + Label JSON") {
                    // Extremely rarely the KG returns explicit geo-coordinates in the public api unless it's specifically included.
                    // But if it is, it would be in result.geo.latitude
                    for (const item of data.itemListElement) {
                        const r = item.result;
                        if (r && r.geo && r.geo.latitude && r.geo.longitude) {
                            jsonOutput.push({
                                lat: r.geo.latitude,
                                lng: r.geo.longitude,
                                label: r.name || query
                            });
                        } else if (r && r.name && r["@type"]) {
                            const typeArray = Array.isArray(r["@type"]) ? r["@type"] : [r["@type"]];
                            if (typeArray.includes("Place")) {
                                try {
                                    // 1. Check if the KG explicitly provides a googlePlaceID in its identifiers
                                    let explicitPlaceId = null;
                                    if (r.identifier && Array.isArray(r.identifier)) {
                                        const placeIdObj = r.identifier.find(id => id.propertyID === "googlePlaceID");
                                        if (placeIdObj && placeIdObj.value) explicitPlaceId = placeIdObj.value;
                                    }

                                    if (explicitPlaceId) {
                                        // Fetch exact coordinates via Place Details endpoint (v1)
                                        const detailsUrl = `https://places.googleapis.com/v1/places/${explicitPlaceId}`;
                                        const hdrs = new Headers();
                                        hdrs.set("X-Goog-FieldMask", "id,location,displayName,formattedAddress");

                                        try {
                                            const p = await gcpFetch(detailsUrl, { headers: hdrs });
                                            if (p.location) {
                                                jsonOutput.push({
                                                    lat: p.location.latitude,
                                                    lng: p.location.longitude,
                                                    label: p.formattedAddress || p.displayName?.text || r.name,
                                                    placeId: explicitPlaceId
                                                });
                                                continue; // Move on to next KG entity
                                            }
                                        } catch (e) {
                                            // Silently ignore Place Details errors
                                        }
                                    }

                                    // 2. Fallback to Places API Search Text using the place name
                                    const placeData = await placesSearchText(r.name, "places.id,places.displayName,places.formattedAddress,places.location", 1, "");
                                    if (placeData && placeData.places && placeData.places.length > 0) {
                                        const p = placeData.places[0];
                                        if (p.location) {
                                            jsonOutput.push({
                                                lat: p.location.latitude,
                                                lng: p.location.longitude,
                                                label: p.formattedAddress || p.displayName?.text || r.name,
                                                placeId: p.id
                                            });
                                        }
                                    }
                                } catch (e) {
                                    // Silently ignore Place Search errors (e.g. if Maps API is not enabled)
                                    // We are best-effort retrieving coordinates for Knowledge Graph
                                }
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

        return results.join("\n").trim();
    }

}

export default GCloudKnowledgeGraph;
