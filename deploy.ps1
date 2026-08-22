$ErrorActionPreference = 'Stop'

$worktreeChanges = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not inspect the git worktree before building.' -ForegroundColor Red
    exit 1
}
if ($worktreeChanges.Count -ne 0) {
    Write-Host 'Refusing to label a dirty worktree with a committed build SHA.' -ForegroundColor Red
    exit 1
}

$buildSha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $buildSha -notmatch '^[0-9a-f]{40}$') {
    Write-Host 'Could not resolve a full git SHA for the image build.' -ForegroundColor Red
    exit 1
}
$version = Get-Content -Raw -Path 'version.json' | ConvertFrom-Json
$appVersion = "$($version.major).$($version.minor).$($version.patch)+build.$($version.build)"
if ($appVersion -notmatch '^\d+\.\d+\.\d+\+build\.\d+$') {
    Write-Host 'version.json does not contain a valid application version.' -ForegroundColor Red
    exit 1
}
$env:BUILD_SHA = $buildSha
$env:APP_VERSION = $appVersion

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
