# Clean Next.js build directory and handle file locks
param(
    [switch]$Force
)

Write-Host "=== Cleaning Next.js Build Directory ===" -ForegroundColor Cyan
Write-Host ""

# Stop any running Node processes
Write-Host "Stopping Node processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "✓ Stopped Node processes" -ForegroundColor Green
} else {
    Write-Host "✓ No Node processes running" -ForegroundColor Green
}

# Remove .next directory with retry logic
if (Test-Path .next) {
    Write-Host ""
    Write-Host "Removing .next directory..." -ForegroundColor Yellow
    $maxRetries = 5
    $retryCount = 0
    $success = $false
    
    while ($retryCount -lt $maxRetries -and -not $success) {
        try {
            Remove-Item -Recurse -Force .next -ErrorAction Stop
            Write-Host "✓ Successfully removed .next directory" -ForegroundColor Green
            $success = $true
        } catch {
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Write-Host "⚠ Retry $retryCount/$maxRetries - Files may be locked, waiting..." -ForegroundColor Yellow
                Start-Sleep -Seconds 3
            } else {
                Write-Host ""
                Write-Host "✗ Failed to remove .next directory after $maxRetries attempts" -ForegroundColor Red
                Write-Host "Error: $_" -ForegroundColor Red
                Write-Host ""
                Write-Host "=== Troubleshooting ===" -ForegroundColor Cyan
                Write-Host "1. Close all editors/IDEs (VS Code, Cursor, etc.)"
                Write-Host "2. Pause OneDrive sync temporarily:"
                Write-Host "   - Right-click OneDrive icon → Pause syncing → 2 hours"
                Write-Host "3. Or exclude .next from OneDrive:"
                Write-Host "   - OneDrive Settings → Sync and backup → Advanced settings"
                Write-Host "   - Add exclusion for: .next"
                Write-Host "4. Or move project outside OneDrive folder"
                Write-Host ""
                exit 1
            }
        }
    }
} else {
    Write-Host "✓ .next directory does not exist" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Cleanup Complete ===" -ForegroundColor Green

