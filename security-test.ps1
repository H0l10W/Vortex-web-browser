# Vortex Browser Security Test Script
# Version: 1.0
# Compatible with: Vortex Browser v0.0.7+

param(
    [switch]$Detailed,
    [switch]$ExportResults,
    [string]$OutputPath = "security-test-results.txt"
)

Write-Host "=== VORTEX BROWSER SECURITY AUDIT SCRIPT ===" -ForegroundColor Cyan
Write-Host "Version: 1.0" -ForegroundColor Yellow
Write-Host "Date: $(Get-Date)" -ForegroundColor Yellow
Write-Host ""

$TestResults = @{
    Passed = 0
    Failed = 0
    Total = 7
    Details = @()
}

function Test-Feature {
    param($Name, $TestScript, $PassMsg, $FailMsg)
    
    Write-Host "Testing: $Name" -ForegroundColor Green
    
    try {
        $result = & $TestScript
        if ($result) {
            Write-Host "PASS: $PassMsg" -ForegroundColor Green
            $TestResults.Passed++
            $TestResults.Details += "PASS - $Name"
        } else {
            Write-Host "FAIL: $FailMsg" -ForegroundColor Red
            $TestResults.Failed++
            $TestResults.Details += "FAIL - $Name"
        }
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $TestResults.Failed++
        $TestResults.Details += "ERROR - $Name"
    }
    Write-Host ""
}

# Test 1: Sandbox
Test-Feature -Name "Sandbox Configuration" -TestScript {
    $content = Get-Content "main.js" -Raw
    return (-not ($content -match "no-sandbox")) -and ($content -match "sandbox:\s*true")
} -PassMsg "Sandbox enabled" -FailMsg "Sandbox issues found"

# Test 2: Web Security
Test-Feature -Name "Web Security Settings" -TestScript {
    $content = Get-Content "main.js" -Raw
    return ($content -match "webSecurity:\s*true") -and ($content -match "nodeIntegration:\s*false")
} -PassMsg "Web security configured" -FailMsg "Web security issues"

# Test 3: CSP
Test-Feature -Name "Content Security Policy" -TestScript {
    $index = Get-Content "index.html" -Raw
    $settings = Get-Content "settings.html" -Raw
    return ($index -match "Content-Security-Policy.*object-src") -and ($settings -match "Content-Security-Policy")
} -PassMsg "CSP headers found" -FailMsg "CSP headers missing"

# Test 4: HTTPS
Test-Feature -Name "HTTPS Enforcement" -TestScript {
    $content = Get-Content "main.js" -Raw
    return $content -match "https.*enforcement|upgrade-insecure"
} -PassMsg "HTTPS enforcement found" -FailMsg "HTTPS enforcement missing"

# Test 5: Permissions
Test-Feature -Name "Permission Controls" -TestScript {
    $content = Get-Content "main.js" -Raw
    return ($content -match "setPermissionRequestHandler") -and ($content -match "certificate-error")
} -PassMsg "Permission controls active" -FailMsg "Permission controls missing"

# Test 6: Downloads
Test-Feature -Name "Download Security" -TestScript {
    $content = Get-Content "main.js" -Raw
    return ($content -match "dangerousExtensions") -and ($content -match "\.exe.*\.bat")
} -PassMsg "Download security active" -FailMsg "Download security missing"

# Test 7: IPC
Test-Feature -Name "Secure IPC" -TestScript {
    if (-not (Test-Path "preload.js")) { return $false }
    $content = Get-Content "preload.js" -Raw
    return $content -match "contextBridge"
} -PassMsg "Secure IPC found" -FailMsg "Secure IPC missing"

# Results
Write-Host "=== SECURITY TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "Tests Passed: $($TestResults.Passed)/$($TestResults.Total)" -ForegroundColor Green
Write-Host "Tests Failed: $($TestResults.Failed)/$($TestResults.Total)" -ForegroundColor Red

$score = ($TestResults.Passed / $TestResults.Total) * 100

if ($score -ge 85) {
    $rating = "HIGH"
    $color = "Green"
} elseif ($score -ge 70) {
    $rating = "MEDIUM" 
    $color = "Yellow"
} else {
    $rating = "LOW"
    $color = "Red"
}

Write-Host ""
Write-Host "SECURITY RATING: $rating" -ForegroundColor $color
Write-Host "Security Score: $([math]::Round($score, 1))%" -ForegroundColor $color

if ($ExportResults) {
    $report = @"
VORTEX BROWSER SECURITY TEST REPORT
===================================
Test Date: $(Get-Date)
Security Score: $([math]::Round($score, 1))%
Security Rating: $rating

RESULTS:
$($TestResults.Details -join "`n")

Tests Passed: $($TestResults.Passed)/$($TestResults.Total)
Tests Failed: $($TestResults.Failed)/$($TestResults.Total)
"@
    
    $report | Out-File -FilePath $OutputPath -Encoding UTF8
    Write-Host "Report exported to: $OutputPath" -ForegroundColor Yellow
}