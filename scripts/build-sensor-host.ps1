$ErrorActionPreference = 'Stop'

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hostRoot = Join-Path $workspaceRoot 'sensor-host'
$outputRoot = Join-Path $hostRoot 'bin'
$objectRoot = Join-Path $hostRoot 'obj\lhm-v0.9.6'
$archivePath = Join-Path $objectRoot 'LibreHardwareMonitor.zip'
$pawnIoInstallerCachePath = Join-Path $objectRoot 'PawnIO_setup.exe'
$presentMonCachePath = Join-Path $objectRoot 'PresentMon-2.4.1-x64.exe'
$extractRoot = Join-Path $objectRoot 'unpacked'
$sourcePaths = @(
  (Join-Path $hostRoot 'HardwareDeviceCatalog.cs'),
  (Join-Path $hostRoot 'PresentMonFpsReader.cs'),
  (Join-Path $hostRoot 'PsuReaders.cs'),
  (Join-Path $hostRoot 'Program.cs')
)
$configPath = Join-Path $hostRoot 'SiR.SensorHost.exe.config'
$noticePath = Join-Path $hostRoot 'THIRD-PARTY-NOTICES.md'
$hardwareSupportPath = Join-Path $hostRoot 'HARDWARE-SUPPORT.md'
$compilerPath = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$downloadUrl = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip'
$expectedHash = '086D9F1B5A99E643EDC2CFAAAC16051685B551E4C5AC0B32A57C58C0E529C001'
$pawnIoInstallerUrl = 'https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/v0.9.6/LibreHardwareMonitor/Resources/PawnIO_setup.exe'
$pawnIoInstallerExpectedHash = 'A3A46226C5E2824F4CDD42BE0EECBABFC672C86F7889710F5AB1E6AD385B47A0'
$presentMonUrl = 'https://github.com/GameTechDev/PresentMon/releases/download/v2.4.1/PresentMon-2.4.1-x64.exe'
$presentMonExpectedHash = 'D74183E7AE630F72CD3690BE0373ECBFDC6CBB86578148AAB8FA2A7166068F34'

if (-not (Test-Path -LiteralPath $compilerPath)) {
  throw "The .NET Framework C# compiler was not found at $compilerPath"
}

New-Item -ItemType Directory -Path $objectRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$downloadRequired = $true
if (Test-Path -LiteralPath $archivePath) {
  $currentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
  $downloadRequired = $currentHash -ne $expectedHash
}

if ($downloadRequired) {
  Invoke-WebRequest -Headers @{ 'User-Agent' = 'SiR-System-Monitor-Build' } -Uri $downloadUrl -OutFile $archivePath
}

$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
if ($archiveHash -ne $expectedHash) {
  throw "LibreHardwareMonitor archive hash mismatch. Expected $expectedHash but received $archiveHash"
}

$pawnIoDownloadRequired = $true
if (Test-Path -LiteralPath $pawnIoInstallerCachePath) {
  $pawnIoCurrentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pawnIoInstallerCachePath).Hash
  $pawnIoDownloadRequired = $pawnIoCurrentHash -ne $pawnIoInstallerExpectedHash
}

if ($pawnIoDownloadRequired) {
  Invoke-WebRequest -Headers @{ 'User-Agent' = 'SiR-System-Monitor-Build' } -Uri $pawnIoInstallerUrl -OutFile $pawnIoInstallerCachePath
}

$pawnIoInstallerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pawnIoInstallerCachePath).Hash
if ($pawnIoInstallerHash -ne $pawnIoInstallerExpectedHash) {
  throw "PawnIO installer hash mismatch. Expected $pawnIoInstallerExpectedHash but received $pawnIoInstallerHash"
}

$presentMonDownloadRequired = $true
if (Test-Path -LiteralPath $presentMonCachePath) {
  $presentMonCurrentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $presentMonCachePath).Hash
  $presentMonDownloadRequired = $presentMonCurrentHash -ne $presentMonExpectedHash
}

if ($presentMonDownloadRequired) {
  Invoke-WebRequest -Headers @{ 'User-Agent' = 'SiR-System-Monitor-Build' } -Uri $presentMonUrl -OutFile $presentMonCachePath
}

$presentMonHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $presentMonCachePath).Hash
if ($presentMonHash -ne $presentMonExpectedHash) {
  throw "PresentMon executable hash mismatch. Expected $presentMonExpectedHash but received $presentMonHash"
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
Get-ChildItem -LiteralPath $extractRoot -Filter '*.dll' | Copy-Item -Destination $outputRoot -Force
Copy-Item -LiteralPath $pawnIoInstallerCachePath -Destination (Join-Path $outputRoot 'PawnIO_setup.exe') -Force
Copy-Item -LiteralPath $presentMonCachePath -Destination (Join-Path $outputRoot 'PresentMon.exe') -Force
Copy-Item -LiteralPath $configPath -Destination (Join-Path $outputRoot 'SiR.SensorHost.exe.config') -Force
Copy-Item -LiteralPath $noticePath -Destination (Join-Path $outputRoot 'THIRD-PARTY-NOTICES.md') -Force
Copy-Item -LiteralPath $hardwareSupportPath -Destination (Join-Path $outputRoot 'HARDWARE-SUPPORT.md') -Force

$libraryPath = Join-Path $outputRoot 'LibreHardwareMonitorLib.dll'
$hidSharpPath = Join-Path $outputRoot 'HidSharp.dll'
$executablePath = Join-Path $outputRoot 'SiR.SensorHost.exe'

& $compilerPath `
  /nologo `
  /target:exe `
  /platform:x64 `
  /optimize+ `
  /out:$executablePath `
  /reference:System.Core.dll `
  /reference:System.Management.dll `
  /reference:System.Web.Extensions.dll `
  /reference:$libraryPath `
  /reference:$hidSharpPath `
  $sourcePaths

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $executablePath)) {
  throw 'Sensor host compilation failed.'
}

Write-Output "Built $executablePath"
