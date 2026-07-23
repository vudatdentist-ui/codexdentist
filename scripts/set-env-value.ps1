param(
  [Parameter(Mandatory = $true)]
  [string]$Name,
  [Parameter(Mandatory = $true)]
  [string]$Value,
  [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"
$path = Resolve-Path $EnvPath
$raw = Get-Content -LiteralPath $path -Raw
$escaped = $Value.Replace('"', '\"')
$line = "$Name=`"$escaped`""

if ($raw -match "(?m)^$([regex]::Escape($Name))=") {
  $next = [regex]::Replace($raw, "(?m)^$([regex]::Escape($Name))=.*$", $line)
} else {
  $next = $raw.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
}

Set-Content -LiteralPath $path -Value $next -NoNewline -Encoding UTF8
Write-Host "Updated $Name in $path"
