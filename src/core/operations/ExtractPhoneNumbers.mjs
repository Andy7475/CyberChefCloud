/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { findPhoneNumbersInRegions, normaliseRegions, describeReading, fictionalRange } from "../lib/PhoneNumber.mjs";
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
            "<b>Regions:</b> two-letter country codes separated by commas, e.g. <code>GB</code> or <code>GB, FR</code>. Numbers are read as <code>Parse Phone Number</code> reads them with the same regions, but only numbers belonging to one of these regions are kept, whether written nationally (<code>07400 123456</code>) or internationally (<code>+44 7400 123456</code>, <code>0044 ...</code>). Leave blank to search every region: a nationally written number is then given once for each country where it is valid (e.g. <code>2 305 8333</code> fits Thailand, as <code>+6623058333</code>, and about 40 other countries). Searching every region is slower on long texts.",
            "<br>",
            "<b>Repair Common Errors:</b> also recognises international dialling prefixes not used by the regions (<code>00</code>, <code>011</code>, <code>0011</code>, <code>010</code>, <code>810</code>), e.g. <code>011 44 7400 123456</code> with GB. These are the prefixes <code>Parse Phone Number</code> tries. Whatever this setting, a missing leading 0 and a listed region&apos;s country code written without <code>+</code> are accepted, as libphonenumber reads numbers that way. Parse&apos;s other repair, adding a missing <code>+</code>, is not needed here: a number in the regions written with its country code but no <code>+</code> is already recognised. Has no effect when Regions is blank, as every region&apos;s prefix is then recognised. JSON output lists the repairs against each number.",
            "<br>",
            "<b>Only Valid Numbers:</b> when on, keeps only numbers in allocated ranges. Turn it off to also keep numbers that are the right length but unallocated (e.g. mistyped numbers); with Regions blank this gives many more candidates. Numbers in ranges reserved for fiction (Ofcom drama numbers such as <code>020 7946 0xxx</code> and <code>07700 900xxx</code>, North American 555-0100 to 0199) are always kept so they can be spotted: JSON output marks them <code>valid: false</code> with a note, and <b>Display total</b> lists them.",
            "<br>",
            "<b>Output Format:</b> <code>E.164</code> (e.g. <code>+447400123456</code>) is best for de-duplicating and chaining into <code>Parse Phone Number</code> or <code>GCloud Phone Business Lookup</code>. <code>As written</code> gives each piece of text once, however many regions it fits. <code>JSON</code> groups the matches by region code, with the text as written, its position, and the same fields as <code>Parse Phone Number</code> (formats, type, validity, repairs, notes); <b>Sort</b> orders the regions and numbers, <b>Unique</b> removes repeated numbers within a region and <b>Display total</b> is ignored.",
            "<br><br>",
            "<b>Example:</b> <code>Ring 07400 123456 or 0033 6 12 34 56 78</code> with Regions <code>GB, FR</code> gives <code>+447400123456</code> and <code>+33612345678</code>; with <code>GB</code> only the first."
        ].join("\n");
        this.infoURL = "https://github.com/google/libphonenumber";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Regions",
                type: "string",
                value: "GB"
            },
            {
                name: "Repair Common Errors",
                type: "boolean",
                value: true
            },
            {
                name: "Only Valid Numbers",
                type: "boolean",
                value: true
            },
            {
                name: "Output Format",
                type: "option",
                value: ["E.164", "As written", "International", "National", "JSON"]
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
     * Groups matches by region code for JSON output.
     *
     * @param {Object[]} matches - From findPhoneNumbersInRegions.
     * @param {boolean} sort - Order regions by code and numbers by E.164.
     * @param {boolean} unique - Remove repeated numbers within a region.
     * @returns {Object} {regionCode: {country, matches: [...]}}; non-geographic numbers are under "001".
     */
    groupByRegion(matches, sort, unique) {
        const groups = {};
        for (const m of matches) {
            const { country, countryName, ...fields } = describeReading(m.reading);
            const code = country || "001";
            if (!groups[code]) groups[code] = { country: countryName, matches: [] };
            const list = groups[code].matches;
            if (unique && list.some(x => x.e164 === fields.e164)) continue;
            list.push({ asWritten: m.asWritten, position: m.startsAt, ...fields });
        }
        if (!sort) return groups;

        const sorted = {};
        for (const code of Object.keys(groups).sort()) {
            groups[code].matches.sort((a, b) => a.e164.localeCompare(b.e164));
            sorted[code] = groups[code];
        }
        return sorted;
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [regionsArg, repair, onlyValid, outputFormat, displayTotal, sort, unique] = args;
        const regions = normaliseRegions(regionsArg);
        let matches = findPhoneNumbersInRegions(input, regions, { repair, onlyValid });

        if (outputFormat === "JSON") {
            return JSON.stringify(this.groupByRegion(matches, sort, unique), null, 2);
        }

        // One piece of text can fit several regions; write it out once
        if (outputFormat === "As written") {
            matches = matches.filter((m, i) => i === 0 || m.startsAt !== matches[i - 1].startsAt);
        }

        let results = matches.map(m => {
            const phone = m.reading.phone;
            switch (outputFormat) {
                case "As written": return m.asWritten;
                case "International": return phone.formatInternational();
                case "National": return phone.formatNational();
                default: return phone.number;
            }
        });

        if (sort) results = results.sort(caseInsensitiveSort);
        if (unique) results = results.unique();

        if (displayTotal) {
            const fictional = [...new Set(matches.map(m => m.reading.phone.number).filter(e164 => fictionalRange(e164)))];
            const fictionNote = fictional.length ? `\nReserved for fiction, not real lines: ${fictional.join(", ")}` : "";
            return `Total found: ${results.length}${fictionNote}\n\n${results.join("\n")}`;
        }
        return results.join("\n");
    }

}

export default ExtractPhoneNumbers;
