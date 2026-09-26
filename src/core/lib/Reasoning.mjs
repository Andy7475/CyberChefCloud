/**
 * Rule-based reasoning over an Oxigraph store: the RDFS entailment rules and
 * the OWL 2 RL/RDF rules, each written as a SPARQL CONSTRUCT query and applied
 * repeatedly until no new triples appear.
 *
 * Rule ids and meanings follow the W3C specifications:
 * - RDFS: RDF 1.1 Semantics, section 9.2.1 (rdfs2, rdfs3, …)
 * - OWL 2 RL: OWL 2 Profiles, section 4.3, tables 4–9 (cax-sco, prp-inv1, …)
 *
 * Each rule's new triples are stored in the named graph
 * `urn:ccc:inferred:<rule id>`, so which rule produced a triple survives
 * serialisation as TriG or N-Quads, and later operations can tell asserted
 * triples from inferred ones.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import OperationError from "../errors/OperationError.mjs";
import { WELL_KNOWN_PREFIXES, withPrefixes } from "./RDF.mjs";

export const INFERRED_GRAPH_PREFIX = "urn:ccc:inferred:";

const RDF = WELL_KNOWN_PREFIXES.rdf, RDFS = WELL_KNOWN_PREFIXES.rdfs, OWL = WELL_KNOWN_PREFIXES.owl;
const RDF_TYPE = RDF + "type";
const SUB_CLASS_OF = RDFS + "subClassOf";
const SUB_PROPERTY_OF = RDFS + "subPropertyOf";

export const RDFS_SPEC = "https://www.w3.org/TR/rdf11-mt/#patterns-of-rdfs-entailment-informative";
export const OWL_RL_SPEC = "https://www.w3.org/TR/owl2-profiles/#Reasoning_in_OWL_2_RL_and_RDF_Graphs_using_Rules";

/** Prologue for the built-in rules; declared here so input prefixes cannot redefine them. */
const PROLOGUE = `PREFIX rdf: <${RDF}>\nPREFIX rdfs: <${RDFS}>\nPREFIX owl: <${OWL}>\n`;

/** SPARQL pattern binding ?c1 and ?c2 to two classes declared disjoint. */
const DISJOINT_PAIR = `{ ?c1 owl:disjointWith ?c2 } UNION { ?c2 owl:disjointWith ?c1 }
        UNION { ?adc a owl:AllDisjointClasses ; owl:members ?l . ?l rdf:rest*/rdf:first ?c1 . ?l rdf:rest*/rdf:first ?c2 FILTER(?c1 != ?c2) }`;

/**
 * The rules. `rdfs` is the id of the equivalent RDFS rule, for rules in both
 * sets; `optional` rules only run when asked for.
 */
