# Script to fix the handleQuoteAcceptedClick function
$file = "c:\Users\chris\OneDrive\Desktop\Swash-app(rebuild)\rep\add-new-customer.html"
$content = Get-Content $file -Raw

# The corrected function logic (lines 506-580)
$oldPattern = @'
      async function handleQuoteAcceptedClick\(\) \{
        try \{
          const upfrontToggle = document\.getElementById\('upfrontPayment'\);
          if \(!upfrontToggle \|\| !upfrontToggle\.checked\) \{
            alert\('Enable "Upfront payment \(3 cleans\)" to take payment\.'\);
            return;
          \}
          // Require pinned customer location before initiating payment
'@

$newReplacement = @'
      async function handleQuoteAcceptedClick() {
        try {
          // Require pinned customer location before initiating payment
'@

# Replace the upfront requirement check
$content = $content -replace $oldPattern, $newReplacement

# Fix the online payment section (remove duplicate upfrontToggle and add else branch)
$oldOnlineSection = @'
          // Determine amount dynamically based on toggle
          const upfrontToggle = document\.getElementById\('upfrontPayment'\);
          const useUpfront = upfrontToggle && upfrontToggle\.checked;
          let amountPennies = 0;
          let cleanCount = 1;
          
          if \(useUpfront\) \{
            const upfrontNode = document\.querySelector\('#result \.result-upfront'\);
            if \(!upfrontNode\) \{
            alert\('Upfront amount not visible\. Toggle "Upfront payment \(3 cleans\)" and recalc\.'\);
            return;
          \}
          const amountPennies = toPennies\(upfrontNode\.textContent\);
          if \(!amountPennies \|\| amountPennies < 100\) \{
            alert\('Invalid amount for payment\.'\);
            return;
          \}
'@

$newOnlineSection = @'
          // Determine amount dynamically based on toggle
          const upfrontToggle2 = document.getElementById('upfrontPayment');
          const useUpfront = upfrontToggle2 && upfrontToggle2.checked;
          let amountPennies = 0;
          let cleanCount = 1;
          
          if (useUpfront) {
            const upfrontNode = document.querySelector('#result .result-upfront');
            if (!upfrontNode) {
              alert('Upfront amount not visible. Toggle "Upfront payment (3 cleans)" and recalculate.');
              return;
            }
            amountPennies = toPennies(upfrontNode.textContent);
            cleanCount = 3;
          } else {
            const priceNode = document.querySelector('#result .result-price');
            if (!priceNode) {
              alert('Price per clean not visible. Please recalculate the quote.');
              return;
            }
            amountPennies = toPennies(priceNode.textContent);
            cleanCount = 1;
          }
          
          if (!amountPennies || amountPennies < 100) {
            alert('Invalid amount for payment.');
            return;
          }
'@

$content = $content -replace $oldOnlineSection, $newOnlineSection

# Save the fixed content
Set-Content $file -Value $content -NoNewline

Write-Host "Fixed payment function!" -ForegroundColor Green
