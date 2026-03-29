/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2016
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch } from "../lib/GoogleCloud.mjs";

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
            "Translates text between thousands of language pairs using the Google Cloud Translation API.",
            "<br><br>",
            "<b>Inputs:</b> The raw text that needs to be translated.",
            "<br>",
            "<b>Outputs:</b> The translated text string.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input <code>Bonjour</code> with English as the Target Language -> Output <code>Hello</code>.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
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
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [sourceLanguage, targetLanguage] = args;

        if (input.length === 0) return "";

        const url = "https://translation.googleapis.com/language/translate/v2";

        const body = {
            q: input,
            source: sourceLanguage,
            target: targetLanguage,
            format: "text"
        };

        try {
            const responseData = await gcpFetch(url, {
                method: "POST",
                body: body
            });

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
