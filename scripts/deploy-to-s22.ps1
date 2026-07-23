param(
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RemoteZip = "/sdcard/Download/codexmed-os-deploy.zip",
  [switch]$SkipLocalChecks
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Find-Adb {
  $adb = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter adb.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

  if (!$adb) {
    $adbCommand = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($adbCommand) {
      $adb = $adbCommand.Source
    }
  }

  if (!$adb) {
    throw "adb.exe not found."
  }

  return $adb
}

function Assert-Device($Adb) {
  $devices = & $Adb devices
  $deviceLines = $devices | Select-String -Pattern "`tdevice$"
  if (!$deviceLines) {
    throw "No authorized Android device found. Connect S22 with USB debugging enabled."
  }
}

Push-Location $AppDir
try {
  if (!(Test-Path package.json) -or !(Test-Path prisma\schema.prisma)) {
    throw "AppDir does not look like the CodexMed OS repo: $AppDir"
  }

  if (!$SkipLocalChecks) {
    Write-Step "Encoding check"
    npm run encoding:check

    Write-Step "Local typecheck"
    npm run typecheck
  }

  $adb = Find-Adb
  Write-Step "ADB device"
  Assert-Device $adb
  & $adb devices -l

  $stageRoot = Join-Path $env:TEMP ("codexmed-s22-deploy-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  $stageApp = Join-Path $stageRoot "codexmed-os"
  $zipPath = Join-Path $stageRoot "codexmed-os-deploy.zip"
  New-Item -ItemType Directory -Path $stageApp | Out-Null

  Write-Step "Stage source"
  $excludeDirs = @(
    ".git",
    ".next",
    "node_modules",
    "storage",
    "backups",
    "selfhost-notes",
    ".playwright-cli",
    ".logs"
  )
  $excludeFiles = @(
    ".env",
    ".env.local",
    ".next-dev.out.log",
    ".next-dev.err.log",
    "server.out.log",
    "server.err.log",
    "tsconfig.tsbuildinfo"
  )

  Get-ChildItem -Force | ForEach-Object {
    if ($excludeDirs -contains $_.Name -or $excludeFiles -contains $_.Name) {
      return
    }

    Copy-Item -LiteralPath $_.FullName -Destination $stageApp -Recurse -Force
  }

  Write-Step "Package source"
  Push-Location $stageApp
  try {
    & tar.exe -a -c -f $zipPath .
  } finally {
    Pop-Location
  }

  Write-Step "Push package"
  & $adb push $zipPath $RemoteZip

  Write-Step "Unpack on S22 without touching .env or database"
  $remoteScript = @'
set -e
BASE_DIR="$(pwd)"
HOME_DIR="$BASE_DIR/files/home"
APP_DIR="$HOME_DIR/codexmed-os"
TMP_DIR="$HOME_DIR/codexmed-os-deploy-new"
OLD_DIR="$HOME_DIR/codexmed-os-deploy-old"
rm -rf "$TMP_DIR" "$OLD_DIR"
mkdir -p "$TMP_DIR"
cp /sdcard/Download/codexmed-os-deploy.zip "$HOME_DIR/codexmed-os-deploy.zip"
cd "$TMP_DIR"
/data/data/com.termux/files/usr/bin/unzip -q "$HOME_DIR/codexmed-os-deploy.zip"
for item in .env node_modules .next storage backups; do
  if [ -e "$APP_DIR/$item" ] && [ ! -e "$TMP_DIR/$item" ]; then
    mv "$APP_DIR/$item" "$TMP_DIR/$item"
  fi
done
if [ -d "$APP_DIR" ]; then
  mv "$APP_DIR" "$OLD_DIR"
fi
mv "$TMP_DIR" "$APP_DIR"
chmod -R u+rwX "$APP_DIR"
'@
  $scriptPath = Join-Path $stageRoot "deploy-unpack.sh"
  Set-Content -LiteralPath $scriptPath -Value $remoteScript -Encoding ascii
  & $adb push $scriptPath /sdcard/Download/deploy-unpack.sh
  & $adb shell run-as com.termux cp /sdcard/Download/deploy-unpack.sh files/home/deploy-unpack.sh
  & $adb shell run-as com.termux files/usr/bin/bash files/home/deploy-unpack.sh

  Write-Step "Build and restart on S22"
  & $adb shell run-as com.termux files/usr/bin/bash files/home/codexmed-os/tools/s22-termux/build-restart-codexmed.sh

  Write-Step "Health checks"
  & $adb shell run-as com.termux files/usr/bin/curl -sS http://127.0.0.1:3000/api/health
  Write-Host ""
  try {
    (Invoke-WebRequest -Uri https://app.codexdentist.com/api/health -UseBasicParsing -TimeoutSec 30).Content
  } catch {
    Write-Warning "Public health check failed: $($_.Exception.Message)"
  }

  Write-Step "Done"
  Write-Host "S22 deploy complete."
} finally {
  Pop-Location
}
