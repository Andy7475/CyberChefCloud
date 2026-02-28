# Research Report: Expanding CyberChef with Google Cloud APIs for Intelligence Analysis

## 1. Introduction
CyberChef is an invaluable tool for intelligence analysts, incident responders, and forensic investigators. Its "recipe" architecture allows chaining atomic operations to decode, extract, and analyze data. However, native operations are generally limited to deterministic formatting, decoding, and parsing. 

By integrating Google Cloud APIs into CyberChef, we can introduce **advanced AI, machine learning, and external enrichment capabilities** directly into analytic workflows. This report explores how various Google Cloud services can empower analysts, the technical considerations for CyberChef integration (specifically input/output formatting for chaining), and examples of cross-operation workflows.

## 2. Intelligence Analysis & Data Types
Analysts encounter unstructured and semi-structured data from various sources:
*   **Media:** Images (screenshots, photos), Audio (intercepts, voicemails), Video (CCTV, drone footage).
*   **Unstructured Text:** Social media posts, dark web chatter, translated documents, threat reports.
*   **Geospatial Data:** Raw coordinates, place names, IP locations.

The goal is to transform this raw data into structured intelligence (entities, sentiment, locations, summaries) that can be utilized in downstream CyberChef operations (like extracting IOCs or formatting into CSVs for reporting).

## 3. Proposed Google Cloud API Operations

