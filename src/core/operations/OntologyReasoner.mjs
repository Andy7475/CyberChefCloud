/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import {
    getOxigraph, loadStore, inputPrefixes, allPrefixes, withPrefixes, shortenIRI, serialise, usedPrefixes, WELL_KNOWN_PREFIXES, INPUT_FORMATS
} from "../lib/RDF.mjs";
import {
    builtInRules, parseCustomRules, formatRules, runRules, runChecks, directInferences,
    INFERRED_GRAPH_PREFIX, RDFS_SPEC, OWL_RL_SPEC, RULES, CHECKS
} from "../lib/Reasoning.mjs";
import { md, code, renderMarkdown } from "../lib/OntologyMarkdown.mjs";

const RDF = WELL_KNOWN_PREFIXES.rdf, RDFS = WELL_KNOWN_PREFIXES.rdfs, OWL = WELL_KNOWN_PREFIXES.owl;
/** Rows listed per section of the impact report; the RDF outputs have them all. */
const MAX_ROWS = 500;
/** Rule ids that link to a specification ("unsatisfiable" is not a spec rule). */
const BUILT_IN_IDS = new Set([...RULES.flatMap(r => [r.id, r.rdfs].filter(Boolean)), ...CHECKS.map(c => c.id).filter(id => id !== "unsatisfiable")]);

/**
 * Ontology Reasoner operation
 */
class OntologyReasoner extends Operation {