export const RULES = [
    // Properties (OWL 2 RL table 5)
    { id: "prp-dom", rdfs: "rdfs2", description: "A subject of a property is an instance of the property's domain.",
        where: "?p rdfs:domain ?c . ?x ?p ?y", construct: "?x a ?c" },
    { id: "prp-rng", rdfs: "rdfs3", description: "An object of a property is an instance of the property's range.",
        where: "?p rdfs:range ?c . ?x ?p ?y FILTER(!isLiteral(?y))", construct: "?y a ?c" },
    { id: "prp-spo1", rdfs: "rdfs7", description: "A statement with a sub-property also holds for the super-property.",
        where: "?p1 rdfs:subPropertyOf ?p2 . ?x ?p1 ?y FILTER(?p1 != ?p2)", construct: "?x ?p2 ?y" },
    // Property chains: one query per chain length (2 and 3), both reported as prp-spo2.
    { id: "prp-spo2", description: "A property chain (p1 then p2) implies the chained property.",
        where: `?p owl:propertyChainAxiom ?l . ?l rdf:first ?p1 ; rdf:rest ?l2 . ?l2 rdf:first ?p2 ; rdf:rest rdf:nil .
        ?u0 ?p1 ?u1 . ?u1 ?p2 ?u2`,
        construct: "?u0 ?p ?u2" },
    { id: "prp-spo2", description: "A property chain (p1 then p2 then p3) implies the chained property.",
        where: `?p owl:propertyChainAxiom ?l . ?l rdf:first ?p1 ; rdf:rest ?l2 . ?l2 rdf:first ?p2 ; rdf:rest ?l3 .
        ?l3 rdf:first ?p3 ; rdf:rest rdf:nil . ?u0 ?p1 ?u1 . ?u1 ?p2 ?u2 . ?u2 ?p3 ?u3`,
        construct: "?u0 ?p ?u3" },
    { id: "prp-symp", description: "A symmetric property holds in both directions.",
        where: "?p a owl:SymmetricProperty . ?x ?p ?y", construct: "?y ?p ?x" },
    { id: "prp-trp", description: "A transitive property chains: x p y and y p z give x p z.",
        where: "?p a owl:TransitiveProperty . ?x ?p ?y . ?y ?p ?z", construct: "?x ?p ?z" },
    { id: "prp-inv1", description: "x p y gives y q x when q is the inverse of p.",
        where: "?p1 owl:inverseOf ?p2 . ?x ?p1 ?y FILTER(!isLiteral(?y))", construct: "?y ?p2 ?x" },
    { id: "prp-inv2", description: "x q y gives y p x when q is the inverse of p.",
        where: "?p1 owl:inverseOf ?p2 . ?x ?p2 ?y FILTER(!isLiteral(?y))", construct: "?y ?p1 ?x" },
    { id: "prp-eqp1", description: "A statement with a property also holds for an equivalent property.",
        where: "?p1 owl:equivalentProperty ?p2 . ?x ?p1 ?y", construct: "?x ?p2 ?y" },
    { id: "prp-eqp2", description: "A statement with a property also holds for an equivalent property (reverse direction).",
        where: "?p1 owl:equivalentProperty ?p2 . ?x ?p2 ?y", construct: "?x ?p1 ?y" },
    { id: "prp-fp", description: "Two values of a functional property for the same subject are the same individual.",
        where: "?p a owl:FunctionalProperty . ?x ?p ?y1 . ?x ?p ?y2 FILTER(?y1 != ?y2 && !isLiteral(?y1) && !isLiteral(?y2))",
        construct: "?y1 owl:sameAs ?y2" },
    { id: "prp-ifp", description: "Two subjects with the same value of an inverse-functional property are the same individual.",
        where: "?p a owl:InverseFunctionalProperty . ?x1 ?p ?y . ?x2 ?p ?y FILTER(?x1 != ?x2)", construct: "?x1 owl:sameAs ?x2" },

    // Equality (table 4)
    { id: "eq-sym", description: "owl:sameAs is symmetric.",
        where: "?x owl:sameAs ?y FILTER(?x != ?y)", construct: "?y owl:sameAs ?x" },
    { id: "eq-trans", description: "owl:sameAs is transitive.",
        where: "?x owl:sameAs ?y . ?y owl:sameAs ?z FILTER(?x != ?z)", construct: "?x owl:sameAs ?z" },
    { id: "eq-rep-s", optional: "sameAs", description: "Statements about an individual also hold for anything owl:sameAs it (subject).",
        where: "?s owl:sameAs ?s2 . ?s ?p ?o FILTER(?s != ?s2 && ?p != owl:sameAs)", construct: "?s2 ?p ?o" },
    { id: "eq-rep-p", optional: "sameAs", description: "Statements with a property also hold for anything owl:sameAs it (predicate).",
        where: "?p owl:sameAs ?p2 . ?s ?p ?o FILTER(?p != ?p2)", construct: "?s ?p2 ?o" },
    { id: "eq-rep-o", optional: "sameAs", description: "Statements about an individual also hold for anything owl:sameAs it (object).",
        where: "?o owl:sameAs ?o2 . ?s ?p ?o FILTER(?o != ?o2 && ?p != owl:sameAs)", construct: "?s ?p ?o2" },

    // Classes (table 6)
    { id: "cls-int1", description: "An instance of every class in an intersection is an instance of the intersection.",
        where: `?c owl:intersectionOf ?l . ?l rdf:first ?first . ?y a ?first .
        FILTER NOT EXISTS { ?l rdf:rest*/rdf:first ?m . FILTER NOT EXISTS { ?y a ?m } }`,
        construct: "?y a ?c" },
    { id: "cls-int2", description: "An instance of an intersection is an instance of each class in it.",
        where: "?c owl:intersectionOf ?l . ?l rdf:rest*/rdf:first ?ci . ?y a ?c", construct: "?y a ?ci" },
    { id: "cls-uni", description: "An instance of any class in a union is an instance of the union.",
        where: "?c owl:unionOf ?l . ?l rdf:rest*/rdf:first ?ci . ?y a ?ci", construct: "?y a ?c" },
    { id: "cls-svf1", description: "Something with a p-value of class C is an instance of (p some C).",
        where: "?r owl:someValuesFrom ?c ; owl:onProperty ?p . ?u ?p ?v . ?v a ?c", construct: "?u a ?r" },
    { id: "cls-svf2", description: "Something with any p-value is an instance of (p some owl:Thing).",
        where: "?r owl:someValuesFrom owl:Thing ; owl:onProperty ?p . ?u ?p ?v", construct: "?u a ?r" },
    { id: "cls-avf", description: "The p-values of an instance of (p only C) are instances of C.",
        where: "?r owl:allValuesFrom ?c ; owl:onProperty ?p . ?u a ?r . ?u ?p ?v FILTER(!isLiteral(?v))", construct: "?v a ?c" },
    { id: "cls-hv1", description: "An instance of (p value v) has p-value v.",
        where: "?r owl:hasValue ?v ; owl:onProperty ?p . ?u a ?r", construct: "?u ?p ?v" },
    { id: "cls-hv2", description: "Something with p-value v is an instance of (p value v).",
        where: "?r owl:hasValue ?v ; owl:onProperty ?p . ?u ?p ?v", construct: "?u a ?r" },
    { id: "cls-maxc2", description: "Two p-values of an instance of (p max 1) are the same individual.",
        where: `?r owl:maxCardinality ?n ; owl:onProperty ?p FILTER(?n = 1) . ?u a ?r ; ?p ?y1 , ?y2
        FILTER(?y1 != ?y2 && !isLiteral(?y1) && !isLiteral(?y2))`,
        construct: "?y1 owl:sameAs ?y2" },

    // Class axioms (table 7)
    { id: "cax-sco", rdfs: "rdfs9", description: "An instance of a class is an instance of its superclasses.",
        where: "?c1 rdfs:subClassOf ?c2 . ?x a ?c1 FILTER(?c1 != ?c2)", construct: "?x a ?c2" },
    { id: "cax-eqc1", description: "An instance of a class is an instance of its equivalent classes.",
        where: "?c1 owl:equivalentClass ?c2 . ?x a ?c1", construct: "?x a ?c2" },
    { id: "cax-eqc2", description: "An instance of a class is an instance of its equivalent classes (reverse direction).",
        where: "?c1 owl:equivalentClass ?c2 . ?x a ?c2", construct: "?x a ?c1" },

    // Schema (table 9)
    { id: "scm-sco", rdfs: "rdfs11", description: "rdfs:subClassOf is transitive.",
        where: "?c1 rdfs:subClassOf ?c2 . ?c2 rdfs:subClassOf ?c3 FILTER(?c1 != ?c3)", construct: "?c1 rdfs:subClassOf ?c3" },
    { id: "scm-eqc1", description: "Equivalent classes are subclasses of each other.",
        where: "?c1 owl:equivalentClass ?c2 FILTER(?c1 != ?c2)", construct: "?c1 rdfs:subClassOf ?c2 . ?c2 rdfs:subClassOf ?c1" },
    { id: "scm-eqc2", description: "Classes that are subclasses of each other are equivalent.",
        where: "?c1 rdfs:subClassOf ?c2 . ?c2 rdfs:subClassOf ?c1 FILTER(?c1 != ?c2)", construct: "?c1 owl:equivalentClass ?c2" },
    { id: "scm-spo", rdfs: "rdfs5", description: "rdfs:subPropertyOf is transitive.",
        where: "?p1 rdfs:subPropertyOf ?p2 . ?p2 rdfs:subPropertyOf ?p3 FILTER(?p1 != ?p3)", construct: "?p1 rdfs:subPropertyOf ?p3" },
    { id: "scm-eqp1", description: "Equivalent properties are sub-properties of each other.",
        where: "?p1 owl:equivalentProperty ?p2 FILTER(?p1 != ?p2)", construct: "?p1 rdfs:subPropertyOf ?p2 . ?p2 rdfs:subPropertyOf ?p1" },
    { id: "scm-eqp2", description: "Properties that are sub-properties of each other are equivalent.",
        where: "?p1 rdfs:subPropertyOf ?p2 . ?p2 rdfs:subPropertyOf ?p1 FILTER(?p1 != ?p2)", construct: "?p1 owl:equivalentProperty ?p2" },
    { id: "scm-dom1", description: "A property's domain extends to the domain's superclasses.",
        where: "?p rdfs:domain ?c1 . ?c1 rdfs:subClassOf ?c2 FILTER(?c1 != ?c2)", construct: "?p rdfs:domain ?c2" },
    { id: "scm-dom2", description: "A sub-property has the domain of its super-property.",
        where: "?p2 rdfs:domain ?c . ?p1 rdfs:subPropertyOf ?p2 FILTER(?p1 != ?p2)", construct: "?p1 rdfs:domain ?c" },
    { id: "scm-rng1", description: "A property's range extends to the range's superclasses.",
        where: "?p rdfs:range ?c1 . ?c1 rdfs:subClassOf ?c2 FILTER(?c1 != ?c2)", construct: "?p rdfs:range ?c2" },
    { id: "scm-rng2", description: "A sub-property has the range of its super-property.",
        where: "?p2 rdfs:range ?c . ?p1 rdfs:subPropertyOf ?p2 FILTER(?p1 != ?p2)", construct: "?p1 rdfs:range ?c" },
    { id: "scm-hv", description: "(p1 value v) is a subclass of (p2 value v) when p1 is a sub-property of p2.",
        where: "?c1 owl:hasValue ?v ; owl:onProperty ?p1 . ?c2 owl:hasValue ?v ; owl:onProperty ?p2 . ?p1 rdfs:subPropertyOf ?p2 FILTER(?c1 != ?c2)",
        construct: "?c1 rdfs:subClassOf ?c2" },
    { id: "scm-svf1", description: "(p some C1) is a subclass of (p some C2) when C1 is a subclass of C2.",
        where: "?c1 owl:someValuesFrom ?y1 ; owl:onProperty ?p . ?c2 owl:someValuesFrom ?y2 ; owl:onProperty ?p . ?y1 rdfs:subClassOf ?y2 FILTER(?c1 != ?c2)",
        construct: "?c1 rdfs:subClassOf ?c2" },
    { id: "scm-svf2", description: "(p1 some C) is a subclass of (p2 some C) when p1 is a sub-property of p2.",
        where: "?c1 owl:someValuesFrom ?y ; owl:onProperty ?p1 . ?c2 owl:someValuesFrom ?y ; owl:onProperty ?p2 . ?p1 rdfs:subPropertyOf ?p2 FILTER(?c1 != ?c2)",
        construct: "?c1 rdfs:subClassOf ?c2" },
    { id: "scm-avf1", description: "(p only C1) is a subclass of (p only C2) when C1 is a subclass of C2.",
        where: "?c1 owl:allValuesFrom ?y1 ; owl:onProperty ?p . ?c2 owl:allValuesFrom ?y2 ; owl:onProperty ?p . ?y1 rdfs:subClassOf ?y2 FILTER(?c1 != ?c2)",
        construct: "?c1 rdfs:subClassOf ?c2" },
    { id: "scm-avf2", description: "(p2 only C) is a subclass of (p1 only C) when p1 is a sub-property of p2.",
        where: "?c1 owl:allValuesFrom ?y ; owl:onProperty ?p1 . ?c2 owl:allValuesFrom ?y ; owl:onProperty ?p2 . ?p1 rdfs:subPropertyOf ?p2 FILTER(?c1 != ?c2)",
        construct: "?c2 rdfs:subClassOf ?c1" },
    { id: "scm-int", description: "An intersection is a subclass of each class in it.",
        where: "?c owl:intersectionOf ?l . ?l rdf:rest*/rdf:first ?ci", construct: "?c rdfs:subClassOf ?ci" },
    { id: "scm-uni", description: "Each class in a union is a subclass of the union.",
        where: "?c owl:unionOf ?l . ?l rdf:rest*/rdf:first ?ci", construct: "?ci rdfs:subClassOf ?c" },
];

