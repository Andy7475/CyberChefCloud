/**
 * Generates src/core/lib/HomoglyphData.mjs, the table of non-ASCII characters
 * that look like printable ASCII characters.
 *
 * Source data is the Unicode confusables mapping (confusables.txt from
 * https://www.unicode.org/Public/security/), supplemented by characters whose
 * NFKC compatibility form is ASCII (fullwidth forms, mathematical alphanumerics,
 * superscripts, ligatures, etc.).
 *
 * Usage:
 *     node src/core/config/scripts/generateHomoglyphData.mjs <confusables.txt | confusables.json>
 *
 * The JSON form is the {source: target} map shipped in the `unicode-confusables`
 * npm package (data/confusables.json).
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/* eslint no-console: ["off"] */

import fs from "fs";
import path from "path";
import process from "process";

const ASCII_PRINTABLE = /^[\x21-\x7e]+$/;

/**
 * Parses confusables.txt or a {source: target} JSON map.
 *
 * @param {string} file
 * @returns {Object<string, string>}
 */
function loadConfusables(file) {
    const raw = fs.readFileSync(file, "utf8");
    if (file.endsWith(".json")) return JSON.parse(raw);

    const map = {};
    const toStr = field => field.trim().split(/\s+/).map(h => String.fromCodePoint(parseInt(h, 16))).join("");
    for (const line of raw.split(/\r?\n/)) {
        const content = line.replace(/#.*$/, "").trim();
        if (!content) continue;
        const [src, target] = content.split(";");
        map[toStr(src)] = toStr(target);
    }
    return map;
}

/**
 * Turns a confusables "skeleton" into the ASCII text a reader would see.
 * Skeletons fold I and 1 to l, 0 to O and m to rn, which is right for
 * comparison but wrong when restoring readable ASCII.
 *
 * @param {string} ch - Source character
 * @param {string} target - Skeleton
 * @returns {string}
 */
function readableTarget(ch, target) {
    const isUpper = ch !== ch.toLowerCase() && ch === ch.toUpperCase();
    const isDigit = /\p{Nd}/u.test(ch);

    if (target === "rn") return "m";
    if (target === "l" && isDigit) return "1";
    if (target === "l" && isUpper) return "I";
    if (target === "O" && isDigit) return "0";
    if (target.length > 1 && /[A-Za-z0-9]/.test(target)) {
        const stripped = target.replace(/'/g, "");
        if (stripped) return stripped;
    }
    return target;
}

/**
 * Main
 */
function main() {
    const file = process.argv[2];
    if (!file) {
        console.error("Usage: node generateHomoglyphData.mjs <confusables.txt | confusables.json>");
        process.exit(1);
    }

    const confusables = loadConfusables(file);
    const table = new Map();

    // 1. Unicode confusables
    for (const [src, target] of Object.entries(confusables)) {
        const cps = [...src];
        if (cps.length !== 1) continue;
        const cp = src.codePointAt(0);
        if (cp < 0x80) continue;

        const nfkc = src.normalize("NFKC");
        if (ASCII_PRINTABLE.test(nfkc) && nfkc.length <= 3) {
            table.set(cp, nfkc);
        } else if (ASCII_PRINTABLE.test(target)) {
            table.set(cp, readableTarget(src, target));
        }
    }

    // 2. Compatibility forms that NFKC folds to ASCII but confusables misses
    for (let cp = 0x80; cp <= 0x2FFFF; cp++) {
        if (table.has(cp)) continue;
        if (cp >= 0xD800 && cp <= 0xDFFF) continue;
        const ch = String.fromCodePoint(cp);
        if (/[\p{Cf}\p{Z}\p{Cc}]/u.test(ch)) continue;
        const nfkc = ch.normalize("NFKC");
        if (/^[\x21-\x7e]$/.test(nfkc) || /^[A-Za-z0-9]{2,3}$/.test(nfkc)) {
            table.set(cp, nfkc);
        }
    }

    const entries = [...table.entries()].sort((a, b) => a[0] - b[0]);
    const lines = [];
    for (let i = 0; i < entries.length; i += 6) {
        lines.push("    " + entries.slice(i, i + 6)
            .map(([cp, t]) => `0x${cp.toString(16).toUpperCase().padStart(4, "0")}: ${JSON.stringify(t)}`)
            .join(", ") + ",");
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "");

    const out = `/**
 * Homoglyph table: non-ASCII code point -> the printable ASCII text it looks like.
 *
 * GENERATED FILE - do not edit by hand. Regenerate with
 *     node src/core/config/scripts/generateHomoglyphData.mjs <confusables.txt>
 *
 * Derived from the Unicode confusables data (Unicode Security Mechanisms,
 * UTS #39, https://www.unicode.org/Public/security/), Copyright (c) Unicode, Inc.,
 * used under the Unicode License (https://www.unicode.org/license.txt), and from
 * Unicode NFKC compatibility mappings.
 *
 * ${entries.length} entries.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

export const HOMOGLYPHS = {
${lines.join("\n")}
};
`;
    const dest = path.join(process.cwd(), "src/core/lib/HomoglyphData.mjs");
    fs.writeFileSync(dest, out);
    console.log(`Wrote ${entries.length} entries to ${dest}`);
}

main();