    /**
     * OntologyReasoner constructor
     */
    constructor() {
        super();

        this.name = "Ontology Reasoner";
        this.module = "Ontology";
        this.description = "Applies reasoning rules to an ontology or other RDF data and shows the triples they add (materialisation, or 'triple expansion').<br><br>" +
            "<b>Rules</b>:<ul>" +
            "<li><b>OWL RL</b>: the OWL 2 RL/RDF rules (which include the RDFS ones): subclass and sub-property inheritance, domains and ranges, inverse, symmetric and transitive properties, property chains, " +
            "equivalent classes and properties, intersections and unions, someValuesFrom / allValuesFrom / hasValue restrictions, functional properties and owl:sameAs.</li>" +
            "<li><b>RDFS</b>: only the RDFS entailment rules (rdfs2, 3, 5, 7, 9, 11).</li>" +
            "<li><b>Custom rules only</b>: only the rules in 'Custom rules'.</li></ul>" +
            "Each rule is a SPARQL CONSTRUCT query; the rules are applied repeatedly until no new triples appear. Choose Output 'Rules (SPARQL)' to see them. " +
            "<b>Custom rules</b> are extra CONSTRUCT queries, each starting on a line beginning with CONSTRUCT; a comment line <code># rule: name</code> above one names it.<br><br>" +
            "The rules also check consistency: individuals in disjoint classes or owl:Nothing, sameAs/differentFrom clashes, irreflexive or asymmetric property violations, " +
            "and classes that are subclasses of two disjoint classes (so can have no instances).<br><br>" +
            "<b>Outputs</b>:<ul>" +
            "<li><b>Impact report</b>: consistency problems, the triples added by each rule, then the new superclasses, types, property values and equivalences, each with the rule that produced it.</li>" +
            "<li><b>Asserted and inferred (TriG)</b>: the input plus the inferred triples, which are put in named graphs <code>urn:ccc:inferred:&lt;rule&gt;</code>. " +
            "Follow with <b>Ontology Graph</b> (inferred edges are drawn as thick purple dashed lines), <b>Ontology Summary</b> (inferred superclasses are marked), <b>Ontology Quality Checks</b> or <b>SPARQL Query</b>.</li>" +
            "<li><b>Inferred triples only (Turtle)</b>: just the new triples, grouped by rule.</li></ul>" +
            "<b>Show only direct inferences</b> hides inferred triples that follow from another triple by transitivity (e.g. 'x a Food' when x is also inferred to be a Pizza, a subclass of Food), " +
            "trivial ones (x a owl:Thing) and ones about blank nodes (restrictions, which the rules use internally).<br><br>" +
            "OWL RL does not do everything a DL reasoner (HermiT, Pellet, ELK in Protégé) does: for example it places individuals in defined classes but finds only some subclass relationships between defined classes, " +
            "and it ignores cardinality above 1, complementOf reasoning and anything needing 'or' in a superclass.";
        this.infoURL = "https://www.w3.org/TR/owl2-profiles/#OWL_2_RL";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Input format",
                type: "option",
                value: INPUT_FORMATS
            },
            {
                name: "Rules",
                type: "option",
                value: ["OWL RL (includes RDFS)", "RDFS", "Custom rules only"]
            },
            {
                name: "Output",
                type: "option",
                value: ["Impact report (HTML)", "Impact report (Markdown)", "Asserted and inferred (TriG)", "Inferred triples only (Turtle)", "Rules (SPARQL)"]
            },
            {
                name: "Show only direct inferences",
                type: "boolean",
                value: true
            },
            {
                name: "Apply owl:sameAs substitution",
                type: "boolean",
                value: false
            },
            {
                name: "Custom rules",
                type: "text",
                value: ""
            },
            {
                name: "Max rounds",
                type: "number",
                value: 50,
                min: 1
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
        const [inputFormat, ruleSet, output, directOnly, sameAs, customRules, maxRounds, additionalPrefixes] = args;
        const rules = [
            ...(ruleSet === "Custom rules only" ? [] : builtInRules(ruleSet === "RDFS" ? "RDFS" : "OWL RL", { sameAs })),
            ...parseCustomRules(customRules),
        ];
        if (output === "Rules (SPARQL)") return formatRules(rules);

        const ox = await getOxigraph();
        const { store } = loadStore(ox, input, inputFormat);
        const declared = inputPrefixes(input, additionalPrefixes);
        const prefixes = allPrefixes(declared);
        const result = runRules(ox, store, rules, { prefixes, maxRounds: Math.max(1, maxRounds || 1) });
        const shown = directOnly ? directInferences(store) : inferredQuads(store);

        if (output === "Asserted and inferred (TriG)") {
            const out = new ox.Store();
            for (const q of store.match()) if (!isInferred(q)) out.add(q);
            for (const q of shown) out.add(q);
            // Oxigraph writes TriG with full IRIs; declaring the prefixes lets later
            // operations show prefixed names again.
            const prefixLines = Object.entries(usedPrefixes(out.match(), declared)).map(([name, ns]) => `@prefix ${name}: <${ns}> .`);
            return `# Inferred triples are in the named graphs ${INFERRED_GRAPH_PREFIX}<rule>.\n` +
                (prefixLines.length ? prefixLines.join("\n") + "\n\n" : "") + serialise(ox, out, "TriG", declared);
        }
        if (output === "Inferred triples only (Turtle)") return inferredTurtle(ox, shown, rules, declared, result.total);

        const short = t => termText(t, prefixes);
        const select = query => store.query(withPrefixes(query, prefixes), { "use_default_graph_as_union": true });
        const problems = runChecks(select, short);
        return impactReport({ rules, ruleSet, result, shown, problems, short, directOnly });
    }

    /**
     * Renders the impact report as HTML when the output is 'Impact report (HTML)'.
     *
     * @param {string} data - the result of run()
     * @param {Object[]} args
     * @returns {string}
     */
    present(data, args) {
        if (args[2] !== "Impact report (HTML)") {
            this.presentType = "string";
            return data;
        }
        this.presentType = "html";
        return renderMarkdown(data);
    }

}

/**
 * Tests whether a quad is in an inferred graph.
 *
 * @param {Object} q
 * @returns {boolean}
 */
function isInferred(q) {
    return q.graph.termType === "NamedNode" && q.graph.value.startsWith(INFERRED_GRAPH_PREFIX);
}

/**
 * Returns all quads in inferred graphs.
 *
 * @param {Object} store
 * @returns {Object[]}
 */
function inferredQuads(store) {
    return [...store.match()].filter(isInferred);
}

/**
 * Returns the rule id from an inferred quad's graph name.
 *
 * @param {Object} q
 * @returns {string}
 */
