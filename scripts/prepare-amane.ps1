# Explicit build-time operation; never called by the desktop app.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This runtime build currently targets Windows.' }
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = Join-Path $repoRoot 'packages\amane\upstream'
$runtimeRoot = Join-Path $repoRoot 'resources\amane'
$buildRoot = Join-Path ([IO.Path]::GetTempPath()) ('yingbox-amane-' + [guid]::NewGuid().ToString('N'))
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'pyproject.toml'))) { throw 'Initialize the packages/amane/upstream submodule first.' }
$revision = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -ne 'e45b5867a93793fedca3bfed9c60b9ca2672e68b') { throw 'Expected the pinned Amane 0.20.1 source revision.' }
if (Test-Path -LiteralPath $runtimeRoot) { throw 'resources/amane already exists. Select a fresh output location or preserve the previous runtime before rebuilding.' }
New-Item -ItemType Directory -Path $buildRoot | Out-Null
Push-Location $sourceRoot
try {
  & uv sync --frozen --no-dev --group packaging --python 3.14
  if ($LASTEXITCODE -ne 0) { throw 'uv sync failed' }
  $pythonExe = Join-Path $sourceRoot '.venv\Scripts\python.exe'
  $pyinstallerExe = Join-Path $sourceRoot '.venv\Scripts\pyinstaller.exe'
  $stdlibArgs = @()
  & $pythonExe (Join-Path $sourceRoot 'scripts\stdlib_modules.py') | ForEach-Object {
    if ($_ -ne '') { $stdlibArgs += @('--collect-submodules', $_) }
  }
  if ($LASTEXITCODE -ne 0) { throw 'Standard library collection failed' }
  & $pyinstallerExe --noconfirm --onedir --console --name Amane.Server `
    --paths (Join-Path $sourceRoot 'src') `
    --add-data "$(Join-Path $sourceRoot 'src\amane\db\migrations');amane/db/migrations" `
    --add-data "$(Join-Path $sourceRoot 'src\amane\media\watermarks');amane/media/watermarks" `
    --add-data "$(Join-Path $sourceRoot 'alembic.ini');." `
    --collect-submodules amane --exclude-module patchright --exclude-module camoufox `
    --exclude-module playwright --exclude-module IPython --collect-all pydantic_ai `
    --collect-all pydantic_graph --collect-all genai_prices --collect-data zhconv `
    --hidden-import socksio @stdlibArgs --copy-metadata genai_prices `
    --copy-metadata pydantic_ai_slim --copy-metadata amane `
    --distpath (Join-Path $buildRoot 'runtime') --workpath (Join-Path $buildRoot 'work') `
    --specpath $buildRoot (Join-Path $sourceRoot 'scripts\pyinstaller_entry.py')
  if ($LASTEXITCODE -ne 0) { throw 'Amane backend packaging failed' }
  New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $buildRoot 'runtime\Amane.Server') -Destination (Join-Path $runtimeRoot 'onedir') -Recurse
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'LICENSE') -Destination (Join-Path $runtimeRoot 'LICENSE')
  Copy-Item -LiteralPath (Join-Path $repoRoot 'packages\amane\README.md') -Destination (Join-Path $runtimeRoot 'SOURCE.md')
  $sourceArchive = Join-Path $runtimeRoot 'amane-0.20.1-source.zip'
  & git -C $sourceRoot archive --format=zip "--output=$sourceArchive" HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Could not produce corresponding Amane source archive' }
  Write-Output "Amane 0.20.1 runtime prepared at $runtimeRoot"
} finally { Pop-Location }
