/**
 * Homoglyph and character-class helpers.
 *
 * Shared by the Detect Homoglyphs and Remove Homoglyphs operations and by the
 * "Character class highlighting" editor setting, so that the operations and the
 * editor colouring always agree about what counts as a homoglyph.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import { HOMOGLYPHS } from "./HomoglyphData.mjs";

/**
 * Character classes, in the order they are shown in the legend.
 */
export const CHAR_CLASS = {
    LETTER: "letter",         // ASCII a-z A-Z
    DIGIT: "digit",           // ASCII 0-9
    SYMBOL: "symbol",         // ASCII punctuation and symbols
    WHITESPACE: "whitespace", // ASCII space, tab, CR, LF
    HOMOGLYPH: "homoglyph",   // Non-ASCII character that looks like an ASCII one (Unicode confusables)
    ACCENTED: "accented",     // Latin letter with a diacritic, or a combining diacritic
    INVISIBLE: "invisible",   // Zero-width, bidi, format and control characters, unusual whitespace
    OTHER: "other"            // Any other non-ASCII character (CJK, emoji, Arabic...)
};

/**
 * Human-readable labels for each class.
 */
export const CHAR_CLASS_LABELS = {
    letter: "ASCII letter",
    digit: "ASCII digit",
    symbol: "ASCII symbol",
    whitespace: "ASCII whitespace",
    homoglyph: "Homoglyph",
    accented: "Accented letter",
    invisible: "Invisible / control",
    other: "Other non-ASCII"
};

/**
 * Latin letters with a stroke or hook that NFD does not decompose.
 */
const STROKED_LATIN = {
    "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ħ": "h", "Ħ": "H", "ł": "l", "Ł": "L",
    "ŧ": "t", "Ŧ": "T", "ƀ": "b", "Ƀ": "B", "ɨ": "i", "Ɨ": "I", "ʉ": "u", "Ʉ": "U",
    "ƶ": "z", "Ƶ": "Z", "ǥ": "g", "Ǥ": "G", "ɍ": "r", "Ɍ": "R", "ɏ": "y", "Ɏ": "Y",
    "ȼ": "c", "Ȼ": "C", "ɇ": "e", "Ɇ": "E", "ɉ": "j", "Ɉ": "J", "ß": "ss", "ẞ": "SS"
};

/**
 * Invisible characters that are not in the Unicode Cf/Z categories but render as
 * nothing: Hangul fillers, the combining grapheme joiner, variation selectors and
 * the blank Braille pattern.
 */
const EXTRA_INVISIBLE = [
    [0x034F, 0x034F], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180B, 0x180F], [0x2800, 0x2800],
    [0x3164, 0x3164], [0xFE00, 0xFE0F], [0xFFA0, 0xFFA0], [0xE0100, 0xE01EF]
];

/**
 * @param {number} cp
 * @returns {boolean}
 */
function isExtraInvisible(cp) {
    return EXTRA_INVISIBLE.some(([lo, hi]) => cp >= lo && cp <= hi);
}

const INVISIBLE_RE = /[\p{Cf}\p{Zl}\p{Zp}\p{Cc}]/u;
const UNUSUAL_SPACE_RE = /\p{Zs}/u;

/**
 * Scripts that are tested, in order, when naming a character's script.
 * Common and Inherited are tested last.
 */
const SCRIPTS = [
    "Latin", "Cyrillic", "Greek", "Armenian", "Cherokee", "Coptic", "Georgian",
    "Hebrew", "Arabic", "Syriac", "Thaana", "Nko", "Devanagari", "Bengali", "Gurmukhi",
    "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai",
    "Lao", "Tibetan", "Myanmar", "Ethiopic", "Canadian_Aboriginal", "Runic", "Ogham",
    "Tifinagh", "Lisu", "Vai", "Bamum", "Han", "Hiragana", "Katakana", "Hangul",
    "Bopomofo", "Yi", "Mongolian", "Khmer", "Old_Italic", "Gothic", "Deseret",
    "Osage", "Warang_Citi", "Mende_Kikakui", "Adlam", "Miao", "Braille",
    "Common", "Inherited"
];
const SCRIPT_RES = SCRIPTS.map(s => [s.replace(/_/g, " "), new RegExp(`\\p{Script=${s}}`, "u")]);

const scriptCache = new Map();

/**
 * Returns the Unicode script name of a character, e.g. "Latin", "Cyrillic", "Common".
 *
 * @param {string} ch - A single code point
 * @returns {string}
 */