function ruleOf(q) {
    return decodeURIComponent(q.graph.value.slice(INFERRED_GRAPH_PREFIX.length));
}

/**
 * Formats a term for the report: prefixed name, full IRI, "_:id" or a quoted literal.
 *
 * @param {Object} t
 * @param {Object<string, string>} prefixes
 * @returns {string}
 */
function termText(t, prefixes) {
    if (t.termType === "NamedNode") return shortenIRI(t.value, prefixes) || t.value;
    if (t.termType === "BlankNode") return "_:" + t.value;
    return JSON.stringify(t.value) + (t.language ? "@" + t.language : "");
}

/**
 * Serialises the inferred triples as Turtle, grouped by rule with a comment
 * before each group.
 *
 * @param {Object} ox
 * @param {Object[]} quads - inferred quads to write
 * @param {Object[]} rules
 * @param {Object<string, string>} declared - prefixes from the input
 * @param {number} total - number of triples inferred, including hidden ones
 * @returns {string}
 */
function inferredTurtle(ox, quads, rules, declared, total) {
    if (!quads.length) {
        return total ?
            `# ${total} triple${total === 1 ? " was" : "s were"} inferred, but none is direct: each follows from another triple by transitivity, is trivial, or is about blank nodes.\n` +
            "# Untick 'Show only direct inferences' to see them.\n" :
            "# No new triples were inferred.\n";
    }
    const descriptions = new Map(rules.map(r => [r.id, r.description]));
    const groups = new Map();
    for (const q of quads) {
        const id = ruleOf(q);
        if (!groups.has(id)) groups.set(id, new ox.Store());
        groups.get(id).add(ox.quad(q.subject, q.predicate, q.object, ox.defaultGraph()));
    }
    const prefixLines = new Set();
    const bodies = [];
    for (const [id, group] of groups) {
        // Blank nodes must keep their ids to mean the same node as in the input,
        // so groups containing them are written without nesting.
        const hasBlank = group.match().some(q => q.subject.termType === "BlankNode" || q.object.termType === "BlankNode");
        const text = serialise(ox, group, "Turtle", hasBlank ? null : declared);
        const body = text.split("\n").filter(line => {
            if (/^\s*@prefix\b/i.test(line)) {
                prefixLines.add(line.trim());
                return false;
            }
            return true;
        }).join("\n").trim();
        bodies.push(`# ${id}: ${descriptions.get(id) || ""} (${group.size} triple${group.size === 1 ? "" : "s"})\n${body}`);
    }
    return [...prefixLines].join("\n") + (prefixLines.size ? "\n\n" : "") + bodies.join("\n\n") + "\n";
}

/**
 * Returns a Markdown link to a rule's specification, or the id as code for custom rules.
 *
 * @param {string} id
 * @returns {string}
 */
function ruleLink(id) {
    if (!BUILT_IN_IDS.has(id)) return code(id);
    return `[${code(id)}][${id.startsWith("rdfs") ? "rdfs" : "owl-rl"}]`;
}

/**
 * Writes a Markdown table, truncated to MAX_ROWS rows.
 *
 * @param {string[]} header
 * @param {string[][]} rows
 * @returns {string[]} lines
 */
function table(header, rows) {
    const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
    for (const r of rows.slice(0, MAX_ROWS)) lines.push(`| ${r.join(" | ")} |`);
    if (rows.length > MAX_ROWS) lines.push(`| … ${rows.length - MAX_ROWS} more |${" |".repeat(header.length - 1)}`);
    return lines;
}

/**
 * Formats the impact report as Markdown.
 *
 * @param {Object} report
 * @returns {string}
 */
