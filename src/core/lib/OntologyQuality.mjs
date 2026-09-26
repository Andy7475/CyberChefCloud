/**
 * Quality checks for an ontology (missing labels and descriptions, terms used
 * but not declared, duplicate labels, …), for the Ontology Quality Checks
 * operation and the quality section of Ontology Summary.
 *
 * Every check is SPARQL over the store. Terms in the common vocabularies
 * (RDF, RDFS, OWL, XSD, SKOS, Dublin Core, …) are not checked, as they are
 * defined elsewhere.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import { WELL_KNOWN_PREFIXES } from "./RDF.mjs";
import { readDescriptions } from "./OntologyModel.mjs";
import { md, code } from "./OntologyMarkdown.mjs";

const EXTERNAL = [...new Set(Object.values(WELL_KNOWN_PREFIXES))];
/** SPARQL test: the IRI in variable v is not in a common vocabulary. */
const local = v => "!(" + EXTERNAL.map(ns => `STRSTARTS(STR(${v}), "${ns}")`).join(" || ") + ")";

const CLASS_TYPES = "owl:Class rdfs:Class";
const PROPERTY_TYPES = "owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty owl:OntologyProperty rdf:Property " +
    "owl:FunctionalProperty owl:InverseFunctionalProperty owl:TransitiveProperty owl:SymmetricProperty " +
    "owl:AsymmetricProperty owl:ReflexiveProperty owl:IrreflexiveProperty";
const declared = (v, types) => `{ SELECT DISTINCT ${v} WHERE { VALUES ?declType { ${types} } ${v} a ?declType FILTER(isIRI(${v}) && ${local(v)}) } }`;
const LABEL = "rdfs:label|skos:prefLabel";

/** Ways an IRI can be used as a class, as [SPARQL pattern binding ?c, description]. */
const CLASS_USES = [
    ["?x a ?c", "rdf:type"],
    ["{ ?c rdfs:subClassOf ?x } UNION { ?x rdfs:subClassOf ?c }", "rdfs:subClassOf"],
    ["{ ?c owl:equivalentClass ?x } UNION { ?x owl:equivalentClass ?c }", "owl:equivalentClass"],
    ["{ ?c owl:disjointWith ?x } UNION { ?x owl:disjointWith ?c }", "owl:disjointWith"],
    ["?x rdfs:domain ?c", "rdfs:domain"],
    ["?x rdfs:range ?c FILTER NOT EXISTS { ?x a owl:DatatypeProperty }", "rdfs:range"],
    ["?x owl:someValuesFrom|owl:allValuesFrom ?c", "a restriction"],
    ["?x owl:unionOf|owl:intersectionOf ?list . ?list rdf:rest*/rdf:first ?c", "a union or intersection"],
];

/**
 * Runs the quality checks.
 *
 * @param {function(string): Map<string, Object>[]} select - runs a SPARQL SELECT (common prefixes added)
 * @param {Object} options
 * @param {string} options.language - for descriptions, e.g. "en"; "" for any
 * @param {function(string): string} options.short - IRI shortener
 * @param {number} [options.maxItems=50] - items listed per check
 * @returns {{id: string, title: string, count: number, items: {iri: string|null, term: string, detail: string}[]}[]}
 */
