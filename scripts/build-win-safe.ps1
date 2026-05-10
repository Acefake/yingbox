$ErrorActionPreference = 'Stop'

$source = (Resolve-Path '.').Path
$targetRoot = 'C:\yingbox-build'
$target = Join-Path $targetRoot 'poster-scraper'

Write-Host 'Preparing clean ASCII build directory...'
if (Test-Path $target) {
  Remove-Item -Recurse -Force $target
}
New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

$excludeDirs = @('node_modules', 'dist', 'out', '.git')
$excludeFiles = @('build.log', 'build2.log')

Write-Host "Copying project to $target ..."
robocopy $source $target /MIR /XD $excludeDirs /XF $excludeFiles | Out-Host
$code = $LASTEXITCODE
if ($code -ge 8) {
  throw "robocopy failed with exit code $code"
}

Write-Host 'Installing dependencies...'
pushd $target
pnpm install
pnpm run postinstall

Write-Host 'Building Windows installer...'
pnpm run build:win
popd

Write-Host 'Copying build artifacts back to original dist directory...'
$sourceDist = Join-Path $target 'dist'
$destDist = Join-Path $source 'dist'
if (Test-Path $destDist) {
  Remove-Item -Recurse -Force $destDist
}
Copy-Item -Recurse -Force $sourceDist $destDist

Write-Host "Done. Artifacts copied to: $destDist"