function impactReport({ rules, ruleSet, result, shown, problems, short, directOnly }) {
    const out = ["# Reasoning impact", ""];
    const custom = rules.filter(r => !BUILT_IN_IDS.has(r.id)).length;
    const setName = ruleSet === "Custom rules only" ? "custom rules" : ruleSet === "RDFS" ? "RDFS rules" : "OWL 2 RL rules";
    const ruleCount = new Set(rules.map(r => r.id)).size;
    out.push(`Applied ${ruleCount} ${setName}${custom && ruleSet !== "Custom rules only" ? ` (including ${custom} custom)` : ""} ` +
        `in ${result.rounds} round${result.rounds === 1 ? "" : "s"}: **${result.total}** new triple${result.total === 1 ? "" : "s"} inferred` +
        (directOnly && shown.length !== result.total ?
            `, **${shown.length}** shown. The other ${result.total - shown.length} follow from these by transitivity, are trivial, or are about blank nodes (untick 'Show only direct inferences' to see them).` :
            "."), "");

    out.push("## Consistency", "");
    if (!problems.length) {
        out.push("No problems found.", "");
    } else {
        for (const p of problems) {
            out.push(`${ruleLink(p.id)}: ${md(p.description)}`, "");
            for (const m of p.messages.slice(0, MAX_ROWS)) out.push(`- ${md(m)}`);
            if (p.messages.length > MAX_ROWS) out.push(`- … ${p.messages.length - MAX_ROWS} more`);
            out.push("");
        }
    }

    out.push("## Triples added by each rule", "");
    const shownPerRule = new Map();
    for (const q of shown) shownPerRule.set(ruleOf(q), (shownPerRule.get(ruleOf(q)) || 0) + 1);
    const descriptions = new Map();
    for (const r of rules) if (!descriptions.has(r.id)) descriptions.set(r.id, r.description);
    const active = [...result.perRule].filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
    if (active.length) {
        out.push(...table(["Rule", "What it does", "Added", "Shown"],
            active.map(([id, n]) => [ruleLink(id), md(descriptions.get(id)), String(n), String(shownPerRule.get(id) || 0)])), "");
    }
    if (active.length) {
        out.push("Each triple is credited to the rule that produced it in the final step. Earlier steps often involve blank nodes " +
            "(restrictions and class expressions), which are hidden when only direct inferences are shown.", "");
    }
    const idle = [...result.perRule].filter(([, n]) => !n).map(([id]) => id);
    if (idle.length) out.push(`Rules that added nothing: ${idle.map(code).join(", ")}.`, "");

    const predicateIn = list => q => list.includes(q.predicate.value);
    const sections = [
        ["New superclasses", ["Class", "Superclass"], predicateIn([RDFS + "subClassOf"])],
        ["New types", ["Individual", "Class"], predicateIn([RDF + "type"])],
        ["Equivalences and sameAs", ["Term", "Relation", "Term"], predicateIn([OWL + "equivalentClass", OWL + "equivalentProperty", OWL + "sameAs"])],
        ["Property schema (domains, ranges, sub-properties)", ["Property", "Relation", "Value"], predicateIn([RDFS + "domain", RDFS + "range", RDFS + "subPropertyOf"])],
    ];
    const used = new Set();
    for (const [title, header, test] of sections) {
        const quads = shown.filter(q => !used.has(q) && test(q));
        quads.forEach(q => used.add(q));
        if (!quads.length) continue;
        const rows = quads.map(q => header.length === 2 ?
            [code(short(q.subject)), code(short(q.object)), ruleLink(ruleOf(q))] :
            [code(short(q.subject)), code(short(q.predicate)), code(short(q.object)), ruleLink(ruleOf(q))]);
        rows.sort((a, b) => a.join().localeCompare(b.join()));
        out.push(`## ${title} (${quads.length})`, "", ...table([...header, "Rule"], rows), "");
    }
    const values = shown.filter(q => !used.has(q));
    if (values.length) {
        const rows = values.map(q => [code(short(q.predicate)), code(short(q.subject)), code(short(q.object)), ruleLink(ruleOf(q))]);
        rows.sort((a, b) => a.join().localeCompare(b.join()));
        out.push(`## New property values (${values.length})`, "", ...table(["Property", "Subject", "Value", "Rule"], rows), "");
    }
    if (!shown.length) out.push("No new triples to show.", "");
    out.push(`[rdfs]: ${RDFS_SPEC}`, `[owl-rl]: ${OWL_RL_SPEC}`);
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export default OntologyReasoner;
