/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import Utils from "../Utils.mjs";
import { gcpFetch, generateGCSDestinationUri, writeGCSText } from "../lib/GoogleCloud.mjs";

/**
 * Endpoint map: Analysis Type label → NL API v1 path suffix.
 */
const ENDPOINT_MAP = {
    "Analyze Sentiment": "analyzeSentiment",
    "Analyze Entities": "analyzeEntities",
    "Analyze Entity Sentiment": "analyzeEntitySentiment",
    "Analyze Syntax": "analyzeSyntax",
    "Classify Text": "classifyText",
    "Moderate Text": "moderateText",
    "Annotate Text (All)": "annotateText",
};


const NL_API_BASE = "https://language.googleapis.com/v1/documents:";

/**
 * Calls the Natural Language API.
 *
 * @param {string} endpoint - The NL API endpoint suffix (e.g. "analyzeSentiment").
 * @param {Object} document - The NL API Document object.
 * @param {string} [encodingType="UTF8"]
 * @returns {Promise<Object>} The parsed API response body.
 */
async function callNLApi(endpoint, document, encodingType = "UTF8") {
    const url = `${NL_API_BASE}${endpoint}`;

    // For annotateText we need to enable all features explicitly
    const body = endpoint === "annotateText" ?
        {
            document,
            encodingType,
            features: {
                extractSyntax: true,
                extractEntities: true,
                extractDocumentSentiment: true,
                classifyText: true,
                moderateText: true,
            }
        } :
        { document, encodingType };

    return await gcpFetch(url, {
        method: "POST",
        body: body
    });
}

/**
 * Formats a sentiment object into a human-readable string.
 * @param {{score: number, magnitude: number}} sentiment
 * @returns {string}
 */
function formatSentiment(sentiment) {
    if (!sentiment) return "(no sentiment data)";
    const score = sentiment.score?.toFixed(3) ?? "n/a";
    const mag = sentiment.magnitude?.toFixed(3) ?? "n/a";
    const label = sentiment.score >= 0.25 ? "Positive" : sentiment.score <= -0.25 ? "Negative" : "Neutral";
    return `${label} (score: ${score}, magnitude: ${mag})`;
}

/**
 * Builds a human-readable text summary from an NL API response.
 * @param {string} analysisType
 * @param {Object} data
 * @returns {string}
 */
function buildTextSummary(analysisType, data) {
    const lines = [];

    // Helper that adds a section header
    const section = (title) => {
        lines.push("");
        lines.push(`=== ${title} ===`);
    };

    // ── Sentiment ──────────────────────────────────────────────────────────
    if (data.documentSentiment !== undefined) {
        section("Document Sentiment");
        lines.push(formatSentiment(data.documentSentiment));
        if (data.sentences && data.sentences.length > 0) {
            section("Per-Sentence Sentiment");
            for (const s of data.sentences) {
                const text = s.text?.content ?? "";
                lines.push(`  ${formatSentiment(s.sentiment)}  "${text.substring(0, 120)}"`);
            }
        }
    }

    // ── Entities ───────────────────────────────────────────────────────────
    if (data.entities !== undefined) {
        section("Entities");
        if (data.entities.length === 0) {
            lines.push("  (no entities found)");
        } else {
            for (const e of data.entities) {
                const salience = e.salience !== undefined ? ` [salience: ${e.salience.toFixed(3)}]` : "";
                const sentiment = e.sentiment ? `  sentiment: ${formatSentiment(e.sentiment)}` : "";
                lines.push(`  [${e.type}] ${e.name}${salience}${sentiment}`);
                if (e.metadata && Object.keys(e.metadata).length > 0) {
                    for (const [k, v] of Object.entries(e.metadata)) {
                        lines.push(`      ${k}: ${v}`);
                    }
                }
            }
        }
    }

    // ── Tokens (Syntax) ────────────────────────────────────────────────────
    if (data.tokens !== undefined) {
        section("Syntax Tokens");
        if (data.tokens.length === 0) {
            lines.push("  (no tokens)");
        } else {
            const header = "  Text".padEnd(25) + "Lemma".padEnd(25) + "POS".padEnd(12) + "Dependency";
            lines.push(header);
            lines.push("  " + "-".repeat(80));
            for (const t of data.tokens) {
                const text = (t.text?.content ?? "").padEnd(24);
                const lemma = (t.lemma ?? "").padEnd(24);
                const pos = (t.partOfSpeech?.tag ?? "?").padEnd(11);
                const dep = t.dependencyEdge?.label ?? "";
                lines.push(`  ${text} ${lemma} ${pos} ${dep}`);
            }
        }
    }

    // ── Categories (Classify / Annotate) ───────────────────────────────────
    if (data.categories !== undefined) {
        section("Content Categories");
        if (data.categories.length === 0) {
            lines.push("  (no categories)");
        } else {
            for (const c of data.categories) {
                lines.push(`  ${Math.round((c.confidence ?? 0) * 100)}%  ${c.name}`);
            }
        }
    }

    // ── Moderation (Moderate Text) ─────────────────────────────────────────
    if (data.moderationCategories !== undefined) {
        section("Moderation Categories");
        if (data.moderationCategories.length === 0) {
            lines.push("  (no flagged categories)");
        } else {
            for (const c of data.moderationCategories) {
                lines.push(`  ${Math.round((c.confidence ?? 0) * 100)}%  ${c.name}`);
            }
        }
    }

    return lines.join("\n").trimStart();
}

