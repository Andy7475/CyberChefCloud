/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import {ViewPlugin, keymap} from "@codemirror/view";
import {Prec} from "@codemirror/state";
import {getSearchQuery, searchPanelOpen} from "@codemirror/search";

/*
 * When the output is rendered HTML, the editor document is empty and the HTML
 * is displayed as a widget (see htmlWidget.mjs). CodeMirror's search only looks
 * at the document, so the search panel finds nothing. This extension searches
 * the text of the rendered HTML instead, highlights the matches with the CSS
 * Custom Highlight API and makes next/previous step through them.
 */

const MATCH_HIGHLIGHT = "ccc-search-match";
const CURRENT_HIGHLIGHT = "ccc-search-current";
const MAX_MATCHES = 10000;

/**
 * Builds a global RegExp equivalent to a CodeMirror SearchQuery
 * @param {SearchQuery} query
 * @returns {RegExp|null}
 */
function queryRegExp(query) {
    let source = query.regexp ?
        query.search :
        query.unquoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (query.wholeWord)
        source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    try {
        return new RegExp(source, "gmu" + (query.caseSensitive ? "" : "i"));
    } catch (err) {
        return null;
    }
}

/**
 * Finds all matches of a query in the text nodes under an element
 * @param {Element} root
 * @param {SearchQuery} query
 * @returns {Range[]}
 */
function findMatches(root, query) {
    const re = queryRegExp(query);
    if (!re) return [];

    // Concatenate the visible text nodes, remembering where each one starts
    const nodes = [], starts = [];
    let text = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => n.parentElement.closest("script, style") ?
            NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n);
        starts.push(text.length);
        text += n.nodeValue;
    }

    const ranges = [];
    let i = 0;
    /**
     * Sets one end of a range to a text offset. Offsets only increase, so the
     * node index carries on from the previous call.
     * @param {Range} range
     * @param {string} end - "setStart" or "setEnd"
     * @param {number} offset
     */
    const place = (range, end, offset) => {
        while (i < nodes.length - 1 && starts[i + 1] <= offset &&
            !(end === "setEnd" && starts[i + 1] === offset)) i++;
        range[end](nodes[i], offset - starts[i]);
    };
    for (const m of text.matchAll(re)) {
        if (!m[0].length) continue;
        const range = document.createRange();
        place(range, "setStart", m.index);
        place(range, "setEnd", m.index + m[0].length);
        ranges.push(range);
        if (ranges.length >= MAX_MATCHES) break;
    }
    return ranges;
}

/**
 * Scrolls the editor so that a range is in view, centring it if it is not
 * @param {EditorView} view
 * @param {Range} range
 */
function scrollRangeIntoView(view, range) {
    const el = range.startContainer.parentElement;
    if (el) el.scrollIntoView({block: "nearest", inline: "nearest"});
    const r = range.getBoundingClientRect(),
        s = view.scrollDOM.getBoundingClientRect();
    if (r.top < s.top || r.bottom > s.bottom)
        view.scrollDOM.scrollTop += r.top - s.top - (s.height - r.height) / 2;
    if (r.left < s.left || r.right > s.right)
        view.scrollDOM.scrollLeft += r.left - s.left - (s.width - r.width) / 2;
}

/**
 * Search support for rendered HTML output
 * @param {Object} htmlOutput - The output HTML state shared with htmlPlugin
 * @returns {Extension}
 */
export function htmlSearch(htmlOutput) {
    const plugin = ViewPlugin.fromClass(
        class {
            /**
             * Plugin constructor
             * @param {EditorView} view
             */
            constructor(view) {
                this.view = view;
                this.root = null;
                this.query = null;
                this.matches = [];
                this.current = -1;

                // The panel's next/prev buttons call CodeMirror's findNext/findPrevious
                // directly, which do nothing on an empty document, so listen for them here
                this.onClick = e => {
                    const button = e.target.closest ?
                        e.target.closest(".cm-search button[name=next], .cm-search button[name=prev]") :
                        null;
                    if (button && this.active())
                        this.step(button.name === "next" ? 1 : -1);
                };
                view.dom.addEventListener("click", this.onClick, true);
            }

            /**
             * Whether the output is HTML and the search panel is open
             * @returns {boolean}
             */
            active() {
                return htmlOutput.html.length > 0 && searchPanelOpen(this.view.state);
            }

            /**
             * Editor update listener. The HTML widget's DOM is only in place after the
             * update, so the matches are refreshed in the measure phase.
             * @param {ViewUpdate} update
             */
            update(update) {
                update.view.requestMeasure({
                    key: this,
                    read: () => null,
                    write: () => this.refresh()
                });
            }

            /**
             * Recalculates the matches if the query or the rendered HTML has changed
             */
            refresh() {
                const root = this.active() ? this.view.dom.querySelector("#output-html") : null;
                const query = getSearchQuery(this.view.state);
                if (root === this.root && query === this.query) return;
                this.root = root;
                this.query = query;
                this.current = -1;
                this.matches = root && query.valid ? findMatches(root, query) : [];
                this.paint();
            }

            /**
             * Moves to the next or previous match
             * @param {number} dir - 1 for next, -1 for previous
             */
            step(dir) {
                this.refresh();
                const n = this.matches.length;
                if (!n) return;
                this.current = this.current < 0 ?
                    (dir > 0 ? 0 : n - 1) :
                    (this.current + dir + n) % n;
                this.paint();
                scrollRangeIntoView(this.view, this.matches[this.current]);
            }

            /**
             * Applies the match highlights
             */
            paint() {
                if (typeof CSS === "undefined" || !CSS.highlights) return;
                if (!this.matches.length) {
                    CSS.highlights.delete(MATCH_HIGHLIGHT);
                    CSS.highlights.delete(CURRENT_HIGHLIGHT);
                    return;
                }
                CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...this.matches));
                if (this.current >= 0)
                    CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(this.matches[this.current]));
                else
                    CSS.highlights.delete(CURRENT_HIGHLIGHT);
            }

            /**
             * Removes the listener and highlights
             */
            destroy() {
                this.view.dom.removeEventListener("click", this.onClick, true);
                this.matches = [];
                this.paint();
            }
        }
    );

    /**
     * Builds a command that steps through HTML matches, or returns false so that
     * the default search command runs when the output is not HTML
     * @param {number} dir
     * @param {boolean} [searchFieldOnly=false] - Only run when the search field has focus
     * @returns {Command}
     */
    const stepCommand = (dir, searchFieldOnly = false) => view => {
        const p = view.plugin(plugin);
        if (!p || !p.active()) return false;
        if (searchFieldOnly && view.dom.ownerDocument.activeElement?.name !== "search")
            return false;
        p.step(dir);
        return true;
    };

    return [
        plugin,
        Prec.high(keymap.of([
            {key: "Enter", run: stepCommand(1, true), shift: stepCommand(-1, true), scope: "search-panel"},
            {key: "F3", run: stepCommand(1), shift: stepCommand(-1), scope: "editor search-panel"},
            {key: "Mod-g", run: stepCommand(1), shift: stepCommand(-1), scope: "editor search-panel"}
        ]))
    ];
}
