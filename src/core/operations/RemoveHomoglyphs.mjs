/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { removeHomoglyphs } from "../lib/Homoglyph.mjs";

/**
 * Remove Homoglyphs operation
 */
class RemoveHomoglyphs extends Operation {

    /**
     * RemoveHomoglyphs constructor
     */
    constructor() {
        super();

        this.name = "Remove Homoglyphs";
        this.module = "Default";
        this.description = "Converts text back to plain ASCII by replacing homoglyphs (non-ASCII characters that look like ASCII, e.g. a Cyrillic <code>а</code> or a fullwidth <code>ａ</code>) with the ASCII characters they imitate. For example, <code>pаypal.com</code> becomes <code>paypal.com</code>.<br><br>Optionally also replaces accented letters with their base letter (<code>é</code> to <code>e</code>), removes zero-width and bidi-override characters, turns unusual spaces into normal spaces, and removes or replaces any remaining non-ASCII characters.<br><br>Uses the same character data as <i>Detect Homoglyphs</i>. Lookalikes follow the Unicode confusables data, so a few characters map to a close rather than exact match (e.g. <code>ℓ</code> to <code>l</code>).";
        this.infoURL = "https://wikipedia.org/wiki/IDN_homograph_attack";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Homoglyphs",
                type: "option",
                value: ["Replace with ASCII lookalike", "Remove"]
            },
            {
                name: "Include accented letters",
                type: "boolean",
                value: true
            },
            {
                name: "Clean invisible characters",
                type: "boolean",
                value: true
            },
            {
                name: "Other non-ASCII",
                type: "option",
                value: ["Keep", "Remove", "Replace with ?"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [homoglyphs, accented, invisible, other] = args;
        return removeHomoglyphs(input, {
            homoglyphAction: homoglyphs === "Remove" ? "remove" : "replace",
            accented,
            invisible,
            otherAction: other === "Remove" ? "remove" : other === "Replace with ?" ? "?" : "keep"
        });
    }

}

export default RemoveHomoglyphs;
