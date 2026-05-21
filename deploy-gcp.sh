#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCP_PROJECT_ID:-}" ]]; then
  echo "Set GCP_PROJECT_ID to the standalone Pizza Blitz Google Cloud project before deploying." >&2
  exit 1
fi

PROJECT_ID="$GCP_PROJECT_ID"
REGION="${GCP_REGION:-us-central1}"
BACKEND_IMAGE="gcr.io/$PROJECT_ID/pizza-blitz-backend"
FRONTEND_IMAGE="gcr.io/$PROJECT_ID/pizza-blitz-frontend"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${SQLALCHEMY_DATABASE_URI:-}" ]]; then
  echo "Set SQLALCHEMY_DATABASE_URI before deploying the backend." >&2
  exit 1
fi

echo "Starting Pizza Blitz deployment to Google Cloud Run..."

echo "Building backend..."
cd "$ROOT/backend"
gcloud builds submit --project="$PROJECT_ID" --tag "$BACKEND_IMAGE" .

echo "Deploying backend service..."
BACKEND_ENV="SQLALCHEMY_DATABASE_URI=$SQLALCHEMY_DATABASE_URI"
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  BACKEND_ENV="$BACKEND_ENV,GEMINI_API_KEY=$GEMINI_API_KEY"
fi
if [[ -n "${RESTAURANT_ADMIN_ID:-}" ]]; then
  BACKEND_ENV="$BACKEND_ENV,RESTAURANT_ADMIN_ID=$RESTAURANT_ADMIN_ID"
fi
if [[ -n "${RESTAURANT_ADMIN_PASSWORD:-}" ]]; then
  BACKEND_ENV="$BACKEND_ENV,RESTAURANT_ADMIN_PASSWORD=$RESTAURANT_ADMIN_PASSWORD"
fi

DEPLOY_ARGS=(
  run deploy pizza-blitz-backend
  --project="$PROJECT_ID"
  --image="$BACKEND_IMAGE"
  --region="$REGION"
  --platform=managed
  --allow-unauthenticated
  --set-env-vars="$BACKEND_ENV"
)
if [[ -n "${CLOUD_SQL_INSTANCE:-}" ]]; then
  DEPLOY_ARGS+=(--add-cloudsql-instances="$CLOUD_SQL_INSTANCE")
fi
gcloud "${DEPLOY_ARGS[@]}"

BACKEND_URL="$(gcloud run services describe pizza-blitz-backend --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo "Backend deployed at: $BACKEND_URL"

echo "Building frontend..."
cd "$ROOT/frontend"
gcloud builds submit --project="$PROJECT_ID" --tag "$FRONTEND_IMAGE" --build-arg "NEXT_PUBLIC_API_URL=$BACKEND_URL" .

echo "Deploying frontend service..."
gcloud run deploy pizza-blitz-frontend \
  --project="$PROJECT_ID" \
  --image="$FRONTEND_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars="NEXT_PUBLIC_API_URL=$BACKEND_URL"

cd "$ROOT"
echo "Deployment complete."
