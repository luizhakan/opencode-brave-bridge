$ErrorActionPreference='Continue'
if (-not $env:LOCALAPPDATA) { Write-Error 'LOCALAPPDATA não está definido.'; exit 1 }
$data=Join-Path $env:LOCALAPPDATA 'opencode-brave-bridge'; $hostFile=Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.opencode.brave_bridge.json'; $configFile=Join-Path $data 'host-config.json'
Get-Command node,opencode -ErrorAction SilentlyContinue | Format-Table Name,Source
if (Get-Command node -ErrorAction SilentlyContinue) { node --version }
foreach ($p in @((Join-Path $data 'src\host.js'),(Join-Path $data 'src\mcp.js'),(Join-Path $data 'launch-host.exe'),(Join-Path $data 'launch-mcp.cmd'),(Join-Path $data 'node_modules'),(Join-Path $data 'extension\manifest.json'),$configFile,$hostFile)) { if (Test-Path $p) { "OK $p" } else { "FALTA $p" } }
if (Test-Path $hostFile) { try { $manifest=Get-Content $hostFile -Raw | ConvertFrom-Json; $config=Get-Content $configFile -Raw | ConvertFrom-Json; if ($manifest.path -like '*.exe' -and -not $manifest.args -and (Test-Path $manifest.path) -and [IO.Path]::IsPathRooted($config.nodePath) -and [IO.Path]::IsPathRooted($config.hostPath) -and (Test-Path $config.nodePath) -and (Test-Path $config.hostPath)) { 'OK native host launcher and adjacent runtime config' } else { Write-Error 'Manifest/launcher/config paths are invalid.' } } catch { Write-Error "Manifest/config inválido: $_" } }
if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode mcp list }
