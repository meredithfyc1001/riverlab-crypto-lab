# Confirm the loose EXE can open and close without the install tree or a Node PATH.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$evidence = 'work/desktop-6a/evidence/standalone.json'
$oldPath = $env:PATH
$app = $null
$result = [ordered]@{
    sourceSha = $env:EXPECTED_SHA
    nodeAvailableOnChildPath = $null
    visibleResponsiveWindow = $false
    webView2ChildObserved = $false
    regularWindowCloseExited = $false
}
try {
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
    $env:RIVERLAB_6A_TEST_PROFILE = 'standalone-' + [Guid]::NewGuid().ToString('N')
    $result.nodeAvailableOnChildPath = $null -ne (Get-Command node.exe -ErrorAction SilentlyContinue)
    if ($result.nodeAvailableOnChildPath) { throw "Node.js still resolves in the test process PATH." }
    $app = Start-Process -FilePath $env:RIVERLAB_6A_STANDALONE -WorkingDirectory (Split-Path $env:RIVERLAB_6A_STANDALONE) -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        $app.Refresh()
        if ($app.HasExited) { throw "The standalone EXE exited during startup ($($app.ExitCode))." }
        $result.visibleResponsiveWindow = ($app.MainWindowHandle -ne 0 -and $app.Responding)
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($app.Id) AND Name='msedgewebview2.exe'" | Select-Object -First 1
        $result.webView2ChildObserved = $null -ne $child
        if ($result.visibleResponsiveWindow -and $result.webView2ChildObserved) { break }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not ($result.visibleResponsiveWindow -and $result.webView2ChildObserved)) {
        throw "The standalone EXE did not produce a responsive window and WebView2 child."
    }
    if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(15000)) {
        throw "The standalone EXE did not exit after its window was closed."
    }
    $result.regularWindowCloseExited = $app.ExitCode -eq 0
    if (-not $result.regularWindowCloseExited) { throw "The standalone EXE returned $($app.ExitCode) on close." }
} finally {
    $env:PATH = $oldPath
    if ($app -and -not $app.HasExited) { $app.Kill($true) }
    $result | ConvertTo-Json | Set-Content -LiteralPath $evidence -Encoding utf8NoBOM
}
