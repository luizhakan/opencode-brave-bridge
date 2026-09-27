$ErrorActionPreference='Continue'
if (-not $env:LOCALAPPDATA) { Write-Error 'LOCALAPPDATA não está definido.'; exit 1 }
$data=Join-Path $env:LOCALAPPDATA 'opencode-brave-bridge'; $hostDir=Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\NativeMessagingHosts'
Remove-Item (Join-Path $hostDir 'dev.opencode.brave_bridge.json') -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.opencode.brave_bridge' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode mcp remove brave --global 2>$null }
Write-Host 'Bridge removida. Remova extensão manualmente em brave://extensions.'