export function readQualityChecks(select, { language, short, maxItems = 50 }) {
    const lang = language ? ` (${language})` : "";
    const checks = [];
    const add = (id, title, items) => {
        items.sort((a, b) => a.term.localeCompare(b.term));
        checks.push({ id, title, count: items.length, items: items.slice(0, Math.max(0, maxItems)) });
    };
    const item = (iri, detail = "") => ({ iri, term: short(iri), detail });
    const values = (rows, name) => [...new Set(rows.map(r => r.get(name).value))];

    // Missing labels and descriptions
    const classes = values(select(`SELECT ?c WHERE ${declared("?c", CLASS_TYPES)}`), "c");
    const properties = values(select(`SELECT ?p WHERE ${declared("?p", PROPERTY_TYPES)}`), "p");
    const labelled = new Set(values(select(`SELECT DISTINCT ?t WHERE { ?t ${LABEL} ?l FILTER(isIRI(?t)) }`), "t"));
    const described = readDescriptions(select, language);
    add("class-no-label", "Classes without a label", classes.filter(c => !labelled.has(c)).map(c => item(c)));
    add("class-no-description", `Classes without a description${lang}`, classes.filter(c => !described.get(c)?.length).map(c => item(c)));
    add("property-no-label", "Properties without a label", properties.filter(p => !labelled.has(p)).map(p => item(p)));
    add("property-no-description", `Properties without a description${lang}`, properties.filter(p => !described.get(p)?.length).map(p => item(p)));

    // Terms used but not declared
    const classUses = new Map();
    for (const [pattern, how] of CLASS_USES) {
        const rows = select(`SELECT DISTINCT ?c WHERE {
            ${pattern}
            FILTER(isIRI(?c) && ${local("?c")})
            FILTER NOT EXISTS { VALUES ?t { owl:Class rdfs:Class rdfs:Datatype } ?c a ?t }
        }`);
        for (const c of values(rows, "c")) {
            if (!classUses.has(c)) classUses.set(c, []);
            classUses.get(c).push(how);
        }
    }
    add("undeclared-class", "Classes used but not declared (no owl:Class or rdfs:Class)",
        [...classUses].map(([c, hows]) => item(c, "used in " + hows.join(", "))));

    const propertyRows = select(`SELECT ?p (COUNT(*) AS ?n) WHERE {
        { ?s ?p ?o } UNION { ?x owl:onProperty|rdfs:subPropertyOf|owl:inverseOf|owl:equivalentProperty ?p }
        FILTER(isIRI(?p) && ${local("?p")})
        FILTER NOT EXISTS { VALUES ?t { ${PROPERTY_TYPES} } ?p a ?t }
    } GROUP BY ?p`);
    add("undeclared-property", "Properties used but not declared (no property type)",
        propertyRows.map(r => item(r.get("p").value, `used ${r.get("n").value} time${r.get("n").value === "1" ? "" : "s"}`)));

    // Labels
    const labels = select(`SELECT ?t ?l WHERE { ?t ${LABEL} ?l FILTER(isIRI(?t) && isLiteral(?l)) }`);
    const byText = new Map(), byTerm = new Map();
    for (const r of labels) {
        const t = r.get("t").value, l = r.get("l");
        const textKey = l.value.trim().toLowerCase() + "@" + (l.language || "");
        if (!byText.has(textKey)) byText.set(textKey, { label: l, first: t, terms: new Set() });
        const entry = byText.get(textKey);
        entry.terms.add(t);
        // Show the spelling used by the term that sorts first, so the output is stable
        if (t < entry.first) Object.assign(entry, { label: l, first: t });
        const termKey = t + "@" + (l.language || "");
        if (!byTerm.has(termKey)) byTerm.set(termKey, { iri: t, language: l.language, labels: new Set() });
        byTerm.get(termKey).labels.add(l.value.trim());
    }
    const literal = l => JSON.stringify(l.value.trim()) + (l.language ? "@" + l.language : "");
    add("duplicate-label", "Labels used by more than one term",
        [...byText.values()].filter(x => x.terms.size > 1).map(x => ({
            iri: null, term: literal(x.label), detail: [...x.terms].map(short).sort().join(", ")
        })));
    add("several-labels", "Terms with more than one label in the same language",
        [...byTerm.values()].filter(x => x.labels.size > 1).map(x => item(x.iri,
            [...x.labels].sort().map(l => JSON.stringify(l)).join(", ") + (x.language ? ` (@${x.language})` : " (no language)"))));

    // Structure and usage
    add("orphan-class", "Classes with no superclass that nothing refers to",
        values(select(`SELECT ?c WHERE {
            ${declared("?c", CLASS_TYPES)}
            FILTER NOT EXISTS { ?c rdfs:subClassOf ?p FILTER(?p != owl:Thing && ?p != ?c) }
            FILTER NOT EXISTS { ?x ?p ?c FILTER(?x != ?c) }
        }`), "c").map(c => item(c)));
    add("untyped-individual", "Named individuals with no class",
        values(select(`SELECT DISTINCT ?i WHERE {
            ?i a owl:NamedIndividual FILTER(isIRI(?i))
            FILTER NOT EXISTS { ?i a ?t FILTER(?t NOT IN (owl:NamedIndividual, owl:Thing)) }
        }`), "i").map(i => item(i)));
    add("deprecated-in-use", "Deprecated terms still used by other terms",
        select(`SELECT ?d (COUNT(*) AS ?n) WHERE {
            ?d owl:deprecated ?v FILTER(isIRI(?d) && STR(?v) IN ("true", "1"))
            { ?s ?p ?d FILTER(?s != ?d) } UNION { ?s ?d ?o }
        } GROUP BY ?d`).map(r => item(r.get("d").value, `used ${r.get("n").value} time${r.get("n").value === "1" ? "" : "s"}`)));

    // Ontology header
    const ontologies = values(select("SELECT ?o WHERE { ?o a owl:Ontology FILTER(isIRI(?o)) }"), "o");
    const header = [];
    if (!ontologies.length) header.push({ iri: null, term: "(none)", detail: "no owl:Ontology declared" });
    const fields = [
        ["title", "dcterms:title|dc:title|rdfs:label"],
        ["description", "dcterms:description|dc:description|rdfs:comment"],
        ["version", "owl:versionIRI|owl:versionInfo"],
        ["licence", "dcterms:license|dcterms:rights|dc:rights|<http://creativecommons.org/ns#license>"],
    ];
    for (const o of ontologies) {
        const missing = fields.filter(([, path]) => !select(`SELECT ?v WHERE { <${o}> ${path} ?v } LIMIT 1`).length).map(([name]) => name);
        if (missing.length) header.push(item(o, "no " + missing.join(", no ")));
    }
    add("ontology-metadata", "Ontology header missing title, description, version or licence", header);
    return checks;
}

