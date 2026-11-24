#!/bin/bash
#
# Deploys the Google API relay (used by gcpFetch when Google refuses a browser request) to Cloud Run.
#
# It holds no secrets: it forwards each request with the caller's own token.
# Only callers with run.routes.invoke on the project are relayed (see main.py).
#
# Usage:  ./deploy.sh                      (deploys to project cyberchefcloud)
#         PROJECT_ID=other ./deploy.sh     (deploys elsewhere)

set -e
cd "$(dirname "$0")"

SERVICE="cyber-chef-cloud-google-api"
FUNCTION="handle"
REGION="europe-west2"
# Pinned rather than read from `gcloud config`, so a different default project can't receive the deploy.
PROJECT_ID="${PROJECT_ID:-cyberchefcloud}"

if ! command -v gcloud &> /dev/null; then
    echo "gcloud could not be found. Please install the Google Cloud SDK."
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
  --timeout 310 \
  --no-invoker-iam-check \
  --max-instances 5 \
  --cpu-boost \
  --quiet

echo "Deployment complete."
