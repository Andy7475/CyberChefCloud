/**
 * Phone number parsing helpers built on libphonenumber-js (Google libphonenumber metadata).
 * Everything here runs offline: no number leaves the browser.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import { parsePhoneNumberFromString, findPhoneNumbersInText, getCountries, isSupportedCountry } from "libphonenumber-js/max";
import OperationError from "../errors/OperationError.mjs";

export { findPhoneNumbersInText };

/**
 * Human-readable labels for libphonenumber number types.
 */
const TYPE_NAMES = {
    MOBILE: "Mobile",
    FIXED_LINE: "Fixed line",
    FIXED_LINE_OR_MOBILE: "Fixed line or mobile",
    TOLL_FREE: "Toll free",
    PREMIUM_RATE: "Premium rate",
    SHARED_COST: "Shared cost",
    VOIP: "VoIP",
    PERSONAL_NUMBER: "Personal number",
    PAGER: "Pager",
    UAN: "UAN (company number)",
    VOICEMAIL: "Voicemail"
};

/**
 * Short codes libphonenumber-js does not cover. Keyed by region, "*" applies everywhere.
 */
const SHORT_CODES = {
    "*": {
        "112": "Emergency services (EU / international)",
        "911": "Emergency services (North America)"
    },
    "GB": {
        "999": "Emergency services",
        "101": "Police non-emergency",
        "111": "NHS non-urgent medical",
        "105": "Power cut line",
        "116123": "Samaritans"
    }
};

/**
 * International dialling (exit) prefixes tried when repairing numbers that lack a "+".
 * Longest first, so "0011" is tried before "00".
 */
const EXIT_PREFIXES = ["0011", "011", "010", "00"];

let regionNames = null;

/**
 * Returns the English name of an ISO 3166 region code, or the code itself if unavailable.
 *
 * @param {string} code
 * @returns {string}
 */
export function regionName(code) {
    if (!code) return "";
    try {
        if (!regionNames) regionNames = new Intl.DisplayNames(["en"], { type: "region" });
        return regionNames.of(code) || code;
    } catch (e) {
        return code;
    }
}

/**
 * Returns a readable label for a libphonenumber number type.
 *
 * @param {string|undefined} type
 * @returns {string}
 */
export function typeName(type) {
    return TYPE_NAMES[type] || "Unknown";
}

/**
 * Validates and upper-cases a default region argument. Blank means no default region.
 *
 * @param {string} region
 * @returns {string|undefined}
 * @throws {OperationError} if the region is not a supported ISO 3166 code
 */
export function normaliseRegion(region) {
    const code = (region || "").trim().toUpperCase();
    if (!code) return undefined;
    if (!isSupportedCountry(code)) {
        throw new OperationError(`Unknown default region "${region}". Use a two-letter ISO 3166 code such as GB, US or FR, or leave it blank.`);
    }
    return code;
}

/**
 * Parses a number, optionally trying common repairs when the direct parse is not valid.
 *
 * @param {string} raw - The number as written.
 * @param {string|undefined} region - Default region for national-format numbers.
 * @param {boolean} repair - Whether to try repairs.
 * @returns {{phone: Object|undefined, repairs: string[]}}
 */
export function parseWithRepair(raw, region, repair) {
    const repairs = [];
    let phone = parsePhoneNumberFromString(raw, region);
    const international = raw.trim().startsWith("+");
    const digits = raw.replace(/\D/g, "");

    if (repair && !international && !(phone && phone.isValid())) {
        const candidates = [];
        for (const prefix of EXIT_PREFIXES) {
            if (digits.startsWith(prefix)) {
                candidates.push(["+" + digits.slice(prefix.length), `Removed international dialling prefix ${prefix}`]);
            }
        }
        candidates.push(["+" + digits, "Added missing \"+\" (digits read as starting with a country code)"]);

        for (const [candidate, description] of candidates) {
            const fixed = parsePhoneNumberFromString(candidate);
            if (fixed && fixed.isValid()) {
                phone = fixed;
                repairs.push(description);
                break;
            }
        }
    }

    if (phone && !international && !repairs.length) {
        const nationalDigits = phone.formatNational().replace(/\D/g, "");
        if (digits === phone.countryCallingCode + phone.nationalNumber && !digits.startsWith("0")) {
            repairs.push(`Leading ${phone.countryCallingCode} read as the country code (no "+" written)`);
        } else if (nationalDigits === "0" + digits) {
            repairs.push("Leading 0 was missing (often stripped by spreadsheets)");
        }
    }

    return { phone, repairs };
}

