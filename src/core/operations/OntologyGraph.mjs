/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import Utils from "../Utils.mjs";
import {
    getOxigraph, loadStore, inputPrefixes, allPrefixes, withPrefixes, shortenIRI, localName, preferredLabels, langMatches,
    WELL_KNOWN_PREFIXES, INPUT_FORMATS
} from "../lib/RDF.mjs";
import { readDescriptions, DESCRIPTION_PREDICATES } from "../lib/OntologyModel.mjs";

const RDF = WELL_KNOWN_PREFIXES.rdf, RDFS = WELL_KNOWN_PREFIXES.rdfs, OWL = WELL_KNOWN_PREFIXES.owl;
const OWL_THING = OWL + "Thing";
const MAX_TOOLTIP_LINES = 12;
const BUILT_IN = [RDF, RDFS, OWL];
const MAX_DESCRIPTION_LENGTH = 600;
const SKOS = WELL_KNOWN_PREFIXES.skos;

/** Annotations shown in tooltips after the descriptions, as [predicate, heading]. */
const EXTRA_ANNOTATIONS = [
    [SKOS + "altLabel", "Also known as"],
    ["http://www.geneontology.org/formats/oboInOwl#hasExactSynonym", "Also known as"],
    [SKOS + "example", "Example"],
    [SKOS + "scopeNote", "Scope note"],
    [SKOS + "note", "Note"],
    [RDFS + "seeAlso", "See also"],
    [OWL + "deprecated", "Deprecated"],
];
/** Literal-valued predicates shown in the annotation block rather than as separate tooltip lines. */
const ANNOTATION_PREDICATES = new Set([...DESCRIPTION_PREDICATES, ...EXTRA_ANNOTATIONS.map(([p]) => p).filter(p => p !== RDFS + "seeAlso")]);

const VIS_NETWORK_URL = "https://unpkg.com/vis-network@10.1.2/standalone/umd/vis-network.min.js";
const VIS_NETWORK_SRI = "sha384-RDdG1CLOxjNlTHh4JYx/rnAueaMHbkBHmeHwrEyljMQw3LF0it4SkuNotIY/FPxD";

/** Node colours per group; chosen to be readable on both light and dark themes. */
const GROUPS = {
    "class": { label: "Class", background: "#cfe2ff", border: "#3d6fb6", shape: "box" },
    "datatype": { label: "Datatype", background: "#fff3cd", border: "#b8860b", shape: "box" },
    "resource": { label: "Resource", background: "#d1e7dd", border: "#2e7d4f", shape: "box" },
    "bnode": { label: "Blank node", background: "#e9ecef", border: "#6c757d", shape: "dot" },
};

/**
 * Colours for a selected node and its neighbours in the class hierarchy, from
 * the ColorBrewer "Oranges" sequential scale: superclasses (parents) darkest
 * and thickest, subclasses (children) lightest.
 */
const SELECTED_COLOUR = "#d94801";
const RELATIVES = {
    parent: { label: "superclass", color: "#7f2704", borderWidth: 3, selectionWidth: 2 },
    child: { label: "subclass", color: "#fd8d3c", borderWidth: 2, selectionWidth: 1 },
};

/**
 * Ontology Graph operation
 */
class OntologyGraph extends Operation {

