/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import {
    getOxigraph, loadStore, inputPrefixes, allPrefixes, withPrefixes, shortenIRI, INPUT_FORMATS
} from "../lib/RDF.mjs";
import { withoutInferred } from "../lib/Reasoning.mjs";
import { readQualityChecks, qualityTextLines, qualityMarkdownLines, qualityCSV } from "../lib/OntologyQuality.mjs";
import { renderMarkdown } from "../lib/OntologyMarkdown.mjs";

/**
 * Ontology Quality Checks operation
 */
class OntologyQualityChecks extends Operation {

    /**
     * OntologyQualityChecks constructor
     */
    constructor() {
        super();

        this.name = "Ontology Quality Checks";
        this.module = "Ontology";
        this.description = "Checks an ontology or other RDF data for common quality problems and lists the terms affected:<ul>" +
            "<li>classes and properties without a label, or without a description (rdfs:comment, skos:definition, dcterms:description, OBO definition) in the chosen language;</li>" +
            "<li>classes used (as a type, superclass, domain, range, restriction value, …) but not declared as owl:Class or rdfs:Class, and properties used but not declared;</li>" +
            "<li>labels used by more than one term, and terms with several labels in the same language;</li>" +
            "<li>classes with no superclass that nothing refers to, named individuals with no class, and deprecated terms still in use;</li>" +
            "<li>an ontology header without a title, description, version or licence.</li></ul>" +
            "Terms in common vocabularies (RDF, RDFS, OWL, XSD, SKOS, Dublin Core, …) are not checked.<br><br>" +
            "Works on plain RDF or on the output of <b>Ontology Reasoner</b> (TriG). With reasoned input, 'Triples to check' chooses whether the inferred triples count: " +
            "for example, an individual typed only by inference is not reported as having no class under 'All', but is under 'Asserted only'.<br><br>" +
            "Choose 'CSV' followed by <b>To Table</b> for a table with one row per problem. The same checks can be added to <b>Ontology Summary</b> with its 'Include quality checks' option.";
        this.infoURL = "https://robot.obolibrary.org/report";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Input format",
                type: "option",
                value: INPUT_FORMATS
            },
            {
                name: "Output",
                type: "option",
                value: ["HTML", "Markdown", "Text", "JSON", "CSV"]
            },
            {
                name: "Triples to check",
                type: "option",
                value: ["All (asserted and inferred)", "Asserted only"]
            },
            {
                name: "Language",
                type: "string",
                value: "en"
            },
            {
                name: "Max items per check",
                type: "number",
                value: 50,
                min: 0
            },
            {
                name: "Additional prefixes",
                type: "text",
                value: ""
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {Promise<string>}
     */
    async run(input, args) {
        const [inputFormat, output, triples, language, maxItems, additionalPrefixes] = args;
        const ox = await getOxigraph();
        const loaded = loadStore(ox, input, inputFormat).store;
        const store = triples === "Asserted only" ? withoutInferred(ox, loaded) : loaded;
        const prefixes = allPrefixes(inputPrefixes(input, additionalPrefixes));
        const select = query => store.query(withPrefixes(query, prefixes), { "use_default_graph_as_union": true });
        const short = iri => shortenIRI(iri, prefixes) || iri;
        const checks = readQualityChecks(select, { language: (language || "").trim(), short, maxItems });

        const problems = checks.reduce((n, c) => n + c.count, 0);
        const failing = checks.filter(c => c.count).length;
        const summary = problems ?
            `${problems} problem${problems === 1 ? "" : "s"} in ${failing} of ${checks.length} checks` :
            `All ${checks.length} checks passed`;
        const scope = triples === "Asserted only" ? " (asserted triples only)" : "";
        switch (output) {
            case "JSON":
                return JSON.stringify({ triples: triples === "Asserted only" ? "asserted" : "all", checks }, null, 2);
            case "CSV":
                return qualityCSV(checks);
            case "Text":
                return [`Quality checks${scope}: ${summary}`, "", ...qualityTextLines(checks)].join("\n");
            default:
                return [`# Quality checks${scope}`, "", summary + ".", "", ...qualityMarkdownLines(checks)].join("\n") + "\n";
        }
    }

    /**
     * Renders the Markdown report as HTML when the output is 'HTML'.
     *
     * @param {string} data - the result of run()
     * @param {Object[]} args
     * @returns {string}
     */
    present(data, args) {
        if (args[1] !== "HTML") {
            this.presentType = "string";
            return data;
        }
        this.presentType = "html";
        return renderMarkdown(data);
    }

}

export default OntologyQualityChecks;
