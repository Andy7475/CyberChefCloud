/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";

/**
 * Trim operation
 */
class Trim extends Operation {

    /**
     * Trim constructor
     */
    constructor() {
        super();

        this.name = "Trim";
        this.module = "Default";
        this.description = [
            "Removes characters from the start and/or end of the input.",
            "<br><br>",
            "<b>Characters</b> is a set: any of the listed characters is removed, in any order. Leave it empty to remove whitespace. Escape sequences such as <code>\\t</code> and <code>\\n</code> are supported.",
            "<br><br>",
            "<b>Remove</b>: <i>All</i> keeps removing while the end character is in the set; <i>Only one</i> removes at most one character from each end.",
            "<br><br>",
            // Quotes are written as &quot; because the description is placed in a double-quoted HTML attribute
            "<b>Example:</b> Characters <code>&quot;</code> with <i>Only one</i> turns <code>&quot;&quot;quoted&quot;&quot;</code> into <code>&quot;quoted&quot;</code>; with <i>All</i> it gives <code>quoted</code>."
        ].join("\n");
        this.infoURL = "https://wikipedia.org/wiki/Trimming_(computer_programming)";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                "name": "Characters (empty = whitespace)",
                "type": "binaryString",
                "value": ""
            },
            {
                "name": "Position",
                "type": "option",
                "value": ["Both ends", "Start", "End"]
            },
            {
                "name": "Remove",
                "type": "option",
                "value": ["All", "Only one"]
            },
            {
                "name": "Each line separately",
                "type": "boolean",
                "value": false
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [chars, position, remove, eachLine] = args;
        const set = new Set(Array.from(chars));
        const isTrimmed = set.size ? c => set.has(c) : c => /\s/.test(c);
        const onlyOne = remove === "Only one";

        const trim = str => {
            // Split by code point so characters outside the BMP (e.g. emoji) are handled whole
            const cs = Array.from(str);
            let start = 0, end = cs.length;
            if (position !== "End") {
                while (start < end && isTrimmed(cs[start])) {
                    start++;
                    if (onlyOne) break;
                }
            }
            if (position !== "Start") {
                while (end > start && isTrimmed(cs[end - 1])) {
                    end--;
                    if (onlyOne) break;
                }
            }
            return cs.slice(start, end).join("");
        };

        if (!eachLine) return trim(input);

        // Odd entries are the line breaks, which are kept as they are
        return input.split(/(\r?\n)/)
            .map((part, i) => i % 2 ? part : trim(part))
            .join("");
    }

}

export default Trim;
