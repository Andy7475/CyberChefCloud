/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2016
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";

/**
 * Google Translate operation
 */
class GoogleTranslate extends Operation {

    /**
     * GoogleTranslate constructor
     */
    constructor() {
        super();

        this.name = "Google Translate";
        this.module = "Cloud";
        this.description = [
            "Translates text using the Google Cloud Translation API.",
            "<br><br>",
            "Supports providing an API Key or an OAuth Bearer Token. ",
            "See the setup guide in the documentation for how to secure your Cloud project.",
        ].join("\n");
        this.infoURL = "https://cloud.google.com/translate/docs/reference/rest/v2/translate";
        this.inputType = "string";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Source Language (ISO-639-1)",
                "type": "string",
                "value": "en"
            },
            {
                "name": "Target Language (ISO-639-1)",
                "type": "string",
                "value": "es"
            },
            {
                "name": "Auth Type",
                "type": "option",
                "value": ["API Key", "OAuth Token"]
            },
            {
                "name": "GCP Auth String",
                "type": "toggleString",
                "value": "",
                "toggleValues": ["UTF8", "Latin1", "Base64", "Hex"]
            },
            {
                "name": "Quota Project (ADC only)",
                "type": "string",
                "value": ""
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [sourceLanguage, targetLanguage, authType, authStringObj, quotaProject] = args;
        const authString = typeof authStringObj === "string" ? authStringObj : (authStringObj.string || "");

        if (input.length === 0) return "";
        if (!authString) throw new OperationError("Error: Please provide a valid GCP Auth String (API Key or OAuth Token).");

        let url = "https://translation.googleapis.com/language/translate/v2";
        const headers = new Headers();
        headers.set("Content-Type", "application/json; charset=utf-8");

        if (authType === "API Key") {
            url += `?key=${encodeURIComponent(authString)}`;
        } else if (authType === "OAuth Token") {
            headers.set("Authorization", `Bearer ${authString}`);
            if (quotaProject) {
                headers.set("x-goog-user-project", quotaProject);
            }
        }

        const body = JSON.stringify({
            q: input,
            source: sourceLanguage,
            target: targetLanguage,
            format: "text"
        });

        const config = {
            method: "POST",
            headers: headers,
            body: body,
            mode: "cors",
            cache: "no-cache",
        };

        try {
            const response = await fetch(url, config);
            let responseData;

            try {
                responseData = await response.json();
            } catch (err) {
                throw new OperationError("Error: Failed to parse response from Google Translation API.");
            }

            if (!response.ok) {
                const msg = responseData?.error?.message || response.statusText;
                throw new OperationError(`Google Translation API Error (${response.status}): ${msg}`);
            }

            if (responseData && responseData.data && responseData.data.translations && responseData.data.translations.length > 0) {
                return responseData.data.translations[0].translatedText;
            }

            throw new OperationError("Error: Unexpected response format from Google Translation API.");
        } catch (e) {
            if (e.name === "OperationError") throw e;
            throw new OperationError(e.message || e.toString() +
                "\n\nThis error could be caused by a network issue or invalid authentication.");
        }
    }

}

export default GoogleTranslate;