/**
 * Consistency checks: the OWL 2 RL rules whose conclusion is "false", plus
 * classes that can have no instances. Each is a SELECT; `message` turns a
 * result row (a function from variable name to display text) into a sentence.
 */
export const CHECKS = [
    { id: "cax-dw", description: "An individual is an instance of two disjoint classes.",
        select: `SELECT DISTINCT ?x ?c1 ?c2 WHERE { ${DISJOINT_PAIR} ?x a ?c1 , ?c2 FILTER(STR(?c1) < STR(?c2)) }`,
        message: v => `${v("x")} is an instance of disjoint classes ${v("c1")} and ${v("c2")}` },
    { id: "cls-nothing2", description: "An individual is an instance of owl:Nothing.",
        select: "SELECT DISTINCT ?x WHERE { ?x a owl:Nothing }",
        message: v => `${v("x")} is an instance of owl:Nothing` },
    { id: "cls-com", description: "An individual is an instance of a class and its complement.",
        select: "SELECT DISTINCT ?x ?c1 ?c2 WHERE { ?c1 owl:complementOf ?c2 . ?x a ?c1 , ?c2 }",
        message: v => `${v("x")} is an instance of ${v("c2")} and of its complement ${v("c1")}` },
    { id: "eq-diff1", description: "Two individuals are both owl:sameAs and owl:differentFrom each other.",
        select: "SELECT DISTINCT ?x ?y WHERE { ?x owl:sameAs ?y . { ?x owl:differentFrom ?y } UNION { ?y owl:differentFrom ?x } }",
        message: v => `${v("x")} and ${v("y")} are both the same and different` },
    { id: "prp-irp", description: "An irreflexive property relates something to itself.",
        select: "SELECT DISTINCT ?x ?p WHERE { ?p a owl:IrreflexiveProperty . ?x ?p ?x }",
        message: v => `${v("x")} ${v("p")} ${v("x")}, but ${v("p")} is irreflexive` },
    { id: "prp-asyp", description: "An asymmetric property holds in both directions.",
        select: "SELECT DISTINCT ?x ?y ?p WHERE { ?p a owl:AsymmetricProperty . ?x ?p ?y . ?y ?p ?x FILTER(STR(?x) <= STR(?y)) }",
        message: v => `${v("x")} ${v("p")} ${v("y")} and back, but ${v("p")} is asymmetric` },
    { id: "prp-pdw", description: "Two disjoint properties relate the same pair.",
        select: "SELECT DISTINCT ?x ?y ?p1 ?p2 WHERE { ?p1 owl:propertyDisjointWith ?p2 . ?x ?p1 ?y . ?x ?p2 ?y }",
        message: v => `${v("x")} is related to ${v("y")} by both ${v("p1")} and ${v("p2")}, which are disjoint` },
    { id: "cls-maxc1", description: "An instance of (p max 0) has a p-value.",
        select: "SELECT DISTINCT ?u ?p WHERE { ?r owl:maxCardinality ?n ; owl:onProperty ?p FILTER(?n = 0) . ?u a ?r ; ?p ?y }",
        message: v => `${v("u")} has a ${v("p")} value but is an instance of (${v("p")} max 0)` },
    { id: "unsatisfiable", description: "A class is a subclass of two disjoint classes (or of owl:Nothing), so it can have no instances. This is found from the subclass links only, so it is incomplete.",
        select: `SELECT DISTINCT ?c ?c1 ?c2 WHERE {
        { ${DISJOINT_PAIR} ?c rdfs:subClassOf ?c1 , ?c2 FILTER(STR(?c1) < STR(?c2)) }
        UNION { ?c rdfs:subClassOf owl:Nothing }
        FILTER(isIRI(?c) && ?c != owl:Nothing) }`,
        message: v => v("c1") ? `${v("c")} is a subclass of disjoint classes ${v("c1")} and ${v("c2")}` : `${v("c")} is a subclass of owl:Nothing` },
];

