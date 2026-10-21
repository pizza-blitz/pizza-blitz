$ErrorActionPreference = "Stop"

$PROJECT_ID = $env:GCP_PROJECT_ID
if (-not $PROJECT_ID) {
  throw "Set GCP_PROJECT_ID to the standalone Pizza Blitz Google Cloud project before deploying."
}

$REGION = $env:GCP_REGION
if (-not $REGION) { $REGION = "us-central1" }

if (-not $env:SQLALCHEMY_DATABASE_URI) {
  throw "Set SQLALCHEMY_DATABASE_URI before deploying the backend."
}
if (-not $env:RESTAURANT_ADMIN_ID) {
  throw "Set RESTAURANT_ADMIN_ID before deploying the backend."
}
if (-not $env:RESTAURANT_ADMIN_PASSWORD) {
  throw "Set RESTAURANT_ADMIN_PASSWORD before deploying the backend."
}
if (-not $env:AUTH_SECRET_KEY) {
  throw "Set AUTH_SECRET_KEY before deploying the backend."
}
if (-not $env:BACKEND_CORS_ORIGINS) {
  throw "Set BACKEND_CORS_ORIGINS to the deployed frontend origin before deploying."
}
if (-not $env:PIZZA_BLITZ_SESSION_SECRET) {
  throw "Set PIZZA_BLITZ_SESSION_SECRET (a long random value shared with the frontend session signer) before deploying."
}
if (-not $env:PAYMENT_RETURN_URL) {
  throw "Set PAYMENT_RETURN_URL to the deployed customer account URL before deploying."
}

$BACKEND_IMAGE = "gcr.io/$PROJECT_ID/pizza-blitz-backend"
$FRONTEND_IMAGE = "gcr.io/$PROJECT_ID/pizza-blitz-frontend"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting Pizza Blitz deployment to Google Cloud Run..."

Write-Host "Building backend..."
Set-Location (Join-Path $ROOT "backend")
gcloud builds submit --project=$PROJECT_ID --tag $BACKEND_IMAGE .

Write-Host "Deploying backend service..."
$backendEnvPairs = @(
  "SQLALCHEMY_DATABASE_URI=$env:SQLALCHEMY_DATABASE_URI",
  "ENVIRONMENT=production",
  "RESTAURANT_ADMIN_ID=$env:RESTAURANT_ADMIN_ID",
  "RESTAURANT_ADMIN_PASSWORD=$env:RESTAURANT_ADMIN_PASSWORD",
  "PIZZA_BLITZ_ADMIN_ID=$env:RESTAURANT_ADMIN_ID",
  "PIZZA_BLITZ_ADMIN_PASSWORD=$env:RESTAURANT_ADMIN_PASSWORD",
  "AUTH_SECRET_KEY=$env:AUTH_SECRET_KEY",
  "BACKEND_CORS_ORIGINS=$env:BACKEND_CORS_ORIGINS",
  "PIZZA_BLITZ_SESSION_SECRET=$env:PIZZA_BLITZ_SESSION_SECRET",
  "PAYMENT_RETURN_URL=$env:PAYMENT_RETURN_URL"
)
if ($env:RESTAURANT_TIMEZONE) {
  $backendEnvPairs += "RESTAURANT_TIMEZONE=$env:RESTAURANT_TIMEZONE"
}
if ($env:PIZZA_BLITZ_PUBLIC_URL) {
  $backendEnvPairs += "PIZZA_BLITZ_PUBLIC_URL=$env:PIZZA_BLITZ_PUBLIC_URL"
}
if ($env:GEMINI_API_KEY) {
  $backendEnvPairs += "GEMINI_API_KEY=$env:GEMINI_API_KEY"
}
if ($env:BACKUP_DIR) {
  $backendEnvPairs += "BACKUP_DIR=$env:BACKUP_DIR"
}
if ($env:BACKUP_RETENTION_DAYS) {
  $backendEnvPairs += "BACKUP_RETENTION_DAYS=$env:BACKUP_RETENTION_DAYS"
}
$backendEnv = "^|^" + ($backendEnvPairs -join "|")

$deployArgs = @(
  "run", "deploy", "pizza-blitz-backend",
  "--project=$PROJECT_ID",
  "--image=$BACKEND_IMAGE",
  "--region=$REGION",
  "--platform=managed",
  "--allow-unauthenticated",
  "--set-env-vars=$backendEnv"
)
if ($env:CLOUD_SQL_INSTANCE) {
  $deployArgs += "--add-cloudsql-instances=$env:CLOUD_SQL_INSTANCE"
}
gcloud @deployArgs

$BACKEND_URL = gcloud run services describe pizza-blitz-backend --project=$PROJECT_ID --region=$REGION --format='value(status.url)'
Write-Host "Backend deployed at: $BACKEND_URL"

Write-Host "Building frontend..."
Set-Location (Join-Path $ROOT "frontend")
gcloud builds submit --project=$PROJECT_ID --tag $FRONTEND_IMAGE --build-arg NEXT_PUBLIC_API_URL=$BACKEND_URL .

Write-Host "Deploying frontend service..."
$frontendEnvPairs = @(
  "PIZZA_BLITZ_API_URL=$BACKEND_URL",
  "NEXT_PUBLIC_API_URL=$BACKEND_URL",
  "PIZZA_BLITZ_ADMIN_ID=$env:RESTAURANT_ADMIN_ID",
  "PIZZA_BLITZ_ADMIN_PASSWORD=$env:RESTAURANT_ADMIN_PASSWORD",
  "PIZZA_BLITZ_SESSION_SECRET=$env:PIZZA_BLITZ_SESSION_SECRET"
)
if ($env:PIZZA_BLITZ_SITE_URL) {
  $frontendEnvPairs += "PIZZA_BLITZ_SITE_URL=$env:PIZZA_BLITZ_SITE_URL"
}
if ($env:PIZZA_BLITZ_STAFF_ID) {
  $frontendEnvPairs += "PIZZA_BLITZ_STAFF_ID=$env:PIZZA_BLITZ_STAFF_ID"
}
if ($env:PIZZA_BLITZ_STAFF_PASSWORD) {
  $frontendEnvPairs += "PIZZA_BLITZ_STAFF_PASSWORD=$env:PIZZA_BLITZ_STAFF_PASSWORD"
}
$frontendEnv = "^|^" + ($frontendEnvPairs -join "|")

gcloud run deploy pizza-blitz-frontend `
  --project=$PROJECT_ID `
  --image=$FRONTEND_IMAGE `
  --region=$REGION `
  --platform=managed `
  --allow-unauthenticated `
  --set-env-vars=$frontendEnv

Set-Location $ROOT
Write-Host "Deployment complete."
