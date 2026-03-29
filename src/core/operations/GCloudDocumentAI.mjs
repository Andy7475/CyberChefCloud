/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { gcpFetch, getGcpCredentials } from "../lib/GoogleCloud.mjs";

/**
 * GCloud Document AI operation — processor-agnostic wrapper for the Document AI
 * Online Processing API. Works with any processor type: Enterprise Document OCR,
 * Form Parser, Lending Document AI, custom classifiers, splitters, etc.
 */
class GCloudDocumentAI extends Operation {

    /**
     * GCloudDocumentAI constructor
     */
    constructor() {
        super();

        this.name = "GCloud Document AI";
        this.module = "Cloud";
        this.description = [
            "Uses Google Cloud DocumentAI to extract text, entities, and form data from documents.",
            "<br><br>",
            "<b>Inputs:</b> A document file (PDF, TIFF, Image) or a GCS URI.",
            "<br>",
            "<b>Outputs:</b> Extracted text or a highly detailed JSON structure of the document.",
            "<br><br>",
            "<b>Example:</b>",
            "<ul><li>Input an invoice PDF, and extract the structured data (invoice number, total amount) via JSON.</li></ul>",
            "<br>",
            "<b>Requirements:</b> Requires a prior <code>Authenticate Google Cloud</code> operation."
        ].join("\n");
        this.infoURL = "https://cloud.google.com/document-ai/docs/overview";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.manualBake = true;
        this.args = [
            {
                "name": "Input Mode",
                "type": "option",
                "value": ["Inline Upload", "GCS URI (gs://...)"]
            },
            {
                "name": "Input MIME Type",
                "type": "editableOption",
                "value": [
                    { name: "PDF", value: "application/pdf" },
                    { name: "JPEG", value: "image/jpeg" },
                    { name: "PNG", value: "image/png" },
                    { name: "TIFF", value: "image/tiff" },
                    { name: "BMP", value: "image/bmp" },
                    { name: "WebP", value: "image/webp" },
                    { name: "GIF", value: "image/gif" }
                ]
            },
            {
                "name": "Processor ID",
                "type": "string",
                "value": ""
            },
            {
                "name": "Location",
                "type": "option",
                "value": ["us", "eu"]
            },
            {
                "name": "Output Mode",
                "type": "option",
                "value": ["Extracted Text", "Form Fields (JSON)", "Full Document (JSON)"]
            }
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {string}
     */
    async run(input, args) {
        const [inputMode, mimeType, processorId, location, outputMode] = args;

        if (!processorId || !processorId.trim()) {
            throw new OperationError(
                "GCloud Document AI: Processor ID is required. " +
                "Create a processor at https://console.cloud.google.com/ai/document-ai and paste its ID."
            );
        }

        const creds = getGcpCredentials();
        if (!creds || !creds.quotaProject) {
            throw new OperationError(
                "GCloud Document AI: Please run 'Authenticate Google Cloud' first and set a Quota Project."
            );
        }

        const project = creds.quotaProject;
        const url = `https://${location}-documentai.googleapis.com/v1/projects/` +
            `${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/` +
            `processors/${encodeURIComponent(processorId.trim())}:process`;

        // Build request body
        let requestBody;
        if (inputMode === "GCS URI (gs://...)") {
            const gcsUri = new TextDecoder("utf-8", { fatal: false }).decode(input).trim();
            if (!gcsUri.startsWith("gs://")) {
                throw new OperationError(
                    "GCloud Document AI: Input Mode is 'GCS URI' but the input does not start with gs://"
                );
            }
            requestBody = {
                gcsDocument: {
                    gcsUri,
                    mimeType
                }
            };
        } else {
            // Inline — base64-encode the ArrayBuffer
            const bytes = new Uint8Array(input);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Content = btoa(binary);

            requestBody = {
                rawDocument: {
                    content: base64Content,
                    mimeType
                }
            };
        }

        let data;
        try {
            data = await gcpFetch(url, {
                method: "POST",
                body: requestBody
            });
        } catch (e) {
            throw new OperationError(`GCloud Document AI: API error: ${e.message}`);
        }

        const document = data.document;
        if (!document) {
            throw new OperationError(
                "GCloud Document AI: No document in API response. " +
                "Check the Processor ID and ensure the processor is enabled."
            );
        }

        return this._formatOutput(document, outputMode);
    }

    /**
     * Formats the Document AI response based on the selected output mode.
     *
     * @param {Object} document - The document object from the API response
     * @param {string} outputMode - The selected output mode
     * @returns {string}
     */
    _formatOutput(document, outputMode) {
        switch (outputMode) {
            case "Extracted Text":
                return document.text || "(No text extracted)";

            case "Form Fields (JSON)": {
                const fields = this._extractFormFields(document);
                if (fields.length === 0) {
                    return JSON.stringify({
                        note: "No form fields found. Ensure you are using a Form Parser or similar processor.",
                        processorHint: "Enterprise Document OCR does not return form fields. Use a Form Parser processor."
                    }, null, 2);
                }
                return JSON.stringify(fields, null, 2);
            }

            case "Full Document (JSON)":
                // Return the full document — can be large; strip image data to keep it manageable
                return JSON.stringify(this._sanitiseDocument(document), null, 2);

            default:
                return document.text || "";
        }
    }

    /**
     * Extracts form fields from a Document AI document response.
     * Tries entities first (Form Parser), then falls back to page-level formFields.
     *
     * @param {Object} document - Document AI document object
     * @returns {Object[]} Array of field objects
     */
    _extractFormFields(document) {
        const fields = [];

        // Primary: document.entities (Form Parser produces these as structured key-value pairs)
        if (document.entities && document.entities.length > 0) {
            for (const entity of document.entities) {
                fields.push({
                    name: entity.type || null,
                    value: entity.mentionText || null,
                    confidence: entity.confidence != null ? parseFloat(entity.confidence.toFixed(3)) : null,
                    normalizedValue: entity.normalizedValue?.text || null,
                    pageNumber: entity.pageAnchor?.pageRefs?.[0]?.page ?? null
                });
            }
            return fields;
        }

        // Fallback: pages[*].formFields (layout-based detection — older Form Parser versions)
        for (const page of document.pages || []) {
            const pageNum = page.pageNumber || 1;
            for (const ff of page.formFields || []) {
                const name = this._resolveAnchorText(ff.fieldName, document.text);
                const value = this._resolveAnchorText(ff.fieldValue, document.text);
                fields.push({
                    name: name || null,
                    value: value || null,
                    confidence: ff.fieldValue?.confidence != null ?
                        parseFloat(ff.fieldValue.confidence.toFixed(3)) : null,
                    pageNumber: pageNum
                });
            }
        }

        return fields;
    }

    /**
     * Resolves a text anchor reference to its actual text using the document text string.
     *
     * @param {Object} anchor - A fieldName or fieldValue object with a textAnchor
     * @param {string} fullText - The full document text string
     * @returns {string}
     */
    _resolveAnchorText(anchor, fullText) {
        if (!anchor || !fullText) return "";
        // Use pre-computed content if available
        if (anchor.textAnchor?.content) return anchor.textAnchor.content.trim();
        // Otherwise resolve from text segments
        const segments = anchor.textAnchor?.textSegments || [];
        return segments
            .map(seg => fullText.slice(
                parseInt(seg.startIndex || 0, 10),
                parseInt(seg.endIndex || 0, 10)
            ))
            .join("")
            .trim();
    }

    /**
     * Strips image bytes from a document to keep Full Document JSON manageable.
     *
     * @param {Object} document - Document AI document object
     * @returns {Object} Sanitised document
     */
    _sanitiseDocument(document) {
        const doc = { ...document };
        // Remove inline image data from pages to avoid huge base64 blobs in output
        if (doc.pages) {
            doc.pages = doc.pages.map(page => {
                const p = { ...page };
                if (p.image) {
                    p.image = { ...p.image, content: "[image bytes removed]" };
                }
                return p;
            });
        }
        return doc;
    }

}

export default GCloudDocumentAI;
