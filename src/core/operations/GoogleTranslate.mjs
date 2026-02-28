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
    run(input, args) {
        const [sourceLanguage, targetLanguage, authType, authString] = args;

        if (input.length === 0) return "";
        if (!authString) throw new OperationError("Error: Please provide a valid GCP Auth String (API Key or OAuth Token).");

        let url = "https://translation.googleapis.com/language/translate/v2";
        const headers = new Headers();
        headers.set("Content-Type", "application/json; charset=utf-8");

        if (authType === "API Key") {
            url += `?key=${encodeURIComponent(authString)}`;
        } else if (authType === "OAuth Token") {
            headers.set("Authorization", `Bearer ${authString}`);
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

        return fetch(url, config)
            .then(r => {
                if (!r.ok) {
                    return r.json().then(err => {
                        let msg = err?.error?.message || r.statusText;
                        throw new OperationError(`Google Translation API Error (${r.status}): ${msg}`);
                    }).catch(() => {
                        throw new OperationError(`Google Translation API Error: ${r.status} ${r.statusText}`);
                    });
                }
                return r.json();
            })
            .then(data => {
                if (data && data.data && data.data.translations && data.data.translations.length > 0) {
                    return data.data.translations[0].translatedText;
                }
                throw new OperationError("Error: Unexpected response format from Google Translation API.");
            })
            .catch(e => {
                if (e instanceof OperationError) throw e;
                throw new OperationError(e.toString() +
                    "\n\nThis error could be caused by a network issue or invalid authentication.");
            });
    }

}

export default GoogleTranslate;
