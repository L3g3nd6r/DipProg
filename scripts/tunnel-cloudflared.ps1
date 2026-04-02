# Free HTTPS tunnel to http://localhost:3000
# 1) Run backend: cd backend && npm start
# 2) Run: powershell -ExecutionPolicy Bypass -File scripts\tunnel-cloudflared.ps1
# 3) Put the printed https://....trycloudflare.com into local.properties as api.base.url=
# 4) Rebuild the Android app.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root 'tools'
$exe = Join-Path $toolsDir 'cloudflared.exe'
$url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host 'Downloading cloudflared to tools\cloudflared.exe (first run)...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
    Write-Host 'Done.' -ForegroundColor Green
}

Write-Host 'Waiting for backend at http://localhost:3000 ...' -ForegroundColor Cyan
Write-Host 'Look for trycloudflare.com URL below.' -ForegroundColor Gray
& $exe tunnel --url 'http://localhost:3000'