export function getScript(ch) {
    let s = scriptCache.get(ch);
    if (s !== undefined) return s;
    s = "Other";
    for (const [name, re] of SCRIPT_RES) {
        if (re.test(ch)) {
            s = name;
            break;
        }
    }
    if (scriptCache.size < 10000) scriptCache.set(ch, s);
    return s;
}

/**
 * Formats a code point as U+XXXX.
 *
 * @param {string} ch
 * @returns {string}
 */
export function codePointLabel(ch) {
    return "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
}

const classCache = new Map();

/**
 * Classifies a single code point.
 *
 * @param {string} ch - A single code point (may be two UTF-16 units)
 * @returns {{cls: string, lookalike: (string|null)}} lookalike is the ASCII text
 *     the character resembles ("" for invisible characters that should be removed,
 *     " " for unusual spaces), or null if there is none.
 */
export function classifyChar(ch) {
    const cp = ch.codePointAt(0);

    if (cp < 0x80) {
        if ((cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a)) return { cls: CHAR_CLASS.LETTER, lookalike: ch };
        if (cp >= 0x30 && cp <= 0x39) return { cls: CHAR_CLASS.DIGIT, lookalike: ch };
        if (cp >= 0x21 && cp <= 0x7e) return { cls: CHAR_CLASS.SYMBOL, lookalike: ch };
        if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) return { cls: CHAR_CLASS.WHITESPACE, lookalike: ch };
        return { cls: CHAR_CLASS.INVISIBLE, lookalike: "" };
    }

    const cached = classCache.get(cp);
    if (cached) return cached;

    let result;
    if (UNUSUAL_SPACE_RE.test(ch)) {
        result = { cls: CHAR_CLASS.INVISIBLE, lookalike: " " };
    } else if (cp === 0x2028 || cp === 0x2029) {
        result = { cls: CHAR_CLASS.INVISIBLE, lookalike: "\n" };
    } else if (INVISIBLE_RE.test(ch) || isExtraInvisible(cp)) {
        result = { cls: CHAR_CLASS.INVISIBLE, lookalike: "" };
    } else if (Object.prototype.hasOwnProperty.call(HOMOGLYPHS, cp)) {
        result = { cls: CHAR_CLASS.HOMOGLYPH, lookalike: HOMOGLYPHS[cp] };
    } else if (Object.prototype.hasOwnProperty.call(STROKED_LATIN, ch)) {
        result = { cls: CHAR_CLASS.ACCENTED, lookalike: STROKED_LATIN[ch] };
    } else {
        const stripped = ch.normalize("NFD").replace(/\p{M}/gu, "");
        if (stripped && stripped !== ch && /^[A-Za-z]+$/.test(stripped)) {
            result = { cls: CHAR_CLASS.ACCENTED, lookalike: stripped };
        } else if (/\p{M}/u.test(ch) && getScript(ch) === "Inherited") {
            // Combining diacritic (e.g. U+0301) that turns the previous letter into an accented one
            result = { cls: CHAR_CLASS.ACCENTED, lookalike: "" };
        } else {
            result = { cls: CHAR_CLASS.OTHER, lookalike: null };
        }
    }

    if (classCache.size < 20000) classCache.set(cp, result);
    return result;
}

/**
 * Returns a one-line description of a character for tooltips and reports,
 * e.g. "U+0430 Cyrillic homoglyph, looks like 'a'".
 *
 * @param {string} ch
 * @returns {string}
 */
export function describeChar(ch) {
    const { cls, lookalike } = classifyChar(ch);
    let desc = `${codePointLabel(ch)} ${getScript(ch)} ${CHAR_CLASS_LABELS[cls].toLowerCase().replace("ascii", "ASCII")}`;
    if (cls === CHAR_CLASS.HOMOGLYPH || (cls === CHAR_CLASS.ACCENTED && lookalike)) {
        desc += `, looks like '${lookalike}'`;
    } else if (cls === CHAR_CLASS.INVISIBLE && lookalike === " ") {
        desc += ", looks like a space";
    }
    return desc;
}

/**
 * Whether a character class counts as suspicious under the given options.
 *
 * @param {string} cls
 * @param {Object} [opts]
 * @param {boolean} [opts.accented=true] - Flag accented Latin letters
 * @param {boolean} [opts.invisible=true] - Flag invisible and control characters
 * @param {boolean} [opts.other=false] - Flag every other non-ASCII character
 * @returns {boolean}
 */
