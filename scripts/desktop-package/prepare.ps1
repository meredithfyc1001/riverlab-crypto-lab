# Build an isolated test kit from this Windows job's own locked release build.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sha -cne $env:EXPECTED_SHA) {
    throw "Checkout does not match the requested PR head."
}

$output = 'work/desktop-6b/package'
$evidence = 'work/desktop-6b/evidence'
$kit = Join-Path $output 'kit'
New-Item -ItemType Directory -Path $kit -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$build = 'src-tauri/target/release'
$exe = Get-Item -LiteralPath "$build/riverlab-desktop.exe"
$installers = @(Get-ChildItem -LiteralPath "$build/bundle/nsis" -File -Filter '*-setup.exe')
if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer. Found $($installers.Count)."
}

$installer = $installers[0]
Copy-Item -LiteralPath $exe.FullName -Destination "$kit/riverlab-desktop.exe"
Copy-Item -LiteralPath $installer.FullName -Destination "$kit/RiverLab-6B-x64-setup.exe"
Copy-Item -LiteralPath 'scripts/desktop-package/README-Windows.md' -Destination $kit
$payload = foreach ($file in (Get-ChildItem -LiteralPath $kit -File -Filter '*.exe' | Sort-Object Name)) {
    [ordered]@{
        name = $file.Name
        bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        authenticode = (Get-AuthenticodeSignature -LiteralPath $file.FullName).Status.ToString()
    }
}
$manifestLines = foreach ($file in $payload) { "$($file.sha256)  $($file.name)" }
(($manifestLines -join "`n") + "`n") | Set-Content -LiteralPath "$kit/SHA256SUMS.txt" -Encoding ascii -NoNewline
$config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
[ordered]@{
    type = 'Phase 6B Windows acceptance kit'
    sourceSha = $sha
    runId = $env:GITHUB_RUN_ID
    runAttempt = $env:GITHUB_RUN_ATTEMPT
    productVersion = $config.version
    architecture = 'x86_64-pc-windows-msvc'
    existingWebView2RuntimeRequired = $true
    payload = @($payload)
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$kit/build-info.json" -Encoding utf8NoBOM
"exe_sha256=$($payload.Where({ $_.name -ceq 'riverlab-desktop.exe' })[0].sha256)" >> $env:GITHUB_OUTPUT
"setup_sha256=$($payload.Where({ $_.name -ceq 'RiverLab-6B-x64-setup.exe' })[0].sha256)" >> $env:GITHUB_OUTPUT
Copy-Item -LiteralPath "$kit/build-info.json" -Destination $evidence

$archiveName = "RiverLab-6B-Windows-x64-$sha.zip"
$archive = Join-Path $output $archiveName
Compress-Archive -Path "$kit/*" -DestinationPath $archive -CompressionLevel Optimal
$digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$digest  $archiveName" | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
"archive_sha256=$digest" >> $env:GITHUB_OUTPUT

# Use the actual user-distributed bytes, including the path handling exercised by NSIS.
$extracted = Join-Path $env:RUNNER_TEMP '河流 实验 验收包'
Expand-Archive -LiteralPath $archive -DestinationPath $extracted
$extractedSums = foreach ($file in $payload) {
    $extractedHash = (Get-FileHash -LiteralPath (Join-Path $extracted $file.name) -Algorithm SHA256).Hash
    if ($extractedHash.ToLowerInvariant() -cne $file.sha256) { throw "Extraction changed $($file.name)." }
    "$($extractedHash.ToLowerInvariant())  $($file.name)"
}
$manifestPath = Join-Path $extracted 'SHA256SUMS.txt'
if ((Get-Content -LiteralPath $manifestPath -Raw) -cne (($extractedSums -join "`n") + "`n")) {
    throw "The packaged SHA256SUMS.txt does not match the extracted EXEs."
}
Copy-Item -LiteralPath $manifestPath -Destination $evidence
$extractedInstaller = Join-Path $extracted 'RiverLab-6B-x64-setup.exe'
$installDir = Join-Path $env:RUNNER_TEMP '中文 用户 安装目录'
if (Test-Path -LiteralPath $installDir) { throw "Expected a fresh per-user install directory." }
# NSIS parses the rest of the command line after /D= as the raw path (spaces included).
$setup = Start-Process -FilePath $extractedInstaller -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "NSIS returned $($setup.ExitCode)." }

$installed = Get-Item -LiteralPath (Join-Path $installDir 'riverlab-desktop.exe')
$installedHash = (Get-FileHash -LiteralPath $installed.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$standalone = Get-Item -LiteralPath (Join-Path $extracted 'riverlab-desktop.exe')
$standaloneHash = (Get-FileHash -LiteralPath $standalone.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$identical = $standaloneHash -ceq $installedHash
[ordered]@{
    sourceSha = $sha
    installerExitCode = $setup.ExitCode
    extractedAndInstalledUnderUnicodeAndSpacePaths = $true
    installedExeSha256 = $installedHash
    installedExeBytes = $installed.Length
    installedExeFileVersion = $installed.VersionInfo.FileVersion
    standaloneExeSha256 = $standaloneHash
    standaloneExeBytes = $standalone.Length
    standaloneExeFileVersion = $standalone.VersionInfo.FileVersion
    installedExeEqualsStandalone = $identical
    installedDirectoryBytes = (Get-ChildItem -LiteralPath $installDir -File -Recurse | Measure-Object Length -Sum).Sum
    archiveSha256 = $digest
    archiveBytes = (Get-Item -LiteralPath $archive).Length
    system = [Environment]::OSVersion.Version.ToString()
    runnerImage = $env:ImageVersion
} | ConvertTo-Json | Set-Content -LiteralPath "$evidence/windows-install.json" -Encoding utf8NoBOM
if (-not $identical) {
    throw "EXE identity mismatch. Installed SHA-256 $installedHash ($($installed.Length) bytes), standalone SHA-256 $standaloneHash ($($standalone.Length) bytes)."
}
"RIVERLAB_6A_INSTALL_DIR=$installDir" >> $env:GITHUB_ENV
"RIVERLAB_6A_INSTALLER=$extractedInstaller" >> $env:GITHUB_ENV
"RIVERLAB_6A_EXE=$($installed.FullName)" >> $env:GITHUB_ENV
"RIVERLAB_6A_STANDALONE=$($standalone.FullName)" >> $env:GITHUB_ENV
