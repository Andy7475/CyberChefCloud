/**
 * Small example ontologies for the Sample Ontology operation. Each one shows
 * a few kinds of inference by Ontology Reasoner; the comment block at the top
 * of each lists the inferences to expect and the rule that makes each one.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const PEOPLE = `# People and organisations: RDFS and OWL property reasoning
#
# Try:  Sample Ontology -> Ontology Reasoner (Rules: RDFS or OWL RL)
#       -> Output 'Impact report' to read the inferences, or
#       -> Output 'Asserted and inferred (TriG)' -> Ontology Graph to see them as magenta edges.
#
# Inferences to expect (rule ids: RDFS / OWL RL):
#   Subclass (rdfs9 / cax-sco):       ex:carol a ex:Person          (Carol is an Employee; Employee is a subclass of Person)
#                                     ex:alice a ex:Employee        (Alice is a Manager; Manager is a subclass of Employee)
#   Domain (rdfs2 / prp-dom):         ex:grace a ex:Person          (Grace has no type in the data; ex:birthYear, ex:livesIn
#                                                                    and ex:hasParent have the domain Person)
#   Range (rdfs3 / prp-rng):          ex:ruth a ex:Person           (Ruth has no type in the data; she is the object of
#                                                                    ex:hasParent, whose range is Person)
#   Sub-property (rdfs7 / prp-spo1):  ex:grace ex:hasParent ex:alice  (from ex:grace ex:hasMother ex:alice)
#   OWL RL only:
#   Inverse (prp-inv1, prp-inv2):     ex:bob ex:reportsTo ex:alice   (from ex:alice ex:manages ex:bob)
#                                     ex:henry ex:hasParent ex:dave  (from ex:dave ex:hasChild ex:henry)
#   Symmetric (prp-symp):             ex:dave ex:knows ex:alice      (from ex:alice ex:knows ex:dave)
#   Transitive (prp-trp):             ex:London ex:locatedIn ex:UK   (London -> England -> UK)
#   Property chain (prp-spo2):        ex:grace ex:hasGrandparent ex:ruth  (Grace -> Alice -> Ruth; this needs the
#                                     sub-property inference above first, so it appears in a later round)
#
# Some triples are produced by more than one rule, and the output lists each rule. For example, ex:carol a ex:Person
# comes from rdfs9 (Carol is an Employee), rdfs2 (the domain of ex:worksFor) and rdfs3 (the range of ex:knows: Bob knows Carol).
#
# Not shown by default: ex:Manager rdfs:subClassOf ex:Person (rdfs11 / scm-sco) is inferred, but it follows from
# Manager -> Employee -> Person, so 'Hide implied subClassOf, subPropertyOf, domain, range' removes it. Untick that option to see it.
#
# To see an inconsistency: remove the # from the line "# ex:frank a ex:Employee ." near the end.
# Frank is then an Employee and a Contractor, which are disjoint, and the report shows a cax-dw problem.

@prefix ex:   <http://example.org/people#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<http://example.org/people> a owl:Ontology ;
    rdfs:label "People and Organisations test ontology" .

#################################################################
# TBox: classes
#################################################################

ex:Person       a owl:Class ; rdfs:label "Person" .
ex:Employee     a owl:Class ; rdfs:label "Employee" ;     rdfs:subClassOf ex:Person .
ex:Manager      a owl:Class ; rdfs:label "Manager" ;      rdfs:subClassOf ex:Employee .
ex:Contractor   a owl:Class ; rdfs:label "Contractor" ;   rdfs:subClassOf ex:Person .
ex:Organisation a owl:Class ; rdfs:label "Organisation" .
ex:Place        a owl:Class ; rdfs:label "Place" .
ex:City         a owl:Class ; rdfs:label "City" ;         rdfs:subClassOf ex:Place .
ex:Country      a owl:Class ; rdfs:label "Country" ;      rdfs:subClassOf ex:Place .

ex:Employee owl:disjointWith ex:Contractor .

#################################################################
# TBox: object properties
#################################################################

ex:worksFor a owl:ObjectProperty ;
    rdfs:label "works for" ;
    rdfs:domain ex:Person ;
    rdfs:range ex:Organisation .

ex:manages a owl:ObjectProperty ;
    rdfs:label "manages" ;
    rdfs:domain ex:Manager ;
    rdfs:range ex:Employee .

ex:reportsTo a owl:ObjectProperty ;
    rdfs:label "reports to" ;
    owl:inverseOf ex:manages .

ex:knows a owl:ObjectProperty , owl:SymmetricProperty ;
    rdfs:label "knows" ;
    rdfs:domain ex:Person ;
    rdfs:range ex:Person .

ex:hasParent a owl:ObjectProperty ;
    rdfs:label "has parent" ;
    rdfs:domain ex:Person ;
    rdfs:range ex:Person .

# Added: a sub-property of hasParent (sub-property inference)
ex:hasMother a owl:ObjectProperty ;
    rdfs:label "has mother" ;
    rdfs:subPropertyOf ex:hasParent .

# Added: a property chain. A parent's parent is a grandparent.
ex:hasGrandparent a owl:ObjectProperty ;
    rdfs:label "has grandparent" ;
    owl:propertyChainAxiom ( ex:hasParent ex:hasParent ) .

ex:hasChild a owl:ObjectProperty ;
    rdfs:label "has child" ;
    owl:inverseOf ex:hasParent .

ex:livesIn a owl:ObjectProperty ;
    rdfs:label "lives in" ;
    rdfs:domain ex:Person ;
    rdfs:range ex:Place .

ex:basedIn a owl:ObjectProperty ;
    rdfs:label "based in" ;
    rdfs:domain ex:Organisation ;
    rdfs:range ex:Place .

ex:locatedIn a owl:ObjectProperty , owl:TransitiveProperty ;
    rdfs:label "located in" ;
    rdfs:domain ex:Place ;
    rdfs:range ex:Place .

#################################################################
# TBox: datatype properties
#################################################################

ex:name a owl:DatatypeProperty ;
    rdfs:label "name" ;
    rdfs:range xsd:string .

ex:birthYear a owl:DatatypeProperty ;
    rdfs:label "birth year" ;
    rdfs:domain ex:Person ;
    rdfs:range xsd:integer .

ex:salary a owl:DatatypeProperty ;
    rdfs:label "salary" ;
    rdfs:domain ex:Employee ;
    rdfs:range xsd:decimal .

#################################################################
# ABox: places
#################################################################

ex:UK         a ex:Country ; ex:name "United Kingdom" .
ex:England    a ex:Place ;   ex:name "England" ;    ex:locatedIn ex:UK .
ex:London     a ex:City ;    ex:name "London" ;     ex:locatedIn ex:England .
ex:Manchester a ex:City ;    ex:name "Manchester" ; ex:locatedIn ex:England .
ex:Edinburgh  a ex:City ;    ex:name "Edinburgh" ;  ex:locatedIn ex:UK .

#################################################################
# ABox: organisations
#################################################################

ex:Acme   a ex:Organisation ; ex:name "Acme Ltd" ;     ex:basedIn ex:London .
ex:Globex a ex:Organisation ; ex:name "Globex plc" ;   ex:basedIn ex:Manchester .

#################################################################
# ABox: people
#################################################################

ex:alice a ex:Manager ;
    ex:name "Alice Smith" ;
    ex:birthYear 1975 ;
    ex:salary 85000.00 ;
    ex:worksFor ex:Acme ;
    ex:livesIn ex:London ;
    ex:manages ex:bob , ex:carol ;
    ex:knows ex:dave ;
    ex:hasParent ex:ruth .                 # added: Alice's parent, for the grandparent chain

ex:bob a ex:Employee ;
    ex:name "Bob Jones" ;
    ex:birthYear 1988 ;
    ex:salary 52000.00 ;
    ex:worksFor ex:Acme ;
    ex:livesIn ex:London ;
    ex:knows ex:carol .

ex:carol a ex:Employee ;
    ex:name "Carol White" ;
    ex:birthYear 1992 ;
    ex:salary 48000.00 ;
    ex:worksFor ex:Acme ;
    ex:livesIn ex:Manchester .

ex:dave a ex:Manager ;
    ex:name "Dave Brown" ;
    ex:birthYear 1970 ;
    ex:salary 91000.00 ;
    ex:worksFor ex:Globex ;
    ex:livesIn ex:Manchester ;
    ex:manages ex:erin .

ex:erin a ex:Employee ;
    ex:name "Erin Green" ;
    ex:birthYear 1995 ;
    ex:salary 45000.00 ;
    ex:worksFor ex:Globex ;
    ex:livesIn ex:Edinburgh ;
    ex:reportsTo ex:dave .

ex:frank a ex:Contractor ;
    ex:name "Frank Black" ;
    ex:birthYear 1983 ;
    ex:worksFor ex:Globex ;
    ex:livesIn ex:Edinburgh .

# ex:frank a ex:Employee .    # remove the # at the start of this line to make the data inconsistent

# was: ex:grace a ex:Person ; (type removed so that Person is inferred from the domains of birthYear, livesIn and hasParent)
ex:grace ex:name "Grace Smith" ;
    ex:birthYear 2008 ;
    ex:hasMother ex:alice ;                # was: ex:hasParent ex:alice (now inferred from hasMother)
    ex:livesIn ex:London .

ex:henry a ex:Person ;
    ex:name "Henry Brown" ;
    ex:birthYear 2003 ;
    ex:livesIn ex:Manchester .

ex:ruth ex:name "Ruth Smith" .             # added, with no type: Person is inferred from the range of hasParent

ex:dave ex:hasChild ex:henry .
`;

const PIZZA = `# Pizzas: classifying individuals with defined classes (OWL RL)
#
# Try:  Sample Ontology -> Ontology Reasoner (Rules: OWL RL, Output: Impact report or Asserted and inferred (TriG) -> Ontology Graph)
#
# A defined class has an owl:equivalentClass: anything that meets the definition is a member.
# :CheeseyPizza is defined as "a Pizza that has at least one topping that is a Cheese".
#
# Inferences to expect:
#   :tonightsPizza a :Pizza           (prp-dom: it has a topping, and the domain of hasTopping is Pizza)
#   :tonightsPizza a :CheeseyPizza    (it is a Pizza with a Mozzarella topping, and Mozzarella is a Cheese.
#                                      Steps: cls-svf1 puts it in the restriction "hasTopping some Cheese",
#                                      cls-int1 puts it in the intersection, and cax-sco / cax-eqc1 / cax-eqc2
#                                      put it in CheeseyPizza. The first two steps are about blank nodes, so
#                                      they are hidden by default; only the last step is shown.)
#   :myMargherita a :CheeseyPizza     (every Margherita has a Mozzarella topping, so this one has too,
#                                      although no topping is listed for it)
#   :CheeseyPizza rdfs:subClassOf :Pizza   (scm-int: the definition is an intersection that includes Pizza)
#   :topping1 a :VegetarianTopping    (cls-avf: :veggie is a VegetarianPizza, whose toppings can only be
#                                      VegetarianToppings)
#   :topping1 a :PizzaTopping         (prp-rng: the range of hasTopping is PizzaTopping)
#
# What OWL RL does NOT infer, and a DL reasoner (e.g. HermiT in Protégé) does:
#   :Margherita rdfs:subClassOf :CheeseyPizza
# OWL RL finds that the individual :myMargherita is a CheeseyPizza, but not that every Margherita is one.
# OWL RL has no rule that concludes "C is a subclass of an intersection" from "C is a subclass of each part
# of the intersection". In Ontology Graph, the edge :myMargherita -> :CheeseyPizza is drawn, and the edge
# :Margherita -> :CheeseyPizza is not.

@prefix :     <http://example.org/pizza#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .

<http://example.org/pizza> a owl:Ontology ; rdfs:label "Small pizza ontology" .

:Food              a owl:Class .
:Pizza             a owl:Class ; rdfs:subClassOf :Food .
:PizzaTopping      a owl:Class ; rdfs:subClassOf :Food .
:Cheese            a owl:Class ; rdfs:subClassOf :PizzaTopping .
:Mozzarella        a owl:Class ; rdfs:subClassOf :Cheese .
:VegetarianTopping a owl:Class ; rdfs:subClassOf :PizzaTopping .
:Tomato            a owl:Class ; rdfs:subClassOf :VegetarianTopping .

:hasTopping a owl:ObjectProperty ; rdfs:domain :Pizza ; rdfs:range :PizzaTopping .

# Defined class: a Pizza with at least one Cheese topping
:CheeseyPizza a owl:Class ;
    owl:equivalentClass [ owl:intersectionOf ( :Pizza
        [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:someValuesFrom :Cheese ] ) ] .

# Every Margherita has a Mozzarella topping and a Tomato topping
:Margherita a owl:Class ;
    rdfs:subClassOf :Pizza ,
        [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:someValuesFrom :Mozzarella ] ,
        [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:someValuesFrom :Tomato ] .

# Every topping of a VegetarianPizza is a VegetarianTopping ("only" restriction)
:VegetarianPizza a owl:Class ;
    rdfs:subClassOf :Pizza ,
        [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:allValuesFrom :VegetarianTopping ] .

# Individuals
:tonightsPizza :hasTopping :mozz1 .          # no type given
:mozz1 a :Mozzarella .

:myMargherita a :Margherita .                # no toppings listed

:veggie a :VegetarianPizza ; :hasTopping :topping1 .
# :topping1 has no type given
`;

const SAME_AS = `# Same individuals: owl:sameAs from functional and inverse-functional properties (OWL RL)
#
# Try:  Sample Ontology -> Ontology Reasoner (Rules: OWL RL, Output: Impact report)
#       then tick 'Apply owl:sameAs substitution' and run it again.
#
# Two systems (a CRM and an HR system) each have a record for the same person.
#
# Inferences to expect:
#   ex:crm_123 owl:sameAs ex:hr_456   (prp-ifp: ex:mbox is inverse-functional, which means one mailbox belongs to
#                                      one person. Both records have the same mailbox.)
#   ex:mary owl:sameAs ex:m_jones     (prp-fp: ex:hasBirthMother is functional, which means a person has one value.
#                                      ex:hr_456 has two values, so they are the same person.)
# The reverse triples (ex:hr_456 owl:sameAs ex:crm_123) are also inferred (eq-sym); 'Hide restated equivalences'
# removes them.
#
# With 'Apply owl:sameAs substitution' ticked (eq-rep-s, eq-rep-o), each record also gets the other record's
# facts, for example:
#   ex:crm_123 ex:birthYear 1980      (from ex:hr_456)
#   ex:hr_456 ex:customerSince 2019   (from ex:crm_123)
#   ex:crm_123 ex:hasBirthMother ex:m_jones

@prefix ex:   <http://example.org/records#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .

<http://example.org/records> a owl:Ontology ; rdfs:label "Two records of one person" .

ex:Person a owl:Class .

ex:mbox a owl:ObjectProperty , owl:InverseFunctionalProperty ;
    rdfs:label "mailbox" .
ex:hasBirthMother a owl:ObjectProperty , owl:FunctionalProperty ;
    rdfs:label "has birth mother" .
ex:name a owl:DatatypeProperty .
ex:birthYear a owl:DatatypeProperty .
ex:customerSince a owl:DatatypeProperty .

# Record in the CRM system
ex:crm_123 a ex:Person ;
    ex:name "J. Smith" ;
    ex:mbox <mailto:john.smith@example.org> ;
    ex:customerSince 2019 .

# Record in the HR system
ex:hr_456 a ex:Person ;
    ex:name "John Smith" ;
    ex:mbox <mailto:john.smith@example.org> ;
    ex:birthYear 1980 ;
    ex:hasBirthMother ex:mary , ex:m_jones .

ex:mary ex:name "Mary Smith" .
ex:m_jones ex:name "M. Jones" .
`;

const BAD_DATA = `# Bad data: wrong inferences and inconsistencies
#
# Try:  Sample Ontology -> Ontology Reasoner (Rules: OWL RL, Output: Impact report), and
#       Output 'Asserted and inferred (TriG)' -> Ontology Graph to see the wrong inferences as magenta edges.
#
# The reasoner applies its rules to all the data, including data that is wrong. The inferred triples can
# therefore be wrong too. It reports a problem only when the ontology states a rule that the data breaks
# (disjoint classes, owl:differentFrom). It does not stop when it finds a problem.
# (A DL reasoner such as HermiT in Protégé reports an inconsistent ontology and shows no inferences.)
#
# The data has four errors:
#
# Error 1: ex:bob ex:manages ex:carol, although Bob is not a manager.
#   Wrong inferences: ex:bob a ex:Manager (prp-dom: the domain of manages is Manager)
#                     ex:carol ex:reportsTo ex:bob (prp-inv2: reportsTo is the inverse of manages)
#   Warning: none. Nothing in the ontology contradicts this, so the wrong triples appear with no warning.
#
# Error 2: Alice and Bob have the same mailbox (a shared address was entered by mistake).
#   ex:mbox is inverse-functional: one mailbox belongs to one person.
#   Wrong inference:  ex:alice owl:sameAs ex:bob (prp-ifp)
#   Warning: eq-diff1, because the data also says ex:alice owl:differentFrom ex:bob.
#   With 'Apply owl:sameAs substitution' ticked, Alice also gets Bob's name and birth year, and Bob gets Alice's.
#   Substitution also produces ex:bob owl:differentFrom ex:bob: the data now says that Bob is different from himself.
#
# Error 3: ex:Acme ex:worksFor ex:Globex. worksFor is for people, but Acme is an organisation.
#   Wrong inference:  ex:Acme a ex:Person (prp-dom: the domain of worksFor is Person)
#   Warning: cax-dw, because Person and Organisation are disjoint, so Acme cannot be both.
#
# Error 4: ex:Freelancer is a subclass of both Employee and Contractor, which are disjoint.
#   Warning: unsatisfiable. No individual can be a Freelancer.

@prefix ex:   <http://example.org/people#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .

<http://example.org/bad-data> a owl:Ontology ; rdfs:label "People data with errors" .

ex:Person       a owl:Class .
ex:Employee     a owl:Class ; rdfs:subClassOf ex:Person .
ex:Manager      a owl:Class ; rdfs:subClassOf ex:Employee .
ex:Contractor   a owl:Class ; rdfs:subClassOf ex:Person .
ex:Organisation a owl:Class .

ex:Person owl:disjointWith ex:Organisation .
ex:Employee owl:disjointWith ex:Contractor .

ex:Freelancer a owl:Class ; rdfs:subClassOf ex:Employee , ex:Contractor .    # error 4

ex:worksFor a owl:ObjectProperty ; rdfs:domain ex:Person ; rdfs:range ex:Organisation .
ex:manages a owl:ObjectProperty ; rdfs:domain ex:Manager ; rdfs:range ex:Employee .
ex:reportsTo a owl:ObjectProperty ; owl:inverseOf ex:manages .
ex:mbox a owl:ObjectProperty , owl:InverseFunctionalProperty .
ex:name a owl:DatatypeProperty .
ex:birthYear a owl:DatatypeProperty .

ex:Acme   a ex:Organisation ; ex:name "Acme Ltd" .
ex:Globex a ex:Organisation ; ex:name "Globex plc" .
ex:Acme ex:worksFor ex:Globex .                                               # error 3

ex:alice a ex:Manager ;
    ex:name "Alice Smith" ; ex:birthYear 1975 ;
    ex:worksFor ex:Acme ;
    ex:mbox <mailto:info@acme.example> ;                                      # error 2
    ex:manages ex:carol .

ex:bob a ex:Employee ;
    ex:name "Bob Jones" ; ex:birthYear 1988 ;
    ex:worksFor ex:Acme ;
    ex:mbox <mailto:info@acme.example> ;                                      # error 2
    ex:manages ex:carol .                                                     # error 1

ex:carol a ex:Employee ; ex:name "Carol White" ; ex:worksFor ex:Acme .

ex:alice owl:differentFrom ex:bob .
`;

/** The samples, by the name shown in the operation's drop-down. */
export const SAMPLE_ONTOLOGIES = {
    "People and organisations (RDFS and OWL properties)": PEOPLE,
    "Pizzas (defined classes)": PIZZA,
    "Same individuals (owl:sameAs)": SAME_AS,
    "Bad data (wrong inferences and inconsistencies)": BAD_DATA,
};
