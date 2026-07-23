param(
  [int]$Port = 3000,
  [string]$HostName = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outLog = Join-Path $projectRoot ".next-selfhost.out.log"
$errLog = Join-Path $projectRoot ".next-selfhost.err.log"

$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and
    $_.CommandLine -like "*$projectRoot*" -and
    (
      $_.CommandLine -like "*next dev*" -or
      $_.CommandLine -like "*next start*" -or
      $_.CommandLine -like "*start-server.js*"
    )
  }

foreach ($process in $existing) {
  Stop-Process -Id $process.ProcessId -Force
}

Push-Location $projectRoot
try {
  npm run build
  Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "start", "--", "-H", $HostName, "-p", "$Port") `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden
} finally {
  Pop-Location
}

Start-Sleep -Seconds 4

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -ExpandProperty IPAddress

Write-Host "Self-host server started."
Write-Host "Local: http://127.0.0.1:$Port"
foreach ($ip in $ips) {
  Write-Host "LAN:   http://$ip`:$Port"
}
Write-Host "Logs:  $outLog"
