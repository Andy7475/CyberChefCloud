/**
 * Phone number operation tests.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */
import TestRegister from "../../lib/TestRegister.mjs";

const EXTRACT_TEXT = "Ring 07400 123456 / 0207 323 8000, alt 01632 960123, foreign 0033 6 12 34 56 78, again +447400123456";

TestRegister.addTests([
    {
        name: "Parse Phone Number: repairs, types, short codes and IMEIs",
        input: "447400123456\n7400123456\n011 44 7400 123456\n07012345678\n999\n490154203237518",
        expectedOutput: [
            "447400123456",
            "  E.164:          +447400123456",
            "  Country:        United Kingdom (GB, +44)",
            "  Type:           Mobile",
            "  National:       07400 123456",
            "  International:  +44 7400 123456",
            "  Repair:         Leading 44 read as the country code (no \"+\" written)",
            "",
            "7400123456",
            "  E.164:          +447400123456",
            "  Country:        United Kingdom (GB, +44)",
            "  Type:           Mobile",
            "  National:       07400 123456",
            "  International:  +44 7400 123456",
            "  Repair:         Leading 0 was missing (often stripped by spreadsheets)",
            "",
            "011 44 7400 123456",
            "  E.164:          +447400123456",
            "  Country:        United Kingdom (GB, +44)",
            "  Type:           Mobile",
            "  National:       07400 123456",
            "  International:  +44 7400 123456",
            "  Repair:         Removed international dialling prefix 011",
            "",
            "07012345678",
            "  E.164:          +447012345678",
            "  Country:        United Kingdom (GB, +44)",
            "  Type:           Personal number",
            "  National:       070 1234 5678",
            "  International:  +44 70 1234 5678",
            "",
            "999",
            "  Not a valid number",
            "  Note:           Short code: Emergency services",
            "",
            "490154203237518",
            "  Not a valid number",
            "  Note:           15 digits passing the Luhn check: possibly an IMEI (handset ID), not a phone number",
            "  Note:           15 digits: possibly an IMSI (SIM ID); if so the mobile country code is 490"
        ].join("\n"),
        recipeConfig: [{ op: "Parse Phone Number", args: ["GB", true, false, "Text Summary"] }]
    },
    {
        name: "Parse Phone Number: CSV lists other regions for a number invalid in the default region",
        input: "0612345678\n+33 6 12 34 56 78",
        expectedOutput: [
            "Input,E.164,Valid,Possible,Country Code,Country,Calling Code,Type,National Format,International Format,Extension,Repairs,Notes,Other Matching Regions",
            "0612345678,,false,true,,,+44,,,,,,,AF CH DE DZ FI FR HU ID IT JP KE KG KR LY MA MC NA NL PK PY RS SE SO TH TW TZ UA ZA",
            "+33 6 12 34 56 78,+33612345678,true,true,FR,France,+33,Mobile,06 12 34 56 78,+33 6 12 34 56 78,,,,"
        ].join("\n"),
        recipeConfig: [{ op: "Parse Phone Number", args: ["GB", true, false, "CSV"] }]
    },
    {
        name: "Parse Phone Number: JSON with blank regions",
        input: "+1 650 253 0000",
        expectedOutput: JSON.stringify([{
            input: "+1 650 253 0000",
            valid: true,
            possible: true,
            callingCode: "",
            readings: [{
                e164: "+16502530000",
                country: "US",
                countryName: "United States",
                callingCode: "+1",
                type: "Fixed line or mobile",
                national: "(650) 253-0000",
                international: "+1 650 253 0000",
                extension: "",
                valid: true,
                repairs: [],
                notes: []
            }],
            notes: [],
            otherRegions: []
        }], null, 2),
        recipeConfig: [{ op: "Parse Phone Number", args: ["", true, false, "JSON"] }]
    },
    {
        name: "Parse Phone Number: drama numbers are not valid and get a note",
        input: "020 7946 0123",
        expectedOutput: [
            "020 7946 0123",
            "  Valid:          No (see note)",
            "  E.164:          +442079460123",
            "  Country:        United Kingdom (GB, +44)",
            "  Type:           Fixed line",
            "  National:       020 7946 0123",
            "  International:  +44 20 7946 0123",
            "  Note:           Ofcom drama number: reserved for TV and radio drama, never allocated to a real line"
        ].join("\n"),
        recipeConfig: [{ op: "Parse Phone Number", args: ["GB", true, false, "Text Summary"] }]
    },
    {
        name: "Parse Phone Number: unknown region",
        input: "07400 123456",
        expectedOutput: "Unknown region \"ZZ\". Use two-letter ISO 3166 codes such as GB, US or FR, separated by commas, or leave blank for all regions.",
        recipeConfig: [{ op: "Parse Phone Number", args: ["ZZ", true, false, "Text Summary"] }]
    },
    {
        name: "Extract Phone Numbers: valid, E.164, unique, total, keeps and counts drama numbers",
        input: EXTRACT_TEXT,
        expectedOutput: "Total found: 3\nReserved for fiction, not real lines: +441632960123\n\n+447400123456\n+442073238000\n+441632960123",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB", true, true, "E.164", true, false, true] }]
    },
    {
        name: "Extract Phone Numbers: possible, as written, region limits international numbers too",
        input: EXTRACT_TEXT,
        expectedOutput: "07400 123456\n0207 323 8000\n01632 960123\n+447400123456",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB", true, false, "As written", false, false, false] }]
    },
    {
        name: "Extract Phone Numbers: region list, whitespace and case ignored",
        input: EXTRACT_TEXT,
        expectedOutput: "+447400123456\n+442073238000\n+441632960123\n+33612345678",
        recipeConfig: [{ op: "Extract Phone Numbers", args: [" gb ;fr ", true, true, "E.164", false, false, true] }]
    },
    {
        name: "Extract Phone Numbers: unknown regions",
        input: EXTRACT_TEXT,
        expectedOutput: "Unknown regions \"XX\", \"ZZ\". Use two-letter ISO 3166 codes such as GB, US or FR, separated by commas, or leave blank for all regions.",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB, XX, zz", true, true, "E.164", false, false, false] }]
    },
    {
        name: "Extract Phone Numbers: JSON keyed by region, fiction flagged",
        input: "Bangkok 2 305 8333, US 202 555 0143",
        expectedOutput: JSON.stringify({
            TH: { country: "Thailand", matches: [{
                asWritten: "2 305 8333", position: 8, e164: "+6623058333", callingCode: "+66", type: "Fixed line",
                national: "02 305 8333", international: "+66 2 305 8333", extension: "", valid: true,
                repairs: ["Leading 0 was missing (often stripped by spreadsheets)"], notes: []
            }] },
            US: { country: "United States", matches: [{
                asWritten: "202 555 0143", position: 23, e164: "+12025550143", callingCode: "+1", type: "Fixed line or mobile",
                national: "(202) 555-0143", international: "+1 202 555 0143", extension: "", valid: false, repairs: [],
                notes: ["Fictional number: 555-0100 to 555-0199 is reserved for fiction in North America, never allocated to a real line"]
            }] }
        }, null, 2),
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["th, us", true, true, "JSON", false, false, false] }]
    },
    {
        name: "Extract Phone Numbers: blank region finds national numbers, once per span",
        input: "Embassy 2 305 8333 or +44 20 7008 1500",
        expectedOutput: "2 305 8333\n+44 20 7008 1500",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["", true, true, "As written", false, false, false] }]
    },
    {
        name: "Extract Phone Numbers: blank region gives the number for each region it is valid in",
        input: "Embassy 2 305 8333",
        expectedOutput: "+6623058333",
        recipeConfig: [
            { op: "Extract Phone Numbers", args: ["", true, true, "E.164", false, false, false] },
            { op: "Regular expression", args: ["User defined", "^\\+66\\d+$", false, true, false, false, false, false, "List matches"] }
        ]
    },
    {
        name: "Parse Phone Number: several regions, one reading per region the number fits",
        input: "2 305 8333\n0612345678",
        expectedOutput: [
            "2 305 8333",
            "  Fits 2 regions (no country code was written):",
            "    +6623058333      Thailand (TH), Fixed line",
            "    +4923058333      Germany (DE), Fixed line",
            "  Repair:         Leading 0 was missing (often stripped by spreadsheets)",
            "",
            "0612345678",
            "  Fits 2 regions (no country code was written):",
            "    +66612345678     Thailand (TH), Mobile",
            "    +49612345678     Germany (DE), Fixed line"
        ].join("\n"),
        recipeConfig: [{ op: "Parse Phone Number", args: ["th, gb, de", true, false, "Text Summary"] }]
    },
    {
        name: "Parse Phone Number: repair is off, foreign exit prefix not read",
        input: "011 44 7400 123456",
        expectedOutput: [
            "011 44 7400 123456",
            "  Not a valid number",
            "  Note:           15 digits: possibly an IMSI (SIM ID); if so the mobile country code is 011"
        ].join("\n"),
        recipeConfig: [{ op: "Parse Phone Number", args: ["GB", false, false, "Text Summary"] }]
    },
    {
        name: "Extract Phone Numbers: repair reads foreign exit prefixes; comma-separated numbers kept apart",
        input: "Embassy 2 305 8333, 011 44 7400 123456, +33 6 12 34 56 78, 7400 123456",
        expectedOutput: "011 44 7400 123456\n7400 123456",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB", true, true, "As written", false, false, false] }]
    },
    {
        name: "Extract Phone Numbers: no repair, foreign exit prefix not read",
        input: "Embassy 2 305 8333, 011 44 7400 123456, +33 6 12 34 56 78, 7400 123456",
        expectedOutput: "7400 123456",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB", false, true, "As written", false, false, false] }]
    },
    {
        name: "GCloud Phone Business Lookup: errors without auth",
        input: "020 7323 8000",
        expectedOutput: "No Google Cloud credentials found. Please add the 'Authenticate Google Cloud' operation before this one.",
        recipeConfig: [{ op: "GCloud Phone Business Lookup", args: ["GB", "Text Summary", false] }]
    },
    {
        name: "GCloud Phone Business Lookup: empty input",
        input: "",
        expectedOutput: "",
        recipeConfig: [{ op: "GCloud Phone Business Lookup", args: ["GB", "Text Summary", false] }]
    }
]);
