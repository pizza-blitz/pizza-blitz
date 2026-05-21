$ErrorActionPreference = "Stop"

$PROJECT_ID = $env:GCP_PROJECT_ID
if (-not $PROJECT_ID) { $PROJECT_ID = "eduecosystem-prod" }

$REGION = $env:GCP_REGION
if (-not $REGION) { $REGION = "us-central1" }

if (-not $env:SQLALCHEMY_DATABASE_URI) {
  throw "Set SQLALCHEMY_DATABASE_URI before deploying the backend."
}

$BACKEND_IMAGE = "gcr.io/$PROJECT_ID/pizza-blitz-backend"
$FRONTEND_IMAGE = "gcr.io/$PROJECT_ID/pizza-blitz-frontend"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting Pizza Blitz deployment to Google Cloud Run..."

Write-Host "Building backend..."
Set-Location (Join-Path $ROOT "backend")
gcloud builds submit --project=$PROJECT_ID --tag $BACKEND_IMAGE .

Write-Host "Deploying backend service..."
$backendEnv = "SQLALCHEMY_DATABASE_URI=$env:SQLALCHEMY_DATABASE_URI"
if ($env:GEMINI_API_KEY) {
  $backendEnv = "$backendEnv,GEMINI_API_KEY=$env:GEMINI_API_KEY"
}
if ($env:RESTAURANT_ADMIN_ID) {
  $backendEnv = "$backendEnv,RESTAURANT_ADMIN_ID=$env:RESTAURANT_ADMIN_ID"
}
if ($env:RESTAURANT_ADMIN_PASSWORD) {
  $backendEnv = "$backendEnv,RESTAURANT_ADMIN_PASSWORD=$env:RESTAURANT_ADMIN_PASSWORD"
}

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
gcloud run deploy pizza-blitz-frontend `
  --project=$PROJECT_ID `
  --image=$FRONTEND_IMAGE `
  --region=$REGION `
  --platform=managed `
  --allow-unauthenticated `
  --set-env-vars="NEXT_PUBLIC_API_URL=$BACKEND_URL"

Set-Location $ROOT
Write-Host "Deployment complete."

