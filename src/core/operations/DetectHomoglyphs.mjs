/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import Utils from "../Utils.mjs";
import OperationError from "../errors/OperationError.mjs";
import {
    findHomoglyphs,
    findMixedScriptWords,
    wordScripts,
    toAsciiSkeleton,
    describeChar,
    CHAR_CLASS,
    CHAR_CLASS_LABELS
} from "../lib/Homoglyph.mjs";

/**
 * Detect Homoglyphs operation
 */
class DetectHomoglyphs extends Operation {

    /**
     * DetectHomoglyphs constructor
     */
    constructor() {
        super();

        this.name = "Detect Homoglyphs";
        this.module = "Default";
        this.description = "Finds characters that look like ASCII letters, digits or symbols but are not, as used in phishing URLs and spoofed names (a homoglyph or IDN homograph attack). For example, <code>pаypal.com</code> written with a Cyrillic <code>а</code> (U+0430).<br><br>Flags:<ul><li><b>Homoglyphs</b>: non-ASCII characters listed as confusable with ASCII in the Unicode confusables data, plus fullwidth and mathematical letters</li><li><b>Accented letters</b>: Latin letters with diacritics (<code>é</code>, <code>ạ</code>) and stray combining marks</li><li><b>Invisible characters</b>: zero-width, bidi-override, format and control characters, and unusual whitespace such as no-break spaces</li><li>Optionally, <b>all other non-ASCII</b> characters</li></ul>Words that mix scripts (e.g. Latin and Cyrillic) are also underlined in the highlight output and reported by <i>List suspicious words</i>.<br><br>Output formats mirror <i>Regular expression</i>: highlight in place, list the characters, list them with code point, script and ASCII lookalike (tab-separated, for <i>To Table</i>), or list each affected word next to its ASCII equivalent. Use <i>Remove Homoglyphs</i> to convert back to plain ASCII.";
        this.infoURL = "https://wikipedia.org/wiki/IDN_homograph_attack";
        this.inputType = "string";
        this.outputType = "html";
        this.args = [
            {
                name: "Include accented letters",
                type: "boolean",
                value: true
            },
            {
                name: "Include invisible characters",
                type: "boolean",
                value: true
            },
            {
                name: "Include all other non-ASCII",
                type: "boolean",
                value: false
            },
            {
                name: "Display total",
                type: "boolean",
                value: false
            },
            {
                name: "Output format",
                type: "option",
                value: [
                    "Highlight homoglyphs",
                    "List homoglyphs",
                    "List homoglyphs with details",
                    "List suspicious words"
                ]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {html}
     */
    run(input, args) {
        const [accented, invisible, other, displayTotal, outputFormat] = args;
        const opts = { accented, invisible, other };
        const found = findHomoglyphs(input, opts);

        let output, total;
        switch (outputFormat) {
            case "Highlight homoglyphs":
                return highlight(input, found, displayTotal);
            case "List homoglyphs":
                total = found.length;
                output = Utils.escapeHtml(found.map(f => f.char).join("\n"));
                break;
            case "List homoglyphs with details":
                total = found.length;
                output = Utils.escapeHtml(detailsTable(found));
                break;
            case "List suspicious words": {
                const words = suspiciousWords(input, opts);
                total = Math.max(words.length - 1, 0); // Excludes header row
                output = Utils.escapeHtml(words.join("\n"));
                break;
            }
            default:
                throw new OperationError("Invalid output format: " + outputFormat);
        }

        if (displayTotal) output = `Total found: ${total}\n\n${output}`;
        return output;
    }

}

/**
 * Returns the input as HTML with flagged characters and mixed-script words highlighted.
 *
 * @param {string} input
 * @param {Object[]} found - Output of findHomoglyphs
 * @param {boolean} displayTotal
 * @returns {html}
 */
function highlight(input, found, displayTotal) {
    const mixed = findMixedScriptWords(input);
    const flagged = new Map(found.map(f => [f.offset, f]));

    // Boundaries: [offset, "open"|"close"] for mixed-script words
    const opens = new Map(mixed.map(w => [w.offset, w]));
    const closes = new Set(mixed.map(w => w.offset + w.word.length));

    let output = "", pos = 0;
    for (const ch of input) {
        if (closes.has(pos)) output += "</span>";
        if (opens.has(pos)) {
            const w = opens.get(pos);
            output += `<span class='cc-mixed' title='Mixed scripts: ${Utils.escapeHtml(w.scripts.join(" + "))}'>`;
        }

        const f = flagged.get(pos);
        if (f) {
            const title = Utils.escapeHtml(`Offset: ${pos}\n${describeChar(ch)}`);
            if (f.cls === CHAR_CLASS.INVISIBLE && f.lookalike === "") {
                // Zero-width: show a code-point badge (drawn with CSS so copying returns the original character)
                const cp = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
                output += `<span class='cc-invisible-badge cc-badge-attr' data-cp='${cp}' title='${title}'>${Utils.escapeHtml(ch)}</span>`;
            } else {
                output += `<span class='cc-${f.cls}' title='${title}'>${Utils.escapeHtml(ch)}</span>`;
            }
        } else {
            output += Utils.escapeHtml(ch);
        }
        pos += ch.length;
    }
    if (closes.has(pos)) output += "</span>";

    if (displayTotal) output = `Total found: ${found.length}\n\n${output}`;
    return output;
}

/**
 * Tab-separated table of flagged characters.
 *
 * @param {Object[]} found
 * @returns {string}
 */
function detailsTable(found) {
    const rows = ["Offset\tCharacter\tCode point\tScript\tType\tLooks like"];
    for (const f of found) {
        let looks = f.lookalike ?? "";
        if (f.cls === CHAR_CLASS.INVISIBLE) looks = looks === " " ? "(space)" : looks === "\n" ? "(new line)" : "(nothing)";
        rows.push([f.offset, f.char, f.codePoint, f.script, CHAR_CLASS_LABELS[f.cls], looks].join("\t"));
    }
    return rows.join("\n");
}

/**
 * Lists each whitespace-separated word that contains a flagged character or mixes
 * scripts, with its ASCII equivalent, as tab-separated rows. Duplicates are listed once.
 *
 * @param {string} input
 * @param {Object} opts - See isFlagged
 * @returns {string[]}
 */
function suspiciousWords(input, opts) {
    const rows = [];
    const seen = new Set();
    for (const word of input.split(/[\s\u2028\u2029]+/)) {
        if (!word || seen.has(word)) continue;
        const chars = findHomoglyphs(word, opts);
        const scripts = wordScripts(word);
        if (!chars.length && scripts.length < 2) continue;
        seen.add(word);
        rows.push([word, toAsciiSkeleton(word), scripts.join(" + ") || "-", chars.length].join("\t"));
    }
    if (rows.length) rows.unshift("Word\tASCII equivalent\tScripts\tFlagged characters");
    return rows;
}

export default DetectHomoglyphs;
