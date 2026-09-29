$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path '.next/standalone/server.js')) {
    throw 'Production build missing. Run npm run build first.'
}
New-Item -ItemType Directory -Force '.next/standalone/.next' | Out-Null
Copy-Item -LiteralPath '.next/static' -Destination '.next/standalone/.next' -Recurse -Force
Copy-Item -LiteralPath 'public' -Destination '.next/standalone' -Recurse -Force
$env:HOSTNAME = '127.0.0.1'
$env:PORT = '3000'
$env:NODE_ENV = 'production'
Write-Host 'Sakura NAI: http://127.0.0.1:3000 (Ctrl+C to stop)'
node .next/standalone/server.js
exit $LASTEXITCODE
