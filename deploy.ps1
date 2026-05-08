$ErrorActionPreference = 'Stop'

Write-Host '==> Building Docker image...' -ForegroundColor Cyan
docker compose build
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed.' -ForegroundColor Red; exit 1 }

Write-Host '==> Restarting container...' -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Host 'Deploy failed.' -ForegroundColor Red; exit 1 }

Write-Host '==> Waiting for server to start...' -ForegroundColor Cyan
Start-Sleep -Seconds 4

Write-Host '==> Health check...' -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri 'http://localhost:3006/api/health' -TimeoutSec 10
    if ($response.status -eq 'ok') {
        Write-Host 'Deploy successful. Workshop is live.' -ForegroundColor Green
        Write-Host "  DB: $($response.db)" -ForegroundColor Gray
    } else {
        Write-Host 'Health check returned unexpected response.' -ForegroundColor Yellow
    }
} catch {
    Write-Host "Health check failed: $_" -ForegroundColor Red
    Write-Host 'Check logs with: docker compose logs workshop' -ForegroundColor Yellow
    exit 1
}
