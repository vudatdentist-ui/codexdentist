$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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

Write-Host "Stopped $($existing.Count) NhaVista node process(es)."
