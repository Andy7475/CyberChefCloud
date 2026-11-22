#!/bin/bash
#
# Deploys the CloudConvert proxy (used by the "Cloud Convert" operation) to Cloud Run.
#
# The CloudConvert API key is never stored in this repository. It lives in
# Secret Manager as CLOUDCONVERT_API_KEY and Cloud Run injects it as an
# environment variable at runtime (--set-secrets).
#
# Usage:  ./deploy.sh                      (deploys to project cyberchefcloud)
#         PROJECT_ID=other ./deploy.sh     (deploys elsewhere)

set -e
cd "$(dirname "$0")"

SERVICE="cyber-chef-cloud-convert"
FUNCTION="convert_file"
REGION="europe-west2"
SECRET="CLOUDCONVERT_API_KEY"
# Pinned rather than read from `gcloud config`, so a different default project can't receive the deploy.
PROJECT_ID="${PROJECT_ID:-cyberchefcloud}"

if ! command -v gcloud &> /dev/null; then
    echo "gcloud could not be found. Please install the Google Cloud SDK."
    exit 1
fi

if ! gcloud secrets describe "$SECRET" --project "$PROJECT_ID" &> /dev/null; then
    echo "Secret $SECRET not found in project $PROJECT_ID. Create it with:"
    echo "  read -rs KEY && printf %s \"\$KEY\" | gcloud secrets create $SECRET --project $PROJECT_ID --data-file=-"
    echo "Then grant the Cloud Run service account roles/secretmanager.secretAccessor on it."
    exit 1
fi

echo "Deploying $SERVICE to Cloud Run in project $PROJECT_ID ($REGION)..."

# --no-invoker-iam-check: the browser calls this directly, so it can't be IAM-protected.
# Access from other websites is limited by the CORS origins in main.py.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source . \
  --function "$FUNCTION" \
  --base-image python314 \
  --automatic-updates \
  --set-secrets "$SECRET=$SECRET:latest" \
  --no-invoker-iam-check \
  --max-instances 5 \
  --cpu-boost \
  --quiet

echo "Deployment complete."
