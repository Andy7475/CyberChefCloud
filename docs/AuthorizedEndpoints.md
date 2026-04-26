# Authorized Google Cloud Endpoints

This file lists the exact API endpoints and domains authorized by the Content Security Policy (CSP) in `src/web/html/index.html`. 

When a new Google Cloud ingredient is added that connects to a new API service, its endpoint **MUST** be added to the `connect-src` directive of the CSP, and recorded here.

## Core Authentication & GCS
- `https://storage.googleapis.com` (Google Cloud Storage)
- `https://accounts.google.com` (OAuth & Identity Services)
- `https://oauth2.googleapis.com` (OAuth Tokens)

## Specific Services
- `https://speech.googleapis.com` (Speech-to-Text)
- `https://texttospeech.googleapis.com` (Text-to-Speech)
- `https://translation.googleapis.com` (Translate)
- `https://vision.googleapis.com` (Cloud Vision API)
- `https://videointelligence.googleapis.com` (Video Intelligence API)
- `https://language.googleapis.com` (Cloud Natural Language API)
- `https://maps.googleapis.com` (Google Maps API + Geocoding API)
- `https://places.googleapis.com` (Google Places API New)
- `https://kgsearch.googleapis.com` (Knowledge Graph Search API)
- `https://*.aiplatform.googleapis.com` (Vertex AI API, Gemini LLMs)
- `https://dlp.googleapis.com` (Cloud DLP / Sensitive Data Protection)
- `https://cyber-chef-cloud-convert-593556123914.europe-west2.run.app` (CloudConvert Proxy)
- `https://google-http-proxy-593556123914.europe-west2.run.app` (Google HTTP Proxy)