/**
 * Highlights entity mentions in the original text by wrapping them in
 * coloured `<span>` elements, one colour per entity type.
 *
 * Uses a placeholder-then-replace strategy (same pattern as CC's regexHighlight)
 * to avoid double-escaping: the input text is mutated via placeholder tokens,
 * all remaining text is HTML-escaped, and then the placeholders are swapped for
 * pre-built safe span tags.
 *
 * @param {string} text       The raw (unescaped) input text.
 * @param {Array}  entities   The `entities` array from the NL API response.
 * @returns {string}          HTML string safe to inject into the output pane.
 */
function highlightEntities(text, entities) {
    if (!entities || entities.length === 0) {
        return Utils.escapeHtml(text) + "\n\n<i>(No entities detected)</i>";
    }

    // Collect all (offset, length, mentionText, colour, label) tuples across
    // all entity mentions, then sort and walk left-to-right.
    const markings = [];

    for (const entity of entities) {
        const label = `${Utils.escapeHtml(entity.name)} [${entity.type}]`;
        if (!entity.mentions) continue;
        for (const mention of entity.mentions) {
            const mentionText = mention.text?.content;
            const offset = mention.text?.beginOffset;
            if (mentionText === undefined || offset === undefined) continue;
            markings.push({ offset, length: mentionText.length, mentionText, entityType: entity.type, label });
        }
    }

    // Sort by offset ascending so we process left-to-right
    markings.sort((a, b) => a.offset - b.offset);

    // Build output by walking through the text
    let result = "";
    let pos = 0;

    for (const { offset, length, mentionText, entityType, label } of markings) {
        if (offset < pos) continue; // skip overlapping spans
        // Plain text before this mention
        result += Utils.escapeHtml(text.slice(pos, offset));
        // Highlighted span for the mention
        const spanHtml = `<span class="nl-entity nl-entity-${entityType}" title="${label}">${Utils.escapeHtml(mentionText)}</span>`;
        result += spanHtml;
        pos = offset + length;
    }
    // Remaining text after last mention
    result += Utils.escapeHtml(text.slice(pos));

    return result;
}

/**
 * GCloud Natural Language operation
 */
class GCloudNaturalLanguage extends Operation {

