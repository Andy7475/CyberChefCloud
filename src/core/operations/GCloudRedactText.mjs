/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, getGcpCredentials } from "../lib/GoogleCloud.mjs";

/**
 * GCloud Redact Text operation
 */
class GCloudRedactText extends Operation {

    /**
     * GCloudRedactText constructor
     */
    constructor() {
        super();

        this.name = "GCloud Redact Text";
        this.module = "Cloud";
        this.description = [
            "Redacts sensitive data from text using the Google Cloud Sensitive Data Protection (DLP) API.",
            "<br><br>",
            "<b>Inputs:</b> Plain text.",
            "<br>",
            "<b>Outputs:</b> The redacted text or the full JSON response.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input <code>Contact me at test@example.com</code> -> Output: <code>Contact me at ****************</code></li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/sensitive-data-protection/docs/reference/rest/v2/projects.locations.content/deidentify";
        this.inputType = "string";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "InfoTypes to Redact (Optional)",
                "type": "string",
                "value": "",
                "hint": "Comma-separated list (e.g. EMAIL_ADDRESS, PHONE_NUMBER). Leave blank for default comprehensive list."
            },
            {
                "name": "Redaction Strategy",
                "type": "option",
                "value": ["Mask with Character", "Replace with InfoType Name"]
            },
            {
                "name": "Masking Character",
                "type": "string",
                "value": "*"
            },
            {
                "name": "Output Format",
                "type": "option",
                "value": ["Redacted Text", "Full JSON Response"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        if (!input) return "";

        const [infoTypesStr, strategy, maskingChar, outputFormat] = args;

        const creds = getGcpCredentials();
        if (!creds || !creds.quotaProject) {
            throw new OperationError(
                "GCloud Redact Text: Please run 'Authenticate Google Cloud' first and set a Quota Project."
            );
        }

        const project = creds.quotaProject;
        // Global location endpoint
        const url = `https://dlp.googleapis.com/v2/projects/${encodeURIComponent(project)}/content:deidentify`;

        const requestBody = {
            item: { value: input }
        };

        // Parse infoTypes
        const infoTypesFilter = infoTypesStr.split(",")
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => ({ name: s }));

        if (infoTypesFilter.length > 0) {
            requestBody.inspectConfig = {
                infoTypes: infoTypesFilter
            };
        }

        // Configure DeidentifyConfig
        let primitiveTransformation;
        if (strategy === "Mask with Character") {
            const char = maskingChar || "*";
            primitiveTransformation = {
                characterMaskConfig: {
                    maskingCharacter: char[0] || "*"
                }
            };
        } else {
            primitiveTransformation = {
                replaceWithInfoTypeConfig: {}
            };
        }

        requestBody.deidentifyConfig = {
            infoTypeTransformations: {
                transformations: [{
                    // If infoTypesFilter is provided, we tell it to transform those specific ones,
                    // otherwise it transforms all infoTypes detected by the default detect config.
                    infoTypes: infoTypesFilter.length > 0 ? infoTypesFilter : undefined,
                    primitiveTransformation
                }]
            }
        };

        let data;
        try {
            data = await gcpFetch(url, {
                method: "POST",
                body: requestBody
            });
        } catch (e) {
            throw new OperationError(`GCloud Redact Text API error: ${e.message}`);
        }

        if (outputFormat === "Full JSON Response") {
            return JSON.stringify(data, null, 2);
        }

        return data.item?.value || "";
    }

}

export default GCloudRedactText;
