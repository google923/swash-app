# Restores firebase.json to normal live configuration
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $repoRoot "..")

Copy-Item -Path (Join-Path $repoRoot "firebase.live.json") -Destination (Join-Path $repoRoot "firebase.json") -Force

Write-Host "firebase.json restored to live configuration." -ForegroundColor Green
Write-Host "Deploy with:" -NoNewline; Write-Host " firebase deploy --only hosting" -ForegroundColor Cyan