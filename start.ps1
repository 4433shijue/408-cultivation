$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodeExe = 'E:\vibe coding\toolchains\node-v24.18.1-win-x64\node.exe'
if (!(Test-Path $nodeExe)) { $nodeExe = 'node' }
$version = & $nodeExe -p "Number(process.versions.node.split('.')[0])"
if ([int]$version -lt 24) { throw '请安装 Node.js 24 后再启动。' }
if (!(Test-Path 'node_modules')) { & $nodeExe ((Split-Path (Get-Command $nodeExe).Source) + '\node_modules\npm\bin\npm-cli.js') ci }
& $nodeExe node_modules/typescript/bin/tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw '类型检查失败' }
& $nodeExe node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
try {
    $existing = Invoke-RestMethod 'http://127.0.0.1:4175/api/status' -TimeoutSec 2
    if ($null -ne $existing.available) { Start-Process 'http://127.0.0.1:4175/'; exit 0 }
} catch { }
& $nodeExe server/index.mjs --open