/**
 * Returns the built-in rules for a rule set.
 *
 * @param {string} ruleSet - "OWL RL" or "RDFS"
 * @param {Object} [options]
 * @param {boolean} [options.sameAs=false] - include the owl:sameAs substitution rules
 * @returns {{id: string, description: string, query: string}[]}
 */
export function builtInRules(ruleSet, { sameAs = false } = {}) {
    const rdfsOnly = ruleSet === "RDFS";
    return RULES
        .filter(r => rdfsOnly ? r.rdfs : (!r.optional || (r.optional === "sameAs" && sameAs)))
        .map(r => ({
            id: rdfsOnly ? r.rdfs : r.id,
            description: r.description,
            query: `${PROLOGUE}CONSTRUCT { ${r.construct} } WHERE {\n    ${r.where}\n}`,
        }));
}

/**
 * Formats rules as a text block that parseCustomRules() reads back: a
 * "# rule: id" comment and description before each CONSTRUCT query.
 *
 * @param {{id: string, description: string, query: string}[]} rules
 * @returns {string}
 */
export function formatRules(rules) {
    return rules.map(r => `# rule: ${r.id}\n# ${r.description}\n${r.query.replace(/^(PREFIX[^\n]*\n)+/i, "")}`).join("\n\n") + "\n";
}

