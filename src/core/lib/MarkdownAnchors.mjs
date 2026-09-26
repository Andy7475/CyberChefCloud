/**
 * Heading anchors for Markdown, using the same slugs as GitHub, so that links
 * such as [Class hierarchy](#class-hierarchy) work in Render Markdown and in
 * other Markdown viewers.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/**
 * Prefix for heading ids in rendered HTML. It keeps them apart from the ids
 * used by the CyberChef page (e.g. a heading "Output" would otherwise get
 * id="output"). GitHub uses the same prefix.
 */
export const HEADING_ID_PREFIX = "user-content-";

/**
 * Converts heading text to a slug as GitHub does: lower case, punctuation
 * removed (except "-" and "_"), spaces replaced by "-".
 *
 * @param {string} text - the heading's text, without Markdown syntax
 * @returns {string}
 */
export function slugify(text) {
    return String(text).trim().toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
        .replace(/ /g, "-");
}

/**
 * Gives each heading in a document a unique slug, in document order. A slug
 * already used gets "-1", "-2", … appended, as on GitHub.
 */
export class HeadingSlugger {

    /**
     * HeadingSlugger constructor
     */
    constructor() {
        this.used = new Map();
    }

    /**
     * Returns the slug for the next heading.
     *
     * @param {string} text - the heading's text, without Markdown syntax
     * @returns {string}
     */
    slug(text) {
        const base = slugify(text);
        let slug = base;
        let count = this.used.get(base) ?? 0;
        if (this.used.has(base)) {
            do {
                count++;
                slug = `${base}-${count}`;
            } while (this.used.has(slug));
        }
        this.used.set(base, count);
        this.used.set(slug, 0);
        return slug;
    }

}
