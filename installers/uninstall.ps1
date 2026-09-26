$ErrorActionPreference='Continue'; $data=Join-Path $env:LOCALAPPDATA 'opencode-brave-bridge'; $hostDir=Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\NativeMessagingHosts'
Remove-Item (Join-Path $hostDir 'dev.opencode.brave_bridge.json') -Force; Remove-Item 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.opencode.brave_bridge' -Recurse -Force; Remove-Item $data -Recurse -Force
if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode mcp remove brave --global }
Write-Host 'Bridge removida. Remova extensão manualmente em brave://extensions.'
