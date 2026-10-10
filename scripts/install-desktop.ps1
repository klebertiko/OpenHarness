param(
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
  $InstallerPath = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis\OpenHarness_0.1.0_x64-setup.exe"
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\OpenHarness"
$installer = Start-Process -FilePath $resolvedInstaller `
  -ArgumentList @("/S", "/D=$installRoot") `
  -PassThru `
  -Wait `
  -WindowStyle Hidden
if ($installer.ExitCode -ne 0) {
  throw "OpenHarness installer failed with code $($installer.ExitCode)"
}

$appPath = Join-Path $installRoot "openharness.exe"
# Windows caches shell icons (taskbar, Start, jump list on right-click). An
# upgrade in place keeps the stale icon until that cache is refreshed.
$ie4uinit = Join-Path $env:SystemRoot "System32\ie4uinit.exe"
if (Test-Path -LiteralPath $ie4uinit) {
  & $ie4uinit -show
}
if (-not (Test-Path -LiteralPath $appPath)) {
  throw "Installed OpenHarness executable was not found at $appPath"
}

$smoke = & powershell -NoProfile -ExecutionPolicy Bypass `
  -File (Join-Path $PSScriptRoot "smoke-desktop.ps1") `
  -AppPath $appPath
if ($LASTEXITCODE -ne 0) {
  throw "Installed OpenHarness smoke failed"
}

[pscustomobject]@{
  installer = $resolvedInstaller
  installer_exit = $installer.ExitCode
  installed_app = (Resolve-Path -LiteralPath $appPath).Path
  smoke = ($smoke | ConvertFrom-Json)
} | ConvertTo-Json -Compress -Depth 4
