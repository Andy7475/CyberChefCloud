/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { findPhoneNumbersInText, normaliseRegion } from "../lib/PhoneNumber.mjs";
import { caseInsensitiveSort } from "../lib/Sort.mjs";

/**
 * Extract Phone Numbers operation
 */
class ExtractPhoneNumbers extends Operation {

    /**
     * ExtractPhoneNumbers constructor
     */
    constructor() {
        super();

        this.name = "Extract Phone Numbers";
        this.module = "PhoneNumber";
        this.description = [
            "Finds phone numbers in free text (statements, chat exports, OCR output) offline using Google&apos;s libphonenumber metadata.",
            "<br><br>",
            "<b>Default Region:</b> the two-letter country code assumed for numbers written without an international prefix (e.g. <code>GB</code>). Numbers with a <code>+</code> or international dialling prefix are found whatever the region.",
            "<br>",
            "<b>Only Valid Numbers:</b> when on, keeps only numbers in allocated ranges. Turn it off to also keep numbers that are the right length but unallocated (e.g. Ofcom drama ranges, mistyped numbers).",
            "<br>",
            "<b>Output Format:</b> <code>E.164</code> (e.g. <code>+447400123456</code>) is best for de-duplicating and chaining into <code>Parse Phone Number</code> or <code>GCloud Phone Business Lookup</code>.",
            "<br><br>",
            "<b>Example:</b> <code>Ring 07400 123456 or 0033 6 12 34 56 78</code> gives <code>+447400123456</code> and <code>+33612345678</code>."
        ].join("\n");
        this.infoURL = "https://github.com/google/libphonenumber";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Default Region",
                type: "string",
                value: "GB"
            },
            {
                name: "Only Valid Numbers",
                type: "boolean",
                value: true
            },
            {
                name: "Output Format",
                type: "option",
                value: ["E.164", "As written", "International", "National"]
            },
            {
                name: "Display total",
                type: "boolean",
                value: false
            },
            {
                name: "Sort",
                type: "boolean",
                value: false
            },
            {
                name: "Unique",
                type: "boolean",
                value: false
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [regionArg, onlyValid, outputFormat, displayTotal, sort, unique] = args;
        const region = normaliseRegion(regionArg);

        const matches = findPhoneNumbersInText(input, {
            defaultCountry: region,
            leniency: onlyValid ? "VALID" : "POSSIBLE"
        });

        let results = matches.map(m => {
            switch (outputFormat) {
                case "As written": return input.slice(m.startsAt, m.endsAt);
                case "International": return m.number.formatInternational();
                case "National": return m.number.formatNational();
                default: return m.number.number;
            }
        });

        if (sort) results = results.sort(caseInsensitiveSort);
        if (unique) results = results.unique();

        if (displayTotal) {
            return `Total found: ${results.length}\n\n${results.join("\n")}`;
        }
        return results.join("\n");
    }

}

export default ExtractPhoneNumbers;
