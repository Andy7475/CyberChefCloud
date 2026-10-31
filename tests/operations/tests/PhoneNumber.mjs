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
        name: "Parse Phone Number: JSON with no default region",
        input: "+1 202 555 0143",
        expectedOutput: JSON.stringify([{
            input: "+1 202 555 0143",
            valid: true,
            possible: true,
            e164: "+12025550143",
            country: "US",
            countryName: "United States",
            callingCode: "+1",
            type: "Fixed line or mobile",
            national: "(202) 555-0143",
            international: "+1 202 555 0143",
            extension: "",
            repairs: [],
            notes: [],
            otherRegions: []
        }], null, 2),
        recipeConfig: [{ op: "Parse Phone Number", args: ["", true, false, "JSON"] }]
    },
    {
        name: "Parse Phone Number: unknown region",
        input: "07400 123456",
        expectedOutput: "Unknown default region \"ZZ\". Use a two-letter ISO 3166 code such as GB, US or FR, or leave it blank.",
        recipeConfig: [{ op: "Parse Phone Number", args: ["ZZ", true, false, "Text Summary"] }]
    },
    {
        name: "Extract Phone Numbers: valid, E.164, unique, total",
        input: EXTRACT_TEXT,
        expectedOutput: "Total found: 3\n\n+447400123456\n+442073238000\n+33612345678",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB", true, "E.164", true, false, true] }]
    },
    {
        name: "Extract Phone Numbers: possible, as written",
        input: EXTRACT_TEXT,
        expectedOutput: "07400 123456\n0207 323 8000\n01632 960123\n0033 6 12 34 56 78\n+447400123456",
        recipeConfig: [{ op: "Extract Phone Numbers", args: ["GB", false, "As written", false, false, false] }]
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
