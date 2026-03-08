/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Utils from "../Utils.mjs";
import { getGcpCredentials } from "../lib/GoogleCloud.mjs";

const PUBLIC_KG_SEARCH_URL = "https://kgsearch.googleapis.com/v1/entities:search";

/**
 * Calls the Google Knowledge Graph Search API (Public).
 *
 * @param {string} queryOrId - The text query or mid (e.g. /m/xxxx or c-xxxx).
 * @param {boolean} isLookup - True if queryOrId is a MID, False for text search.
 * @param {number} limit - Max results.
 * @param {string} language - Optional language code.
 * @param {string} apiKey - Optional but recommended API Key.
 * @returns {Promise<Object>} The parsed API response body.
 */
async function kgSearch(queryOrId, isLookup, limit, language, apiKey) {
    const url = new URL(PUBLIC_KG_SEARCH_URL);

    if (isLookup) {
        url.searchParams.append("ids", queryOrId);
    } else {
        url.searchParams.append("query", queryOrId);
    }

    if (limit > 0) url.searchParams.append("limit", limit.toString());
    if (language) url.searchParams.append("languages", language);
    if (apiKey) url.searchParams.append("key", apiKey);

    const response = await fetch(url.toString(), {
        method: "GET",
        mode: "cors",
        cache: "no-cache"
    });

    const rawText = await response.text();
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        throw new OperationError(
            `GCloud Knowledge Graph: Failed to parse API response (HTTP ${response.status}).\nRaw: ${rawText.substring(0, 500)}`
        );
    }

    if (!response.ok) {
        const msg = data?.error?.message || response.statusText;
        throw new OperationError(
            `GCloud Knowledge Graph: API error (${response.status} ${response.statusText}): ${msg}\nEndpoint: ${url.toString().replace(/key=[^&]+/, "key=REDACTED")}`
        );
    }

    return data;
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
            "Searches or looks up entities in the <b>Google Knowledge Graph</b>.",
            "<br><br>",
            "Automatically detects if the input is a Machine ID (MID) or a text query:",
            "<ul>",
            "<li>If the input starts with <code>/m/</code>, <code>/g/</code>, or <code>c-</code>, it performs an exact <b>Lookup</b> by MID.</li>",
            "<li>Otherwise, it performs a <b>Text Search</b> for entities matching the text.</li>",
            "</ul>",
            "<br>",
            "<b>Output Modes:</b>",
            "<ul>",
            "<li><code>Lat/Long + Label JSON</code> — If the entity is a Place/City with coordinates (rarely populated), converts it for <code>GCloud Show on Map</code>.</li>",
            "<li><code>Text Summary</code> — Human-readable summary including Wikipedia links and description.</li>",
            "<li><code>JSON</code> — Raw Schema.org JSON-LD response.</li>",
            "</ul>",
            "<br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation using an API Key."
        ].join("");
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
        const [outputFormat, limitRaw, language] = args;
        const limit = parseInt(limitRaw, 10) || 1;

        if (!input || input.trim() === "") return "";

        // API Key is required for high quota, although public KG search doesn't strictly always need it,
        // it requires it in practice.
        const creds = getGcpCredentials();
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
            const data = await kgSearch(query, isLookup, limit, language, apiKey);

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
