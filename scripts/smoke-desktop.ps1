param(
  [string]$AppPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppPath)) {
  $AppPath = Join-Path $PSScriptRoot "..\src-tauri\target\release\openharness.exe"
}

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$appDirectory = Split-Path -Parent $resolvedApp
$sidecarPath = (Resolve-Path -LiteralPath (Join-Path $appDirectory "openharness-sidecar.exe")).Path

$existingApp = @(Get-CimInstance Win32_Process -Filter "Name = 'openharness.exe'")
$existingSidecars = @(Get-CimInstance Win32_Process -Filter "Name = 'openharness-sidecar.exe'" |
  Where-Object { $_.ExecutablePath -eq $sidecarPath })
if ($existingApp.Count -gt 0 -or $existingSidecars.Count -gt 0) {
  $runningPaths = @($existingApp | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ }) -join ", "
  throw "Desktop smoke requires no existing OpenHarness process because the app is single-instance. Close: $runningPaths"
}

$debugListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$debugListener.Start()
$debugPort = ($debugListener.LocalEndpoint).Port
$debugListener.Stop()
$previousWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort"
$app = Start-Process -FilePath $resolvedApp -PassThru -WindowStyle Hidden
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments
try {
  $listener = $null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($app.HasExited) {
      throw "OpenHarness exited during startup with code $($app.ExitCode)"
    }

    $sidecars = @(Get-CimInstance Win32_Process -Filter "Name = 'openharness-sidecar.exe'" |
      Where-Object { $_.ExecutablePath -eq $sidecarPath })
    if ($sidecars.Count -gt 0) {
      $sidecarPids = $sidecars.ProcessId
      $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object {
          $sidecarPids -contains $_.OwningProcess -and
          $_.LocalAddress -in @("127.0.0.1", "::1")
        } |
        Select-Object -First 1
      if ($null -ne $listener) { break }
    }
    Start-Sleep -Milliseconds 250
  }

  if ($null -eq $listener) {
    throw "OpenHarness sidecar did not expose a loopback listener"
  }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($listener.LocalPort)/health" -TimeoutSec 3
  if ($health.status -ne "ok") {
    throw "OpenHarness sidecar health was '$($health.status)'"
  }

  $webView = & node (Join-Path $PSScriptRoot "check-webview.mjs") $debugPort
  if ($LASTEXITCODE -ne 0) {
    throw "OpenHarness WebView did not render"
  }

  if (-not $app.CloseMainWindow()) {
    throw "OpenHarness did not expose a closable main window"
  }
  $app.WaitForExit(10000) | Out-Null
  if (-not $app.HasExited) {
    throw "OpenHarness did not exit after its main window closed"
  }

  Start-Sleep -Seconds 2
  $remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'openharness-sidecar.exe'" |
    Where-Object { $_.ExecutablePath -eq $sidecarPath })
  if ($remaining.Count -ne 0) {
    throw "OpenHarness left $($remaining.Count) sidecar process(es) after exit"
  }
  if (
    (Test-Path -LiteralPath (Join-Path $appDirectory "harness.db")) -or
    (Test-Path -LiteralPath (Join-Path $appDirectory "secrets"))
  ) {
    throw "OpenHarness wrote persistent user data into its installation directory"
  }

  [pscustomobject]@{
    app = $resolvedApp
    health = $health.status
    loopback = $listener.LocalAddress
    port = $listener.LocalPort
    webview = ($webView | ConvertFrom-Json)
    app_closed = $true
    remaining_sidecars = 0
    install_directory_clean = $true
  } | ConvertTo-Json -Compress
}
finally {
  if (-not $app.HasExited) {
    Stop-Process -Id $app.Id -Force
  }
  @(Get-CimInstance Win32_Process -Filter "Name = 'openharness-sidecar.exe'" |
    Where-Object { $_.ExecutablePath -eq $sidecarPath }) |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