/**
 * Luhn checksum test, used to spot IMEIs.
 *
 * @param {string} digits
 * @returns {boolean}
 */
function luhnValid(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let d = parseInt(digits[digits.length - 1 - i], 10);
        if (i % 2 === 1) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return sum % 10 === 0;
}

/**
 * Notes for inputs that look like short codes or other telecoms identifiers rather than phone numbers.
 *
 * @param {string} raw
 * @param {string|undefined} region
 * @returns {string[]}
 */
function identifierNotes(raw, region) {
    const notes = [];
    const digits = raw.replace(/\D/g, "");
    const shortCode = (SHORT_CODES[region] || {})[digits] || SHORT_CODES["*"][digits];
    if (shortCode && !raw.trim().startsWith("+")) {
        notes.push(`Short code: ${shortCode}`);
    } else if (region === "GB" && /^118\d{3}$/.test(digits)) {
        notes.push("Short code: directory enquiries");
    }
    if (digits.length === 15) {
        if (luhnValid(digits)) notes.push("15 digits passing the Luhn check: possibly an IMEI (handset ID), not a phone number");
        notes.push(`15 digits: possibly an IMSI (SIM ID); if so the mobile country code is ${digits.slice(0, 3)}`);
    } else if (/^89\d{16,18}$/.test(digits)) {
        notes.push("Starts with 89 and is 18-20 digits: possibly a SIM ICCID, not a phone number");
    }
    return notes;
}

/**
 * Lists the other regions in which a national-format number would also be valid.
 *
 * @param {string} raw
 * @param {string|undefined} exclude - Region to leave out (usually the one already reported).
 * @returns {string[]}
 */
export function otherMatchingRegions(raw, exclude) {
    return getCountries().filter(cc => {
        if (cc === exclude) return false;
        const p = parsePhoneNumberFromString(raw, cc);
        return p && p.country === cc && p.isValid();
    });
}

/**
 * Analyses one phone number string.
 *
 * @param {string} raw - The number as written.
 * @param {string|undefined} region - Default region.
 * @param {Object} [options]
 * @param {boolean} [options.repair=true] - Try common repairs.
 * @param {boolean} [options.otherRegions=false] - List other regions where a national-format number is valid.
 *      Always done for national-format numbers that are not valid in the default region.
 * @returns {Object} Analysis record.
 */
export function analysePhoneNumber(raw, region, { repair = true, otherRegions = false } = {}) {
    const { phone, repairs } = parseWithRepair(raw, region, repair);
    const valid = !!(phone && phone.isValid());
    const record = {
        input: raw,
        valid,
        possible: !!(phone && phone.isPossible()),
        e164: valid ? phone.number : "",
        country: valid && phone.country ? phone.country : "",
        countryName: valid && phone.country ? regionName(phone.country) : "",
        callingCode: phone ? "+" + phone.countryCallingCode : "",
        type: valid ? typeName(phone.getType()) : "",
        national: valid ? phone.formatNational() : "",
        international: valid ? phone.formatInternational() : "",
        extension: phone && phone.ext ? phone.ext : "",
        repairs,
        notes: valid ? [] : identifierNotes(raw, region),
        otherRegions: []
    };

    const writtenNationally = !raw.trim().startsWith("+") && !repairs.some(r => r.includes("\"+\"") || r.includes("dialling prefix"));
    if (writtenNationally && (otherRegions || !valid)) {
        record.otherRegions = otherMatchingRegions(raw, record.country);
    }
    return record;
}
