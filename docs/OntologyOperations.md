# Ontology / RDF operations

These operations work on ontologies and other RDF data. They run entirely in the browser and need no authentication or network access.

Each operation parses its input into an in-memory RDF store ([Oxigraph](https://github.com/oxigraph/oxigraph), compiled to WebAssembly), works on the store, and writes a result. Each operation parses its own input, so operations chain freely: for example, `SPARQL Query` (CONSTRUCT) → `Convert RDF Format`.

| Operation | What it does |
| :--- | :--- |
| Convert RDF Format | Converts between RDF serialisations, e.g. Turtle → RDF/XML for a visualiser that only accepts RDF/XML. |
| SPARQL Query | Runs a SPARQL 1.1 SELECT / ASK / CONSTRUCT / DESCRIBE query against the input. |
| Ontology Summary | Reports the ontology IRI, version, title and imports; counts; namespaces; the class hierarchy; and a per-class reference of descriptions, applicable properties (own and inherited) and restrictions. |
| Ontology Graph | Draws the ontology as an interactive graph (drag, zoom, hover for IRIs and annotations, search to highlight), with a 'Max nodes' limit (default 200). |
| Sample Ontology | Outputs one of four small example ontologies (Turtle) that show the kinds of inference the Reasoner makes. The input is ignored. |
| Ontology Reasoner | Applies the RDFS and OWL 2 RL rules (as SPARQL CONSTRUCT queries) and shows the triples they add, in a report or as TriG for the other operations. |
| Ontology Quality Checks | Lists missing labels and descriptions, classes and properties used but not declared, duplicate labels, orphan classes and other common problems. |

All seven are in the **Ontology / RDF** category. `Convert RDF Format` is also listed under **Data format**.

## Formats

| Format | Usual extensions | Read | Write |
| :--- | :--- | :---: | :---: |
| Turtle | `.ttl` | yes | yes (with prefixes, nested blank nodes, `( )` lists) |
| RDF/XML | `.rdf`, `.owl`, `.xml` | yes | yes (Protégé style: typed nodes, nested blank nodes, `parseType="Collection"`) |
| JSON-LD | `.jsonld`, `.json` | yes | yes (compacted with a prefix `@context`) |
| N-Triples | `.nt` | yes | yes |
| N-Quads | `.nq` | yes | yes |
| TriG | `.trig` | yes | yes |
| N3 | `.n3` | yes | yes |
| OWL/XML | `.owx` (sometimes `.owl`) | no | no |
| OWL Functional Syntax | `.ofn` | no | no |
| OWL Manchester Syntax | `.omn` | no | no |
| OBO | `.obo` | no | no |

The last four are OWL syntaxes, not RDF serialisations, and no maintained JavaScript library reads them. The operations recognise them and return an error suggesting conversion with Protégé or [ROBOT](https://robot.obolibrary.org/convert) (`robot convert`). An `.owl` file is usually RDF/XML, which is supported.

Notes:

- **Auto-detection.** 'Auto' picks the format from the content: XML → RDF/XML, `{` → JSON-LD, graph blocks → TriG; otherwise it tries Turtle, which also reads N-Triples, then N-Quads.
- **Prefixes.** With 'Use prefixes' on, output uses the prefixes declared in the input (`@prefix`, `PREFIX`, `xmlns:`, JSON-LD `@context`) plus common vocabularies (rdf, rdfs, owl, xsd, skos, dc, dcterms, foaf, schema, prov, sh). N-Triples and N-Quads contain no prefixes, so converting through them loses the prefix names, but not the data.
- **Restoring prefixes with Register.** All the ontology operations have an 'Additional prefixes' argument. It accepts prefix declarations in any of the syntaxes above, and they take precedence over prefixes found in the input. To bring back the original file's prefixes after a step that drops them, store the file with the existing **Register** operation. Its default extractor `([\s\S]*)` puts the whole input into `$R0` and passes the input through unchanged.

  ```
  Register                (Extractor: ([\s\S]*))
  Convert RDF Format      (Output: N-Triples)
  … other steps …
  Convert RDF Format      (Output: Turtle, Additional prefixes: $R0)
  ```

  You can also type the declarations directly, e.g. `PREFIX pizza: <http://example.org/pizza#>`.
- **Named graphs.** When writing a format that has no graphs (Turtle, RDF/XML, N-Triples, N3), named graphs are merged into one graph.
- **Relative IRIs.** Input containing relative IRIs (e.g. `<a>`) needs the 'Base IRI' argument.
- **RDF/XML limits.** RDF/XML can't represent a predicate whose IRI doesn't end in a valid XML name, or RDF-star quoted triples. Converting such data to RDF/XML gives an error; choose another format.

## SPARQL Query

- Prefixes from the input and the common vocabularies above are added to the query automatically, so `SELECT ?c WHERE { ?c a owl:Class }` works without `PREFIX` lines. Prefixes declared in the query take precedence.
- **Output format** is chosen to match the query:
  - **SELECT** → CSV (default), TSV, JSON (SPARQL JSON) or XML (SPARQL XML). With 'Shorten IRIs with prefixes' on, CSV/TSV show `:Pizza` rather than the full IRI.
  - **ASK** → `true` / `false` with CSV/TSV, or SPARQL JSON/XML.
  - **CONSTRUCT / DESCRIBE** → RDF, written in the **RDF format** setting (Turtle, RDF/XML, …) so it can be chained into other ontology operations.
- A mismatch is an error rather than a silent switch: RDF with SELECT/ASK, or CSV/TSV/JSON/XML with CONSTRUCT/DESCRIBE. (Before this, CONSTRUCT ignored the results format and always returned RDF; saved recipes that relied on that now need Output format = RDF.)
- Named graphs are queried as one merged default graph.
- SPARQL Update (INSERT/DELETE) is not supported yet.

### Showing results as a table

Use the existing **To Table** operation rather than a separate table output:

```
SPARQL Query      (Output format: CSV)
To Table          (Cell delimiters: ,   Make first row header: ticked   Format: HTML, ASCII or Markdown)
```

The same works for `Ontology Summary` with Output = 'Counts CSV'.

`To Table` previously HTML-escaped its input before splitting it into cells. That broke CSV quoting, so a quoted cell such as `"Pizza, Italian"` was split in two. It now escapes each cell after parsing.

## Ontology Summary: class details

With **Include class details** on (the default), the summary adds one entry per class, in depth-first hierarchy order. Each entry shows:

- **Path, superclasses, and equivalent-class definitions.** Class expressions are written in Protégé/Manchester style, e.g. `:Car and (:poweredBy some :Battery)`.
- **Descriptions** from `skos:definition`, the OBO definition (`IAO_0000115`), `rdfs:comment`, `dcterms:description` and `dc:description`. These are filtered by the **Language** argument: `en` by default, several can be given as `en, fr`, and leaving it empty includes all. Untagged text is always included. Labels prefer the chosen language but fall back to others, since many ontologies label in one language only.
- **Properties** that apply to the class, with range, kind, description and the class they are inherited from. Own properties come first, then inherited ones, nearest ancestor first.
- **Restrictions** on the class (`subClassOf` restrictions, including those inside an intersection) and those inherited from ancestors, e.g. `:hasTopping some :TomatoTopping (from :Pizza)`.

How a property is matched to classes:

| Domain | Applies to |
| :--- | :--- |
| `rdfs:domain :A` | `:A` and all its subclasses. |
| `rdfs:domain [ owl:unionOf (:A :B) ]` | each of `:A`, `:B` and their subclasses. |
| Several `rdfs:domain` statements, or an intersection | only classes under all of them (RDFS semantics). If no class qualifies, the property is listed under "Properties whose domain matches no class" and not silently dropped. |
| No domain, but a super-property has one | the super-property's domain (shown as "domain via"). The range is inherited the same way. |
| No domain at all, or `owl:Thing` / `rdfs:Resource` | any class. Listed once under "Properties that apply to any class" and not repeated for every class. |

Ontology Summary does not reason by itself: it uses the `rdfs:subClassOf` links in its input. To include inferred superclasses, put **Ontology Reasoner** (Output: 'Asserted and inferred (TriG)') before it. Links that only exist in the reasoner's inferred graphs are then marked "(inferred)" in the hierarchy and in each class's "Subclass of" line, and the counts include "Inferred triples".

**Include quality checks** (off by default) adds the results of the Ontology Quality Checks operation as a final "Quality checks" section (and `qualityChecks` in the JSON output), so a Summary at the end of any ontology recipe gives one report.

For a long ontology, choose **Output: HTML**. This produces the Markdown report and displays it through **Render Markdown**, as a formatted document. The rendering is done in `present()`, so it only happens when Ontology Summary is the last operation; a following operation receives the Markdown text. Choose **Output: Markdown** for the Markdown text itself (for example to save it, or to add Render Markdown with different options). Properties are a list rather than a table, because a table with long descriptions is squeezed unreadably in the output pane. Render Markdown disables raw HTML, so descriptions from the file cannot inject markup.

The Markdown links between its parts. A contents line under the title links to each section. When class details are included, each class name in the hierarchy, and each named class in a path, superclass, equivalent class, property range or domain, restriction or "from" note, links to that class's entry under Classes. Property names are not linked, because properties have no section of their own. The links use GitHub's heading anchors (for example `:ElectricCar` → `#electriccar`, and `#classes-1` when a heading's text has already been used), so they also work when the Markdown is viewed on GitHub or in VS Code. Render Markdown gives each heading an id of `user-content-<anchor>` and rewrites links to match. In the CyberChef output pane, clicking such a link scrolls the output instead of changing the page URL, which holds the recipe.

The JSON output includes the same data (`classes`, `propertiesForAnyClass`, `propertiesMatchingNoClass`).

## Ontology Graph

Views:

- **Classes and properties** (default): named classes, with an arrow from each subclass to its superclass. It also shows:
  - object properties as domain → range edges;
  - datatype properties as domain → datatype edges (each property gets its own datatype node, so `xsd:string` does not become a hub);
  - `someValuesFrom` / `allValuesFrom` restrictions as dashed edges labelled `property (some)` / `property (only)`.
- **Class hierarchy**: only classes and subclass arrows.
- **All triples**: every IRI and blank node, with one edge per triple. Literal values, and `rdf:type` links to OWL/RDFS/RDF built-ins such as `owl:Class`, go into the node's tooltip and colour instead of becoming edges. Otherwise every class would link to one `owl:Class` hub.

**Show** (default 'TBox and ABox') picks the schema, the instance data, or both, in any view:

- **TBox** terms are found with a SPARQL query: anything typed with an RDF/RDFS/OWL type other than `owl:NamedIndividual` / `owl:Thing` (classes, properties, the ontology header, restrictions), subjects of schema predicates (`rdfs:subClassOf`, `rdfs:domain`, `rdfs:range`, `owl:equivalentClass`, `owl:inverseOf`, …), and classes used as an `rdf:type` or as the object of `rdfs:subClassOf`. Blank nodes reachable from these through other blank nodes (restrictions, RDF lists, class expressions) are TBox too. That last step is done in JavaScript, because a SPARQL property path cannot be restricted to pass only through blank nodes: `owl:hasValue :acme` would otherwise pull in `:acme`'s own blank nodes.
- **ABox** is every other subject, so untyped data such as `:bob :knows :alice` counts as ABox. IRIs that ABox triples are about or link to are drawn as **Individual** nodes (purple ellipses).
- In the class views, the ABox adds individuals with an `a` edge to each class they belong to, and literal values (e.g. `:age: 34`) in their tooltip. 'Classes and properties' also draws property assertions between individuals and blank nodes such as addresses; 'Class hierarchy' draws only the `a` edges, as it has no property edges for the TBox either. With 'ABox only', classes appear only as the targets of `a` edges.
- In 'All triples', each triple is kept or dropped according to whether its subject is TBox or ABox.

The same split can be done by hand with `SPARQL Query` (CONSTRUCT, Output format RDF) → `Ontology Graph`, for a custom selection.

**Max nodes** (default 200) caps the drawing, because vis-network slows down and becomes unreadable with thousands of nodes. When the graph is larger, nodes are chosen breadth-first from the most connected node, so the part shown stays connected. The summary line says e.g. "Showing 200 of 514 nodes".

Other options:

- **Node labels**: `rdfs:label`/`skos:prefLabel` (English or untagged preferred), or prefixed names only.
- **Layout**: 'Force-directed' or 'Hierarchical'. Hierarchical draws a left-to-right tree with superclasses on the left.
- **Freeze layout** (default off): see [Freezing the layout](#freezing-the-layout).
- **Language** (default `en`): filters the annotations shown in tooltips (e.g. `en`, or `en, fr`; empty for all). Untagged text is always included. Labels prefer this language.

Tooltips: hovering over a node shows its IRI, its label (if the node shows the prefixed name), and its annotations:

1. `Deprecated`, if `owl:deprecated true`;
2. descriptions, one paragraph each: `skos:definition`, OBO definition (`IAO_0000115`), `rdfs:comment`, `dcterms:description`, `dc:description` (the same list as Ontology Summary, from `DESCRIPTION_PREDICATES` in `OntologyModel.mjs`), each cut to 600 characters;
3. one line each for synonyms (`skos:altLabel`, `oboInOwl:hasExactSynonym`), `skos:example`, `skos:scopeNote`, `skos:note` and `rdfs:seeAlso`.

Edges drawn for a property (object/datatype property edges, restrictions, and every edge in 'All triples') have the same tooltip for the property. In 'All triples', literal values of these annotation predicates are shown in the annotation block and not repeated as separate `predicate: value` lines. vis-network puts tooltips in a `white-space: nowrap` box; the op's CSS overrides this so long descriptions wrap at 420px.

Search: the box at the top right matches nodes whose label, IRI or tooltip text (so also descriptions) contains the text, case-insensitively. Matching nodes are selected (thick orange border) and the others are dimmed. Enter focuses the next match, Shift+Enter the previous one, Esc clears the search. Search runs entirely in the drawn page and does not re-run the recipe.

If the whole graph only fits at an unreadable size, it opens zoomed in on the most connected node; scroll to zoom out and drag to pan. Physics stops once the layout settles, so dragged nodes stay put.

### Freezing the layout

Every bake redraws the graph from scratch. vis-network's random start positions use a fixed seed (`LAYOUT_SEED`), so the same graph is laid out the same way each time. A different graph, for example the same ontology with Ontology Reasoner turned on, has different edges and settles into a different layout, even with the same seed. A fixed seed is therefore not enough to compare two bakes.

**Freeze layout** handles this. After each drawing, the drawing script stores every node's position and the view (pan and zoom) in `window.ontologyGraphLayouts`, keyed by View and Layout. It also stores them after the user drags a node, pans or zooms. When Freeze layout is ticked, the next drawing:

1. places each node that has a stored position at that position, fixed;
2. places each new node beside the average position of its stored neighbours (nodes with no stored neighbour start at a random position);
3. runs the force-directed physics briefly so that only the new nodes move (in the Hierarchical layout too, whose tree layout would otherwise reposition everything);
4. unfixes all nodes, so they can be dragged, and restores the stored view instead of fitting the graph to the pane.

Positions are recorded even while Freeze layout is off, so ticking it keeps the layout that is on screen. The stored positions are lost when the page is reloaded.

The graph is drawn only when this is the last operation. Otherwise it outputs the graph as JSON (`nodes`, `edges`, `totalNodes`, `truncated`), which can be saved or processed further.

Drawing loads vis-network 10.1.2 from unpkg.com at display time, the same way 'Show on map' loads Leaflet. It is pinned with a Subresource Integrity hash (`VIS_NETWORK_SRI` in `OntologyGraph.mjs`; update it when changing the version). This needs internet access; without it the op shows a message. Data embedded in the page's script is escaped (`<`, `>`, U+2028/9), so labels cannot inject HTML.

### Inferred edges

After **Ontology Reasoner** (TriG output), edges whose triple was inferred are drawn as **thick magenta long-dashed lines**, labelled with the rule that produced them (e.g. `:hasPart · prp-trp`), with "Inferred by rule …" in the tooltip. Asserted edges are thin and grey, and restrictions are thin grey short dashes, so the three can't be confused. Magenta is not used by any node group. The legend shows a sample of the inferred line, and the summary line counts the inferred edges.

A **Show inferred** checkbox appears at the top right when there are inferred edges. Unticking it hides them without redrawing the graph, which shows the graph before and after reasoning.

## Ontology Reasoner

Ontology Reasoner materialises inferences ("triple expansion"): it applies reasoning rules to the input and adds the triples they produce. Oxigraph has no reasoning of its own, so the rules are written as SPARQL CONSTRUCT queries and applied to the store repeatedly until a round adds nothing new. Choose Output **Rules (SPARQL)** to see every rule as a query.

**Rule sets**:

- **OWL RL (includes RDFS)**: the rules of the [OWL 2 RL/RDF rule tables](https://www.w3.org/TR/owl2-profiles/#Reasoning_in_OWL_2_RL_and_RDF_Graphs_using_Rules), with the W3C rule ids (`cax-sco`, `prp-inv1`, `cls-svf1`, …):
  - property rules: domain and range, sub-properties, property chains of length 2 and 3, inverse, symmetric, transitive, equivalent, functional and inverse-functional properties;
  - class rules: intersections, unions, `someValuesFrom`, `allValuesFrom`, `hasValue`, `maxCardinality 1`;
  - schema rules: transitivity of `subClassOf` and `subPropertyOf`, equivalent classes and properties, domains and ranges of super-classes and sub-properties, subsumption between restrictions, intersections and unions.
  The `owl:sameAs` substitution rules (`eq-rep-s/p/o`) copy every statement about an individual to each of its aliases, which grows the output very quickly, so they only run with **Apply owl:sameAs substitution** ticked.
- **RDFS**: the RDFS entailment rules rdfs2, rdfs3, rdfs5, rdfs7, rdfs9 and rdfs11. rdfs4a/4b ("everything is an rdfs:Resource") and the axiomatic triples are left out as noise.
- **Custom rules only**: only the rules in **Custom rules**.

**Custom rules** are extra CONSTRUCT queries, run in the same loop as the built-in rules. Each rule starts on a line beginning with `CONSTRUCT`, and the comment and `PREFIX` lines just above it belong to it. A comment `# rule: name` names the rule; other comment lines become its description. The input's prefixes are added automatically. The 'Rules (SPARQL)' output is in this format, so a built-in rule can be copied, changed and pasted back:

```
# rule: grandparent
# Grandparents from parents.
CONSTRUCT { ?x :hasGrandparent ?z }
WHERE { ?x :hasParent ?y . ?y :hasParent ?z }
```

**Consistency.** The OWL RL rules whose conclusion is "false" are run as checks: an individual in two disjoint classes (`cax-dw`, including `owl:AllDisjointClasses`), in `owl:Nothing` (`cls-nothing2`), or in a class and its complement (`cls-com`); `owl:sameAs` together with `owl:differentFrom` (`eq-diff1`); violations of irreflexive, asymmetric and disjoint properties (`prp-irp`, `prp-asyp`, `prp-pdw`); and `maxCardinality 0` (`cls-maxc1`). The report also lists classes that are subclasses of two disjoint classes, so can have no instances (e.g. pizza.owl's `CheeseyVegetableTopping`). This is found from the subclass links only, so it is incomplete.

**Where inferred triples go.** Each rule's new triples are put in the named graph `urn:ccc:inferred:<rule id>`, and a triple already in the input (in any graph) is never added again. The rule id is therefore carried along when the output is TriG or N-Quads, with no reification.

A new triple is credited to every rule that produces it in the round in which it first appears, so it can be in more than one rule's graph. For example, in the People sample `ex:carol a ex:Person` is produced in round 1 by rdfs9 (Carol is an Employee, a subclass of Person), rdfs2 (the domain of `ex:worksFor`) and rdfs3 (the range of `ex:knows`). The report lists all three rules in the triple's row, and the Turtle output lists the triple under each rule. A rule that would produce the triple only in a later round is not credited. Only the final step of a chain is credited: the intermediate triples are credited to the rules that made them, and are often about blank nodes.

**Outputs**:

- **Impact report** (HTML or Markdown):
  1. consistency problems;
  2. a table of the rules that added triples, with how many each added and how many are shown;
  3. the new superclasses, types, equivalences and `sameAs` links, property schema (domains, ranges, sub-properties) and property values, each with the rule that produced it, linked to the specification.
- **Asserted and inferred (TriG)**: the input in the default graph, plus the inferred graphs. Ontology Summary, Ontology Graph, Ontology Quality Checks and SPARQL Query read all graphs as one, so they can follow directly; Summary and Graph mark the inferred parts. `Convert RDF Format` → Turtle merges everything into one graph, for exporting to Protégé or elsewhere.
- **Inferred triples only (Turtle)**: only the new triples, grouped by rule with a comment before each group.

**Hide options.** Four options, all ticked by default, remove kinds of inferred triple that are numerous and rarely informative. The triples are still inferred and used by the other rules; the options only change what is written to the output. A triple that matches more than one option is counted under the first one in this table. The report's first paragraph gives the number of triples each option removed.

| Option | Triples it removes | Example |
| :--- | :--- | :--- |
| Hide owl:Thing and rdfs:Resource | `x a owl:Thing`, `x a rdfs:Resource`, and `rdfs:subClassOf`, `rdfs:domain` or `rdfs:range` of `owl:Thing` / `rdfs:Resource` | `:x a owl:Thing`, from a property whose domain is `owl:Thing` |
| Hide implied subClassOf, subPropertyOf, domain, range | `rdfs:subClassOf`, `rdfs:subPropertyOf`, `rdfs:domain` and `rdfs:range` triples that follow from two or more triples of the same kind | `ex:Manager rdfs:subClassOf ex:Person`, when Manager → Employee and Employee → Person are in the data; `ex:manages rdfs:domain ex:Person`, when the data has `ex:manages rdfs:domain ex:Manager` and Manager is a subclass of Person |
| Hide triples about blank nodes | triples whose subject or object is a blank node: restrictions, class expressions and list items | `:p1 a _:b1`, where `_:b1` is the restriction "hasTopping some Cheese" |
| Hide restated equivalences | the reverse of an `owl:equivalentClass`, `owl:equivalentProperty` or `owl:sameAs` triple that is present (the asserted direction is kept, or else the one whose subject sorts first), and `rdfs:subClassOf` / `rdfs:subPropertyOf` between two equivalent terms | `ex:hr_456 owl:sameAs ex:crm_123`, when `ex:crm_123 owl:sameAs ex:hr_456` is shown |

Inferred `rdf:type` triples of individuals are never removed by the hierarchy option: `ex:carol a ex:Person` is shown although Carol is an Employee and Employee is a subclass of Person. A domain or range that a sub-property gets from its super-property is also shown, because it is new information (e.g. `ex:hasMother rdfs:domain ex:Person`).

For pizza.owl, OWL RL infers 917 triples. The hierarchy option removes 275 and the blank node option 623, leaving 19.

**Limits.** OWL RL is designed to be computed by rules like these, but it is less complete than a DL reasoner (HermiT, Pellet or ELK in Protégé). It places *individuals* in defined classes, and finds some subclass links between *classes* (for example, pizza.owl's `CheeseyPizza`, `SpicyPizza` and `VegetarianPizza` are placed under `Pizza`, from their definitions as intersections). It does not find subclass links that need reasoning about hypothetical individuals: for example, `MargheritaPizza` is not placed under `CheeseyPizza`, which Protégé's reasoner does. It also ignores cardinalities above 1 and does not use `complementOf` or unions in superclasses. For full DL reasoning, load the ontology into a triple store with a reasoner (e.g. GraphDB) or use Protégé.

**Limits on the loop.** 'Max rounds' (default 50) and a cap of 200,000 inferred triples stop runaway rules (usually `owl:sameAs` substitution, or custom rules that create new terms); the error names the rule that added the most triples. Each round runs every rule over the whole store, which takes about 0.2 s for pizza.owl (2,300 triples, 4 rounds).

## Sample Ontology

Outputs a small ontology in Turtle; the input is ignored. It is meant as the first operation of a recipe, for example:

```
Sample Ontology  →  Ontology Reasoner (Output: Asserted and inferred (TriG))  →  Ontology Graph
Sample Ontology  →  Ontology Reasoner (Output: Impact report (HTML))
```

Each sample starts with a comment block that lists the inferences to expect, the rule that makes each one, and what to try. Comments in the body mark the lines each inference comes from. The samples have about 10–40 nodes, so each inference can be followed by hand.

| Sample | What it shows |
| :--- | :--- |
| People and organisations | RDFS: subclass (`ex:carol a ex:Person`), domain (`ex:grace a ex:Person`), range (`ex:ruth a ex:Person`) and sub-property (`ex:grace ex:hasParent ex:alice`, from `ex:hasMother`). OWL RL: inverse (`ex:bob ex:reportsTo ex:alice`), symmetric (`ex:dave ex:knows ex:alice`) and transitive (`ex:London ex:locatedIn ex:UK`) properties, and a property chain (`ex:grace ex:hasGrandparent ex:ruth`, which needs the sub-property inference first). A commented-out line makes the data inconsistent. |
| Pizzas | Defined classes: `:tonightsPizza` and `:myMargherita` are classified as `:CheeseyPizza`, `:CheeseyPizza` is placed under `:Pizza`, and an "only" restriction types a topping. The comments state one inference OWL RL does not make: `:Margherita rdfs:subClassOf :CheeseyPizza`. |
| Same individuals | `owl:sameAs` from an inverse-functional property (two records with the same mailbox) and a functional property (two birth mothers), and the facts copied between records with 'Apply owl:sameAs substitution'. |
| Bad data | Four errors in people data. A wrong `ex:manages` statement makes Bob a Manager with no warning. A shared mailbox makes Alice and Bob the same person (warning: eq-diff1, because they are declared different). A company used as the subject of `ex:worksFor` becomes a Person (warning: cax-dw). A class under two disjoint classes is reported as unsatisfiable. |

The People sample is the test ontology used while developing the Reasoner, with a few additions, each marked with a comment: `ex:hasMother`, `ex:hasGrandparent`, `ex:ruth`, and the removed type of `ex:grace` (the original line is kept as a comment).

The samples are in `src/core/lib/SampleOntologies.mjs`. The operation does not use Oxigraph, so it is in the `Default` module.

## Ontology Quality Checks

Checks, each with the number of problems and the terms affected (up to 'Max items per check', default 50):

| Check | What it reports |
| :--- | :--- |
| Classes / properties without a label | Declared classes and properties with no `rdfs:label` or `skos:prefLabel`. |
| Classes / properties without a description | No `skos:definition`, OBO definition, `rdfs:comment`, `dcterms:description` or `dc:description` in the chosen **Language** (untagged counts). |
| Classes used but not declared | IRIs used as a type, in `subClassOf`, `equivalentClass` or `disjointWith`, as a domain, as the range of a non-datatype property, in a restriction, or in a union or intersection, that are not typed `owl:Class`, `rdfs:Class` or `rdfs:Datatype`. |
| Properties used but not declared | Predicates (and IRIs in `owl:onProperty`, `rdfs:subPropertyOf`, `owl:inverseOf`, `owl:equivalentProperty`) with no property type. |
| Labels used by more than one term | The same label (ignoring case) in the same language on different terms. |
| Terms with more than one label in the same language | Several `rdfs:label` / `skos:prefLabel` values in one language on one term. |
| Classes with no superclass that nothing refers to | Declared classes not connected to anything else. |
| Named individuals with no class | `owl:NamedIndividual`s with no other type. |
| Deprecated terms still used | Terms with `owl:deprecated true` that other triples still refer to. |
| Ontology header | No `owl:Ontology`, or one without a title, description, version (`owl:versionIRI` / `owl:versionInfo`) or licence (`dcterms:license`, `dcterms:rights`, `dc:rights`, `cc:license`). |

Terms in the common vocabularies (RDF, RDFS, OWL, XSD, SKOS, Dublin Core, FOAF, schema.org, PROV, SHACL) are not checked.

It works on plain RDF or on the Reasoner's TriG output. **Triples to check** chooses 'All (asserted and inferred)' or 'Asserted only', which ignores the `urn:ccc:inferred:*` graphs. Running both on the same reasoned input shows what reasoning changes. For example, an individual whose type comes only from a property's domain is reported as having no class under 'Asserted only' but not under 'All'.

Outputs: HTML (a table of checks with ✓ or a count, then the items of each failing check), Markdown, Text, JSON, and CSV with one row per problem for **To Table**. The same checks are available in Ontology Summary through **Include quality checks**.

## Implementation

- `src/core/lib/OntologyModel.mjs`: class hierarchy, class expressions, restrictions, descriptions, and property-to-class matching for Ontology Summary.
- `src/core/lib/Reasoning.mjs`: the rule table (`RULES`, `CHECKS`), `runRules` (the loop), `filterInferences` (the Hide options), `inferredIndex` (which triples are only inferred, and by which rules, used by Graph and Summary) and `withoutInferred`.
- `src/core/lib/OntologyQuality.mjs`: the quality checks and their Text, Markdown and CSV formatters, shared by Ontology Quality Checks and Ontology Summary.
- `src/core/lib/OntologyMarkdown.mjs`: Markdown escaping, and rendering through Render Markdown for the ops' HTML outputs. Each op sets `presentType` to `html` inside `present()` only for its HTML option, so the other outputs stay plain text.
- `src/core/lib/RDF.mjs`: shared helpers.
  - `getOxigraph()` initialises the WASM once. In the browser, `oxigraph/web_bg.wasm` is inlined as base64 by a `base64-loader` rule in `webpack.config.js` (the same pattern as argon2) and passed to `init()`. Oxigraph's default loader resolves the file from `import.meta.url`, which fails inside the ChefWorker; a separate `.wasm` file would also break the standalone build. The Node build loads the WASM itself.
  - It also provides format detection, `loadStore`, prefix extraction, and `serialise`.
- Turtle output uses `@rdfjs/serializer-turtle`, with two fixes applied in `RDF.mjs`:
  - Local names that are not valid in Turtle stay as full IRIs.
  - Blank-node cycles, which the library would otherwise drop, are given labels.

  As a safety net, the pretty output is re-parsed and replaced with Oxigraph's plain Turtle if any triple were missing.
- RDF/XML output is written by `prettyRDFXML` in `RDF.mjs`, because Oxigraph's RDF/XML writer declares a namespace on every element. The "Pretty" RDF/XML is checked by round-trip tests.
- The operations use their own webpack module (`Ontology`), so the WASM (~5.4 MB as base64) is only downloaded when an ontology operation is first used.
- Node 18 has no global `crypto`, which Oxigraph needs for blank-node ids, so `getOxigraph()` sets it from Node's `webcrypto`.
- Tests:
  - `tests/operations/tests/Ontology.mjs`, `tests/operations/tests/OntologyReasoning.mjs` and `tests/operations/tests/ToTable.mjs` (offline, `npm test`).
  - `tests/browser/OntologyOps.js` (Nightwatch; checks that the WASM loads in the real ChefWorker and that the graph draws from unpkg).

## Possible next steps

- **SPARQL Update.** INSERT/DELETE, then write the modified graph back out, e.g. to rename a namespace or remove deprecated terms.
- **SHACL validation** with `rdf-validate-shacl`.
- **Remote SPARQL endpoints** such as Wikidata or DBpedia. These need CSP `connect-src` entries.
- **OWL/XML, Functional, Manchester and OBO** via a ROBOT Cloud Run proxy, following the pattern in `infrastructure/`.
- **Full DL reasoning** (Protégé-style classification) via an external store such as GraphDB, or `robot reason` in the same proxy.
