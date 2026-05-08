# iis-setup.ps1 — One-time IIS site creation for Workshop
# Run once from an admin PowerShell session: .\iis-setup.ps1

$ErrorActionPreference = 'Stop'

$siteName    = 'workshop'
$hostHeader  = 'your-app.example.com'   # replace with your domain
$physPath    = 'C:\inetpub\workshop'
$port        = 3006

# Create physical directory and drop web.config
Write-Host '==> Creating IIS physical directory...' -ForegroundColor Cyan
if (-not (Test-Path $physPath)) {
    New-Item -ItemType Directory -Path $physPath | Out-Null
}

$webConfig = @'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="HTTP to HTTPS" stopProcessing="true">
                    <match url="(.*)" />
                    <conditions>
                        <add input="{HTTPS}" pattern="^OFF$" />
                    </conditions>
                    <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
                </rule>
                <rule name="ReverseProxyInboundRule1" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3006/{R:1}" />
                </rule>
            </rules>
        </rewrite>
    </system.webServer>
</configuration>
'@
Set-Content -Path "$physPath\web.config" -Value $webConfig -Encoding UTF8

# Create IIS site (skip if already exists)
Import-Module WebAdministration
if (-not (Get-Website -Name $siteName -ErrorAction SilentlyContinue)) {
    Write-Host "==> Creating IIS site '$siteName'..." -ForegroundColor Cyan
    New-Website -Name $siteName `
                -PhysicalPath $physPath `
                -HostHeader $hostHeader `
                -Port 80 `
                -Force | Out-Null

    # Add HTTPS binding (SNI, reuses existing wildcard/SAN cert)
    New-WebBinding -Name $siteName `
                   -Protocol https `
                   -Port 443 `
                   -HostHeader $hostHeader `
                   -SslFlags 1
    Write-Host "  Site created: http://$hostHeader and https://$hostHeader" -ForegroundColor Green
} else {
    Write-Host "  Site '$siteName' already exists, skipping creation." -ForegroundColor Yellow
}

Write-Host '==> IIS setup complete.' -ForegroundColor Green
Write-Host "  Next: add DNS A record for $hostHeader -> your public IP" -ForegroundColor Gray
Write-Host "  Then: .\deploy.ps1 to build and start the Docker container" -ForegroundColor Gray
