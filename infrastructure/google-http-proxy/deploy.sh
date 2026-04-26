#!/bin/bash

# Stop execution if any command fails
set -e

# Ensure we are in the script's directory so we only upload the proxy code
cd "$(dirname "$0")"

# Ensure gcloud is installed
if ! command -v gcloud &> /dev/null
then
    echo "gcloud could not be found. Please install the Google Cloud SDK."
    exit 1
fi

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo "Please set your project ID using: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "Deploying Google HTTP Proxy to Cloud Run in project: $PROJECT_ID..."
echo "This will package the source code, build a container using Cloud Build, and deploy it."

# We use --allow-unauthenticated because the service relies on CORS for protection
# instead of IAM.
gcloud run deploy google-http-proxy \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated \
  --quiet

echo "Deployment complete! Copy the Service URL above and place it in 'src/core/operations/GoogleHTTPRequest.mjs'."
