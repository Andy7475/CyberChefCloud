/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import {
    getOxigraph, loadStore, inputPrefixes, allPrefixes, withPrefixes, shortenIRI, localName, preferredLabels, langMatches, WELL_KNOWN_PREFIXES, INPUT_FORMATS
} from "../lib/RDF.mjs";
import { readClassHierarchy, readDescriptions, buildClassDetails } from "../lib/OntologyModel.mjs";
import { HeadingSlugger } from "../lib/MarkdownAnchors.mjs";
import { md, code, renderMarkdown } from "../lib/OntologyMarkdown.mjs";
import { inferredIndex, tripleKey } from "../lib/Reasoning.mjs";
import { readQualityChecks, qualityTextLines, qualityMarkdownLines } from "../lib/OntologyQuality.mjs";

const MAX_TREE_LINES = 5000;
const MAX_SUBCLASS_LINES = 100;

/** Counted metrics: label -> SPARQL pattern binding ?x. */
const COUNTS = [
    ["Classes", "{ ?x a owl:Class } UNION { ?x a rdfs:Class } FILTER(isIRI(?x))"],
    ["Object properties", "?x a owl:ObjectProperty"],
    ["Datatype properties", "?x a owl:DatatypeProperty"],
    ["Annotation properties", "?x a owl:AnnotationProperty"],
    ["RDF properties", "?x a rdf:Property"],
    ["Named individuals", "?x a owl:NamedIndividual"],
    ["Restrictions", "?x a owl:Restriction"],
    ["SKOS concepts", "?x a skos:Concept"],
    ["Deprecated terms", "?x owl:deprecated true"],
];

/**
 * Ontology Summary operation
 */
class OntologySummary extends Operation {

