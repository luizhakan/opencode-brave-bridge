$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js >=20 não encontrado.' }
if ([int](& $node -p 'process.versions.node.split(".")[0]') -lt 20) { throw 'Node.js >=20 necessário.' }
foreach ($d in @('src','extension')) { if (-not (Test-Path (Join-Path $root $d))) { throw "Diretório $d ausente." } }
$data=Join-Path $env:LOCALAPPDATA 'opencode-brave-bridge'; $hostDir=Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\NativeMessagingHosts'
New-Item -ItemType Directory -Force $data,$hostDir | Out-Null
foreach ($d in @('src','extension')) { Remove-Item (Join-Path $data $d) -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item (Join-Path $root $d) (Join-Path $data $d) -Recurse }
$launcher=Join-Path $data 'launch-host.cmd'; Set-Content -Encoding ASCII $launcher "@echo off`r`n`"$node`" `"$data\src\index.js`" %*"
$m=Get-Content (Join-Path $data 'extension\manifest.json') -Raw | ConvertFrom-Json; $id=''
if ($m.key) { $b=[Convert]::FromBase64String($m.key); $h=[Security.Cryptography.SHA256]::Create().ComputeHash($b); $id=-join ($h[0..15] | ForEach-Object { ([char](97 + ($_ -shr 4))).ToString() + ([char](97 + ($_ -band 15))).ToString() }) } else { Write-Warning "Carregue $data\extension em brave://extensions e informe o ID exibido."; $id='INSIRA_ID_DA_EXTENSAO' }
$native=@{name='dev.opencode.brave_bridge';description='OpenCode Brave Bridge';path=$launcher;type='stdio';allowed_origins=@("chrome-extension://$id/")} | ConvertTo-Json -Depth 4
$file=Join-Path $hostDir 'dev.opencode.brave_bridge.json'; Set-Content -Encoding UTF8 $file $native
$key='HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.opencode.brave_bridge'; New-Item -Force $key | Out-Null; Set-ItemProperty $key '(default)' $file
if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode mcp add brave --global -- $launcher } else { Write-Host 'OpenCode CLI indisponível; consulte README.md.' }