/**
 * Formats check results as plain-text lines: each check with its count (or
 * "ok"), then the items of failing checks, indented.
 *
 * @param {Object[]} checks - from readQualityChecks()
 * @returns {string[]}
 */
export function qualityTextLines(checks) {
    const out = [];
    const width = Math.max(2, ...checks.map(c => String(c.count).length));
    for (const c of checks) {
        out.push(`  ${(c.count ? String(c.count) : "ok").padStart(width)}  ${c.title}`);
        for (const i of c.items) out.push(`  ${" ".repeat(width)}    ${i.term}${i.detail ? `  (${i.detail})` : ""}`);
        if (c.count > c.items.length) out.push(`  ${" ".repeat(width)}    … ${c.count - c.items.length} more`);
    }
    return out;
}

/**
 * Formats check results as Markdown: a table of checks and results, then a
 * list of items for each failing check.
 *
 * @param {Object[]} checks - from readQualityChecks()
 * @param {function(string): string} [name] - formats a term (e.g. as a link); defaults to inline code
 * @returns {string[]} lines
 */
export function qualityMarkdownLines(checks, name = code) {
    const out = ["| Check | Result |", "| --- | ---: |"];
    for (const c of checks) out.push(`| ${md(c.title)} | ${c.count ? `**${c.count}**` : "✓"} |`);
    for (const c of checks.filter(x => x.count)) {
        out.push("", `**${md(c.title)}** (${c.count})`, "");
        for (const i of c.items) {
            const term = i.iri ? name(i.term) : code(i.term);
            out.push(`- ${term}${i.detail ? ` — ${md(i.detail)}` : ""}`);
        }
        if (c.count > c.items.length) out.push(`- … ${c.count - c.items.length} more`);
    }
    return out;
}

/**
 * Formats check results as CSV: one row per item.
 *
 * @param {Object[]} checks - from readQualityChecks()
 * @returns {string}
 */
export function qualityCSV(checks) {
    const cell = s => (/[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s);
    const rows = [["check", "term", "iri", "detail"]];
    for (const c of checks) {
        for (const i of c.items) rows.push([c.title, i.term, i.iri || "", i.detail]);
    }
    return rows.map(r => r.map(cell).join(",")).join("\n");
}
