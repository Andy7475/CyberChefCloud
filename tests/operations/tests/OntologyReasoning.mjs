/**
 * Ontology Reasoner and Ontology Quality Checks tests, and how Ontology Graph
 * and Ontology Summary show inferred triples.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */
import TestRegister from "../../lib/TestRegister.mjs";

const PREFIXES = `@prefix : <http://ex.org/#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
`;

const PIZZA = PREFIXES + `
:Food a owl:Class . :Pizza a owl:Class ; rdfs:subClassOf :Food .
:Cheese a owl:Class ; rdfs:subClassOf :Food . :Mozzarella a owl:Class ; rdfs:subClassOf :Cheese .
:CheeseyPizza a owl:Class ;
    owl:equivalentClass [ owl:intersectionOf ( :Pizza [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:someValuesFrom :Cheese ] ) ] .
:hasTopping a owl:ObjectProperty ; owl:inverseOf :isToppingOf .
:hasPart a owl:TransitiveProperty .
:p1 a :Pizza ; :hasTopping :m1 . :m1 a :Mozzarella .
:p1 :hasPart :base . :base :hasPart :flour .
`;

const FAMILY = PREFIXES + `
:hasParent a owl:ObjectProperty .
:hasGrandparent owl:propertyChainAxiom ( :hasParent :hasParent ) .
:hasMother a owl:FunctionalProperty .
:ann :hasParent :bob . :bob :hasParent :cat .
:ann :hasMother :mum , :mother .
`;

const CLASHES = PREFIXES + `
:Meat a owl:Class . :Veg a owl:Class ; owl:disjointWith :Meat .
:Tofu a owl:Class ; rdfs:subClassOf :Veg , :Meat .
:x a :Meat , :Veg .
`;

const REASON = (output, direct = true, ruleSet = "OWL RL (includes RDFS)", custom = "", rounds = 50) =>
    ({ op: "Ontology Reasoner", args: ["Auto", ruleSet, output, direct, false, custom, rounds, ""] });
/** Matches when every pattern is found, in any order. */
const all = (...patterns) => new RegExp("^" + patterns.map(p => `(?=[\\s\\S]*${p.source})`).join(""));

