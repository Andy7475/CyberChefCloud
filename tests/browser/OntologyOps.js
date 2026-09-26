/**
 * End-to-end tests for the ontology / RDF operations via Nightwatch.
 * These run offline: they check that the Oxigraph WASM module loads in the
 * browser's ChefWorker and that results render (including via To Table).
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const browserUtils = require("./browserUtils.js");

const PIZZA_TTL = `@prefix : <http://example.org/pizza#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:Pizza a owl:Class ; rdfs:label "Pizza, Italian"@en .
:Margherita a owl:Class ; rdfs:subClassOf :Pizza .
`;

/**
 * Returns the current output text.
 *
 * @param {Object} browser
 * @param {function(string)} callback
 */
function readOutput(browser, callback) {
    browser.execute(function () {
        return window.app.manager.output.outputEditorView.state.doc.toString();
    }, [], function ({ value }) {
        callback(value);
    });
}

module.exports = {

    before: browser => {
        browser
            .resizeWindow(1280, 800)
            .url(browser.launchUrl)
            .useCss()
            .waitForElementNotPresent("#preloader", 10000)
            .click("#auto-bake-label");
    },

    "Convert RDF Format: Turtle to RDF/XML in the browser": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            { op: "Convert RDF Format", args: ["Auto", "RDF/XML", "", true, ""] }
        ], PIZZA_TTL);
        browserUtils.bake(browser);
        browser.pause(3000); // First use downloads and compiles the WASM module

        readOutput(browser, value => {
            browser.assert.ok(value.includes("<rdf:RDF"), `Expected RDF/XML output, got: ${value}`);
            browser.assert.ok(value.includes("<owl:Class rdf:about=\"http://example.org/pizza#Margherita\">"), `Expected typed node for Margherita, got: ${value}`);
        });
    },

    "SPARQL Query: SELECT rendered with To Table": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            { op: "SPARQL Query", args: ["SELECT ?c ?l WHERE { ?c a owl:Class OPTIONAL { ?c rdfs:label ?l } } ORDER BY ?c", "Auto", "CSV", true, "Turtle", "", ""] },
            { op: "To Table", args: [",", "\\r\\n", true, "HTML"] }
        ], PIZZA_TTL);
        browserUtils.bake(browser);
        browser.pause(2000);

        browser.expect.element("#output-html table").to.be.present.before(5000);
        browser.expect.element("#output-html table").text.to.contain("Pizza, Italian");
        browser.expect.element("#output-html table").text.to.contain(":Margherita");
    },

    "Ontology Summary: class hierarchy": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            { op: "Ontology Summary", args: ["Auto", "Text report", true, 10, false, "en", ""] }
        ], PIZZA_TTL);
        browserUtils.bake(browser);
        browser.pause(2000);

        readOutput(browser, value => {
            browser.assert.ok(value.includes(":Pizza \"Pizza, Italian\"\n    :Margherita"), `Expected class tree, got: ${value}`);
        });
    },

    "Ontology Graph: draws with vis-network": function (browser) {
        browserUtils.loadRecipeConfig(browser, [
            { op: "Ontology Graph", args: ["Auto", "Classes and properties", 200, "Label, else prefixed name", "Force-directed", ""] }
        ], PIZZA_TTL);
        browserUtils.bake(browser);

        // vis-network is fetched from unpkg on first use and draws into a canvas
        browser.expect.element("#ontologyGraph canvas").to.be.present.before(15000);
        browser.expect.element("#output-html").text.to.contain("2 nodes, 1 edges.");
        browser.saveScreenshot("tests/browser/output/ontology-graph.png");
    },

    "Ontology Graph: search highlights matches and tooltips show annotations": function (browser) {
        const annotated = PIZZA_TTL + ":Margherita rdfs:comment \"Tomato and mozzarella only.\"@en .\n";
        browserUtils.loadRecipeConfig(browser, [
            { op: "Ontology Graph", args: ["Auto", "Class hierarchy", 200, "Label, else prefixed name", "Force-directed", "", "en"] }
        ], annotated);
        browserUtils.bake(browser);
        browser.expect.element("#ontologyGraph canvas").to.be.present.before(15000);

        // Matches on the description, not only the label
        browser.setValue("#ontologyGraphSearch", "mozzarella");
        browser.expect.element("#ontologyGraphCount").text.to.equal("1 match").before(2000);

        // Enter centres the match, so hovering the middle of the canvas shows its tooltip
        browser.sendKeys("#ontologyGraphSearch", browser.Keys.ENTER);
        browser.expect.element("#ontologyGraphCount").text.to.equal("1 of 1").before(2000);
        browser.pause(1000);
        browser.moveToElement("#ontologyGraph canvas", undefined, undefined);
        browser.expect.element("#ontologyGraph div.vis-tooltip").text.to.contain("Tomato and mozzarella only.").before(3000);
        browser.saveScreenshot("tests/browser/output/ontology-graph-search.png");

        browser.clearValue("#ontologyGraphSearch");
        browser.setValue("#ontologyGraphSearch", "no such node");
        browser.expect.element("#ontologyGraphCount").text.to.equal("0 matches").before(2000);
    },

    "Ontology Graph: clicking a class colours its superclass and subclass links": function (browser) {
        const P = "http://example.org/pizza#";
        browserUtils.loadRecipeConfig(browser, [
            { op: "Ontology Graph", args: ["Auto", "Class hierarchy", 200, "Label, else prefixed name", "Force-directed", "", "en"] }
        ], PIZZA_TTL + ":Food a owl:Class .\n:Pizza rdfs:subClassOf :Food .\n");
        browserUtils.bake(browser);
        browser.expect.element("#ontologyGraph canvas").to.be.present.before(15000);
        browser.expect.element("#output-html").text.to.contain("superclass").before(2000);

        // Centre :Pizza (the middle class) using the search, clear the search, then click it
        browser.setValue("#ontologyGraphSearch", "italian");
        browser.sendKeys("#ontologyGraphSearch", browser.Keys.ENTER);
        browser.expect.element("#ontologyGraphCount").text.to.equal("1 of 1").before(2000);
        browser.pause(1000);
        browser.sendKeys("#ontologyGraphSearch", browser.Keys.ESCAPE);
        browser.click("#ontologyGraph canvas");
        browser.pause(500);
        browser.saveScreenshot("tests/browser/output/ontology-graph-relatives.png");

        browser.execute(function (p) {
            const network = document.getElementById("ontologyGraph").visNetwork;
            const node = id => network.body.nodes[id].options;
            const edge = (from, to) => Object.values(network.body.edges).find(e => e.fromId === from && e.toId === to).options;
            return {
                selected: network.getSelectedNodes(),
                parent: [node(p + "Food").color.border, node(p + "Food").borderWidth],
                child: [node(p + "Margherita").color.border, node(p + "Margherita").borderWidth],
                upEdge: [edge(p + "Pizza", p + "Food").color.highlight, edge(p + "Pizza", p + "Food").selectionWidth],
                downEdge: [edge(p + "Margherita", p + "Pizza").color.highlight, edge(p + "Margherita", p + "Pizza").selectionWidth],
            };
        }, [P], function ({ value }) {
            browser.assert.deepStrictEqual(value.selected, [P + "Pizza"], "Clicking selects :Pizza");
            browser.assert.deepStrictEqual(value.parent, ["#7f2704", 3], "Superclass :Food has a dark, thick border");
            browser.assert.deepStrictEqual(value.child, ["#fd8d3c", 2], "Subclass :Margherita has a light border");
            browser.assert.deepStrictEqual(value.upEdge, ["#7f2704", 2], "Arrow to the superclass is dark");
            browser.assert.deepStrictEqual(value.downEdge, ["#fd8d3c", 1], "Arrow from the subclass is light");
        });

        // Clicking empty space clears the colouring
        browser.execute(function () {
            const network = document.getElementById("ontologyGraph").visNetwork;
            network.fit();
            return network.getBoundingBox(Object.keys(network.body.nodes)[0]);
        });
        browser.moveToElement("#ontologyGraph canvas", 5, 5).mouseButtonClick();
        browser.pause(500);
        browser.execute(function (p) {
            const network = document.getElementById("ontologyGraph").visNetwork;
            return [network.getSelectedNodes().length, network.body.nodes[p + "Food"].options.borderWidth];
        }, [P], function ({ value }) {
            browser.assert.deepStrictEqual(value, [0, 1], "Deselecting resets the superclass border");
        });
    },

    after: browser => {
        browser.end();
    }
};
