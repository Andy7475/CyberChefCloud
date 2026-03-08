/**
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { getGcpCredentials } from "../lib/GoogleCloud.mjs";

/**
 * GCloud Show on Map operation
 */
class GCloudShowOnMap extends Operation {

    /**
     * GCloudShowOnMap constructor
     */
    constructor() {
        super();

        this.name = "GCloud Show on Map";
        this.module = "Cloud";
        this.description = [
            "Displays multiple geographic coordinates as markers on a Google Map.",
            "<br><br>",
            "<b>Input:</b> A JSON array of location objects. This matches the <code>Lat/Long + Label JSON</code> output mode ",
            "of other Google Cloud location operations (Geocode, Places API, etc.).",
            "<br><br>",
            "Example JSON:",
            "<pre>[",
            "  { &quot;lat&quot;: 37.422, &quot;lng&quot;: -122.084, &quot;label&quot;: &quot;Googleplex&quot; }",
            "]</pre>",
            "<br>",
            "<b>Google Maps JavaScript API</b>:<br>",
            "If using Google Maps, the Google Cloud Project associated with your API key must have the ",
            "<b>Maps JavaScript API</b> enabled in the Cloud Console. An API Key is required.",
            "<br><br>",
            "<b>OpenStreetMap</b>:<br>",
            "Uses Leaflet and OpenStreetMap tiles. No API key required.",
            "<br><br>",
            "Requires a prior <code>Authenticate Google Cloud</code> operation using an API Key if using Google Maps."
        ].join("");
        this.infoURL = "https://developers.google.com/maps/documentation/javascript/overview";
        this.inputType = "string";
        this.outputType = "html";
        this.presentType = "html";
        this.args = [
            {
                name: "Map Provider",
                type: "option",
                value: ["OpenStreetMap", "Google Maps"]
            },
            {
                name: "Zoom Level",
                type: "number",
                value: 12
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        if (!input || input.trim() === "") return "[]";

        let jsonInput;
        try {
            jsonInput = JSON.parse(input);
        } catch (e) {
            throw new OperationError(`Input must be valid JSON array of locations. Error parsing input: ${e.message}`);
        }

        if (!Array.isArray(jsonInput)) {
            throw new OperationError("Input JSON must be an array of location objects.");
        }

        // Validate structure slightly to drop bad items early.
        const validLocations = jsonInput.filter(loc => typeof loc.lat === "number" && typeof loc.lng === "number");

        // Get credentials
        let apiKey = "";
        const [mapProvider, zoomLevel] = args;
        if (mapProvider === "Google Maps") {
            const creds = getGcpCredentials();
            if (creds && creds.authType === "API Key" && creds.authString) {
                apiKey = creds.authString;
            }
        }

        if (validLocations.length === 0) {
            return `<i>No valid coordinates to display on map.</i>`;
        }

        const mapId = "presentedMap_" + Math.random().toString(36).substr(2, 9);
        const scriptId = "mapscript_" + mapId;

        // Auto-center on average
        let centerLat = 0, centerLng = 0;
        validLocations.forEach(l => { centerLat += l.lat; centerLng += l.lng; });
        centerLat /= validLocations.length;
        centerLng /= validLocations.length;

        if (mapProvider === "Google Maps") {
            if (!apiKey) {
                return `<div style="color:red; font-weight:bold;">Error: A Google Cloud API Key is required to render Google Maps.<br>Please add an "Authenticate Google Cloud" operation providing an API Key.</div>`;
            }

            return `<style>
    #output-text .cm-content, #output-text .cm-line, #output-html { padding: 0; white-space: normal; }
    #${mapId} { width: 100%; height: 100%; min-height: 400px; display: block; border-radius: 4px; }
</style>
<div id="${mapId}"></div>
<script type="text/javascript">
if (!window.googleMapsLoaded) {
    var ${scriptId} = document.createElement('script');
    document.body.appendChild(${scriptId});
    ${scriptId}.onload = function() {
        window.googleMapsLoaded = true;
        waitForGoogleMaps_${mapId}();
    };
    ${scriptId}.src = "https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}";
} else {
    waitForGoogleMaps_${mapId}();
}

function waitForGoogleMaps_${mapId}() {
    if (window.google && window.google.maps && window.google.maps.Map) {
        initMap_${mapId}();
    } else {
        setTimeout(waitForGoogleMaps_${mapId}, 100);
    }
}

function initMap_${mapId}() {
    var locations = ${JSON.stringify(validLocations)};
    var centerLat = ${centerLat};
    var centerLng = ${centerLng};
    
    var map = new google.maps.Map(document.getElementById('${mapId}'), {
        zoom: ${zoomLevel},
        center: { lat: centerLat, lng: centerLng },
        mapTypeId: "roadmap"
    });

    var bounds = new google.maps.LatLngBounds();
    var infoWindow = new google.maps.InfoWindow();

    locations.forEach(function(loc) {
        var marker = new google.maps.Marker({
            position: { lat: loc.lat, lng: loc.lng },
            map: map,
            title: loc.label || ""
        });
        
        if (loc.label) {
            marker.addListener("click", function() {
                infoWindow.setContent("<div><strong>" + (loc.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) + "</strong></div>");
                infoWindow.open(map, marker);
            });
        }
        
        bounds.extend({ lat: loc.lat, lng: loc.lng });
    });

    if (locations.length > 1) {
        map.fitBounds(bounds);
    }
}
</script>`;
        } else {
            // OpenStreetMap using Leaflet
            return `<style>
    #output-text .cm-content, #output-text .cm-line, #output-html { padding: 0; white-space: normal; }
    #${mapId} { width: 100%; height: 100%; min-height: 400px; display: block; border-radius: 4px; }
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<div id="${mapId}"></div>
<script type="text/javascript">

function initOSM_${mapId}() {
    var locations = ${JSON.stringify(validLocations)};
    var centerLat = ${centerLat};
    var centerLng = ${centerLng};
    
    var map = L.map('${mapId}').setView([centerLat, centerLng], ${zoomLevel});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var group = new L.featureGroup();

    locations.forEach(function(loc) {
        var marker = L.marker([loc.lat, loc.lng]).addTo(group);
        if (loc.label) {
            marker.bindPopup("<div><strong>" + (loc.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) + "</strong></div>");
        }
    });
    group.addTo(map);

    if (locations.length > 1) {
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

if (!window.L) {
    var ${scriptId} = document.createElement('script');
    ${scriptId}.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    ${scriptId}.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    ${scriptId}.crossOrigin = "";
    document.body.appendChild(${scriptId});
    ${scriptId}.onload = function() {
        initOSM_${mapId}();
    };
} else {
    setTimeout(initOSM_${mapId}, 50);
}
</script>`;
        }
    }

    /**
     * @param {string} data
     * @param {Object[]} args
     * @returns {string}
     */
    async present(data, args) {
        return data; // HTML generated in run()
    }
}

export default GCloudShowOnMap;
