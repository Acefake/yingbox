# 影盒 × lada 修复效果对比工具
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\lada-compare.ps1 "E:\片子.mp4"
#   powershell -ExecutionPolicy Bypass -File scripts\lada-compare.ps1 "E:\片子.mp4" -At 42:00 -Seconds 20
#
# 它做四件事：
#   1. 从 -At 时刻起切 -Seconds 秒（默认 20 秒）的小片段
#   2. 用 lada 跑一遍修复
#   3. 从原片段和修复片段各截一帧，并排拼成 compare.png
#   4. 自动打开这张图（左=原片，右=修复后）
#
# 只读你的原文件；所有中间产物都在临时目录，跑完会打印路径。

param(
  [Parameter(Mandatory = $true)][string]$Video,
  [string]$At = '0:30',
  [int]$Seconds = 20,
  [string]$Ffmpeg = ''
)

$ErrorActionPreference = 'Stop'

function Find-Exe($name, $fallbacks) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($f in $fallbacks) { if ($f -and (Test-Path $f)) { return $f } }
  return $null
}

$FF = if ($Ffmpeg) { $Ffmpeg } else {
  Find-Exe 'ffmpeg' @('C:\ffmpeg-2026-04-19-git-de18feb0f0-full_build\bin\ffmpeg.exe')
}
if (-not $FF -or -not (Test-Path $FF)) { throw "找不到 ffmpeg。用 -Ffmpeg 指定路径。" }
$FP = Join-Path (Split-Path $FF) 'ffprobe.exe'
if (-not (Test-Path $FP)) { $FP = $null }

$CLI = Join-Path $env:LOCALAPPDATA 'lada\lada\lada-cli.exe'
if (-not (Test-Path $CLI)) { throw "找不到 lada-cli：$CLI（请先安装 lada）" }
if (-not (Test-Path $Video)) { throw "找不到视频：$Video" }

$work = Join-Path $env:TEMP 'yingbox-lada-compare'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
$slice = Join-Path $work 'slice.mp4'
$out = Join-Path $work 'restored.mp4'
$frameA = Join-Path $work 'frame-original.png'
$frameB = Join-Path $work 'frame-restored.png'
$cmp = Join-Path $work 'compare.png'

Write-Host "[1/4] 切片 $At 起 $Seconds 秒 …"
& $FF -y -loglevel error -ss $At -i $Video -t $Seconds -c copy -avoid_negative_ts make_zero $slice
if (-not (Test-Path $slice)) { throw "切片失败" }
Write-Host ("      片段 {0:N1} MB" -f ((Get-Item $slice).Length / 1MB))

Write-Host "[2/4] 跑 lada 修复（首次启动模型约 20-40 秒，请耐心）…"
$t0 = Get-Date
$ladaLog = Join-Path $work 'lada.log'
# 注意：lada 把进度写进 stderr。$ErrorActionPreference='Stop' 会把原生命令的 stderr
# 当成终止性错误，所以这里临时放开，并把 stderr 落到日志文件。
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $CLI --input $slice --output $out --encoding-preset hevc-nvidia-gpu-hq --mp4-fast-start 2>$ladaLog | Out-Null
$ladaExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$cost = ((Get-Date) - $t0).TotalSeconds
if (-not (Test-Path $out)) { throw "lada 没有产出结果（退出码 $ladaExit）。日志：$ladaLog" }
Write-Host ("      完成，用时 {0:N1} 秒（{1:N1}x 实时）" -f $cost, ($cost / $Seconds))

Write-Host "[3/4] 截取同一时刻的两帧 …"
$mid = [math]::Round($Seconds / 2, 1)
& $FF -y -loglevel error -ss $mid -i $slice -frames:v 1 $frameA
& $FF -y -loglevel error -ss $mid -i $out -frames:v 1 $frameB
if (-not (Test-Path $frameA) -or -not (Test-Path $frameB)) { throw "截帧失败" }

Write-Host "[4/4] 拼接对比图 …"
& $FF -y -loglevel error -i $frameA -i $frameB -filter_complex "[0:v][1:v]hstack=inputs=2" $cmp
if (-not (Test-Path $cmp)) { throw "拼接失败" }

Write-Host ""
Write-Host "对比图（左=原片，右=修复后）：$cmp"
Write-Host "单帧也保留了："
Write-Host "  原片   $frameA"
Write-Host "  修复后 $frameB"
Write-Host "修复后的完整片段：$out"
Write-Host ""
Invoke-Item $cmp
