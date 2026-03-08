/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { applyGCPAuth } from "../lib/GoogleCloud.mjs";

/**
 * GCloud Web Search operation
 */
class InternetArchiveSearch extends Operation {

    /**
     * GCloudWebSearch constructor
     */
    constructor() {
        super();

        this.name = "Internet Archive Search";
        this.module = "Cloud";
        this.description = "Perform a web search using the Google Custom Search JSON API, configured by default to search the Internet Archive. This requires an API key or an OAuth token configured in the 'Authenticate Google Cloud' operation.";
        this.infoURL = "https://developers.google.com/custom-search/v1/overview";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Search Engine ID",
                type: "string",
                value: "7702f5ea964fe41d5",
            },
            {
                name: "Number of Results",
                type: "number",
                value: 10,
                min: 1,
                max: 10
            },
            {
                name: "Output Format",
                type: "option",
                value: ["URLs Only (Newline separated)", "Markdown (Title, Link, Snippet)", "Raw JSON"]
            },
            {
                name: "Safe Search",
                type: "option",
                value: ["Off", "Moderate", "Active"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        let query = input.trim();
        if (!query) {
            throw new OperationError("Please provide a search query as input.");
        }

        const cxArg = args[0];
        const numResults = args[1];
        const outputFormat = args[2];
        const safeSearch = args[3].toLowerCase();

        const cx = args[0];

        if (!cx) {
            throw new OperationError("Search Engine ID (cx) is required.");
        }

        let baseEndpoint = `https://customsearch.googleapis.com/customsearch/v1?cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${numResults}&safe=${safeSearch}`;

        let headers = new Headers({
            "Accept": "application/json"
        });

        const authDetails = applyGCPAuth(baseEndpoint, headers);
        const url = authDetails.url;
        headers = authDetails.headers;

        let res;
        try {
            res = await fetch(url, {
                method: "GET",
                headers: headers
            });
        } catch (err) {
            throw new OperationError(`Network error trying to fetch Google Custom Search: ${err.message}`);
        }

        if (!res.ok) {
            let errText = await res.text();
            throw new OperationError(`Google Custom Search API Error (${res.status}): ${res.statusText}\n${errText}`);
        }

        let jsonResponse;
        try {
            jsonResponse = await res.json();
        } catch (err) {
            throw new OperationError(`Failed to parse Google Custom Search API response: ${err.message}`);
        }

        const items = jsonResponse.items || [];

        if (outputFormat === "URLs Only (Newline separated)") {
            return items.map(item => item.link).join("\\n");
        } else if (outputFormat === "Markdown (Title, Link, Snippet)") {
            if (items.length === 0) {
                return "No results found.";
            }
            return items.map(item => `### [${item.title}](${item.link})\\n${item.snippet}\\n`).join("\\n---\\n");
        } else {
            // Raw JSON
            return JSON.stringify(jsonResponse, null, 4);
        }
    }
}

export default InternetArchiveSearch;
