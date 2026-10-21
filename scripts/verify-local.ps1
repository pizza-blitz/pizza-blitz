param(
    [switch]$E2E
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Invoke-ProjectStep {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
}

Invoke-ProjectStep "Backend unit validation" {
    Push-Location (Join-Path $Root "backend")
    try {
        python -W error::FutureWarning -m unittest discover -s tests -v
    }
    finally {
        Pop-Location
    }
}

Invoke-ProjectStep "Frontend production build" {
    Push-Location (Join-Path $Root "frontend")
    try {
        npm run build
    }
    finally {
        Pop-Location
    }
}

if ($E2E) {
    Invoke-ProjectStep "Browser E2E smoke" {
        Push-Location (Join-Path $Root "frontend")
        try {
            npm run test:e2e
        }
        finally {
            Pop-Location
        }
    }
}
else {
    Write-Host ""
    Write-Host "Skipped browser E2E. Start backend on 8010 and frontend on 3011, then rerun with -E2E." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Local verification completed." -ForegroundColor Green
