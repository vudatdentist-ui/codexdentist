param(
  [string]$OutputDir = "backups",
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
  if (Test-Path ".env") {
    $envLine = Get-Content ".env" | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if ($envLine) {
      $DatabaseUrl = ($envLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim('"', "'")
    }
  }
}

if (-not $DatabaseUrl) {
  throw "DATABASE_URL is required."
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump was not found in PATH."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $OutputDir "codexmed-postgres-$timestamp.dump"

pg_dump --format=custom --no-owner --no-privileges --file "$backupPath" "$DatabaseUrl"

if (-not (Test-Path $backupPath)) {
  throw "Backup file was not created."
}

Write-Output "Backup created: $backupPath"
