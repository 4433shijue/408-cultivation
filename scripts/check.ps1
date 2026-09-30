$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$nodeExe = 'E:\vibe coding\toolchains\node-v24.18.1-win-x64\node.exe'
if (!(Test-Path $nodeExe)) { $nodeExe = 'node' }
& $nodeExe node_modules/typescript/bin/tsc --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe node_modules/typescript/bin/tsc src/model.ts src/content.ts src/battle.ts src/companion/rules.ts --module commonjs --target es2022 --outDir work/rules --noEmit false --moduleResolution node --skipLibCheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Content work/rules/package.json '{"type":"commonjs"}' -Encoding utf8
& $nodeExe --test tests/rules.cjs tests/chapter.cjs tests/service.mjs tests/service-edge.mjs tests/companion-rules.cjs tests/companion-service.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe node_modules/vite/bin/vite.js build
exit $LASTEXITCODE
