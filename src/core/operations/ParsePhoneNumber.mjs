/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { analysePhoneNumber, normaliseRegion } from "../lib/PhoneNumber.mjs";

/**
 * Quotes a value for CSV output.
 *
 * @param {string} value
 * @returns {string}
 */
function csvField(value) {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

/**
 * Parse Phone Number operation
 */
class ParsePhoneNumber extends Operation {

    /**
     * ParsePhoneNumber constructor
     */
    constructor() {
        super();

        this.name = "Parse Phone Number";
        this.module = "PhoneNumber";
        this.description = [
            "Parses phone numbers (one per line) offline using Google&apos;s libphonenumber metadata and reports the country, number type (mobile, fixed line, VoIP, premium rate, personal number, etc.), validity and standard formats.",
            "<br><br>",
            "<b>Default Region:</b> the two-letter country code assumed for numbers written without an international prefix, e.g. <code>GB</code> reads <code>07400 123456</code> as a UK mobile. Leave blank to accept only international numbers.",
            "<br>",
            "<b>Repair Common Errors:</b> when a number is not valid as written, tries removing an international dialling prefix (<code>00</code>, <code>011</code>, <code>0011</code>, <code>010</code>) or adding a missing <code>+</code>. Repairs, and inferences such as a missing leading 0, are listed against the number so they can be checked.",
            "<br>",
            "<b>List Other Matching Regions:</b> for numbers written without a country code, lists the other countries whose numbering plans the number also fits. This shows how ambiguous the number is; it does not mean the number is in use there. The list is always given for such numbers when they are not valid in the default region.",
            "<br><br>",
            "Validity means the number falls in an allocated range; it does not show that the number is in service, and the country is where the range was allocated, not where the phone is. Mobile numbers can be ported between networks.",
            "<br><br>",
            "Also flags short codes (e.g. 999, 101) and 15-digit values that may be IMEIs or IMSIs.",
            "<br><br>",
            "<b>Example:</b> <code>447400123456</code> with default region GB gives <code>+447400123456</code>, United Kingdom, Mobile."
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
                name: "Repair Common Errors",
                type: "boolean",
                value: true
            },
            {
                name: "List Other Matching Regions",
                type: "boolean",
                value: false
            },
            {
                name: "Output Format",
                type: "option",
                value: ["Text Summary", "CSV", "JSON"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [regionArg, repair, otherRegions, outputFormat] = args;
        const region = normaliseRegion(regionArg);

        const lines = input.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (!lines.length) return "";

        const records = lines.map(line => analysePhoneNumber(line, region, { repair, otherRegions }));

        if (outputFormat === "JSON") {
            return JSON.stringify(records, null, 2);
        }

        if (outputFormat === "CSV") {
            const header = ["Input", "E.164", "Valid", "Possible", "Country Code", "Country", "Calling Code", "Type",
                            "National Format", "International Format", "Extension", "Repairs", "Notes", "Other Matching Regions"];
            const rows = records.map(r => [
                r.input, r.e164, r.valid, r.possible, r.country, r.countryName, r.callingCode, r.type,
                r.national, r.international, r.extension, r.repairs.join("; "), r.notes.join("; "), r.otherRegions.join(" ")
            ].map(csvField).join(","));
            return [header.join(","), ...rows].join("\n");
        }

        return records.map(r => {
            const out = [r.input];
            if (r.valid) {
                out.push(`  E.164:          ${r.e164}`);
                out.push(`  Country:        ${r.countryName || "Non-geographic"} (${r.country ? r.country + ", " : ""}${r.callingCode})`);
                out.push(`  Type:           ${r.type}`);
                out.push(`  National:       ${r.national}`);
                out.push(`  International:  ${r.international}`);
                if (r.extension) out.push(`  Extension:      ${r.extension}`);
            } else {
                out.push(`  Not a valid number${r.possible ? ` (right length for ${r.callingCode}, but not in an allocated range)` : ""}`);
                if (r.otherRegions.length) out.push(`  Valid in:       ${r.otherRegions.join(", ")}`);
            }
            for (const repairNote of r.repairs) out.push(`  Repair:         ${repairNote}`);
            for (const note of r.notes) out.push(`  Note:           ${note}`);
            if (r.valid && r.otherRegions.length) out.push(`  Also fits:      ${r.otherRegions.join(", ")}`);
            return out.join("\n");
        }).join("\n\n");
    }

}

export default ParsePhoneNumber;
