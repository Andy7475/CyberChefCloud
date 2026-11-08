/**
 * CodeMirror extension that colour-codes characters by class, to make
 * homoglyph attacks (e.g. a Cyrillic "а" in "pаypal.com") visible.
 *
 * - ASCII letters, digits and symbols each get their own colour
 * - Homoglyphs (non-ASCII characters that look like ASCII), accented letters,
 *   other non-ASCII characters and invisible characters are highlighted and
 *   carry a tooltip with the code point, script and ASCII lookalike
 * - Zero-width and bidi characters are drawn as a visible code-point badge
 * - Words that mix scripts get a wavy underline
 *
 * Only the visible part of the document is decorated.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import { ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import {
    classifyChar,
    describeChar,
    findMixedScriptWords,
    CHAR_CLASS
} from "../../core/lib/Homoglyph.mjs";

/** Maximum number of characters decorated per update, to keep huge single-line outputs responsive. */
const MAX_CHARS = 100000;

const runMarks = {
    [CHAR_CLASS.LETTER]: Decoration.mark({ class: "cc-letter" }),
    [CHAR_CLASS.DIGIT]: Decoration.mark({ class: "cc-digit" }),
    [CHAR_CLASS.SYMBOL]: Decoration.mark({ class: "cc-symbol" })
};

const charDecoCache = new Map();

/**
 * Widget that draws a zero-width or bidi character as a small code-point badge.
 */
class InvisibleCharWidget extends WidgetType {
    /**
     * InvisibleCharWidget constructor
     *
     * @param {string} label - Hex code point
     * @param {string} title - Tooltip
     */
    constructor(label, title) {
        super();
        this.label = label;
        this.title = title;
    }

    /**
     * @param {InvisibleCharWidget} other
     * @returns {boolean}
     */
    eq(other) {
        return other.label === this.label;
    }

    /**
     * @returns {HTMLElement}
     */
    toDOM() {
        const s = document.createElement("span");
        s.className = "cc-invisible-badge";
        s.textContent = this.label;
        s.title = this.title;
        s.setAttribute("aria-label", this.title);
        return s;
    }

    /**
     * @returns {boolean}
     */
    ignoreEvent() {
        return false;
    }
}

/**
 * Returns the (cached) decoration for a single non-ASCII or control character.
 *
 * @param {string} ch
 * @returns {Decoration}
 */
function charDecoration(ch) {
    let deco = charDecoCache.get(ch);
    if (deco) return deco;

    const code = ch.codePointAt(0);
    let { cls, lookalike } = classifyChar(ch);
    let title = describeChar(ch);

    // The output editor stores control characters in the Private Use Area (see Utils.escapeWhitespace),
    // where highlightSpecialChars already draws them, so just mark them.
    if (code >= 0xe000 && code <= 0xf8ff) {
        cls = CHAR_CLASS.INVISIBLE;
        lookalike = " ";
        title = "Control character";
    }

    if (cls === CHAR_CLASS.INVISIBLE && lookalike === "" && code >= 0x80) {
        deco = Decoration.replace({
            widget: new InvisibleCharWidget(code.toString(16).toUpperCase().padStart(4, "0"), title)
        });
    } else {
        deco = Decoration.mark({
            class: "cc-" + cls,
            attributes: { title }
        });
    }

    if (charDecoCache.size < 5000) charDecoCache.set(ch, deco);
    return deco;
}

/**
 * Builds decorations for the visible ranges of the editor.
 *
 * @param {EditorView} view
 * @returns {DecorationSet}
 */
function buildDecorations(view) {
    const decos = [];
    let budget = MAX_CHARS;

    for (const { from, to } of view.visibleRanges) {
        if (budget <= 0) break;
        const end = Math.min(to, from + budget);
        budget -= end - from;
        const text = view.state.doc.sliceString(from, end);

        let runCls = null, runStart = 0, i = 0;
        const flush = pos => {
            if (runCls && pos > runStart) decos.push(runMarks[runCls].range(from + runStart, from + pos));
            runCls = null;
        };

        for (const ch of text) {
            const code = ch.charCodeAt(0);
            let cls = null;
            if (code < 0x80) {
                if ((code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a)) cls = CHAR_CLASS.LETTER;
                else if (code >= 0x30 && code <= 0x39) cls = CHAR_CLASS.DIGIT;
                else if (code >= 0x21 && code <= 0x7e) cls = CHAR_CLASS.SYMBOL;
            }

            if (cls) {
                if (cls !== runCls) {
                    flush(i);
                    runCls = cls;
                    runStart = i;
                }
            } else {
                flush(i);
                // Plain whitespace is left alone; ASCII control characters are drawn by highlightSpecialChars
                if (code >= 0x80 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
                    decos.push(charDecoration(ch).range(from + i, from + i + ch.length));
                }
            }
            i += ch.length;
        }
        flush(i);

        for (const w of findMixedScriptWords(text)) {
            decos.push(Decoration.mark({
                class: "cc-mixed",
                attributes: { title: "Mixed scripts: " + w.scripts.join(" + ") }
            }).range(from + w.offset, from + w.offset + w.word.length));
        }
    }

    return Decoration.set(decos, true);
}

const charHighlightPlugin = ViewPlugin.fromClass(class {
    /**
     * @param {EditorView} view
     */
    constructor(view) {
        this.decorations = buildDecorations(view);
    }

    /**
     * @param {ViewUpdate} update
     */
    update(update) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = buildDecorations(update.view);
        }
    }
}, {
    decorations: v => v.decorations
});

/**
 * Character class highlighting extension.
 *
 * @returns {Extension}
 */
export function charHighlight() {
    // High precedence so our badges replace highlightSpecialChars' generic dot for zero-width characters
    return Prec.high(charHighlightPlugin);
}
