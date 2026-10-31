/**
 * Phone number parsing helpers built on libphonenumber-js (Google libphonenumber metadata).
 * Everything here runs offline: no number leaves the browser.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import { parsePhoneNumberFromString, findPhoneNumbersInText, getCountries, getCountryCallingCode, isSupportedCountry } from "libphonenumber-js/max";
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
 * Ranges reserved for fiction (TV, radio, films, books), which libphonenumber mostly treats as valid.
 * Matched against E.164.
 */
const FICTIONAL_RANGES = [
    {
        // Ofcom drama numbers: 0113-0118, 0121, 0131, 0141, 0151, 0161 496 0xxx; 0191 498 0xxx; 020 7946 0xxx;
        // 028 9649 6xxx; 029 2018 0xxx; 01632 960xxx; 07700 900xxx; 08081 570xxx; 0909 879 0xxx; 03069 990xxx
        pattern: /^\+44(?:1(?:1[3-8]|[2-6]1)4960|1914980|2079460|2896496|2920180|1632960|7700900|8081570|9098790|3069990)\d{3}$/,
        region: "GB",
        note: "Ofcom drama number: reserved for TV and radio drama, never allocated to a real line"
    },
    {
        // NANP 555-0100 to 555-0199
        pattern: /^\+1[2-9]\d{2}55501\d{2}$/,
        region: "",
        note: "Fictional number: 555-0100 to 555-0199 is reserved for fiction in North America, never allocated to a real line"
    }
];

/**
 * Returns the fictional range an E.164 number falls in, if any.
 *
 * @param {string} e164
 * @returns {{region: string, note: string}|undefined}
 */
export function fictionalRange(e164) {
    return FICTIONAL_RANGES.find(r => r.pattern.test(e164 || ""));
}

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
 * Regions whose international dialling (exit) prefixes are tried as a repair: 00 (most of the world), 011 (North
 * America), 0011 (Australia), 010 (Japan) and 810 (Russia). Parsing with one of these as the default region
 * recognises its prefix.
 */
const REPAIR_PREFIX_REGIONS = ["GB", "US", "AU", "JP", "RU"];

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
 * Parses a list of region codes separated by commas, semicolons or whitespace. Blank means every region.
 *
 * @param {string} regions - e.g. "gb, th".
 * @returns {string[]} Upper-cased, de-duplicated codes; empty for every region.
 * @throws {OperationError} if any code is not a supported ISO 3166 code
 */
export function normaliseRegions(regions) {
    const codes = [...new Set((regions || "").split(/[\s,;]+/).map(c => c.toUpperCase()).filter(c => c))];
    const unknown = codes.filter(c => !isSupportedCountry(c));
    if (unknown.length) {
        throw new OperationError(`Unknown region${unknown.length > 1 ? "s" : ""} ${unknown.map(c => `"${c}"`).join(", ")}. Use two-letter ISO 3166 codes such as GB, US or FR, separated by commas, or leave blank for all regions.`);
    }
    return codes;
}

/**
 * Whether a parsed number is valid or in a range reserved for fiction; either way it is reported in full.
 *
 * @param {Object|undefined} phone - libphonenumber PhoneNumber.
 * @returns {boolean}
 */
function isKnown(phone) {
    return !!(phone && (phone.isValid() || fictionalRange(phone.number)));
}

/**
 * The region a parsed number belongs to: its country, the region of its fictional range, or for an unallocated
 * number the region it was read in if that shares its calling code. "" if none is known (e.g. non-geographic).
 *
 * @param {Object} phone - libphonenumber PhoneNumber.
 * @param {string} [readIn] - The default region it was parsed with.
 * @returns {string}
 */
export function numberRegion(phone, readIn) {
    return phone.country || fictionalRange(phone.number)?.region ||
        (readIn && phone.countryCallingCode === getCountryCallingCode(readIn) ? readIn : "");
}

/**
 * Whether a number parsed with a default region was read through an international dialling prefix
 * (its country code is not the default region's).
 *
 * @param {Object} phone - libphonenumber PhoneNumber.
 * @param {string} readIn - The default region it was parsed with.
 * @returns {boolean}
 */
function readViaPrefix(phone, readIn) {
    return phone.countryCallingCode !== getCountryCallingCode(readIn);
}

/**
 * Notes on how a nationally written number was read: a leading country code with no "+", or a missing leading 0.
 * These are part of normal parsing, not optional repairs, but are listed so they can be checked.
 *
 * @param {string} raw - The number as written.
 * @param {Object} phone - libphonenumber PhoneNumber.
 * @returns {string[]}
 */
function inferredRepairs(raw, phone) {
    const digits = raw.replace(/\D/g, "");
    if (digits === phone.countryCallingCode + phone.nationalNumber && !digits.startsWith("0")) {
        return [`Leading ${phone.countryCallingCode} read as the country code (no "+" written)`];
    }
    if (phone.formatNational().replace(/\D/g, "") === "0" + digits) {
        return ["Leading 0 was missing (often stripped by spreadsheets)"];
    }
    return [];
}