TestRegister.addTests([
    {
        name: "Ontology Reasoner: OWL RL infers types, superclasses, inverse and transitive values",
        input: PIZZA,
        expectedMatch: all(
            /# cax-sco: [^\n]*\n:p1 a :CheeseyPizza\./,
            /# scm-sco: [^\n]*\n:CheeseyPizza\n {2}rdfs:subClassOf :Pizza\./,
            /# prp-inv1: [^\n]*\n:m1\n {2}:isToppingOf :p1\./,
            /# prp-trp: [^\n]*\n:p1\n {2}:hasPart :flour\./,
        ),
        recipeConfig: [REASON("Inferred triples only (Turtle)")],
    },
    {
        name: "Ontology Reasoner: direct inferences hide triples implied by transitivity",
        input: PIZZA,
        expectedOutput: "# 4 triples were inferred, but none is direct: each follows from another triple by transitivity, is trivial, or is about blank nodes.\n" +
            "# Untick 'Show only direct inferences' to see them.\n",
        recipeConfig: [REASON("Inferred triples only (Turtle)", true, "RDFS")],
    },
    {
        name: "Ontology Reasoner: all inferences with RDFS rules",
        input: PIZZA,
        expectedMatch: all(/# rdfs9: [^\n]*\(3 triples\)\n:m1 a :Cheese, :Food\.\n\n:p1 a :Food\./, /# rdfs11: [^\n]*\n:Mozzarella\n {2}rdfs:subClassOf :Food\./),
        recipeConfig: [REASON("Inferred triples only (Turtle)", false, "RDFS")],
    },
    {
        name: "Ontology Reasoner: property chains and functional properties",
        input: FAMILY,
        expectedMatch: all(/# prp-spo2: [^\n]*\n:ann\n {2}:hasGrandparent :cat\./, /owl:sameAs/, /:mother\n {2}owl:sameAs :mum\./),
        recipeConfig: [REASON("Inferred triples only (Turtle)")],
    },
    {
        name: "Ontology Reasoner: custom rules",
        input: FAMILY,
        expectedOutput: "@prefix : <http://ex.org/#>.\n\n# grandparent: Grandparents from parents. (1 triple)\n:ann\n  :grandparentOf2 :cat.\n",
        recipeConfig: [REASON("Inferred triples only (Turtle)", true, "Custom rules only",
            "# rule: grandparent\n# Grandparents from parents.\nCONSTRUCT { ?x :grandparentOf2 ?z }\nWHERE { ?x :hasParent ?y . ?y :hasParent ?z }")],
    },
    {
        name: "Ontology Reasoner: invalid custom rule",
        input: FAMILY,
        expectedMatch: /^Rule custom-1 is not a valid SPARQL query/,
        recipeConfig: [REASON("Inferred triples only (Turtle)", true, "Custom rules only", "CONSTRUCT { ?x :p ?y } WHERE { ?x :q ")],
    },
    {
        name: "Ontology Reasoner: max rounds",
        input: PIZZA,
        expectedMatch: /^Reasoning did not finish within 1 round \(/,
        recipeConfig: [REASON("Inferred triples only (Turtle)", true, "OWL RL (includes RDFS)", "", 1)],
    },
    {
        name: "Ontology Reasoner: rules as SPARQL",
        input: "",
        expectedMatch: /^# rule: rdfs2\n# A subject of a property is an instance of the property's domain\.\nCONSTRUCT \{ \?x a \?c \} WHERE \{[\s\S]*# rule: rdfs9\n/,
        recipeConfig: [REASON("Rules (SPARQL)", true, "RDFS")],
    },
    {
        name: "Ontology Reasoner: impact report lists consistency problems and inferences",
        input: CLASHES,
        expectedMatch: all(
            /`cax-dw`\]\[owl-rl\]: An individual is an instance of two disjoint classes\.\n\n- :x is an instance of disjoint classes :Meat and :Veg/,
            /- :Tofu is a subclass of disjoint classes :Meat and :Veg/,
        ),
        recipeConfig: [REASON("Impact report (Markdown)")],
    },
    {
        name: "Ontology Reasoner: impact report as HTML",
        input: PIZZA,
        expectedMatch: all(
            /<h2[^>]*>New types \(1\)<\/h2>/,
            /<td><code>:p1<\/code><\/td>\s*<td><code>:CheeseyPizza<\/code><\/td>\s*<td><a href="https:\/\/www\.w3\.org\/TR\/owl2-profiles\/[^"]*"><code>cax-sco<\/code><\/a><\/td>/,
        ),
        recipeConfig: [REASON("Impact report (HTML)")],
    },
    {
        name: "Ontology Reasoner: TriG output puts inferred triples in named graphs",
        input: PIZZA,
        expectedMatch: all(/<urn:ccc:inferred:prp-trp> \{\n\t<http:\/\/ex\.org\/#p1> <http:\/\/ex\.org\/#hasPart> <http:\/\/ex\.org\/#flour> \.\n\}/, /^# Inferred triples/, /@prefix : <http:\/\/ex\.org\/#> \./),
        recipeConfig: [REASON("Asserted and inferred (TriG)")],
    },
    {
        name: "Ontology Graph: inferred edges are marked and styled",
        input: PIZZA,
        expectedMatch: all(/Show inferred/, /"inferred":"prp-inv1"/, /"inferred":"scm-sco"/, /"dashes":\[10,6\]/, /4 inferred\./),
        recipeConfig: [
            REASON("Asserted and inferred (TriG)"),
            { op: "Ontology Graph", args: ["Auto", "Classes and properties", 200, "Prefixed name", "Force-directed", "", "en", "TBox and ABox"] },
        ],
    },
    {
        name: "Ontology Graph: no inferred styling without reasoning",
        input: PIZZA,
        expectedMatch: /^(?![\s\S]*(<input id="ontologyGraphInferred"|"inferred":))/,
        recipeConfig: [{ op: "Ontology Graph", args: ["Auto", "Classes and properties", 200, "Prefixed name", "Force-directed", "", "en", "TBox and ABox"] }],
    },
    {
        name: "Ontology Summary: inferred superclasses are marked",
        input: PIZZA,
        expectedMatch: all(/ {2}Inferred triples {7}4\n/, /\n {6}:CheeseyPizza \(inferred\)\n/, /\n {6}:CheeseyPizza\n {8}Subclass of: {3}:Pizza \(inferred\)\n/),
        recipeConfig: [
            REASON("Asserted and inferred (TriG)"),
            { op: "Ontology Summary", args: ["Auto", "Text report", true, 10, true, "en", ""] },
        ],
    },
    {
        name: "Ontology Summary: quality checks section",
        input: CLASHES,
        expectedMatch: all(/\*\*Contents:\*\*[^\n]*\[Quality checks\]\(#quality-checks\)/, /## Quality checks\n\n\| Check \| Result \|/, /\*\*Classes without a label\*\* \(3\)\n\n- \[`:Meat`\]\(#meat\)/),
        recipeConfig: [{ op: "Ontology Summary", args: ["Auto", "Markdown", true, 10, true, "en", "", true] }],
    },
    {
        name: "Ontology Quality Checks: finds each kind of problem",
        input: PREFIXES + `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<http://ex.org/onto> a owl:Ontology ; rdfs:label "Test" .
:A a owl:Class ; rdfs:label "Thing"@en , "Object"@en ; rdfs:comment "An A."@en .
:B a owl:Class ; rdfs:label "thing"@en ; rdfs:subClassOf :Undeclared .
:Lonely a owl:Class ; rdfs:label "Lonely"@en ; rdfs:comment "Alone."@en .
:Old a owl:Class ; owl:deprecated true . :C a owl:Class ; rdfs:subClassOf :Old .
:hasX a owl:ObjectProperty ; rdfs:label "has x"@en .
:i a owl:NamedIndividual ; :undeclaredProp :A .
`,
        expectedOutput: `Quality checks: 14 problems in 11 of 12 checks

   2  Classes without a label
        :C
        :Old
   3  Classes without a description (en)
        :B
        :C
        :Old
  ok  Properties without a label
   1  Properties without a description (en)
        :hasX
   1  Classes used but not declared (no owl:Class or rdfs:Class)
        :Undeclared  (used in rdfs:subClassOf)
   1  Properties used but not declared (no property type)
        :undeclaredProp  (used 1 time)
   1  Labels used by more than one term
        "Thing"@en  (:A, :B)
   1  Terms with more than one label in the same language
        :A  ("Object", "Thing" (@en))
   1  Classes with no superclass that nothing refers to
        :Lonely
   1  Named individuals with no class
        :i
   1  Deprecated terms still used by other terms
        :Old  (used 1 time)
   1  Ontology header missing title, description, version or licence
        <http://ex.org/onto>  (no description, no version, no licence)`.replace("<http://ex.org/onto>", "http://ex.org/onto"),
        recipeConfig: [{ op: "Ontology Quality Checks", args: ["Auto", "Text", "All (asserted and inferred)", "en", 50, ""] }],
    },
    {
        name: "Ontology Quality Checks: asserted only ignores inferred types",
        input: PREFIXES + ":Person a owl:Class ; rdfs:label \"Person\" ; rdfs:comment \"A person.\" .\n:knows a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:label \"knows\" ; rdfs:comment \"Knows.\" .\n:i a owl:NamedIndividual ; :knows :j .\n",
        expectedMatch: /"triples": "asserted",[\s\S]*"id": "untyped-individual",\s+"title": "Named individuals with no class",\s+"count": 1,/,
        recipeConfig: [
            REASON("Asserted and inferred (TriG)"),
            { op: "Ontology Quality Checks", args: ["Auto", "JSON", "Asserted only", "en", 50, ""] },
        ],
    },
    {
        name: "Ontology Quality Checks: all triples includes inferred types",
        input: PREFIXES + ":Person a owl:Class ; rdfs:label \"Person\" ; rdfs:comment \"A person.\" .\n:knows a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:label \"knows\" ; rdfs:comment \"Knows.\" .\n:i a owl:NamedIndividual ; :knows :j .\n",
        expectedMatch: /"id": "untyped-individual",\s+"title": "Named individuals with no class",\s+"count": 0,/,
        recipeConfig: [
            REASON("Asserted and inferred (TriG)"),
            { op: "Ontology Quality Checks", args: ["Auto", "JSON", "All (asserted and inferred)", "en", 50, ""] },
        ],
    },
    {
        name: "Ontology Quality Checks: CSV",
        input: PREFIXES + ":A a owl:Class ; rdfs:label \"A, the first\" .\n",
        expectedOutput: [
            "check,term,iri,detail",
            "Classes without a description (en),:A,http://ex.org/#A,",
            "Classes with no superclass that nothing refers to,:A,http://ex.org/#A,",
            "\"Ontology header missing title, description, version or licence\",(none),,no owl:Ontology declared",
        ].join("\n"),
        recipeConfig: [{ op: "Ontology Quality Checks", args: ["Auto", "CSV", "All (asserted and inferred)", "en", 50, ""] }],
    },
]);