### 3.1. Entity Extraction & Sentiment Analysis
**API:** [Cloud Natural Language API](https://cloud.google.com/natural-language)
*   **Purpose:** Extracting people, organizations, locations, events, and assessing the sentiment of unstructured text.
*   **Input:** Text (UTF-8).
*   **Output Considerations:** 
    *   *Option 1 (Human Readable):* Formatted text table `[Entity Type] - [Entity Name] (Salience)`.
    *   *Option 2 (Machine Readable/Chaining):* Line-separated list of extracted entities (e.g., just the names) so it can be fed directly into default CyberChef operations like "Defang IP", "Sort", or "Unique".
    *   *Option 3 (JSON):* Full JSON response for advanced users to parse using CyberChef's "JSONPath".

### 3.2. Image Recognition & OCR
**API:** [Cloud Vision API](https://cloud.google.com/vision)
*   **Purpose:** Identifying objects, landmarks, logos, explicit content, and extracting text (OCR) from images.
*   **Input:** Image file (Hex/Base64 encoded or raw bytes).
*   **Output Considerations:**
    *   If the user selects **OCR / Text Extraction**, the output should be purely the extracted text. This allows the output to be seamlessly piped into regex extractors (e.g., "Extract IP addresses").
    *   If the user selects **Label / Object Detection**, the output could be a comma-separated list of tags (e.g., `car, weapon, outdoors`) or a JSON payload detailing bounding boxes. For CyberChef, a flat list of tags is most useful for chaining into text analysis.
    *   *Landmark Detection* could output specific GPS coordinates to be fed into a Maps operation.

### 3.3. Audio & Video Transcribing
**APIs:** [Cloud Speech-to-Text API](https://cloud.google.com/speech-to-text), [Cloud Video Intelligence API](https://cloud.google.com/video-intelligence)
*   **Purpose:** Converting spoken language in audio/video files into searchable text, and identifying scene changes or objects in video frames.
*   **Input:** Audio/Video files (bytes). Note: CyberChef runs in-browser, so large files might be memory-constrained. Consider supporting GCS URIs (`gs://...`) as an alternative input for large media.
*   **Output Considerations:**
    *   Plain text transcription. This effortlessly integrates with CyberChef’s text manipulation operations, Translation operations, and Entity Extraction.
    *   For Video Intelligence, a timeline of detected objects (e.g., `[00:01:23] - Vehicle`).

### 3.4. Web Search & Enrichment
**API:** [Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
*   **Purpose:** Querying the web for open-source intelligence (OSINT) related to an extracted indicator (e.g., querying a hash or username).
*   **Input:** Short text string.
*   **Output Considerations:**
    *   Extracting purely the URLs found in the search results to feed into a hypothetical "Scrape Webpage" operation.
    *   Returning snippets of text from the search results to be fed into the LLM or Entity Extractor.

### 3.5. Geocoding & Mapping
**API:** [Google Maps Platform (Geocoding API / Maps Static API)](https://developers.google.com/maps)
*   **Purpose:** Converting addresses into geographic coordinates (Geocoding), or coordinates into geographic contexts (Reverse Geocoding).
*   **Input:** Address string OR Latitude, Longitude.
*   **Output Considerations:**
    *   *Geocoding:* Outputs `Lat, Lng`.
    *   *Static Map:* Outputs an Image (PNG/JPG file representation in CyberChef) showing a pin on the map.

### 3.6. Generic LLM Capabilities (Gemini API)
**API:** [Vertex AI Gemini API](https://cloud.google.com/vertex-ai) / [Google AI Studio](https://aistudio.google.com/)
*   **Purpose:** An all-purpose operation where the analyst provides a System Prompt and User Prompt, and the operation feeds the CyberChef input as context.
*   **Input:** Any text or supported media (Gemini is multimodal natively).
*   **Options for the Operation Pane:**
    *   `System Prompt` (e.g., "You are a malware analyst. Extract all indicators of compromise from the following text and return them as a strict CSV.")
    *   `Temperature` / `Model Selection` (e.g., `gemini-1.5-pro`)
*   **Output Considerations:** Pure text output generated by the LLM. Because LLMs can be instructed to format data (JSON, CSV, lists), this operation is incredibly versatile for chaining to existing CyberChef data parsing tools.

---

## 4. Chaining & Interoperability Considerations

To make Google Cloud APIs feel like "native" CyberChef ingredients, the boundary between operations must be seamless. 

**The "Format" Dropdown:**
Every API operation should ideally have an `Output Format` argument in its UI pane with options like:
1.  **Raw Text / Flat List:** Best for chaining. (e.g., Vision API outputs `gun, suspect, vehicle` or Speech API purely outputs transcription).
2.  **Metadata / Human Readable:** A pretty-printed summary.
3.  **JSON:** Strict API response for advanced jq/JSONPath manipulation further down the recipe.

**Error Handling:**
Cloud APIs can fail (rate limits, bad keys, unreadable media). Operations must fail gracefully within the CyberChef framework, outputting explicit error messages rather than hanging the pipeline, as users might be automatically processing hundreds of files via "Fork".

---

## 5. Potential Workflows (Recipes)

Here are examples of how analysts could build recipes combining native CyberChef and these proposed GCloud APIs.

### Workflow A: Media OSINT Exploitation
1.  **Input:** A foreign-language propaganda video file.
2.  **GCloud Speech-to-Text:** Extract the audio transcription.
3.  **GCloud Translate:** Translate the transcription to English.
4.  **Extract Regular Expression:** Extract potential phone numbers or email addresses mentioned.
5.  **GCloud Natural Language:** Extract Organizations and Locations mentioned in the translated text.

### Workflow B: Image-to-Intelligence
1.  **Input:** A screenshot of a dark web forum post.
2.  **GCloud Vision API (OCR mode):** Extract the text from the screenshot.
3.  **GCloud Gemini Prompt:**
    *   *System Prompt:* "Summarize the threat actor's intent in one sentence, then list any mentioned CVEs."
    *   *Input:* Output from Step 2.
4.  **Output:** A concise, text-based threat intel report ready for a ticket.

### Workflow C: Location Triangulation
1.  **Input:** Text document referencing various safehouse addresses.
2.  **GCloud Natural Language:** Extract entities of type `LOCATION`.
3.  **Fork:** Split each location into its own execution stream.
4.  **GCloud Geocoding:** Convert the location names to Lat/Lng coordinates.
5.  **Output:** A list of coordinates ready to be plotted on an analyst's map.