/**
 * Describes a number read through an international dialling prefix that none of the searched regions use.
 *
 * @param {string} raw - The number as written.
 * @param {Object} phone - libphonenumber PhoneNumber.
 * @returns {string}
 */
function prefixRepair(raw, phone) {
    const digits = raw.replace(/\D/g, "");
    const at = digits.indexOf(phone.countryCallingCode + phone.nationalNumber);
    return at > 0 ? `Removed international dialling prefix ${digits.slice(0, at)}` : "Removed an international dialling prefix";
}

/**
 * Repairs for a number written without "+" that has no reading in the searched regions: an international
 * dialling prefix from REPAIR_PREFIX_REGIONS, or failing that a missing "+".
 *
 * @param {string} raw - The number as written.
 * @returns {{phone: Object, region: string, repairs: string[]}[]}
 */
function internationalRepairs(raw) {
    const found = new Map();
    for (const cc of REPAIR_PREFIX_REGIONS) {
        const phone = parsePhoneNumberFromString(raw, cc);
        if (!isKnown(phone) || !readViaPrefix(phone, cc) || found.has(phone.number)) continue;
        found.set(phone.number, { phone, region: numberRegion(phone), repairs: [prefixRepair(raw, phone)] });
    }
    if (!found.size) {
        const phone = parsePhoneNumberFromString("+" + raw.replace(/\D/g, ""));
        if (isKnown(phone)) {
            found.set(phone.number, { phone, region: numberRegion(phone), repairs: ["Added missing \"+\" (digits read as starting with a country code)"] });
        }
    }
    return [...found.values()];
}

/**
 * Parses a number in a single default region, optionally trying common repairs when the direct parse is not valid.
 *
 * @param {string} raw - The number as written.
 * @param {string|undefined} region - Default region for national-format numbers.
 * @param {boolean} repair - Whether to try repairs.
 * @returns {{phone: Object|undefined, repairs: string[]}}
 */
export function parseWithRepair(raw, region, repair) {
    const phone = parsePhoneNumberFromString(raw, region);
    if (raw.trim().startsWith("+")) return { phone, repairs: [] };
    if (isKnown(phone)) return { phone, repairs: inferredRepairs(raw, phone) };
    const repaired = repair ? internationalRepairs(raw)[0] : undefined;
    return repaired ? { phone: repaired.phone, repairs: repaired.repairs } : { phone, repairs: [] };
}

/**
 * Reads a number in each of the given regions. A number written with "+", or with the international dialling
 * prefix of a region searched, has one reading whatever its country. A nationally written number gets one reading
 * for each searched region it is valid in. With repair on and no reading found, common repairs are tried.
 *
 * @param {string} raw - The number as written.
 * @param {string[]} regions - ISO 3166 codes; empty means every region.
 * @param {boolean} repair - Whether to try repairs.
 * @returns {{phone: Object, region: string, repairs: string[]}[]} Readings, in region order.
 */
export function readPhoneNumber(raw, regions, repair) {
    if (raw.trim().startsWith("+")) {
        const phone = parsePhoneNumberFromString(raw);
        return isKnown(phone) ? [{ phone, region: numberRegion(phone), repairs: [] }] : [];
    }

    const readings = new Map();
    for (const cc of regions.length ? regions : getCountries()) {
        const phone = parsePhoneNumberFromString(raw, cc);
        if (!isKnown(phone) || readings.has(phone.number)) continue;
        const viaPrefix = readViaPrefix(phone, cc);
        const region = numberRegion(phone, cc);
        if (!viaPrefix && regions.length && !regions.includes(region)) continue;
        readings.set(phone.number, { phone, region, repairs: viaPrefix ? [] : inferredRepairs(raw, phone) });
    }
    if (!readings.size && repair) return internationalRepairs(raw);
    // Listed regions keep the user's order; with every region searched, order by region code
    const found = [...readings.values()];
    return regions.length ? found : found.sort((a, b) => a.region.localeCompare(b.region));
}

/**
 * The fields reported for one reading of a number, shared by Parse Phone Number and Extract Phone Numbers.
 *
 * @param {{phone: Object, region: string, repairs: string[]}} reading
 * @returns {Object}
 */
