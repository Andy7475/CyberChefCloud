/**
 * Detect Homoglyphs and Remove Homoglyphs tests.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */
import TestRegister from "../../lib/TestRegister.mjs";

// "p\u0430ypal.com/l\u043Egin" with Cyrillic \u0430 (U+0430) and \u043E (U+043E), plus a zero-width space
const SPOOFED_URL = "https://p\u0430ypal.com/l\u043Egin\u200B?id=1";

TestRegister.addTests([
    {
        name: "Detect Homoglyphs: List homoglyphs",
        input: SPOOFED_URL,
        expectedOutput: "\u0430\n\u043E\n\u200B",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, false, false, "List homoglyphs"] }
        ]
    },
    {
        name: "Detect Homoglyphs: List homoglyphs, invisible excluded, with total",
        input: SPOOFED_URL,
        expectedOutput: "Total found: 2\n\n\u0430\n\u043E",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, false, false, true, "List homoglyphs"] }
        ]
    },
    {
        name: "Detect Homoglyphs: plain ASCII finds nothing",
        input: "https://paypal.com/login?id=1",
        expectedOutput: "Total found: 0\n\n",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, false, true, "List homoglyphs"] }
        ]
    },
    {
        name: "Detect Homoglyphs: List homoglyphs with details",
        input: "p\u0430y \uFF47 \u00A0",
        expectedOutput: [
            "Offset\tCharacter\tCode point\tScript\tType\tLooks like",
            "1\t\u0430\tU+0430\tCyrillic\tHomoglyph\ta",
            "4\t\uFF47\tU+FF47\tLatin\tHomoglyph\tg",
            "6\t\u00A0\tU+00A0\tCommon\tInvisible / control\t(space)"
        ].join("\n"),
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, false, false, "List homoglyphs with details"] }
        ]
    },
    {
        name: "Detect Homoglyphs: List suspicious words",
        input: "visit " + SPOOFED_URL + " or caf\u00E9 or \u13AAmazon today",
        expectedOutput: [
            "Word\tASCII equivalent\tScripts\tFlagged characters",
            "https://p\u0430ypal.com/l\u043Egin\u200B?id=1\thttps://paypal.com/login?id=1\tLatin + Cyrillic\t3",
            "caf\u00E9\tcafe\tLatin\t1",
            "\u13AAmazon\tAmazon\tCherokee + Latin\t1"
        ].join("\n"),
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, false, false, "List suspicious words"] }
        ]
    },
    {
        name: "Detect Homoglyphs: accented letters can be excluded",
        input: "caf\u00E9",
        expectedOutput: "",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [false, true, false, false, "List homoglyphs"] }
        ]
    },
    {
        name: "Detect Homoglyphs: all other non-ASCII",
        input: "\u6771\u4EAC a",
        expectedOutput: "\u6771\n\u4EAC",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, true, false, "List homoglyphs"] }
        ]
    },
    {
        name: "Detect Homoglyphs: Highlight homoglyphs",
        input: "p\u0430y <b>",
        expectedOutput: "<span class='cc-mixed' title='Mixed scripts: Latin + Cyrillic'>p<span class='cc-homoglyph' title='Offset: 1\nU+0430 Cyrillic homoglyph, looks like &#x27;a&#x27;'>\u0430</span>y</span> &lt;b&gt;",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, false, false, "Highlight homoglyphs"] }
        ]
    },
    {
        name: "Detect Homoglyphs: Highlight zero-width as badge",
        input: "a\u200Bb",
        expectedOutput: "a<span class='cc-invisible-badge cc-badge-attr' data-cp='200B' title='Offset: 1\nU+200B Common invisible / control'>\u200B</span>b",
        recipeConfig: [
            { op: "Detect Homoglyphs", args: [true, true, false, false, "Highlight homoglyphs"] }
        ]
    },
    {
        name: "Remove Homoglyphs: spoofed URL back to ASCII",
        input: SPOOFED_URL,
        expectedOutput: "https://paypal.com/login?id=1",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Replace with ASCII lookalike", true, true, "Keep"] }
        ]
    },
    {
        name: "Remove Homoglyphs: fullwidth, mathematical and lookalike capitals",
        input: "\uFF47\uFF4F\uFF4F\uFF47\uFF4C\uFF45 \u{1D41A}\u{1D429}\u{1D429}\u{1D425}\u{1D41E} \u0406BM \u2160\u2161 \u{1D7CF}\u0660",
        expectedOutput: "google apple IBM III 1.",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Replace with ASCII lookalike", true, true, "Keep"] }
        ]
    },
    {
        name: "Remove Homoglyphs: accented and combining letters",
        input: "caf\u00E9 cafe\u0301 \u0142\u00F3d\u017A",
        expectedOutput: "cafe cafe lodz",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Replace with ASCII lookalike", true, true, "Keep"] }
        ]
    },
    {
        name: "Remove Homoglyphs: keep accented letters and invisible characters",
        input: "caf\u00E9\u200B \u0430",
        expectedOutput: "caf\u00E9\u200B a",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Replace with ASCII lookalike", false, false, "Keep"] }
        ]
    },
    {
        name: "Remove Homoglyphs: remove homoglyphs, unusual spaces normalised",
        input: "p\u0430ypal\u00A0\u2003x",
        expectedOutput: "pypal  x",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Remove", true, true, "Keep"] }
        ]
    },
    {
        name: "Remove Homoglyphs: other non-ASCII replaced",
        input: "\u6771\u4EAC \u0430 \u{1F600}",
        expectedOutput: "?? a ?",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Replace with ASCII lookalike", true, true, "Replace with ?"] }
        ]
    },
    {
        name: "Remove Homoglyphs: other non-ASCII removed",
        input: "\u6771\u4EAC-\u0430",
        expectedOutput: "-a",
        recipeConfig: [
            { op: "Remove Homoglyphs", args: ["Replace with ASCII lookalike", true, true, "Remove"] }
        ]
    }
]);
