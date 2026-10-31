/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { analysePhoneNumber, normaliseRegions } from "../lib/PhoneNumber.mjs";

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
            "<b>Regions:</b> two-letter country codes separated by commas, e.g. <code>GB</code> or <code>GB, FR</code>. A number written without a country code is read as a national number of each listed region, and every region it is valid in is reported (e.g. <code>07400 123456</code> with GB is a UK mobile). Leave blank to try every region: an ambiguous number such as <code>2 305 8333</code> then gets a reading for each of about 40 countries, one of which is Thailand (<code>+6623058333</code>). Numbers written with <code>+</code>, or with the international dialling prefix of a listed region (e.g. <code>00</code> for GB), are read by their own country code whatever the regions. Every line is reported; <code>Extract Phone Numbers</code> instead drops numbers outside its regions.",
            "<br>",
            "<b>Repair Common Errors:</b> when a number written without <code>+</code> has no reading in the regions, tries removing an international dialling prefix used elsewhere (<code>00</code>, <code>011</code>, <code>0011</code>, <code>010</code>, <code>810</code>) and, failing that, adding a missing <code>+</code>. Whatever this setting, a missing leading 0 (<code>7400 123456</code>) and a listed region&apos;s country code written without <code>+</code> (<code>447400123456</code>) are accepted, as libphonenumber reads numbers that way. All of these are listed as repairs against the number so they can be checked.",
            "<br>",
            "<b>List Other Matching Regions:</b> for numbers written without a country code, lists countries outside the regions whose numbering plans the number also fits. This shows how ambiguous the number is; it does not mean the number is in use there. The list is always given when the number has no reading in the regions. Not used when Regions is blank.",
            "<br><br>",
            "Validity means the number falls in an allocated range; it does not show that the number is in service, and the country is where the range was allocated, not where the phone is. Mobile numbers can be ported between networks.",
            "<br><br>",
            "Also flags short codes (e.g. 999, 101), 15-digit values that may be IMEIs or IMSIs, and numbers reserved for fiction (Ofcom drama numbers such as <code>020 7946 0xxx</code> and <code>07700 900xxx</code>, North American 555-0100 to 0199), which are reported as not valid.",
            "<br><br>",
            "<b>Example:</b> <code>447400123456</code> with region GB gives <code>+447400123456</code>, United Kingdom, Mobile."
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
     * Text summary lines for a number with a single reading.
     *
     * @param {Object} r - Reading from describeReading.
     * @returns {string[]}
     */
    describeReading(r) {
        const out = [];
        if (!r.valid) out.push("  Valid:          No (see note)");
        out.push(`  E.164:          ${r.e164}`);
        out.push(`  Country:        ${r.countryName} (${r.country ? r.country + ", " : ""}${r.callingCode})`);
        if (r.type) out.push(`  Type:           ${r.type}`);
        out.push(`  National:       ${r.national}`);
        out.push(`  International:  ${r.international}`);
        if (r.extension) out.push(`  Extension:      ${r.extension}`);
        for (const repair of r.repairs) out.push(`  Repair:         ${repair}`);
        for (const note of r.notes) out.push(`  Note:           ${note}`);
        return out;
    }

    /**
     * Text summary lines for a number with several readings (a national number that fits several regions).
     * Repairs common to every reading are listed once; others are given against their reading.
     *
     * @param {Object[]} readings - Readings from describeReading.
     * @returns {string[]}
     */
    describeReadings(readings) {
        const common = readings[0].repairs.filter(repair => readings.every(r => r.repairs.includes(repair)));
        const out = [`  Fits ${readings.length} regions (no country code was written):`];
        for (const r of readings) {
            // Shortened (explanations in brackets dropped) to keep one line per reading
            const repairs = r.repairs.filter(x => !common.includes(x)).map(x => x.replace(/ \(.*\)$/, ""));
            const details = [r.type, r.valid ? "" : "not valid", ...repairs, ...r.notes];
            out.push(`    ${r.e164.padEnd(16)} ${r.countryName} (${r.country || r.callingCode})${details.filter(d => d).map(d => ", " + d).join("")}`);
        }
        for (const repair of common) out.push(`  Repair:         ${repair}`);
        return out;
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [regionsArg, repair, otherRegions, outputFormat] = args;
        const regions = normaliseRegions(regionsArg);

        const lines = input.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (!lines.length) return "";

        const records = lines.map(line => analysePhoneNumber(line, regions, { repair, otherRegions }));

        if (outputFormat === "JSON") {
            return JSON.stringify(records, null, 2);
        }

        if (outputFormat === "CSV") {
            // One row per reading; a number with no reading gets one row
            const header = ["Input", "E.164", "Valid", "Possible", "Country Code", "Country", "Calling Code", "Type",
                            "National Format", "International Format", "Extension", "Repairs", "Notes", "Other Matching Regions"];
            const rows = records.flatMap(rec => {
                const other = rec.otherRegions.join(" ");
                if (!rec.readings.length) {
                    return [[rec.input, "", false, rec.possible, "", "", rec.callingCode, "", "", "", "", "", rec.notes.join("; "), other]];
                }
                return rec.readings.map(r => [
                    rec.input, r.e164, r.valid, rec.possible, r.country, r.countryName, r.callingCode, r.type,
                    r.national, r.international, r.extension, r.repairs.join("; "), r.notes.join("; "), other
                ]);
            });
            return [header.join(","), ...rows.map(row => row.map(csvField).join(","))].join("\n");
        }

        return records.map(rec => {
            const out = [rec.input];
            if (rec.readings.length === 1) {
                out.push(...this.describeReading(rec.readings[0]));
            } else if (rec.readings.length > 1) {
                out.push(...this.describeReadings(rec.readings));
            } else {
                out.push(`  Not a valid number${rec.possible && rec.callingCode ? ` (right length for ${rec.callingCode}, but not in an allocated range)` : ""}`);
                if (rec.otherRegions.length) out.push(`  Valid in:       ${rec.otherRegions.join(", ")}`);
            }
            for (const note of rec.notes) out.push(`  Note:           ${note}`);
            if (rec.readings.length && rec.otherRegions.length) out.push(`  Also fits:      ${rec.otherRegions.join(", ")}`);
            return out.join("\n");
        }).join("\n\n");
    }

}

export default ParsePhoneNumber;
