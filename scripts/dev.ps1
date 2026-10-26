# Starts everything for local development: private Postgres (port 5433), migrations + synthetic seed,
# the API (http://localhost:4010) and the web app (http://localhost:3000).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
if (-not (Test-Path "$root\.pgdata\PG_VERSION")) {
  Write-Host 'No local database found. Create it first (see README).' -ForegroundColor Red; exit 1
}
$running = (& "$pgBin\pg_ctl.exe" -D "$root\.pgdata" status) -match 'server is running'
if (-not $running) {
  Write-Host 'Starting local Postgres on port 5433...'
  Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList @('-D', "$root\.pgdata", '-o', '"-p 5433"', '-l', "$root\.pgdata\server.log", 'start') -WindowStyle Hidden -Wait
}

Write-Host 'Migrating and seeding synthetic data...'
pnpm --filter '@auditos/api' seed

Write-Host 'Starting API and web. Open http://localhost:3000' -ForegroundColor Green
$api = Start-Process -PassThru -NoNewWindow -FilePath pnpm -ArgumentList @('--filter', '@auditos/api', 'dev')
$web = Start-Process -PassThru -NoNewWindow -FilePath pnpm -ArgumentList @('--filter', '@auditos/web', 'dev')
try { Wait-Process -Id $api.Id, $web.Id } finally { Stop-Process -Id $api.Id, $web.Id -ErrorAction SilentlyContinue }