    /**
     * GCloudNaturalLanguage constructor
     */
    constructor() {
        super();

        this.name = "GCloud Natural Language";
        this.module = "Cloud";
        this.description = [
            "Analyzes text for sentiment, entity recognition, and syntax using the Google Cloud Natural Language API.",
            "<br><br>",
            "<b>Inputs:</b> Plain text or a GCS URI pointing to a text document.",
            "<br>",
            "<b>Outputs:</b> A JSON object containing sentiment scores, detected entities, or syntax trees.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input <code>I love CyberChef!</code> -> Output JSON showing high positive sentiment.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/natural-language/docs/reference/rest/v1/documents";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.presentType = "html";
        this.highlight = true;
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["Plain Text", "GCS URI (gs://...)"]
            },
            {
                "name": "Input GCS URI",
                "type": "string",
                "value": "",
                "hint": "gs://bucket/path/document.txt — required when Input Mode is GCS URI; also used to auto-generate the output path."
            },
            {
                "name": "Analysis Type",
                "type": "option",
                "value": Object.keys(ENDPOINT_MAP)
            },
            {
                "name": "Language Code (Optional)",
                "type": "string",
                "value": "",
                "hint": "BCP-47 code, e.g. 'en', 'fr'. Leave blank for auto-detect."
            },
            {
                "name": "Output Format",
                "type": "option",
                "value": ["JSON", "Text Summary", "Highlight Entities"]
            },
            {
                "name": "Output Destination",
                "type": "option",
                "value": ["Return to CyberChef", "Write to GCS"]
            },
            {
                "name": "Output GCS URI (Optional)",
                "type": "string",
                "value": "",
                "hint": "gs://bucket/path/ — blank = same directory as Input GCS URI."
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [
            inputMode,
            inputGcsUri,
            analysisType,
            languageCode,
            outputFormat,
            outputDest,
            outputDirectory
        ] = args;

        const endpoint = ENDPOINT_MAP[analysisType];
        if (!endpoint) throw new OperationError(`Unknown Analysis Type: ${analysisType}`);

        // ── Build the NL API Document object ─────────────────────────────
        let document;
        let effectiveGcsUri = inputGcsUri ? inputGcsUri.trim() : "";
        // For Highlight Entities we always need the raw text to perform substitutions
        const needsRawText = outputFormat === "Highlight Entities";
        let rawInputText = null;

        if (inputMode === "GCS URI (gs://...)") {
            if (!effectiveGcsUri) {
                effectiveGcsUri = new TextDecoder().decode(input).trim();
            }
            if (!effectiveGcsUri.startsWith("gs://")) {
                throw new OperationError(
                    "Input Mode is 'GCS URI' but no valid gs:// URI was provided in the " +
                    "Input GCS URI field or the operation input."
                );
            }
            document = { type: "PLAIN_TEXT", gcsContentUri: effectiveGcsUri };
            // For Highlight Entities with a GCS URI we cannot highlight (we don't have the
            // file bytes locally), so fall back to Text Summary with a notice.
            if (needsRawText) {
                rawInputText = null; // will be handled below
            }
        } else {
            rawInputText = Utils.arrayBufferToStr(input);
            if (!rawInputText) throw new OperationError("No text input provided. Add text in the Input pane.");
            document = { type: "PLAIN_TEXT", content: rawInputText };
        }

        if (languageCode && languageCode.trim().length > 0) {
            document.language = languageCode.trim();
        }

        // ── Call API ──────────────────────────────────────────────────────
        // Highlight Entities requires entity data — call analyzeEntities.
        // IMPORTANT: request UTF16 encoding so that beginOffset values returned
        // by the API match JavaScript's UTF-16 string character indices.
        // Default (UTF8) returns byte offsets which diverge from JS indices
        // as soon as any multi-byte character (£, €, emoji…) appears in the text.
        const effectiveEndpoint = needsRawText ? "analyzeEntities" : endpoint;
        const encodingType = needsRawText ? "UTF16" : "UTF8";
        const data = await callNLApi(effectiveEndpoint, document, encodingType);

        // ── Format output ─────────────────────────────────────────────────
        let outputContent;

        if (outputFormat === "Highlight Entities") {
            if (!rawInputText) {
                // GCS URI mode — we don't have the raw bytes, emit a text summary instead
                // Return a sentinel prefix so present() knows to treat it as pre-built HTML
                outputContent = "\x00HTML\x00" + Utils.escapeHtml(
                    "[Highlight Entities requires Plain Text input mode — raw text must be available locally.]\n\n" +
                    buildTextSummary("Analyze Entities", data)
                );
            } else {
                // Return a sentinel prefix so present() knows this is already-built HTML
                outputContent = "\x00HTML\x00" + highlightEntities(rawInputText, data.entities || []);
            }
            return outputContent;
        }

        outputContent = outputFormat === "Text Summary" ?
            buildTextSummary(analysisType, data) :
            JSON.stringify(data, null, 2);

        // ── Write to GCS if requested ──────────────────────────────────────
        if (outputDest === "Write to GCS") {
            const virtualInputUri = effectiveGcsUri || "gs://upload/document.txt";
            const ext = outputFormat === "JSON" ? ".json" : ".txt";
            const contentType = outputFormat === "JSON" ?
                "application/json; charset=utf-8" :
                "text/plain; charset=utf-8";
            const dest = generateGCSDestinationUri(virtualInputUri, outputDirectory, "_ccc_nl", ext);
            await writeGCSText(dest.bucket, dest.objectPath, outputContent, contentType);
            return dest.gcsUri;
        }

        return outputContent;
    }


    /**
     * Presents the run() output as HTML for the CyberChef output pane.
     * Raw text (JSON / Text Summary) is HTML-escaped here so that the audit
     * log always receives clean plain text from run().
     * Entity-highlight output is already HTML (prefixed with a sentinel).
     *
     * @param {string} data
     * @param {Object[]} args
     * @returns {string} HTML string
     */
    present(data, args) {
        // Sentinel set by run() when the string already contains safe HTML
        if (data.startsWith("\x00HTML\x00")) {
            return data.slice(6);
        }
        // Plain text / JSON — HTML-escape for safe display
        return `<pre>${Utils.escapeHtml(data)}</pre>`;
    }

}

export default GCloudNaturalLanguage;
