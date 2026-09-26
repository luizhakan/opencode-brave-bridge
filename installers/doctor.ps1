$ErrorActionPreference='Continue'; $data=Join-Path $env:LOCALAPPDATA 'opencode-brave-bridge'; $hostFile=Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.opencode.brave_bridge.json'
Get-Command node,opencode -ErrorAction SilentlyContinue | Format-Table Name,Source; node --version
foreach ($p in @((Join-Path $data 'src\index.js'),(Join-Path $data 'extension\manifest.json'),$hostFile)) { if (Test-Path $p) { "OK $p" } else { "FALTA $p" } }
if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode mcp list }
