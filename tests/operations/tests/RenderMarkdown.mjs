/**
 * Render Markdown tests.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */
import TestRegister from "../../lib/TestRegister.mjs";

TestRegister.addTests([
    {
        name: "Render Markdown: headings get GitHub-style anchors",
        input: "# Class hierarchy\n\n## `ex:Pizza` Größe & Übung!",
        expectedOutput: "<div style=\"font-family: var(--primary-font-family)\"><h1 id=\"user-content-class-hierarchy\">Class hierarchy</h1>\n" +
            "<h2 id=\"user-content-expizza-größe--übung\"><code>ex:Pizza</code> Größe &amp; Übung!</h2>\n</div>",
        recipeConfig: [{ op: "Render Markdown", args: [false, true] }],
    },
    {
        name: "Render Markdown: repeated headings get numbered anchors",
        input: "# Notes\n\n# Notes\n\n# Notes-1",
        expectedMatch: /id="user-content-notes"[\s\S]*id="user-content-notes-1"[\s\S]*id="user-content-notes-1-1"/,
        recipeConfig: [{ op: "Render Markdown", args: [false, true] }],
    },
    {
        name: "Render Markdown: links to headings point at their anchors",
        input: "[down](#usage) [elsewhere](#recipe=To_Base64()) [site](https://example.org/#usage)\n\n## Usage",
        expectedMatch: /<a href="#user-content-usage">down<\/a> <a href="#recipe=To_Base64\(\)">elsewhere<\/a> <a href="https:\/\/example\.org\/#usage">site<\/a>/,
        recipeConfig: [{ op: "Render Markdown", args: [false, true] }],
    },
]);
