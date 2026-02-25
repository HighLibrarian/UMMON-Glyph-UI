# ──────────────────────────────────────────────────────────────
# Send a demo glyph payload to the Ummon Glyph UI server.
#
# Usage (PowerShell):
#   .\send.ps1 appliance-dishwasher-done.json    # send one
#   .\send.ps1 -All                               # send all, 3s apart
#   .\send.ps1 -Clear                             # clear / reset to idle
#
# Defaults to http://localhost:3000. Override with $env:UMMON_URL.
# ──────────────────────────────────────────────────────────────

param(
  [string]$File,
  [switch]$All,
  [switch]$Clear,
  [int]$Delay = 3
)

$url = if ($env:UMMON_URL) { $env:UMMON_URL } else { "http://localhost:3000" }
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Clear) {
  Write-Host "-> Clearing glyph..."
  Invoke-RestMethod -Uri "$url/clear" -Method POST
  return
}

if ($All) {
  $files = Get-ChildItem -Path $dir -Filter "*.json"
  foreach ($f in $files) {
    Write-Host "-> Sending $($f.Name)"
    $body = Get-Content $f.FullName -Raw
    Invoke-RestMethod -Uri "$url/glyph" -Method POST -ContentType "application/json" -Body $body
    Start-Sleep -Seconds $Delay
  }
  Write-Host "Done — all payloads sent."
  return
}

if (-not $File) {
  Write-Host "Usage: .\send.ps1 <payload.json> | -All | -Clear"
  return
}

$path = if (Test-Path $File) { $File } else { Join-Path $dir $File }
if (-not (Test-Path $path)) {
  Write-Host "File not found: $path" -ForegroundColor Red
  return
}

Write-Host "-> Sending $path"
$body = Get-Content $path -Raw
Invoke-RestMethod -Uri "$url/glyph" -Method POST -ContentType "application/json" -Body $body
