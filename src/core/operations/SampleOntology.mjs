/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import { SAMPLE_ONTOLOGIES } from "../lib/SampleOntologies.mjs";

/**
 * Sample Ontology operation
 */
class SampleOntology extends Operation {

    /**
     * SampleOntology constructor
     */
    constructor() {
        super();

        this.name = "Sample Ontology";
        this.module = "Default";
        this.description = "Outputs a small example ontology in Turtle. The input is ignored. Use it as the first operation of a recipe, " +
            "e.g. <b>Sample Ontology</b> → <b>Ontology Reasoner</b> → <b>Ontology Graph</b>.<br><br>" +
            "Each sample shows a few kinds of inference. A comment block at the top of each lists the inferences to expect and the rule that makes each one.<ul>" +
            "<li><b>People and organisations</b>: subclass, domain, range and sub-property inference (RDFS), and inverse, symmetric and transitive properties and a property chain (OWL RL).</li>" +
            "<li><b>Pizzas</b>: defined classes. Individual pizzas are classified as CheeseyPizza, and the comments show one inference that OWL RL does not make and a DL reasoner does.</li>" +
            "<li><b>Same individuals</b>: owl:sameAs from functional and inverse-functional properties, and what 'Apply owl:sameAs substitution' adds.</li>" +
            "<li><b>Bad data</b>: four data errors. Some give wrong inferences with no warning; others are reported as inconsistencies.</li></ul>";
        this.infoURL = "https://www.w3.org/TR/owl2-primer/";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "Sample",
                type: "option",
                value: Object.keys(SAMPLE_ONTOLOGIES)
            }
        ];
    }

    /**
     * @param {string} input - ignored
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [sample] = args;
        return SAMPLE_ONTOLOGIES[sample] ?? Object.values(SAMPLE_ONTOLOGIES)[0];
    }

}

export default SampleOntology;