export function describeReading({ phone, region, repairs }) {
    const fictional = fictionalRange(phone.number);
    const allocated = phone.isValid();
    return {
        e164: phone.number,
        country: region,
        countryName: region ? regionName(region) : "Non-geographic",
        callingCode: "+" + phone.countryCallingCode,
        type: allocated ? typeName(phone.getType()) : "",
        national: phone.formatNational(),
        international: phone.formatInternational(),
        extension: phone.ext || "",
        valid: allocated && !fictional,
        repairs,
        notes: fictional ? [fictional.note] : []
    };
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
 * @param {string[]} regions - Empty means every region.
 * @returns {string[]}
 */
function identifierNotes(raw, regions) {
    const notes = [];
    const digits = raw.replace(/\D/g, "");
    if (!raw.trim().startsWith("+")) {
        // Name the region only when more than one was searched
        const label = cc => regions.length === 1 ? "" : ` (${cc})`;
        const shortCodeRegions = regions.length ? regions : Object.keys(SHORT_CODES).filter(k => k !== "*");
        for (const cc of shortCodeRegions) {
            if (SHORT_CODES[cc]?.[digits]) notes.push(`Short code${label(cc)}: ${SHORT_CODES[cc][digits]}`);
            else if (cc === "GB" && /^118\d{3}$/.test(digits)) notes.push(`Short code${label(cc)}: directory enquiries`);
        }
        if (!notes.length && SHORT_CODES["*"][digits]) notes.push(`Short code: ${SHORT_CODES["*"][digits]}`);
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
 * @param {string[]} exclude - Regions to leave out (those already searched or reported).
 * @returns {string[]}
 */
export function otherMatchingRegions(raw, exclude) {
    return getCountries().filter(cc => {
        if (exclude.includes(cc)) return false;
        const p = parsePhoneNumberFromString(raw, cc);
        return p && p.country === cc && p.isValid();
    });
}

/**
 * Finds phone numbers in text that belong to any of the given regions, however they are written.
 * A nationally written number valid in several regions is returned once per region.
 *
 * @param {string} text
 * @param {string[]} regions - ISO 3166 codes; empty means every region.
 * @param {Object} options
 * @param {boolean} options.repair - Also recognise the international dialling prefixes of REPAIR_PREFIX_REGIONS.
 * @param {boolean} options.onlyValid - Keep only numbers in allocated ranges, plus numbers in ranges reserved for
 *      fiction so they can be flagged. Otherwise also keep unallocated numbers of a possible length.
 * @returns {Object[]} Matches ({startsAt, endsAt, asWritten, reading}) ordered by position, then region;
 *      reading is as returned by readPhoneNumber.
 */
export function findPhoneNumbersInRegions(text, regions, { repair, onlyValid }) {
    const searched = regions.length ? regions : getCountries();
    const extra = repair && regions.length ? REPAIR_PREFIX_REGIONS.filter(cc => !regions.includes(cc)) : [];
    const seen = new Set();
    const matches = [];
    // libphonenumber-js runs numbers separated by commas or semicolons together (e.g. reads "+33 6 12 34 56 78, 7400"
    // as one number) but handles line breaks; same-length replacement keeps match positions valid for the original
    const separated = text.replace(/[,;|\t]/g, "\n");

    for (const cc of [...searched, ...extra]) {
        const isRepair = !searched.includes(cc);
        for (const m of findPhoneNumbersInText(separated, { defaultCountry: cc, leniency: "POSSIBLE" })) {
            const phone = m.number;
            const key = `${m.startsAt}:${phone.number}`;
            if (seen.has(key)) continue;
            if (onlyValid && !isKnown(phone)) {
                seen.add(key);
                continue;
            }
            const region = numberRegion(phone, cc);
            if (regions.length && !regions.includes(region)) continue;
            // A repair region only contributes numbers read through its international prefix
            const viaPrefix = readViaPrefix(phone, cc);
            if (isRepair && !viaPrefix) continue;
            seen.add(key);
            const asWritten = text.slice(m.startsAt, m.endsAt);
            const repairs = isRepair ? [prefixRepair(asWritten, phone)] : viaPrefix ? [] : inferredRepairs(asWritten, phone);
            matches.push({ startsAt: m.startsAt, endsAt: m.endsAt, asWritten, reading: { phone, region, repairs } });
        }
    }

    // Drop fragments of a longer number that some region's short numbers happen to fit (e.g. "8333" in "2 305 8333")
    const longest = matches.filter(m => !matches.some(n =>
        n.startsAt <= m.startsAt && n.endsAt >= m.endsAt && n.endsAt - n.startsAt > m.endsAt - m.startsAt));
    return longest.sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Analyses one phone number string.
 *
 * @param {string} raw - The number as written.
 * @param {string[]} regions - ISO 3166 codes to read nationally written numbers in; empty means every region.
 * @param {Object} [options]
 * @param {boolean} [options.repair=true] - Try common repairs.
 * @param {boolean} [options.otherRegions=false] - List regions outside `regions` where a nationally written number
 *      is valid. Always done for such numbers that have no reading in `regions`.
 * @returns {Object} Analysis record: line-level fields plus one entry in `readings` per reading.
 */
export function analysePhoneNumber(raw, regions, { repair = true, otherRegions = false } = {}) {
    const readings = readPhoneNumber(raw, regions, repair).map(describeReading);
    const international = raw.trim().startsWith("+");

    // Length check for numbers with no reading, where a single calling code applies
    const single = international ? parsePhoneNumberFromString(raw) :
        regions.length === 1 ? parsePhoneNumberFromString(raw, regions[0]) : undefined;

    const record = {
        input: raw,
        valid: readings.some(r => r.valid),
        possible: readings.length > 0 || !!(single && single.isPossible()),
        callingCode: single && !readings.length ? "+" + single.countryCallingCode : "",
        readings,
        notes: readings.length ? [] : identifierNotes(raw, regions),
        otherRegions: []
    };

    if (!international && regions.length && (otherRegions || !readings.length)) {
        record.otherRegions = otherMatchingRegions(raw, [...regions, ...readings.map(r => r.country)]);
    }
    return record;
}
