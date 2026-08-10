$logPath = Join-Path $env:RUNNER_TEMP "scope-windows-gui-e2e.log"

& npm test --prefix tests/e2e 2>&1 | Tee-Object -FilePath $logPath
$testExitCode = $LASTEXITCODE

if ($testExitCode -eq 0) {
    exit 0
}

$log = Get-Content -Raw $logPath
$isWebView2Runtime150 = $log -match "Detected WebView2 runtime version:\s*150\."
$isKnownSessionFailure = $log -match "DevToolsActivePort file doesn't exist"
$isFinalSessionCreationFailure = $log -match "Failed to create a session:"
$didSpecStart = $log -match "SCOPE_E2E_SPEC_STARTED"

if ($isWebView2Runtime150 -and $isKnownSessionFailure -and $isFinalSessionCreationFailure -and -not $didSpecStart) {
    Write-Output "::warning title=Windows GUI E2E blocked by WebView2 150::The real Tauri app reached EdgeDriver session creation, but elevated GitHub Windows runners cannot expose the WebView2 150 debug port. Tracking tauri-apps/wry#1782 and webdriverio/desktop-mobile#542."
    exit 0
}

exit $testExitCode
