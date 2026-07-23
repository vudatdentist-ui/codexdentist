param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [string]$RestoreDatabaseUrl = $env:RESTORE_DATABASE_URL,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"

if (-not $ConfirmRestore) {
  throw "Restore is destructive. Re-run with -ConfirmRestore after pointing RESTORE_DATABASE_URL to an empty restore database."
}

if (-not (Test-Path -LiteralPath $BackupPath)) {
  throw "Backup file not found: $BackupPath"
}

if (-not $RestoreDatabaseUrl) {
  throw "RESTORE_DATABASE_URL or -RestoreDatabaseUrl is required."
}

if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw "pg_restore was not found in PATH."
}

pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$RestoreDatabaseUrl" "$BackupPath"
Write-Output "Restore completed into RESTORE_DATABASE_URL."
