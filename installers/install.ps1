param([string]$ExtensionId)
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA não está definido.' }
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js >=20 não encontrado.' }
if ([int](& $node -p 'process.versions.node.split(".")[0]') -lt 20) { throw 'Node.js >=20 necessário.' }
foreach ($d in @('src','extension')) { if (-not (Test-Path (Join-Path $root $d))) { throw "Diretório $d ausente." } }
$data=Join-Path $env:LOCALAPPDATA 'opencode-brave-bridge'; $hostDir=Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\NativeMessagingHosts'
New-Item -ItemType Directory -Force $data,$hostDir | Out-Null
foreach ($d in @('src','extension')) { Remove-Item (Join-Path $data $d) -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item (Join-Path $root $d) (Join-Path $data $d) -Recurse }
Copy-Item (Join-Path $root 'package.json') (Join-Path $data 'package.json') -Force
if (Test-Path (Join-Path $root 'package-lock.json')) { Copy-Item (Join-Path $root 'package-lock.json') (Join-Path $data 'package-lock.json') -Force; Push-Location $data; try { npm ci --omit=dev } finally { Pop-Location } }
else { Push-Location $data; try { npm install --omit=dev } finally { Pop-Location } }
$hostLauncher=Join-Path $data 'launch-host.exe'; $mcpLauncher=Join-Path $data 'launch-mcp.cmd'
$compilerSource=Join-Path $PSScriptRoot 'host-launcher.cs'
if (-not (Test-Path $compilerSource)) { throw "Fonte do launcher ausente: $compilerSource" }
try { Add-Type -TypeDefinition (Get-Content $compilerSource -Raw) -Language CSharp -ReferencedAssemblies @([System.Runtime.Serialization.Json.DataContractJsonSerializer].Assembly.Location,[System.Runtime.Serialization.DataContractAttribute].Assembly.Location) -OutputAssembly $hostLauncher -OutputType ConsoleApplication -ErrorAction Stop }
catch { throw "Não foi possível compilar o launcher nativo. Use Windows PowerShell 5.1 ou PowerShell 7 para Windows com Add-Type compatível. Erro: $($_.Exception.Message)" }
$hostJs=[IO.Path]::GetFullPath((Join-Path $data 'src\host.js')); $mcpJs=[IO.Path]::GetFullPath((Join-Path $data 'src\mcp.js'))
@{nodePath=[IO.Path]::GetFullPath($node);hostPath=$hostJs} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $data 'host-config.json')
Set-Content -Encoding ASCII $mcpLauncher "@echo off`r`n`"$node`" `"$mcpJs`" %*`r`n"
$m=Get-Content (Join-Path $data 'extension\manifest.json') -Raw | ConvertFrom-Json
if (-not $m.key -and -not $ExtensionId) { throw 'manifest.key ausente; carregue a extensão e informe -ExtensionId <ID>.' }
if ($m.key) { $b=[Convert]::FromBase64String($m.key); $h=[Security.Cryptography.SHA256]::Create().ComputeHash($b); $id=-join ($h[0..15] | ForEach-Object { ([char](97 + ($_ -shr 4))).ToString() + ([char](97 + ($_ -band 15))).ToString() }) } else { $id=$ExtensionId }
if ($id -cnotmatch '^[a-p]{32}$') { throw 'ID inválido (esperado 32 letras a-p).' }
$file=Join-Path $hostDir 'dev.opencode.brave_bridge.json'
$native=[ordered]@{name='dev.opencode.brave_bridge';description='OpenCode Brave Bridge';path=$hostLauncher;type='stdio';allowed_origins=@("chrome-extension://$id/")}
$native | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $file
$key='HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.opencode.brave_bridge'; New-Item -Force $key | Out-Null; Set-Item -Path $key -Value $file
if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode mcp add brave --global -- $mcpLauncher } else { Write-Host "OpenCode CLI ausente; execute opencode mcp add brave --global -- `"$mcpLauncher`"" }
Write-Host "Instalado em $data"
