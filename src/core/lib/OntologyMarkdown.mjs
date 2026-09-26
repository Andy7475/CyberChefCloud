/**
 * Markdown helpers shared by the ontology operations' reports.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import RenderMarkdown from "../operations/RenderMarkdown.mjs";

/**
 * Escapes text for Markdown (including table cells).
 *
 * @param {string} s
 * @returns {string}
 */
export function md(s) {
    return String(s).replace(/\s+/g, " ").replace(/([\\`*_[\]<>#|~&])/g, "\\$1");
}

/**
 * Formats an identifier or class expression as inline code.
 *
 * @param {string} s
 * @returns {string}
 */
export function code(s) {
    const text = String(s).replace(/\s+/g, " ").replace(/\|/g, "\\|");
    return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

/**
 * Renders Markdown as HTML with the Render Markdown operation.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
    return new RenderMarkdown().run(markdown, [false, true]);
}