export function isFlagged(cls, { accented = true, invisible = true, other = false } = {}) {
    switch (cls) {
        case CHAR_CLASS.HOMOGLYPH: return true;
        case CHAR_CLASS.ACCENTED: return accented;
        case CHAR_CLASS.INVISIBLE: return invisible;
        case CHAR_CLASS.OTHER: return other;
        default: return false;
    }
}

/**
 * Finds every flagged character in a string.
 *
 * @param {string} input
 * @param {Object} [opts] - See isFlagged
 * @returns {Object[]} [{offset, char, codePoint, cls, script, lookalike}]; offset
 *     is the UTF-16 index, matching the Regular expression operation.
 */
export function findHomoglyphs(input, opts = {}) {
    const results = [];
    let offset = 0;
    for (const ch of input) {
        if (ch.charCodeAt(0) >= 0x80 || (ch < " " && !/[\t\n\r]/.test(ch)) || ch === "\x7f") {
            const { cls, lookalike } = classifyChar(ch);
            if (isFlagged(cls, opts)) {
                results.push({
                    offset,
                    char: ch,
                    codePoint: codePointLabel(ch),
                    cls,
                    script: getScript(ch),
                    lookalike
                });
            }
        }
        offset += ch.length;
    }
    return results;
}

/**
 * Returns the distinct scripts used by the letters in a word, ignoring
 * Common and Inherited characters (digits, punctuation, combining marks).
 *
 * @param {string} word
 * @returns {string[]}
 */
export function wordScripts(word) {
    const scripts = new Set();
    for (const ch of word) {
        if (ch.charCodeAt(0) < 0x80) {
            if (/[A-Za-z]/.test(ch)) scripts.add("Latin");
            continue;
        }
        if (!/\p{L}/u.test(ch)) continue;
        const s = getScript(ch);
        if (s !== "Common" && s !== "Inherited") scripts.add(s);
    }
    return [...scripts];
}

/**
 * Finds words whose letters come from more than one script, e.g. "pаypal" with a
 * Cyrillic а. A word is a run of letters, marks and digits.
 *
 * @param {string} input
 * @returns {Object[]} [{offset, word, scripts}]
 */
export function findMixedScriptWords(input) {
    const results = [];
    const re = /[\p{L}\p{M}\p{N}]+/gu;
    let m;
    while ((m = re.exec(input))) {
        // Pure ASCII words cannot be mixed
        if (/^[\x00-\x7f]*$/.test(m[0])) continue;
        const scripts = wordScripts(m[0]);
        if (scripts.length > 1) results.push({ offset: m.index, word: m[0], scripts });
    }
    return results;
}

/**
 * Replaces homoglyphs with the ASCII they look like.
 *
 * @param {string} input
 * @param {Object} [opts]
 * @param {boolean} [opts.accented=true] - Replace accented letters with the base letter
 * @param {boolean} [opts.invisible=true] - Remove invisible characters and turn unusual spaces into spaces
 * @param {string} [opts.homoglyphAction="replace"] - "replace" with ASCII lookalike, or "remove"
 * @param {string} [opts.otherAction="keep"] - Other non-ASCII: "keep", "remove", or a replacement string
 * @returns {string}
 */
export function removeHomoglyphs(input, {
    accented = true,
    invisible = true,
    homoglyphAction = "replace",
    otherAction = "keep"
} = {}) {
    let output = "";
    for (const ch of input) {
        const code = ch.charCodeAt(0);
        if (code < 0x80 && (code >= 0x20 || /[\t\n\r]/.test(ch)) && code !== 0x7f) {
            output += ch;
            continue;
        }
        const { cls, lookalike } = classifyChar(ch);
        switch (cls) {
            case CHAR_CLASS.HOMOGLYPH:
                output += homoglyphAction === "remove" ? "" : lookalike;
                break;
            case CHAR_CLASS.ACCENTED:
                output += accented ? (homoglyphAction === "remove" ? "" : lookalike) : ch;
                break;
            case CHAR_CLASS.INVISIBLE:
                output += invisible ? lookalike : ch;
                break;
            default:
                if (otherAction === "keep") output += ch;
                else if (otherAction !== "remove") output += otherAction;
        }
    }
    return output;
}

/**
 * Returns the ASCII "skeleton" of a string: every homoglyph and accented letter
 * replaced by its lookalike and invisible characters removed. Two strings that
 * look the same have the same skeleton.
 *
 * @param {string} input
 * @returns {string}
 */
export function toAsciiSkeleton(input) {
    return removeHomoglyphs(input, { accented: true, invisible: true, homoglyphAction: "replace", otherAction: "keep" });
}