    /**
     * OntologyGraph constructor
     */
    constructor() {
        super();

        this.name = "Ontology Graph";
        this.module = "Ontology";
        this.description = "Draws an ontology or other RDF data as an interactive node-and-edge graph (drag, zoom, hover for details, search to highlight).<br><br>" +
            "<b>Views</b>:<ul>" +
            "<li><b>Class hierarchy</b>: named classes, with an arrow from each class to its superclass (rdfs:subClassOf).</li>" +
            "<li><b>Classes and properties</b>: the hierarchy plus object properties (domain → range), datatype properties (domain → datatype) and someValuesFrom / allValuesFrom restrictions (dashed).</li>" +
            "<li><b>All triples</b>: every IRI and blank node, one edge per triple. Literal values, and types from the OWL/RDFS/RDF vocabularies (e.g. owl:Class), are shown in the node's tooltip and colour rather than as edges, to avoid hub nodes.</li></ul>" +
            "Hovering over a node or property edge shows its IRI and annotations: descriptions (rdfs:comment, skos:definition, dcterms:description, OBO definition), " +
            "synonyms (skos:altLabel, oboInOwl:hasExactSynonym), skos:example, skos:scopeNote, skos:note, rdfs:seeAlso and owl:deprecated. " +
            "<b>Language</b> filters these (e.g. <code>en</code>, or <code>en, fr</code>; leave empty for all); untagged text is always included. Labels prefer this language.<br><br>" +
            "Clicking a class highlights its subclass arrows and the borders of the classes they lead to: superclasses in dark orange, subclasses in light orange.<br><br>" +
            "The search box highlights nodes whose label, IRI or annotations contain the text; press Enter to move between matches.<br><br>" +
            "<b>Max nodes</b> limits the size of the drawing. When the graph is larger, the most connected nodes and their neighbours are kept, so the part shown stays connected.<br><br>" +
            "As the last operation, the graph is drawn; otherwise the output is the graph as JSON (nodes and edges). " +
            "Drawing uses the vis-network library loaded from unpkg.com, so this operation needs internet access to display the graph.";
        this.infoURL = "https://visjs.github.io/vis-network/docs/network/";
        this.inputType = "string";
        this.outputType = "string";
        this.presentType = "html";
        this.args = [
            {
                name: "Input format",
                type: "option",
                value: INPUT_FORMATS
            },
            {
                name: "View",
                type: "option",
                value: ["Classes and properties", "Class hierarchy", "All triples"]
            },
            {
                name: "Max nodes",
                type: "number",
                value: 200,
                min: 1
            },
            {
                name: "Node labels",
                type: "option",
                value: ["Label, else prefixed name", "Prefixed name"]
            },
            {
                name: "Layout",
                type: "option",
                value: ["Force-directed", "Hierarchical"]
            },
            {
                name: "Additional prefixes",
                type: "text",
                value: ""
            },
            {
                name: "Language",
                type: "string",
                value: "en"
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {Promise<string>} the graph as JSON
     */
    async run(input, args) {
        const [inputFormat, view, maxNodes, labelMode, , additionalPrefixes, language = "en"] = args;
        const lang = (language || "").trim();
        const ox = await getOxigraph();
        const { store } = loadStore(ox, input, inputFormat);
        const prefixes = allPrefixes(inputPrefixes(input, additionalPrefixes));
        const select = query => store.query(withPrefixes(query, prefixes), { "use_default_graph_as_union": true });
        const labels = preferredLabels(ox, store, lang || "en");
        const graph = new GraphBuilder(prefixes, labels, labelMode === "Prefixed name", readAnnotations(select, lang));

        if (view === "All triples") {
            buildTripleGraph(ox, store, graph);
        } else {
            buildClassGraph(select, graph, view === "Classes and properties");
        }
        return JSON.stringify(graph.limit(Math.max(1, Math.floor(maxNodes) || 1)), null, 2);
    }

    /**
     * Draws the graph with vis-network.
     *
     * @param {string} data - graph JSON from run()
     * @param {Object[]} args
     * @returns {string} HTML
     */
    present(data, args) {
        let graph;
        try {
            graph = JSON.parse(data);
        } catch (e) {
            graph = null;
        }
        if (!graph || !Array.isArray(graph.nodes)) return `<pre>${Utils.escapeHtml(data)}</pre>`;
        if (!graph.nodes.length) return "<p>No nodes to draw for this view. Try the 'All triples' view.</p>";

        const hierarchical = args[4] === "Hierarchical";
        const groups = {};
        for (const [name, g] of Object.entries(GROUPS)) {
            groups[name] = {
                shape: g.shape,
                color: { background: g.background, border: g.border, highlight: { background: g.background, border: SELECTED_COLOUR } },
                ...(g.shape === "dot" ? { size: 7 } : {}),
            };
        }
        const options = {
            groups,
            nodes: { margin: 8, borderWidth: 1, borderWidthSelected: 3, font: { size: 14, color: "#1b1b1b" } },
            edges: {
                arrows: { to: { enabled: true, scaleFactor: 0.6 } },
                color: { color: "#8a8a8a", highlight: SELECTED_COLOUR, inherit: false },
                font: { size: 11, color: "#555555", strokeWidth: 3, strokeColor: "#ffffff", align: "middle" },
                smooth: hierarchical ? { type: "cubicBezier", forceDirection: "horizontal" } : { type: "dynamic" },
            },
            interaction: { hover: true, tooltipDelay: 150 },
            layout: hierarchical ?
                // Edges point from subclass to superclass; right-to-left puts superclasses on the
                // left and stacks siblings vertically, which suits long lists of subclasses.
                { hierarchical: { direction: "RL", sortMethod: "directed", shakeTowards: "roots", levelSeparation: 220, nodeSpacing: 60 } } :
                { improvedLayout: graph.nodes.length <= 150 },
            physics: hierarchical ?
                { solver: "hierarchicalRepulsion", hierarchicalRepulsion: { nodeDistance: 140 }, stabilization: { iterations: 300 } } :
                { solver: "forceAtlas2Based", forceAtlas2Based: { gravitationalConstant: -60, springLength: 120 }, stabilization: { iterations: 400 } },
        };

        const summary = graph.truncated ?
            `Showing ${graph.nodes.length} of ${graph.totalNodes} nodes and ${graph.edges.length} of ${graph.totalEdges} edges (limited by 'Max nodes').` :
            `${graph.nodes.length} nodes, ${graph.edges.length} edges.`;
        const usedGroups = new Set(graph.nodes.map(n => n.group));
        const legend = Object.entries(GROUPS)
            .filter(([name]) => usedGroups.has(name))
            .map(([, g]) => `<span style="display:inline-block;width:10px;height:10px;margin:0 4px 0 10px;border:1px solid ${g.border};background:${g.background};border-radius:${g.shape === "dot" ? "50%" : "2px"}"></span>${g.label}`)
            .join("") + (graph.edges.some(e => e.dashes) ? "<span style=\"margin-left:10px\">- - restriction</span>" : "") +
            (graph.edges.some(e => e.subClassOf) ?
                "<span style=\"margin-left:10px\">Selected class:</span>" + Object.values(RELATIVES)
                    .map(r => `<span style="display:inline-block;width:14px;height:0;margin:0 4px 3px 8px;border-top:${r.borderWidth}px solid ${r.color}"></span>${r.label}`)
                    .join("") :
                "");

        return `<style>
    #output-text .cm-content,
    #output-text .cm-line,
    #output-html {
        padding: 0;
        white-space: normal;
    }
    /* vis-network sets tooltips with innerText and white-space: nowrap, so long
       descriptions would run off the pane; wrap them instead. */
    #ontologyGraph div.vis-tooltip {
        white-space: pre-wrap;
        max-width: 420px;
        font-family: inherit;
        font-size: 12px;
        line-height: 1.4;
    }
</style>
<div id="ontologyGraphWrap" style="position: relative; width: 100%; height: 400px;">
    <div id="ontologyGraph" style="width: 100%; height: 100%;"></div>
    <div style="position: absolute; top: 6px; left: 8px; max-width: calc(100% - 270px); font-size: 12px; background: rgba(255,255,255,0.85); color: #333; padding: 3px 8px; border-radius: 4px; pointer-events: none;">
        ${Utils.escapeHtml(summary)}${legend}<span style="margin-left:10px;color:#666">Scroll to zoom, drag to pan, hover for details.</span>
    </div>
    <div style="position: absolute; top: 6px; right: 8px; font-size: 12px; background: rgba(255,255,255,0.85); color: #333; padding: 3px 6px; border-radius: 4px;">
        <input id="ontologyGraphSearch" type="search" placeholder="Search nodes" title="Highlights nodes whose label, IRI or annotations contain this text. Enter: next match, Shift+Enter: previous, Esc: clear." style="width: 150px; font-size: 12px; padding: 1px 4px; border: 1px solid #aaa; border-radius: 3px; background: #fff; color: #1b1b1b;">
        <span id="ontologyGraphCount" style="margin-left: 4px; color: #666;"></span>
    </div>
</div>
<script type="text/javascript">
(function () {
    var data = ${safeJSON({ ...graph, focus: mostConnected(graph) })};
    var options = ${safeJSON(options)};
    var relatives = ${safeJSON(RELATIVES)};
    var container = document.getElementById("ontologyGraph");
    var wrap = document.getElementById("ontologyGraphWrap");
    var pane = document.getElementById("output-text");
    // Percentage heights do not resolve inside the output widget, so match the
    // visible output pane and follow it when the pane is resized.
    function fitToPane() {
        if (wrap && pane) wrap.style.height = Math.max(250, pane.clientHeight - 6) + "px";
    }
    fitToPane();
    function draw() {
        if (!container) return;
        var nodes = new vis.DataSet(data.nodes), edges = new vis.DataSet(data.edges);
        var network = new vis.Network(container, { nodes: nodes, edges: edges }, options);
        container.visNetwork = network; // for the browser tests
        var markRelatives = setupRelatives(network, nodes, edges);
        network.on("select", markRelatives);
        network.on("dragStart", markRelatives);
        setupSearch(network, nodes, edges, markRelatives);
        // Stop the simulation once laid out so nodes stay where the user drags them.
        // If the whole graph only fits at an unreadable size, zoom in on the most
        // connected node instead; the user can pan or zoom out from there.
        network.once("stabilizationIterationsDone", function () {
            network.setOptions({ physics: false });
            network.fit();
            if (network.getScale() < 0.45 && data.focus) network.focus(data.focus, { scale: 0.8 });
        });
        if (window.ResizeObserver && pane) {
            var observer = new ResizeObserver(function () {
                if (!document.body.contains(container)) { observer.disconnect(); return; }
                fitToPane();
                network.fit();
            });
            observer.observe(pane);
        }
    }
    // Returns a function that colours the subclass edges of the selected nodes,
    // and the borders of the classes at their other ends: superclasses in the
    // "parent" colour, subclasses in the "child" colour. vis-network draws an
    // edge touching a selected node in its highlight colour, so setting that is
    // enough for edges; node borders are set here and reset on the next call.
    function setupRelatives(network, nodes, edges) {
        var marked = [];
        return function () {
            var selected = {}, roles = {}, edgeUpdates = [];
            network.getSelectedNodes().forEach(function (id) { selected[id] = true; });
            edges.get({ filter: function (e) { return e.subClassOf && (selected[e.from] || selected[e.to]); } }).forEach(function (e) {
                // Subclass edges point from the subclass to the superclass
                var role = selected[e.from] ? "parent" : "child", other = role === "parent" ? e.to : e.from;
                var colour = Object.assign({}, e.color, { highlight: relatives[role].color });
                edgeUpdates.push({ id: e.id, color: colour, selectionWidth: relatives[role].selectionWidth });
                if (!selected[other] && roles[other] !== "parent") roles[other] = role;
            });
            if (edgeUpdates.length) edges.update(edgeUpdates);
            var nodeUpdates = marked.filter(function (id) { return !roles[id]; }).map(function (id) {
                return { id: id, color: options.groups[nodes.get(id).group].color, borderWidth: 1 };
            });
            marked = Object.keys(roles);
            marked.forEach(function (id) {
                var group = options.groups[nodes.get(id).group].color, r = relatives[roles[id]];
                nodeUpdates.push({ id: id, color: { background: group.background, border: r.color, highlight: group.highlight }, borderWidth: r.borderWidth });
            });
            if (nodeUpdates.length) nodes.update(nodeUpdates);
        };
    }
    // Dims nodes that do not match the search text, selects the ones that do,
    // and steps through the matches with Enter / Shift+Enter.
    function setupSearch(network, nodes, edges, markRelatives) {
        var box = document.getElementById("ontologyGraphSearch");
        var count = document.getElementById("ontologyGraphCount");
        if (!box) return;
        var haystack = {};
        data.nodes.forEach(function (n) {
            haystack[n.id] = ((n.label || "") + " " + n.id + " " + (n.title || "")).toLowerCase();
        });
        var matches = [], current = -1;
        function apply() {
            var q = box.value.trim().toLowerCase();
            var hit = {};
            matches = q ? data.nodes.filter(function (n) { return haystack[n.id].indexOf(q) !== -1; }).map(function (n) { return n.id; }) : [];
            matches.forEach(function (id) { hit[id] = true; });
            current = -1;
            nodes.update(data.nodes.map(function (n) { return { id: n.id, opacity: !q || hit[n.id] ? 1 : 0.2 }; }));
            edges.update(edges.get().map(function (e) { return { id: e.id, color: Object.assign({}, e.color, { opacity: !q || (hit[e.from] && hit[e.to]) ? 1 : 0.15 }) }; }));
            network.selectNodes(matches, false);
            markRelatives();
            count.textContent = q ? matches.length + (matches.length === 1 ? " match" : " matches") : "";
        }
        function step(by) {
            if (!matches.length) return;
            current = (current + by + matches.length) % matches.length;
            network.selectNodes(matches, false);
            network.focus(matches[current], { scale: Math.max(network.getScale(), 1), animation: { duration: 400 } });
            count.textContent = (current + 1) + " of " + matches.length;
        }
        box.addEventListener("input", apply);
        box.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
            else if (e.key === "Escape") { box.value = ""; apply(); }
        });
    }
    if (window.vis && window.vis.Network) { draw(); return; }
    var script = document.createElement("script");
    script.src = "${VIS_NETWORK_URL}";
    script.integrity = "${VIS_NETWORK_SRI}";
    script.crossOrigin = "anonymous";
    script.onload = draw;
    script.onerror = function () {
        if (container) container.textContent = "Could not load vis-network from unpkg.com. The graph needs internet access to display; the graph JSON is available by adding another operation after this one.";
    };
    document.body.appendChild(script);
})();
</script>`;
    }

}

/**
 * Returns the id of the node with the most edges.
 *
 * @param {{nodes: Object[], edges: Object[]}} graph
 * @returns {string|null}
 */
function mostConnected(graph) {
    const degree = new Map();
    for (const e of graph.edges) {
        degree.set(e.from, (degree.get(e.from) || 0) + 1);
        degree.set(e.to, (degree.get(e.to) || 0) + 1);
    }
    let best = null;
    for (const [id, d] of degree) if (best === null || d > degree.get(best)) best = id;
    return best;
}

/**
 * Serialises a value as JSON that is safe to embed inside a <script> element.
 *
 * @param {*} value
 * @returns {string}
 */
function safeJSON(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/**
 * Collects nodes and edges and applies the node limit.
 */
class GraphBuilder {

    /**
     * GraphBuilder constructor
     *
     * @param {Object<string, string>} prefixes
     * @param {Map<string, string>} labels - IRI -> preferred label
     * @param {boolean} prefixedNamesOnly - ignore rdfs:label etc.
     * @param {Map<string, string>} [annotations] - IRI -> tooltip annotation text
     */
    constructor(prefixes, labels, prefixedNamesOnly, annotations = new Map()) {
        this.prefixes = prefixes;
        this.labels = labels;
        this.prefixedNamesOnly = prefixedNamesOnly;
        this.annotations = annotations;
        this.nodes = new Map();
        this.edges = new Map();
    }

    /**
     * Returns the prefixed name of an IRI, or its local name.
     *
     * @param {string} iri
     * @returns {string}
     */
    short(iri) {
        return shortenIRI(iri, this.prefixes) || localName(iri);
    }

    /**
     * Returns the display label for an IRI.
     *
     * @param {string} iri
     * @returns {string}
     */
    display(iri) {
        return (!this.prefixedNamesOnly && this.labels.get(iri)) || this.short(iri);
    }

    /**
     * Returns tooltip text for an IRI: the IRI, its label when not already
     * shown, and its annotations.
     *
     * @param {string} iri
     * @param {string} shown - the text already displayed for it
     * @returns {string}
     */
    tooltip(iri, shown) {
        const lbl = this.labels.get(iri);
        const notes = this.annotations.get(iri);
        return iri + (lbl && lbl !== shown ? `\n${lbl}` : "") + (notes ? `\n\n${notes}` : "");
    }

    /**
     * Returns tooltip text for an edge drawn for a property.
     *
     * @param {string} iri - the property IRI
     * @returns {string}
     */
    edgeTooltip(iri) {
        const short = this.short(iri);
        return (short !== iri ? short + "\n" : "") + this.tooltip(iri, short);
    }

    /**
     * Adds a node (or upgrades its group) and returns its id.
     *
     * @param {{termType: string, value: string}} term
     * @param {string} group - key of GROUPS
     * @param {Object} [extra] - overrides for id/label/title
     * @returns {string}
     */
    addNode(term, group, extra = {}) {
        const id = extra.id || (term.termType === "BlankNode" ? "_:" + term.value : term.value);
        const existing = this.nodes.get(id);
        if (existing) {
            if (group === "class" && existing.group === "resource") existing.group = "class";
            return id;
        }
        let label, title;
        if (term.termType === "BlankNode") {
            label = "";
            title = "Blank node";
        } else {
            label = this.display(term.value);
            title = this.tooltip(term.value, label);
        }
        this.nodes.set(id, { id, label: extra.label ?? label, title: extra.title ?? title, group, info: [] });
        return id;
    }

    /**
     * Adds a line to a node's tooltip (used for literal values).
     *
     * @param {string} id
     * @param {string} line
     */
    addInfo(id, line) {
        const node = this.nodes.get(id);
        if (node && node.info.length <= MAX_TOOLTIP_LINES) node.info.push(line);
    }

    /**
     * Adds a directed edge between two existing nodes (duplicates are ignored).
     *
     * @param {string} from
     * @param {string} to
     * @param {string} label
     * @param {boolean} [dashes]
     * @param {string} [title] - tooltip text
     * @param {boolean} [subClassOf] - true for an rdfs:subClassOf edge (subclass → superclass)
     */
    addEdge(from, to, label, dashes = false, title = "", subClassOf = false) {
        const key = `${from}\u0000${to}\u0000${label}`;
        if (!this.edges.has(key)) {
            this.edges.set(key, {
                from, to, ...(label ? { label } : {}), ...(dashes ? { dashes: true } : {}), ...(title ? { title } : {}), ...(subClassOf ? { subClassOf: true } : {})
            });
        }
    }

    /**
     * Returns the graph, keeping at most maxNodes nodes. Nodes are taken
     * breadth-first from the most connected node, so the kept part stays
     * connected; further components start from their own best-connected node.
     *
     * @param {number} maxNodes
     * @returns {Object}
     */
    limit(maxNodes) {
        const edges = [...this.edges.values()];
        const neighbours = new Map([...this.nodes.keys()].map(id => [id, new Set()]));
        for (const e of edges) {
            neighbours.get(e.from).add(e.to);
            neighbours.get(e.to).add(e.from);
        }
        const degree = id => neighbours.get(id).size;
        const byDegree = (a, b) => degree(b) - degree(a) || (a < b ? -1 : a > b ? 1 : 0);

        let keep;
        if (this.nodes.size <= maxNodes) {
            keep = new Set(this.nodes.keys());
        } else {
            keep = new Set();
            const candidates = [...this.nodes.keys()].sort(byDegree);
            for (const start of candidates) {
                if (keep.size >= maxNodes) break;
                if (keep.has(start)) continue;
                const queue = [start];
                keep.add(start);
                while (queue.length && keep.size < maxNodes) {
                    const next = [...neighbours.get(queue.shift())].filter(n => !keep.has(n)).sort(byDegree);
                    for (const n of next) {
                        if (keep.size >= maxNodes) break;
                        keep.add(n);
                        queue.push(n);
                    }
                }
            }
        }

        const nodes = [...keep].map(id => {
            const { info, ...node } = this.nodes.get(id);
            if (info.length) {
                node.title += "\n\n" + info.slice(0, MAX_TOOLTIP_LINES).join("\n") + (info.length > MAX_TOOLTIP_LINES ? "\n…" : "");
            }
            return node;
        });
        const keptEdges = edges.filter(e => keep.has(e.from) && keep.has(e.to));
        return {
            truncated: keep.size < this.nodes.size,
            totalNodes: this.nodes.size,
            totalEdges: edges.length,
            nodes,
            edges: keptEdges,
        };
    }

}

/**
 * Collects the annotation text shown in tooltips for each IRI: "Deprecated"
 * if it is, the descriptions (one paragraph each), then synonyms, examples,
 * notes and see-also links.
 *
 * @param {function(string): Map<string, Object>[]} select - runs a SPARQL SELECT
 * @param {string} language - e.g. "en"; "" for all
 * @returns {Map<string, string>} IRI -> annotation text
 */
function readAnnotations(select, language) {
    const clip = text => text.length > MAX_DESCRIPTION_LENGTH ? text.slice(0, MAX_DESCRIPTION_LENGTH - 1) + "…" : text;
    const headings = new Map(EXTRA_ANNOTATIONS);
    const extras = new Map();
    const values = EXTRA_ANNOTATIONS.map(([p]) => `<${p}>`).join(" ");
    for (const r of select(`SELECT ?s ?p ?o WHERE { VALUES ?p { ${values} } ?s ?p ?o FILTER(isIRI(?s) && !isBlank(?o)) }`)) {
        const o = r.get("o"), p = r.get("p").value;
        if (p === OWL + "deprecated" && !/^(true|1)$/i.test(o.value)) continue;
        if (o.termType === "Literal" && !langMatches(o.language, language)) continue;
        const text = clip(o.value.trim());
        if (!text) continue;
        const iri = r.get("s").value, heading = headings.get(p);
        if (!extras.has(iri)) extras.set(iri, new Map());
        if (!extras.get(iri).has(heading)) extras.get(iri).set(heading, new Set());
        extras.get(iri).get(heading).add(text);
    }

    const descriptions = readDescriptions(select, language);
    const result = new Map();
    for (const iri of new Set([...descriptions.keys(), ...extras.keys()])) {
        const found = extras.get(iri) || new Map();
        const lines = [...new Set(headings.values())]
            .filter(h => found.has(h) && h !== "Deprecated")
            .map(h => `${h}: ${[...found.get(h)].join(", ")}`);
        const blocks = [
            ...(found.has("Deprecated") ? ["Deprecated"] : []),
            ...(descriptions.get(iri) || []).map(clip),
            ...(lines.length ? [lines.join("\n")] : []),
        ];
        if (blocks.length) result.set(iri, blocks.join("\n\n"));
    }
    return result;
}

/**
 * Adds classes, subclass edges and (optionally) property and restriction edges.
 *
 * @param {function(string): Map<string, Object>[]} select - runs a SPARQL SELECT
 * @param {GraphBuilder} graph
 * @param {boolean} withProperties
 */
function buildClassGraph(select, graph, withProperties) {
    const iri = value => ({ termType: "NamedNode", value });
    const addClass = value => graph.addNode(iri(value), "class");

    for (const r of select("SELECT DISTINCT ?c WHERE { { ?c a owl:Class } UNION { ?c a rdfs:Class } FILTER(isIRI(?c) && ?c != owl:Thing) }")) {
        addClass(r.get("c").value);
    }
    for (const r of select("SELECT DISTINCT ?c ?p WHERE { ?c rdfs:subClassOf ?p FILTER(isIRI(?c) && isIRI(?p) && ?c != ?p) }")) {
        const c = addClass(r.get("c").value);
        if (r.get("p").value !== OWL_THING) graph.addEdge(c, addClass(r.get("p").value), "", false, "", true);
    }
    if (!withProperties) return;

    for (const r of select("SELECT DISTINCT ?p ?d ?r WHERE { ?p a owl:ObjectProperty ; rdfs:domain ?d ; rdfs:range ?r FILTER(isIRI(?d) && isIRI(?r)) }")) {
        const p = r.get("p").value;
        graph.addEdge(addClass(r.get("d").value), addClass(r.get("r").value), graph.display(p), false, graph.edgeTooltip(p));
    }
    // Datatype properties get their own datatype node each, as a shared
    // xsd:string node would pull unrelated classes together.
    for (const r of select("SELECT DISTINCT ?p ?d ?r WHERE { ?p a owl:DatatypeProperty ; rdfs:domain ?d ; rdfs:range ?r FILTER(isIRI(?d) && isIRI(?r)) }")) {
        const p = r.get("p").value, range = r.get("r").value;
        const target = graph.addNode(iri(range), "datatype", { id: `datatype:${p}:${range}`, label: graph.short(range), title: range });
        graph.addEdge(addClass(r.get("d").value), target, graph.display(p), false, graph.edgeTooltip(p));
    }
    const restrictions = select(`SELECT DISTINCT ?c ?p ?v ?kind WHERE {
        ?c rdfs:subClassOf|owl:equivalentClass ?r .
        ?r owl:onProperty ?p .
        { ?r owl:someValuesFrom ?v BIND("some" AS ?kind) } UNION { ?r owl:allValuesFrom ?v BIND("only" AS ?kind) }
        FILTER(isIRI(?c) && isIRI(?p) && isIRI(?v))
    }`);
    for (const r of restrictions) {
        const target = r.get("v").value;
        const to = target.startsWith(WELL_KNOWN_PREFIXES.xsd) || target === RDFS + "Literal" ?
            graph.addNode(iri(target), "datatype", { id: `datatype:${r.get("p").value}:${target}`, label: graph.short(target), title: target }) :
            addClass(target);
        const p = r.get("p").value, kind = r.get("kind").value;
        const restriction = `${kind === "some" ? "owl:someValuesFrom" : "owl:allValuesFrom"} restriction\n\n`;
        graph.addEdge(addClass(r.get("c").value), to, `${graph.display(p)} (${kind})`, true, restriction + graph.edgeTooltip(p));
    }
}

/**
 * Adds a node for every IRI and blank node and an edge for every triple;
 * literal values are listed in the subject's tooltip (annotations of IRIs are
 * already in the tooltip's annotation block, so they are not repeated).
 *
 * @param {Object} ox
 * @param {Object} store
 * @param {GraphBuilder} graph
 */
function buildTripleGraph(ox, store, graph) {
    const classes = new Set();
    for (const type of [OWL + "Class", RDFS + "Class"]) {
        for (const q of store.match(null, ox.namedNode(RDF + "type"), ox.namedNode(type), null)) classes.add(q.subject.value);
    }
    const groupOf = t => (t.termType === "BlankNode" ? "bnode" : classes.has(t.value) ? "class" : "resource");

    for (const q of store.match()) {
        if (q.subject.termType === "Quad" || q.object.termType === "Quad") continue;
        const s = graph.addNode(q.subject, groupOf(q.subject));
        const predicate = graph.short(q.predicate.value);
        if (q.object.termType === "Literal") {
            if (q.subject.termType === "NamedNode" && ANNOTATION_PREDICATES.has(q.predicate.value)) continue;
            const value = q.object.value.length > 120 ? q.object.value.slice(0, 117) + "…" : q.object.value;
            graph.addInfo(s, `${predicate}: ${value}${q.object.language ? "@" + q.object.language : ""}`);
        } else if (q.predicate.value === RDF + "type" && q.object.termType === "NamedNode" && BUILT_IN.some(ns => q.object.value.startsWith(ns))) {
            // Every class would otherwise link to one owl:Class hub node.
            graph.addInfo(s, `a ${graph.short(q.object.value)}`);
        } else {
            const group = q.predicate.value === RDF + "type" ? "class" : groupOf(q.object);
            const subClassOf = q.predicate.value === RDFS + "subClassOf" && q.object.termType === "NamedNode";
            graph.addEdge(s, graph.addNode(q.object, group), q.predicate.value === RDF + "type" ? "a" : predicate, false, graph.edgeTooltip(q.predicate.value), subClassOf);
        }
    }
}

export default OntologyGraph;
