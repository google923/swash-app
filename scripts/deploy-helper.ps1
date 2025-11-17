param(
    [switch]$Firebase,
    [switch]$Vercel,
    [switch]$Both
)

Write-Host "Swash Deploy Helper" -ForegroundColor Cyan

if ($Both -or (-not $Firebase -and -not $Vercel)) {
    $Both = $true
}

if ($Firebase -or $Both) {
    Write-Host "\n➡ Deploying to Firebase Hosting..." -ForegroundColor Yellow
    firebase deploy --only hosting
}

if ($Vercel -or $Both) {
    Write-Host "\n➡ Deploying to Vercel (prod)..." -ForegroundColor Yellow
    npx vercel --prod --yes
}

Write-Host "\nDone." -ForegroundColor Green
