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

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name before deploying the backend." >&2
    exit 1
  fi
}

require_env SQLALCHEMY_DATABASE_URI
require_env RESTAURANT_ADMIN_ID
require_env RESTAURANT_ADMIN_PASSWORD
require_env AUTH_SECRET_KEY
require_env BACKEND_CORS_ORIGINS
require_env PIZZA_BLITZ_SESSION_SECRET
require_env PAYMENT_RETURN_URL

echo "Starting Pizza Blitz deployment to Google Cloud Run..."

echo "Building backend..."
cd "$ROOT/backend"
gcloud builds submit --project="$PROJECT_ID" --tag "$BACKEND_IMAGE" .

echo "Deploying backend service..."
BACKEND_ENV_PAIRS=(
  "SQLALCHEMY_DATABASE_URI=$SQLALCHEMY_DATABASE_URI"
  "ENVIRONMENT=production"
  "RESTAURANT_ADMIN_ID=$RESTAURANT_ADMIN_ID"
  "RESTAURANT_ADMIN_PASSWORD=$RESTAURANT_ADMIN_PASSWORD"
  "PIZZA_BLITZ_ADMIN_ID=$RESTAURANT_ADMIN_ID"
  "PIZZA_BLITZ_ADMIN_PASSWORD=$RESTAURANT_ADMIN_PASSWORD"
  "AUTH_SECRET_KEY=$AUTH_SECRET_KEY"
  "BACKEND_CORS_ORIGINS=$BACKEND_CORS_ORIGINS"
  "PIZZA_BLITZ_SESSION_SECRET=$PIZZA_BLITZ_SESSION_SECRET"
  "PAYMENT_RETURN_URL=$PAYMENT_RETURN_URL"
)
if [[ -n "${RESTAURANT_TIMEZONE:-}" ]]; then
  BACKEND_ENV_PAIRS+=("RESTAURANT_TIMEZONE=$RESTAURANT_TIMEZONE")
fi
if [[ -n "${PIZZA_BLITZ_PUBLIC_URL:-}" ]]; then
  BACKEND_ENV_PAIRS+=("PIZZA_BLITZ_PUBLIC_URL=$PIZZA_BLITZ_PUBLIC_URL")
fi
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  BACKEND_ENV_PAIRS+=("GEMINI_API_KEY=$GEMINI_API_KEY")
fi
if [[ -n "${BACKUP_DIR:-}" ]]; then
  BACKEND_ENV_PAIRS+=("BACKUP_DIR=$BACKUP_DIR")
fi
if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  BACKEND_ENV_PAIRS+=("BACKUP_RETENTION_DAYS=$BACKUP_RETENTION_DAYS")
fi
BACKEND_ENV="^|^$(IFS='|'; echo "${BACKEND_ENV_PAIRS[*]}")"

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
FRONTEND_ENV_PAIRS=(
  "PIZZA_BLITZ_API_URL=$BACKEND_URL"
  "NEXT_PUBLIC_API_URL=$BACKEND_URL"
  "PIZZA_BLITZ_ADMIN_ID=$RESTAURANT_ADMIN_ID"
  "PIZZA_BLITZ_ADMIN_PASSWORD=$RESTAURANT_ADMIN_PASSWORD"
  "PIZZA_BLITZ_SESSION_SECRET=$PIZZA_BLITZ_SESSION_SECRET"
)
if [[ -n "${PIZZA_BLITZ_SITE_URL:-}" ]]; then
  FRONTEND_ENV_PAIRS+=("PIZZA_BLITZ_SITE_URL=$PIZZA_BLITZ_SITE_URL")
fi
if [[ -n "${PIZZA_BLITZ_STAFF_ID:-}" ]]; then
  FRONTEND_ENV_PAIRS+=("PIZZA_BLITZ_STAFF_ID=$PIZZA_BLITZ_STAFF_ID")
fi
if [[ -n "${PIZZA_BLITZ_STAFF_PASSWORD:-}" ]]; then
  FRONTEND_ENV_PAIRS+=("PIZZA_BLITZ_STAFF_PASSWORD=$PIZZA_BLITZ_STAFF_PASSWORD")
fi
FRONTEND_ENV="^|^$(IFS='|'; echo "${FRONTEND_ENV_PAIRS[*]}")"

gcloud run deploy pizza-blitz-frontend \
  --project="$PROJECT_ID" \
  --image="$FRONTEND_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars="$FRONTEND_ENV"

cd "$ROOT"
echo "Deployment complete."
