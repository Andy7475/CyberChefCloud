/**
 * @author j433866 [j433866@gmail.com]
 * @copyright Crown Copyright 2019
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import { HeadingSlugger, HEADING_ID_PREFIX } from "../lib/MarkdownAnchors.mjs";

/**
 * Render Markdown operation
 */
class RenderMarkdown extends Operation {

    /**
     * RenderMarkdown constructor
     */
    constructor() {
        super();

        this.name = "Render Markdown";
        this.module = "Code";
        this.description = "Renders input Markdown as HTML. HTML rendering is disabled to avoid XSS.<br><br>" +
            "Headings get anchors with GitHub-style names, so a link such as <code>[see below](#class-hierarchy)</code> jumps to the heading 'Class hierarchy' in the output.";
        this.infoURL = "https://wikipedia.org/wiki/Markdown";
        this.inputType = "string";
        this.outputType = "html";
        this.args = [
            {
                name: "Autoconvert URLs to links",
                type: "boolean",
                value: false
            },
            {
                name: "Enable syntax highlighting",
                type: "boolean",
                value: true
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {html}
     */
    run(input, args) {
        const [convertLinks, enableHighlighting] = args,
            md = new MarkdownIt({
                linkify: convertLinks,
                html: false, // Explicitly disable HTML rendering
                highlight: function(str, lang) {
                    if (lang && hljs.getLanguage(lang) && enableHighlighting) {
                        try {
                            return hljs.highlight(lang, str).value;
                        } catch (__) {}
                    }

                    return "";
                }
            });
        md.core.ruler.push("heading_anchors", addHeadingAnchors);
        const rendered = md.render(input);

        // white-space: normal stops the output pane's pre-wrap from turning the
        // newlines between rendered elements into blank lines
        return `<div style="font-family: var(--primary-font-family); white-space: normal">${rendered}</div>`;
    }

}

/**
 * markdown-it core rule: gives each heading an id from its text (GitHub-style
 * slug, prefixed with HEADING_ID_PREFIX) and points links to "#slug" at it.
 * Links to fragments that match no heading are left unchanged.
 *
 * @param {Object} state - markdown-it core state
 */
function addHeadingAnchors(state) {
    const slugger = new HeadingSlugger();
    const slugs = new Set();
    state.tokens.forEach((token, i) => {
        if (token.type !== "heading_open") return;
        const text = (state.tokens[i + 1].children || [])
            .filter(t => t.type === "text" || t.type === "code_inline")
            .map(t => t.content)
            .join("");
        const slug = slugger.slug(text);
        if (!slug) return;
        slugs.add(slug);
        token.attrSet("id", HEADING_ID_PREFIX + slug);
    });
    for (const token of state.tokens) {
        for (const child of token.children || []) {
            if (child.type !== "link_open") continue;
            const href = child.attrGet("href") || "";
            if (!href.startsWith("#")) continue;
            let fragment;
            try {
                fragment = decodeURIComponent(href.slice(1));
            } catch (err) {
                continue;
            }
            if (slugs.has(fragment)) child.attrSet("href", "#" + HEADING_ID_PREFIX + href.slice(1));
        }
    }
}

export default RenderMarkdown;
