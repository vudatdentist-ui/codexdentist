$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 LTS is required."
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -ne 22) {
  throw "Node.js 22 LTS is required. Other major versions are not supported yet."
}

node scripts/codexdentist.mjs install