    /**
     * OntologySummary constructor
     */
    constructor() {
        super();

        this.name = "Ontology Summary";
        this.module = "Ontology";
        this.description = "Summarises an ontology or other RDF data: the ontology IRI, version, title and imports; counts of triples, classes, properties, individuals and restrictions; the namespaces in use; and the class hierarchy (rdfs:subClassOf between named classes) as an indented tree.<br><br>" +
            "<b>Include class details</b> adds a reference section with one entry per class, in hierarchy order: its superclasses and definitions, its descriptions (rdfs:comment, skos:definition, dcterms:description, OBO definition) in the chosen language, its subclasses as a tree (including subclasses of subclasses), " +
            "every property that applies to it through rdfs:domain on the class or an ancestor (with the range and the class it is inherited from), and its OWL restrictions (e.g. <code>hasTopping some Tomato</code>). " +
            "Properties with no domain apply to any class and are listed once at the end.<br><br>" +
            "<b>Language</b> filters descriptions (e.g. <code>en</code>, or <code>en, fr</code>; leave empty for all). Untagged text is always included. Labels prefer this language and fall back to others.<br><br>" +
            "Choose 'HTML' to read the report as a formatted document: this is the Markdown report displayed through <b>Render Markdown</b>. " +
            "HTML is only rendered when this is the last operation; otherwise the Markdown is passed to the next operation. " +
            "Choose 'Markdown' to get the Markdown text itself (e.g. to save it or view it on GitHub). " +
            "In the Markdown and HTML, class names (in the hierarchy, superclasses, paths, ranges, domains and restrictions) link to the class's entry in the class details, and a contents line links to each section. " +
            "Choose 'Counts CSV' followed by <b>To Table</b> ('Make first row header' ticked) to show the counts as a table." +
            "<br><br><b>Additional prefixes</b>: prefix declarations to use as well as those in the input (Turtle <code>@prefix</code>, SPARQL <code>PREFIX</code>, RDF/XML <code>xmlns:</code> or a JSON-LD <code>@context</code>). " +
            "To reuse the prefixes of the original file after a step that loses them (e.g. N-Triples), put <b>Register</b> at the start of the recipe and enter <code>$R0</code> here.<br><br>" +
            "<b>Include quality checks</b> adds the checks of <b>Ontology Quality Checks</b> (missing labels and descriptions, classes used but not declared, duplicate labels, …) as a final section.<br><br>" +
            "After <b>Ontology Reasoner</b> (TriG output), subclass links that were inferred are marked '(inferred)', and the counts include the number of inferred triples.";
        this.infoURL = "https://www.w3.org/TR/owl2-primer/";
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
                value: ["Text report", "HTML", "Markdown", "JSON", "Counts CSV"]
            },
            {
                name: "Include class hierarchy",
                type: "boolean",
                value: true
            },
            {
                name: "Max tree depth",
                type: "number",
                value: 10,
                min: 1
            },
            {
                name: "Include class details",
                type: "boolean",
                value: true
            },
            {
                name: "Language",
                type: "string",
                value: "en"
            },
            {
                name: "Additional prefixes",
                type: "text",
                value: ""
            },
            {
                name: "Include quality checks",
                type: "boolean",
                value: false
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {Promise<string>}
     */
    async run(input, args) {
        const [inputFormat, output, includeTree, maxDepth, includeDetails, language, additionalPrefixes, includeQuality = false] = args;
        const lang = (language || "").trim();
        const ox = await getOxigraph();
        const { store, format } = loadStore(ox, input, inputFormat);
        const prefixes = allPrefixes(inputPrefixes(input, additionalPrefixes));

        const select = query => store.query(withPrefixes(query, prefixes), { "use_default_graph_as_union": true });
        const values = (rows, name) => [...new Set(rows.map(r => r.get(name)?.value).filter(Boolean))];
        const inLanguage = (rows, name) => [...new Set(rows.map(r => r.get(name)).filter(t => t && langMatches(t.language, lang)).map(t => t.value))];
        const short = iri => shortenIRI(iri, prefixes) || iri;
        const labels = preferredLabels(ox, store, lang || "en");
        const labelOf = iri => labels.get(iri) ?? null;

        // Ontology header
        const ontRows = select("SELECT ?o ?v ?imp WHERE { ?o a owl:Ontology OPTIONAL { ?o owl:versionIRI ?v } OPTIONAL { ?o owl:imports ?imp } }");
        const titleRows = select("SELECT ?t WHERE { ?o a owl:Ontology ; dcterms:title|dc:title|rdfs:label ?t }");
        const descRows = select("SELECT ?d WHERE { ?o a owl:Ontology ; dcterms:description|dc:description|rdfs:comment ?d }");
        const ontology = {
            iri: values(ontRows, "o"),
            versionIRI: values(ontRows, "v"),
            title: inLanguage(titleRows, "t").length ? inLanguage(titleRows, "t") : values(titleRows, "t"),
            description: inLanguage(descRows, "d"),
            imports: values(ontRows, "imp"),
        };

        // Counts (triples include inferred ones)
        const inferred = inferredIndex(store);
        const counts = { "Triples": store.size };
        if (inferred.size) counts["Inferred triples"] = inferred.size;
        counts["Distinct subjects"] = countOf(select("SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s ?p ?o }"));
        for (const [label, pattern] of COUNTS) {
            counts[label] = countOf(select(`SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { ${pattern} }`));
        }
        counts["Named graphs"] = countOf(select("SELECT (COUNT(DISTINCT ?g) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }"));
        if (output === "Counts CSV") {
            return ["metric,count", ...Object.entries(counts).map(([k, v]) => `${k},${v}`)].join("\n");
        }

        // Namespaces by number of IRI occurrences
        const nsCounts = new Map();
        const addIRI = t => {
            if (t.termType !== "NamedNode") return;
            const m = /^(.*[#/])[^#/]*$/.exec(t.value);
            const ns = m ? m[1] : t.value;
            nsCounts.set(ns, (nsCounts.get(ns) || 0) + 1);
        };
        for (const q of store.match()) [q.subject, q.predicate, q.object].forEach(addIRI);
        const nsToPrefix = new Map(Object.entries(prefixes).map(([name, ns]) => [ns, name]));
        const namespaces = [...nsCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([namespace, count]) => ({ namespace, prefix: nsToPrefix.get(namespace) ?? null, count }));

        // Class hierarchy and details
        const needHierarchy = includeTree || includeDetails;
        const iriTerm = value => ({ termType: "NamedNode", value });
        const subClassOf = iriTerm(WELL_KNOWN_PREFIXES.rdfs + "subClassOf");
        const isInferred = (c, p) => inferred.has(tripleKey(iriTerm(c), subClassOf, iriTerm(p)));
        const hierarchy = needHierarchy ? readClassHierarchy(select, labelOf, isInferred) : null;
        const tree = includeTree ? classTree(hierarchy, short, labelOf, Math.max(1, maxDepth || 1)) : null;
        const details = includeDetails ?
            buildClassDetails({ select, hierarchy, short, labelOf, descriptions: readDescriptions(select, lang) }) :
            null;

        const quality = includeQuality ? readQualityChecks(select, { language: lang, short, maxItems: 50 }) : null;

        const report = { format, language: lang, ontology, counts, namespaces, tree, details, quality };
        if (output === "JSON") {
            return JSON.stringify({
                format, language: lang, ontology, counts, namespaces,
                classHierarchy: tree ? tree.nodes : undefined,
                classes: details ? details.classes : undefined,
                propertiesForAnyClass: details ? details.anyClass : undefined,
                propertiesMatchingNoClass: details ? details.unmatched : undefined,
                qualityChecks: quality ?? undefined,
            }, null, 2);
        }
        if (output === "Markdown" || output === "HTML") return markdownReport(report);
        return textReport(report);
    }

    /**
     * Renders the Markdown report as HTML when the output is 'HTML'. Other
     * outputs are displayed as text.
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

/**
 * Reads the ?n count from a COUNT query result.
 *
 * @param {Map<string, Object>[]} rows
 * @returns {number}
 */
function countOf(rows) {
    return rows.length ? parseInt(rows[0].get("n").value, 10) : 0;
}

/**
 * Returns "name "label"" for display, omitting the label if it only repeats the name.
 *
 * @param {string} name - prefixed name
 * @param {string|null} label
 * @param {string} iri
 * @returns {string}
 */
function nameWithLabel(name, label, iri) {
    return label && label !== localName(iri) ? `${name} "${label}"` : name;
}

/**
 * Builds the class tree (a class with several superclasses appears under each).
 *
 * @param {Object} hierarchy - from readClassHierarchy()
 * @param {function(string): string} short - IRI shortener
 * @param {function(string): string|null} labelOf
 * @param {number} maxDepth
 * @returns {{nodes: Object[], rows: {depth: number, iri: string, name: string, label: string|null, text: string, inferred: boolean, more: number}[], truncated: boolean}}
 */
function classTree(hierarchy, short, labelOf, maxDepth) {
    const { children, roots } = hierarchy;
    const rows = [];
    let truncated = false;
    const build = (iri, depth, path, parent) => {
        const inferred = parent !== null && hierarchy.inferredLinks.has(iri + " " + parent);
        const node = { iri, label: labelOf(iri), ...(inferred ? { inferred: true } : {}) };
        if (rows.length >= MAX_TREE_LINES) {
            truncated = true;
            return node;
        }
        rows.push({ depth, iri, name: short(iri), label: labelOf(iri), text: nameWithLabel(short(iri), labelOf(iri), iri), inferred });
        const kids = (children.get(iri) || []).filter(k => !path.has(k));
        if (kids.length && depth + 1 >= maxDepth) {
            rows.push({ depth: depth + 1, more: kids.length });
        } else if (kids.length) {
            path.add(iri);
            node.children = kids.map(k => build(k, depth + 1, path, iri));
            path.delete(iri);
        }
        return node;
    };
    const nodes = roots.map(r => build(r, 0, new Set(), null));
    return { nodes, rows, truncated };
}

/**
 * Text for a tree row that stands for subclasses below the depth limit.
 *
 * @param {number} n
 * @returns {string}
 */
function moreText(n) {
    return `… (${n} subclass${n === 1 ? "" : "es"} below max depth)`;
}

/**
 * Lists a class's subclasses as a tree: direct subclasses, their subclasses,
 * and so on. A class with several superclasses in the tree appears under each.
 *
 * @param {Object} c - class from buildClassDetails()
 * @param {Map<string, Object>} byName - classes by prefixed name
 * @returns {{rows: {depth: number, name: string, label: string|null, iri: string, inferred: boolean}[], direct: number, total: number, omitted: number}}
 */
function subclassTree(c, byName) {
    const rows = [];
    const all = new Set();
    let omitted = 0;
    const walk = (parent, depth, path) => {
        for (const name of parent.subClasses || []) {
            const child = byName.get(name);
            if (!child || path.has(name)) continue;
            all.add(name);
            if (rows.length >= MAX_SUBCLASS_LINES) {
                omitted++;
            } else {
                rows.push({ depth, name, label: child.label, iri: child.iri, inferred: (child.inferredSubClassOf || []).includes(parent.name) });
            }
            path.add(name);
            walk(child, depth + 1, path);
            path.delete(name);
        }
    };
    walk(c, 0, new Set([c.name]));
    return { rows, direct: (c.subClasses || []).length, total: all.size, omitted };
}

/**
 * Heading text for a subclass tree, e.g. "3 direct, 7 in total".
 *
 * @param {Object} subs - from subclassTree()
 * @returns {string}
 */
function subclassCounts(subs) {
    return subs.total > subs.direct ? `${subs.direct} direct, ${subs.total} in total` : `${subs.direct}`;
}

/** Subject of the example statement for a property with no domain. */
const ANY_CLASS = "(any class)";

/**
 * The label of a property, or null if it only repeats the name.
 *
 * @param {Object} p
 * @returns {string|null}
 */
function propertyLabel(p) {
    return p.label && p.label !== localName(p.iri) ? p.label : null;
}

/**
 * The notes shown under a property's example statement, as [name, value] pairs.
 *
 * @param {Object} p
 * @returns {string[][]}
 */
function propertyNotes(p) {
    return [
        ["Property type", p.kind === "property" ? "rdf:Property" : p.kind],
        ["Inherited from", p.from],
        ["Domain", p.domain],
        ["Domain via", p.domainVia],
    ].filter(([, value]) => value);
}

/**
 * Formats one property for the text report: its name and label, its
 * description, then an example statement (subject — property → range) and
 * notes, indented below.
 *
 * @param {Object} p
 * @param {string} subject - the class the property is used on
 * @param {string} pad - indentation
 * @returns {string[]}
 */
function propertyTextLines(p, subject, pad) {
    const label = propertyLabel(p);
    const range = (p.range || "(any)") + (p.rangeVia ? ` (via ${p.rangeVia})` : "");
    return [
        pad + p.name + (label ? ` "${label}"` : ""),
        ...(p.description ? [`${pad}  ${p.description.replace(/\s+/g, " ")}`] : []),
        `${pad}  - ${subject} — ${p.name}${label ? ` ("${label}")` : ""} → ${range}`,
        ...propertyNotes(p).map(([name, value]) => `${pad}  - ${name}: ${value}`),
    ];
}

/**
 * Formats the summary as a plain-text report.
 *
 * @param {Object} report
 * @returns {string}
 */
function textReport({ format, language, ontology, counts, namespaces, tree, details, quality }) {
    const out = [];
    const field = (name, vals) => {
        if (vals.length) out.push(`${(name + ":").padEnd(14)}${vals.map(v => v.replace(/\s+/g, " ")).join("\n" + " ".repeat(14))}`);
    };
    out.push("Ontology");
    field("IRI", ontology.iri.length ? ontology.iri : ["(no owl:Ontology declared)"]);
    field("Version IRI", ontology.versionIRI);
    field("Title", ontology.title);
    field("Description", ontology.description);
    field("Imports", ontology.imports);
    field("Input format", [format]);

    out.push("", "Counts");
    const width = Math.max(...Object.keys(counts).map(k => k.length)) + 2;
    for (const [k, v] of Object.entries(counts)) {
        if (v || k === "Triples" || k === "Classes") out.push(`  ${k.padEnd(width)}${v}`);
    }

    out.push("", "Namespaces (by usage)");
    const prefixWidth = Math.max(0, ...namespaces.map(n => (n.prefix ?? "").length)) + 2;
    for (const n of namespaces.slice(0, 30)) {
        out.push(`  ${(n.prefix !== null ? n.prefix + ":" : "").padEnd(prefixWidth)}${n.namespace}  (${n.count})`);
    }
    if (namespaces.length > 30) out.push(`  … ${namespaces.length - 30} more`);

    if (tree) {
        out.push("", "Class hierarchy");
        if (!tree.rows.length) out.push("  (no classes)");
        for (const row of tree.rows) out.push("  " + "  ".repeat(row.depth) + (row.more ? moreText(row.more) : row.text + (row.inferred ? " (inferred)" : "")));
        if (tree.truncated) out.push(`  … truncated at ${MAX_TREE_LINES} lines`);
    }

    if (details) {
        const flat = s => s.replace(/\s+/g, " ");
        out.push("", `Class details${language ? ` (descriptions: ${language})` : ""}`);
        if (!details.classes.length) out.push("  (no classes)");
        const byName = new Map(details.classes.map(c => [c.name, c]));
        for (const c of details.classes) {
            const pad = "  " + "  ".repeat(c.depth);
            const sub = (label, vals) => {
                vals.forEach((v, i) => out.push(`${pad}  ${(i ? "" : label + ":").padEnd(15)}${flat(v)}`));
            };
            out.push("", pad + nameWithLabel(c.name, c.label, c.iri));
            const inferredSupers = new Set(c.inferredSubClassOf || []);
            sub("Subclass of", c.subClassOf.map(s => (inferredSupers.has(s) ? s + " (inferred)" : s)));
            sub("Equivalent to", c.equivalentTo);
            sub("Description", c.descriptions);
            const subs = subclassTree(c, byName);
            if (subs.rows.length) {
                out.push(`${pad}  Subclasses (${subclassCounts(subs)}):`);
                for (const row of subs.rows) {
                    out.push(`${pad}    ${"  ".repeat(row.depth)}${nameWithLabel(row.name, row.label, row.iri)}${row.inferred ? " (inferred)" : ""}`);
                }
                if (subs.omitted) out.push(`${pad}    … ${subs.omitted} more`);
            }
            if (c.properties.length) {
                out.push(`${pad}  Properties:`);
                for (const p of c.properties) out.push(...propertyTextLines(p, c.name, pad + "    "));
            }
            if (c.restrictions.length) {
                out.push(`${pad}  Restrictions:`);
                for (const r of c.restrictions) out.push(`${pad}    ${r.text}${r.from ? `  (from ${r.from})` : ""}`);
            }
        }
        const globalList = (title, list) => {
            if (!list.length) return;
            out.push("", title);
            for (const p of list) out.push(...propertyTextLines({ ...p, domain: null }, p.domain || ANY_CLASS, "  "));
        };
        globalList("Properties that apply to any class (no domain, or owl:Thing)", details.anyClass);
        globalList("Properties whose domain matches no class", details.unmatched);
    }
    if (quality) out.push("", "Quality checks", ...qualityTextLines(quality));
    return out.join("\n");
}

/** Splits a class expression into quoted literals, names/keywords, and separators. */
const EXPRESSION_TOKENS = /"(?:[^"\\]|\\.)*"(?:@[\w-]+|\^\^[^\s(){},]+)?|[^\s(){},]+|[\s(){},]+/g;

/**
 * Writes Markdown with links between sections. Headings are given GitHub-style
 * anchors in document order; links to a class are written as placeholders and
 * resolved to the class heading's anchor at the end, so a link can come before
 * its heading.
 */
class LinkedMarkdown {

    /**
     * LinkedMarkdown constructor
     *
     * @param {Set<string>} linkedNames - names (prefixed) of the classes that get a heading
     */
    constructor(linkedNames) {
        this.lines = [];
        this.linkedNames = linkedNames;
        this.slugger = new HeadingSlugger();
        this.anchors = new Map();
        this.keys = [];
        this.keyIndex = new Map();
    }

    /**
     * Adds lines.
     *
     * @param {...string} lines
     */
    push(...lines) {
        this.lines.push(...lines);
    }

    /**
     * Adds a heading and records its anchor under a key.
     *
     * @param {number} level
     * @param {string} markdown - heading content
     * @param {string} text - the same content as plain text, which the anchor is made from
     * @param {string} [key]
     */
    heading(level, markdown, text, key) {
        const slug = this.slugger.slug(text);
        if (key) this.anchors.set(key, slug);
        this.lines.push(`${"#".repeat(level)} ${markdown}`, "");
    }

    /**
     * Returns a link to the heading recorded under a key.
     *
     * @param {string} key
     * @param {string} markdown - link text
     * @returns {string}
     */
    link(key, markdown) {
        if (!this.keyIndex.has(key)) this.keyIndex.set(key, this.keys.push(key) - 1);
        const i = this.keyIndex.get(key);
        return `[${markdown}](#\u0000${i}\u0000)`;
    }

    /**
     * Formats a class name as code, linked to its class details when it has them.
     *
     * @param {string} name
     * @returns {string}
     */
    name(name) {
        return this.linkedNames.has(name) ? this.link("class:" + name, code(name)) : code(name);
    }

    /**
     * Formats a class expression such as "hasTopping some (Mozzarella or Tomato)":
     * names and literals as code, class names linked, keywords as text.
     *
     * @param {string} expression
     * @returns {string}
     */
    expression(expression) {
        const tokens = String(expression).replace(/\s+/g, " ").match(EXPRESSION_TOKENS) || [];
        return tokens.map(t => {
            if (t.startsWith("\"")) return code(t);
            if (/^[\s(){},]+$/.test(t)) return t;
            if (t.includes(":") || this.linkedNames.has(t)) return this.name(t);
            return md(t);
        }).join("");
    }

    /**
     * Returns the document with links resolved.
     *
     * @returns {string}
     */
    toString() {
        return this.lines.join("\n")
            .replace(/\u0000(\d+)\u0000/g, (_, i) => this.anchors.get(this.keys[i]) ?? "")
            .replace(/\n{3,}/g, "\n\n").trim() + "\n";
    }

}

/**
 * Formats one property as a Markdown list item: its name and label, its
 * description, then a nested list with an example statement
 * (subject — property → range) and notes. (A table would be squeezed
 * unreadably in the narrow output pane once descriptions are long.)
 *
 * @param {Object} p
 * @param {LinkedMarkdown} doc
 * @param {string} subject - Markdown for the class the property is used on
 * @returns {string}
 */
function propertyItem(p, doc, subject) {
    const label = propertyLabel(p);
    const range = (p.range ? doc.expression(p.range) : "(any)") + (p.rangeVia ? ` (via ${code(p.rangeVia)})` : "");
    const noteValue = {
        "Inherited from": v => doc.name(v),
        "Domain": v => doc.expression(v),
        "Domain via": v => code(v),
    };
    return [
        `- ${code(p.name)}${label ? " " + md(label) : ""}` + (p.description ? `  \n  ${md(p.description)}` : ""),
        `  - ${subject} — ${code(p.name)}${label ? ` ("${md(label)}")` : ""} → ${range}`,
        ...propertyNotes(p).map(([name, value]) => `  - ${name}: ${(noteValue[name] || md)(value)}`),
    ].join("\n");
}

/**
 * Formats the summary as Markdown, for the Render Markdown operation.
 *
 * @param {Object} report
 * @returns {string}
 */
function markdownReport({ format, language, ontology, counts, namespaces, tree, details, quality }) {
    const doc = new LinkedMarkdown(new Set(details ? details.classes.map(c => c.name) : []));
    const title = ontology.title[0] || "Ontology summary";
    doc.heading(1, md(title), title.replace(/\s+/g, " "));
    const field = (name, vals, asCode) => {
        if (vals.length) doc.push(`- **${name}:** ${vals.map(v => asCode ? code(v) : md(v)).join(", ")}`);
    };
    field("IRI", ontology.iri.length ? ontology.iri : ["(no owl:Ontology declared)"], ontology.iri.length > 0);
    field("Version IRI", ontology.versionIRI, true);
    field("Imports", ontology.imports, true);
    field("Input format", [format]);
    if (ontology.description.length) doc.push("", ...ontology.description.map(d => md(d) + "\n"));

    const sections = [["Counts"], ["Namespaces"]];
    if (tree) sections.push(["Class hierarchy"]);
    if (details) {
        sections.push(["Classes"]);
        if (details.anyClass.length) sections.push(["Properties that apply to any class", "Properties for any class"]);
        if (details.unmatched.length) sections.push(["Properties whose domain matches no class", "Properties matching no class"]);
    }
    if (quality) sections.push(["Quality checks"]);
    doc.push("", "**Contents:** " + sections.map(([heading, short]) => doc.link("section:" + heading, short || heading)).join(" · "), "");

    doc.heading(2, "Counts", "Counts", "section:Counts");
    doc.push("| Metric | Count |", "| --- | ---: |");
    for (const [k, v] of Object.entries(counts)) {
        if (v || k === "Triples" || k === "Classes") doc.push(`| ${k} | ${v} |`);
    }

    doc.push("");
    doc.heading(2, "Namespaces", "Namespaces", "section:Namespaces");
    doc.push("| Prefix | Namespace | Uses |", "| --- | --- | ---: |");
    for (const n of namespaces.slice(0, 30)) {
        doc.push(`| ${n.prefix !== null ? code(n.prefix + ":") : ""} | ${code(n.namespace)} | ${n.count} |`);
    }
    if (namespaces.length > 30) doc.push(`| | … ${namespaces.length - 30} more | |`);

    if (tree) {
        doc.push("");
        doc.heading(2, "Class hierarchy", "Class hierarchy", "section:Class hierarchy");
        if (!tree.rows.length) doc.push("(no classes)");
        for (const row of tree.rows) {
            const pad = "  ".repeat(row.depth);
            if (row.more) {
                doc.push(`${pad}- ${md(moreText(row.more))}`);
            } else {
                const label = row.label && row.label !== localName(row.iri) ? " " + md(row.label) : "";
                doc.push(`${pad}- ${doc.name(row.name)}${label}${row.inferred ? " *(inferred)*" : ""}`);
            }
        }
        if (tree.truncated) doc.push("", `… truncated at ${MAX_TREE_LINES} lines`);
    }

    if (details) {
        doc.push("");
        doc.heading(2, "Classes", "Classes", "section:Classes");
        doc.push("Each class lists its **Properties**: those whose `rdfs:domain` is the class or one of its ancestors. " +
            "Under each property's name and description is an example statement, *this class — property → range*, where the range is what the value must be. " +
            "**Property type** is *object* (the value is another resource), *datatype* (the value is a literal such as a string or number) or *annotation*. " +
            "**Inherited from** is the ancestor whose domain gives this class the property.", "");
        if (language) doc.push(`Descriptions in: ${md(language)} (and untagged).`, "");
        if (!details.classes.length) doc.push("(no classes)");
        const byName = new Map(details.classes.map(c => [c.name, c]));
        for (const c of details.classes) {
            const hasLabel = c.label && c.label !== localName(c.iri);
            doc.heading(3,
                code(c.name) + (hasLabel ? " " + md(c.label) : ""),
                c.name.replace(/\s+/g, " ") + (hasLabel ? " " + c.label.replace(/\s+/g, " ") : ""),
                "class:" + c.name);
            const lines = [];
            if (c.path.length > 1) lines.push(`**Path:** ${[...c.path.slice(0, -1).map(n => doc.name(n)), code(c.name)].join(" › ")}`);
            const inferredSupers = new Set(c.inferredSubClassOf || []);
            if (c.subClassOf.length) {
                lines.push(`**Subclass of:** ${c.subClassOf.map(e => doc.expression(e) + (inferredSupers.has(e) ? " *(inferred)*" : "")).join(", ")}`);
            }
            if (c.equivalentTo.length) lines.push(`**Equivalent to:** ${c.equivalentTo.map(e => doc.expression(e)).join(", ")}`);
            lines.push(`**IRI:** ${code(c.iri)}`);
            doc.push(lines.join("  \n"), "");
            for (const d of c.descriptions) doc.push(`> ${md(d)}`, "");
            const subs = subclassTree(c, byName);
            if (subs.rows.length) {
                doc.push(`**Subclasses** (${subclassCounts(subs)})`, "");
                for (const row of subs.rows) {
                    const label = row.label && row.label !== localName(row.iri) ? " " + md(row.label) : "";
                    doc.push(`${"  ".repeat(row.depth)}- ${doc.name(row.name)}${label}${row.inferred ? " *(inferred)*" : ""}`);
                }
                if (subs.omitted) doc.push(`- … ${subs.omitted} more`);
                doc.push("");
            }
            if (c.properties.length) {
                doc.push("**Properties**", "");
                for (const p of c.properties) doc.push(propertyItem(p, doc, code(c.name)));
                doc.push("");
            }
            if (c.restrictions.length) {
                doc.push("**Restrictions**", "");
                for (const r of c.restrictions) doc.push(`- ${doc.expression(r.text)}${r.from ? ` *(from ${doc.name(r.from)})*` : ""}`);
                doc.push("");
            }
        }
        const globalList = (heading, list) => {
            if (!list.length) return;
            doc.heading(2, heading, heading, "section:" + heading);
            for (const p of list) doc.push(propertyItem({ ...p, domain: null }, doc, p.domain ? doc.expression(p.domain) : md(ANY_CLASS)));
            doc.push("");
        };
        globalList("Properties that apply to any class", details.anyClass);
        globalList("Properties whose domain matches no class", details.unmatched);
    }
    if (quality) {
        doc.push("");
        doc.heading(2, "Quality checks", "Quality checks", "section:Quality checks");
        doc.push(...qualityMarkdownLines(quality, n => doc.name(n)), "");
    }
    return doc.toString();
}

export default OntologySummary;
