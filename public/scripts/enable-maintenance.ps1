# Sets firebase.json to maintenance configuration
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $repoRoot "..")

Copy-Item -Path (Join-Path $repoRoot "firebase.maintenance.json") -Destination (Join-Path $repoRoot "firebase.json") -Force

Write-Host "firebase.json now points to maintenance.html." -ForegroundColor Green
Write-Host "Deploy with:" -NoNewline; Write-Host " firebase deploy --only hosting" -ForegroundColor Cyan