/**
 * Splits text into CONSTRUCT rules. A rule starts at a line beginning with
 * CONSTRUCT, and takes the comment and PREFIX lines directly above it; a
 * "# rule: name" comment names it (otherwise custom-1, custom-2, …).
 *
 * @param {string} text
 * @returns {{id: string, description: string, query: string}[]}
 */
export function parseCustomRules(text) {
    const lines = (text || "").split(/\r?\n/);
    const starts = [];
    lines.forEach((line, i) => {
        if (/^\s*CONSTRUCT\b/i.test(line)) {
            let start = i;
            while (start > 0 && /^\s*(#|PREFIX\b)/i.test(lines[start - 1])) start--;
            starts.push(start);
        }
    });
    if (!starts.length) {
        if (lines.some(l => l.trim() && !/^\s*#/.test(l))) {
            throw new OperationError("Custom rules must be SPARQL CONSTRUCT queries, each starting on a line that begins with CONSTRUCT.");
        }
        return [];
    }
    return starts.map((start, n) => {
        const block = lines.slice(start, n + 1 < starts.length ? starts[n + 1] : lines.length).join("\n").trim();
        const name = /^\s*#\s*rule:\s*(\S+)/im.exec(block);
        const comment = block.split("\n").filter(l => /^\s*#/.test(l) && !/^\s*#\s*rule:/i.test(l)).map(l => l.replace(/^\s*#\s?/, "")).join(" ");
        return { id: name ? name[1] : `custom-${n + 1}`, description: comment || "Custom rule.", query: block };
    });
}

/**
 * Returns a key identifying a triple, for comparing triples across graphs.
 *
 * @param {Object} s - subject term
 * @param {Object} p - predicate term
 * @param {Object} o - object term
 * @returns {string}
 */
export function tripleKey(s, p, o) {
    return `${termKey(s)} ${p.value} ${termKey(o)}`;
}

/**
 * Returns a string identifying a term.
 *
 * @param {Object} t
 * @returns {string}
 */
function termKey(t) {
    if (t.termType === "BlankNode") return "_:" + t.value;
    if (t.termType === "Literal") return JSON.stringify(t.value) + "@" + t.language + "^^" + (t.datatype ? t.datatype.value : "");
    return "<" + t.value + ">";
}

/**
 * Applies rules to the store until a round adds nothing. New triples are
 * added to the named graph of the rule that first produced them; triples
 * already in the store (in any graph) are not added again.
 *
 * @param {Object} ox - Oxigraph module
 * @param {Object} store - modified in place
 * @param {{id: string, query: string}[]} rules
 * @param {Object} options
 * @param {Object<string, string>} options.prefixes - added to custom rules
 * @param {number} [options.maxRounds=50]
 * @param {number} [options.maxTriples=200000] - limit on inferred triples
 * @returns {{perRule: Map<string, number>, rounds: number, total: number}}
 * @throws {OperationError} if a rule is invalid or a limit is reached
 */
export function runRules(ox, store, rules, { prefixes = {}, maxRounds = 50, maxTriples = 200000 } = {}) {
    const perRule = new Map(rules.map(r => [r.id, 0]));
    const graphs = new Map(rules.map(r => [r.id, ox.namedNode(INFERRED_GRAPH_PREFIX + encodeURIComponent(r.id))]));
    let total = 0, rounds = 0;
    for (let added = -1; added !== 0;) {
        if (rounds >= maxRounds) {
            const busiest = [...perRule].sort((a, b) => b[1] - a[1])[0];
            throw new OperationError(`Reasoning did not finish within ${maxRounds} round${maxRounds === 1 ? "" : "s"} (${total} triples inferred; most by ${busiest[0]}). ` +
                "Increase 'Max rounds', or check for rules that keep generating new terms.");
        }
        rounds++;
        added = 0;
        for (const rule of rules) {
            let quads;
            try {
                quads = store.query(withPrefixes(rule.query, prefixes), { "use_default_graph_as_union": true });
            } catch (err) {
                throw new OperationError(`Rule ${rule.id} is not a valid SPARQL query: ${err.message || err}`);
            }
            if (!Array.isArray(quads)) throw new OperationError(`Rule ${rule.id} must be a CONSTRUCT query.`);
            for (const q of quads) {
                if (store.match(q.subject, q.predicate, q.object, null).length) continue;
                store.add(ox.quad(q.subject, q.predicate, q.object, graphs.get(rule.id)));
                perRule.set(rule.id, perRule.get(rule.id) + 1);
                added++;
                if (++total > maxTriples) {
                    throw new OperationError(`Reasoning stopped after inferring more than ${maxTriples} triples (rule ${rule.id} was running). ` +
                        "Try the RDFS rule set, or leave owl:sameAs substitution off.");
                }
            }
        }
    }
    return { perRule, rounds, total };
}

/**
 * Runs the consistency checks.
 *
 * @param {function(string): Map<string, Object>[]} select - SELECT over all graphs
 * @param {function(Object): string} display - formats a term for messages
 * @returns {{id: string, description: string, messages: string[]}[]} the checks that found problems
 */
export function runChecks(select, display) {
    const found = [];
    for (const check of CHECKS) {
        const rows = select(PROLOGUE + check.select);
        if (!rows.length) continue;
        const messages = rows.map(r => check.message(name => (r.get(name) ? display(r.get(name)) : "")));
        found.push({ id: check.id, description: check.description, messages: [...new Set(messages)].sort() });
    }
    return found;
}

/**
 * Returns the triples that are only in inferred graphs (not asserted), with
 * the rule that produced each.
 *
 * @param {Object} store
 * @returns {Map<string, string>} tripleKey -> rule id
 */
export function inferredIndex(store) {
    const index = new Map();
    const asserted = new Set();
    for (const q of store.match()) {
        const key = tripleKey(q.subject, q.predicate, q.object);
        const g = q.graph;
        if (g.termType === "NamedNode" && g.value.startsWith(INFERRED_GRAPH_PREFIX)) {
            if (!index.has(key)) index.set(key, decodeURIComponent(g.value.slice(INFERRED_GRAPH_PREFIX.length)));
        } else {
            asserted.add(key);
        }
    }
    for (const key of asserted) index.delete(key);
    return index;
}

/**
 * Returns a copy of the store without the inferred graphs.
 *
 * @param {Object} ox
 * @param {Object} store
 * @returns {Object}
 */
export function withoutInferred(ox, store) {
    const copy = new ox.Store();
    for (const q of store.match()) {
        if (!(q.graph.termType === "NamedNode" && q.graph.value.startsWith(INFERRED_GRAPH_PREFIX))) copy.add(q);
    }
    return copy;
}

/** Predicates whose inferred objects are reduced to the most specific ones, with the predicate that orders them. */
const ORDERED = new Map([
    [RDF_TYPE, SUB_CLASS_OF],
    [SUB_CLASS_OF, SUB_CLASS_OF],
    [RDFS + "domain", SUB_CLASS_OF],
    [RDFS + "range", SUB_CLASS_OF],
    [SUB_PROPERTY_OF, SUB_PROPERTY_OF],
]);
/** Objects that say nothing: everything is an owl:Thing / rdfs:Resource. */
const TRIVIAL_OBJECTS = new Set([OWL + "Thing", RDFS + "Resource"]);
/** Predicates for which a triple relating a term to itself is trivial. */
const REFLEXIVE = new Set([SUB_CLASS_OF, SUB_PROPERTY_OF, OWL + "equivalentClass", OWL + "equivalentProperty", OWL + "sameAs"]);

/**
 * Picks out the inferred triples worth showing. Hidden are:
 * - triples involving blank nodes (restrictions and class expressions, which
 *   the rules use internally);
 * - trivial triples (x a owl:Thing, C subClassOf C, x sameAs x);
 * - triples that follow from a more specific one by transitivity: an inferred
 *   "x a C" when x is also an instance of a subclass of C, and likewise for
 *   rdfs:subClassOf, rdfs:subPropertyOf, rdfs:domain and rdfs:range.
 *
 * @param {Object} store - after runRules()
 * @returns {Object[]} inferred quads to show
 */
export function directInferences(store) {
    const all = [...store.match()];
    const isInferred = q => q.graph.termType === "NamedNode" && q.graph.value.startsWith(INFERRED_GRAPH_PREFIX);

    // Superclass/super-property reachability over all triples
    const up = new Map([[SUB_CLASS_OF, new Map()], [SUB_PROPERTY_OF, new Map()]]);
    const objects = new Map(); // "s|p" -> Set of object values (named objects only)
    for (const q of all) {
        if (q.subject.termType !== "NamedNode" || q.object.termType !== "NamedNode") continue;
        if (up.has(q.predicate.value)) {
            const m = up.get(q.predicate.value);
            if (!m.has(q.subject.value)) m.set(q.subject.value, new Set());
            m.get(q.subject.value).add(q.object.value);
        }
        if (ORDERED.has(q.predicate.value)) {
            const k = q.subject.value + "|" + q.predicate.value;
            if (!objects.has(k)) objects.set(k, new Set());
            objects.get(k).add(q.object.value);
        }
    }
    const reachCache = new Map();
    const reaches = (order, from) => {
        const key = order + "|" + from;
        if (reachCache.has(key)) return reachCache.get(key);
        const seen = new Set();
        const stack = [from];
        const m = up.get(order);
        while (stack.length) {
            for (const next of m.get(stack.pop()) || []) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        reachCache.set(key, seen);
        return seen;
    };

    return all.filter(q => {
        if (!isInferred(q)) return false;
        if (q.subject.termType === "BlankNode" || q.object.termType === "BlankNode") return false;
        const p = q.predicate.value, o = q.object.value;
        if (REFLEXIVE.has(p) && q.subject.value === o) return false;
        if ((p === RDF_TYPE || p === SUB_CLASS_OF) && TRIVIAL_OBJECTS.has(o)) return false;
        const order = ORDERED.get(p);
        if (!order || q.object.termType !== "NamedNode") return true;
        // Hide if another object D of the same subject is strictly below this one.
        for (const d of objects.get(q.subject.value + "|" + p) || []) {
            if (d === o || d === q.subject.value) continue;
            if (reaches(order, d).has(o) && !reaches(order, o).has(d)) return false;
        }
        return true;
    });
}
