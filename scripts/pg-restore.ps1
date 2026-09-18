param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [string]$RestoreDatabaseUrl = $env:RESTORE_DATABASE_URL,
  [string]$RestoreTargetMarker = $env:RESTORE_TARGET_MARKER,
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

if ($RestoreTargetMarker -ne "CODEXDENTIST_DISPOSABLE_RESTORE") {
  throw "Set RESTORE_TARGET_MARKER=CODEXDENTIST_DISPOSABLE_RESTORE for an explicitly disposable restore target."
}

try {
  $restoreUri = [Uri]$RestoreDatabaseUrl
  $databaseName = $restoreUri.AbsolutePath.Trim('/').Split('/')[-1]
  if ($env:DATABASE_URL -and $RestoreDatabaseUrl -eq $env:DATABASE_URL) {
    throw "Refusing to restore directly into DATABASE_URL. Use a disposable restore database."
  }
  if ($databaseName -notmatch '(?i)(restore|test|qa|dev|local|sandbox)') {
    throw "Restore target must be an explicitly disposable database (name must contain restore, test, qa, dev, local, or sandbox)."
  }
} catch {
  throw $_
}

if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw "pg_restore was not found in PATH."
}

pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$RestoreDatabaseUrl" "$BackupPath"
Write-Output "Restore completed into RESTORE_DATABASE_URL."
