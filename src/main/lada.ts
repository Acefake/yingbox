import { app } from 'electron'
import { type ChildProcess, execFileSync, spawn } from 'child_process'
import { existsSync, promises as fs, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { LadaJob, LadaPaths } from '../shared/lada'
import { parseLadaLine, restoredPathFor } from '../shared/lada'
import { type JobLock, acquireLock, clearStaleLock, readLock, releaseLock } from './lada-lock'
import { emit } from './rpc'
import { lada } from '../shared/contract/lada'

/**
 * 去马赛克（lada）调度。
 *
 * lada 是 AGPL-3.0 的独立外部工具，这里只以子进程方式调用它，不打包、不链接。
 * 职责：找到 lada-cli / ffmpeg → 起任务 → 解析进度 → 完成后交出 .restored.mp4。
 * 单并发：6GB 显存只够跑一个。
 */

/** 允许处理的视频扩展名 */
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.m4v', '.ts', '.m2ts', '.flv', '.webm']
/** 与用户确认过的默认编码预设（NVIDIA 硬件编码） */
const ENCODING_PRESET = 'hevc-nvidia-gpu-hq'

type Overrides = { cli?: string; ffmpeg?: string }

let overrides: Overrides = {}
let job: LadaJob | null = null
let child: ChildProcess | null = null
/** lada 进程真的退出的信号（见 waitForLadaExit） */
let childExit: Promise<void> | null = null
let cancelled = false

const settingsPath = (): string => join(app.getPath('userData'), 'lada.json')
const tempDir = (): string => join(app.getPath('temp'), 'yingbox-lada')

/** 扫描常见的 ffmpeg 安装位置（只看顶层目录，不递归） */
function scanFfmpeg(): string {
  const roots = [
    process.env['ProgramFiles'],
    process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'Programs') : '',
    'C:\\',
    process.env['USERPROFILE'],
  ].filter((v): v is string => Boolean(v))
  for (const root of roots) {
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!/^ffmpeg/i.test(name)) continue
      const candidate = join(root, name, 'bin', 'ffmpeg.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

function detectCli(): string {
  const fromEnv = process.env['YINGBOX_LADA_CLI']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (overrides.cli && existsSync(overrides.cli)) return overrides.cli
  const candidates = [
    process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'lada', 'lada', 'lada-cli.exe') : '',
    'C:\\lada\\lada-cli.exe',
    'C:\\lada\\lada\\lada-cli.exe',
  ].filter(Boolean)
  return candidates.find(p => existsSync(p)) || ''
}

function detectFfmpeg(): string {
  const fromEnv = process.env['YINGBOX_FFMPEG']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (overrides.ffmpeg && existsSync(overrides.ffmpeg)) return overrides.ffmpeg
  try {
    execFileSync('ffmpeg', ['-version'], { timeout: 3000, stdio: 'pipe' })
    return 'ffmpeg'
  } catch {
    /* 继续找 */
  }
  return scanFfmpeg()
}

function paths(): LadaPaths {
  return {
    cli: detectCli(),
    ffmpeg: detectFfmpeg(),
    cliOverridden: Boolean(overrides.cli),
    ffmpegOverridden: Boolean(overrides.ffmpeg),
  }
}

/** 供「边跑边看」等其它模块使用 */
export { paths as ladaPaths }

/** lada 在临时目录里写的"纯视频半成品"路径（与它内部的命名规则一致） */
export function ladaTempVideo(output: string): string {
  const name = output.split(/[/\\]/).pop() || ''
  const base = name.replace(/\.[^.]+$/, '')
  const ext = name.slice(name.lastIndexOf('.'))
  return join(tempDir(), `${base}.tmp${ext}`)
}

/** 当前任务快照（追播用来判断 lada 是否已结束） */
export function currentJob(): LadaJob | null {
  return snapshot()
}

async function loadOverrides(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Overrides
    if (raw && typeof raw === 'object') {
      overrides = {
        ...(typeof raw.cli === 'string' && isAbsolute(raw.cli) ? { cli: raw.cli } : {}),
        ...(typeof raw.ffmpeg === 'string' && isAbsolute(raw.ffmpeg) ? { ffmpeg: raw.ffmpeg } : {}),
      }
    }
  } catch {
    /* 首次运行没有该文件 */
  }
}

async function saveOverrides(): Promise<void> {
  const file = settingsPath()
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(overrides, null, 2), { mode: 0o600 })
  await fs.rename(temp, file)
}

/** 快照，避免把内部可变对象直接发给渲染层 */
export const snapshot = (): LadaJob | null => (job ? { ...job } : null)

/** 校验输入：必须是存在的本地视频文件 */
function validateInput(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('缺少文件路径')
  const filePath = input.trim()
  if (!isAbsolute(filePath)) throw new Error('必须是绝对路径')
  if (!existsSync(filePath)) throw new Error('文件不存在')
  if (!statSync(filePath).isFile()) throw new Error('不是文件')
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  if (!VIDEO_EXTS.includes(ext)) throw new Error(`不支持的格式：${ext || '未知'}`)
  return filePath
}

function dropFile(file: string): void {
  // 进程刚被杀时文件可能还被占着，重试几次，别把垃圾留下
  let attempt = 0
  const retry = (): void => {
    attempt += 1
    try {
      rmSync(file, { force: true })
    } catch {
      if (attempt < 6) setTimeout(retry, 400)
    }
  }
  retry()
}

function cleanupTemp(output: string): void {
  try {
    const tmp = ladaTempVideo(output)
    if (existsSync(tmp)) dropFile(tmp)
    // 归属记录跟着半成品一起清，否则 %TEMP% 里会攒一堆没人认的小文件
    const sidecar = `${tmp}.owner.json`
    if (existsSync(sidecar)) dropFile(sidecar)
  } catch {
    /* 清理失败不影响主流程；下次启动会清扫 */
  }
}

/** lada 临时目录（也用于放续跑的进度记录） */
export function tempDirPath(): string {
  return tempDir()
}

/** 启动时清扫：过期锁与**无主的**半成品临时视频 */
function sweepOrphans(): void {
  try {
    clearStaleLock(tempDir())
    // 别的实例正在跑就别动它的文件
    const lock = readLock(tempDir())
    if (lock && lock.pid !== process.pid) return
    let names: string[] = []
    try {
      names = readdirSync(tempDir())
    } catch {
      return
    }
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const name of names) {
      // 归属记录对应的半成品已经没了，这条记录本身就是垃圾
      if (/\.owner\.json$/i.test(name)) {
        const video = join(tempDir(), name.slice(0, -'.owner.json'.length))
        if (!existsSync(video)) {
          try {
            rmSync(join(tempDir(), name), { force: true })
          } catch {
            /* 下次再说 */
          }
        }
        continue
      }
      if (!/\.tmp\./i.test(name)) continue
      const file = join(tempDir(), name)
      // 带"归属记录"的半成品是**能续跑的成果**，交给续跑模块认领，绝不删
      if (existsSync(`${file}.owner.json`)) continue
      try {
        if (statSync(file).mtimeMs > cutoff) continue
        rmSync(file, { force: true })
      } catch {
        /* 占用中就留给下次 */
      }
    }

    // 「边跑边看」的分片目录只是看的时候的缓存（分片随时能重新切），但一个会话
    // 能攒到几个 G。正常停止会自己删；崩溃/被杀就会留下，所以这里兜底清掉。
    // 门槛设 6 小时：绝不会碰到别的窗口正在看的会话（那时它随时在写新分片）。
    const liveRoot = join(tempDir(), 'live')
    const liveCutoff = Date.now() - 6 * 60 * 60 * 1000
    try {
      for (const name of readdirSync(liveRoot)) {
        const dir = join(liveRoot, name)
        try {
          if (statSync(dir).mtimeMs > liveCutoff) continue
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* 占用中就留给下次 */
        }
      }
    } catch {
      /* 没有 live 目录就算了 */
    }
  } catch {
    /* 清扫失败不影响主流程 */
  }
}

function finish(state: LadaJob['state'], error?: string): void {
  if (!job) return
  job.state = state
  job.finishedAt = Date.now()
  if (error) job.error = error
  if (state === 'done') {
    job.percent = 100
    // lada 自己会删掉临时视频，但归属记录是影盒写的，成功时也得收掉
    const sidecar = `${ladaTempVideo(job.output)}.owner.json`
    if (existsSync(sidecar)) dropFile(sidecar)
  } else {
    cleanupTemp(job.output)
  }
  const done = snapshot()
  child = null
  releaseLock(tempDir(), process.pid)
  emit(lada, 'progress', done)
  emit(lada, 'finished', done)
  if (done) for (const cb of finishedListeners) {
    try {
      cb(done)
    } catch {
      /* 监听者出错不影响别人 */
    }
  }
}

/** 主进程内部监听任务结束（续跑要靠它在跑完剩余部分后自动拼接） */
const finishedListeners: ((job: LadaJob) => void)[] = []
export function onJobFinished(cb: (job: LadaJob) => void): void {
  finishedListeners.push(cb)
}

/** 启动一个去码任务（供 IPC 与「边跑边看」共用） */
export function startJob(input: string, opts?: { source?: string; output?: string }): LadaJob {
  const cli = detectCli()
  if (!cli) throw new Error('没找到 lada-cli，请在设置里指定路径（或在环境变量 YINGBOX_LADA_CLI 里给出）')
  const source = opts?.source ?? input
  const outputPath = opts?.output ?? restoredPathFor(input)
  // 机器级单任务：另一个影盒实例（甚至另一个窗口）在跑时也要拦住，否则两个 lada
  // 会一起抢显存互相打死（真实踩过）
  const foreign = readLock(tempDir())
  if (foreign) {
    const name = foreign.input ? foreign.input.split(/[\\/]/).pop() : ''
    throw new Error(`已有一个去码任务在跑${name ? `：${name}` : ''}（可能来自另一个影盒窗口），请等它结束`)
  }
  if (!acquireLock(tempDir(), { pid: process.pid, input, startedAt: Date.now(), tag: app.getName() })) {
    throw new Error('已有一个去码任务在跑（可能来自另一个影盒窗口），请等它结束')
  }
  try {
    mkdirSync(tempDir(), { recursive: true })
  } catch {
    /* 交给 lada 自己创建 */
  }
  // 记下"这份半成品属于哪个源文件"，这样即使进程被杀，下次启动也能把它
  // 认领成可续跑的进度，而不是当垃圾删掉（这个坑真实踩过）
  try {
    writeFileSync(`${ladaTempVideo(outputPath)}.owner.json`,
      JSON.stringify({ input, source, output: outputPath, startedAt: Date.now() }))
  } catch {
    /* 记录失败不影响跑任务 */
  }

  const output = outputPath
  cancelled = false
  job = {
    state: 'running',
    input,
    output,
    percent: null,
    fps: null,
    frames: null,
    message: '正在启动 lada（首次加载模型约 20-40 秒）…',
    startedAt: Date.now(),
  }
  emit(lada, 'progress', snapshot())

  const service = spawn(
    cli,
    [
      '--input', source,
      '--output', output,
      '--temporary-directory', tempDir(),
      '--encoding-preset', ENCODING_PRESET,
      '--mp4-fast-start',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  child = service
  // 记录"进程真的退出"这件事：taskkill 返回 ≠ lada 已经没了。
  // 谁要在杀掉之后马上再起一个 lada，必须等这个（否则两个 lada 抢显存一起死）。
  childExit = new Promise<void>(resolve => {
    service.once('close', () => resolve())
  })

  let buffer = ''
  let lastEmit = 0
  const onChunk = (chunk: Buffer | string): void => {
    buffer += chunk.toString()
    // tqdm 用 \r 刷新同一行，所以 \r 和 \n 都要当分隔符
    const parts = buffer.split(/[\r\n]/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const parsed = parseLadaLine(part)
      if (!job) continue
      if (parsed.percent !== undefined) job.percent = parsed.percent
      if (parsed.fps !== undefined) job.fps = parsed.fps
      if (parsed.frames !== undefined) job.frames = parsed.frames
      if (parsed.message) job.message = parsed.message
    }
    const now = Date.now()
    if (now - lastEmit > 150) {
      lastEmit = now
      emit(lada, 'progress', snapshot())
    }
  }
  service.stdout?.on('data', onChunk)
  service.stderr?.on('data', onChunk)

  service.once('error', err => {
    if (job && job.state === 'running') finish('failed', `lada 启动失败：${err.message}`)
  })
  service.once('exit', code => {
    if (!job || job.state !== 'running') return
    if (cancelled) return finish('cancelled')
    if (code === 0 && existsSync(output)) return finish('done')
    finish('failed', job.message ? `lada 退出（代码 ${code}）：${job.message}` : `lada 退出（代码 ${code}）`)
  })

  return { ...job }
}

function cancelJob(): void {
  if (!child || !job) return
  cancelled = true
  const pid = child.pid
  if (pid && process.platform === 'win32') {
    // lada 是 PyInstaller 打包的，会带子进程，整棵树一起收
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.once('error', () => {
      try {
        child?.kill()
      } catch {
        /* ignore */
      }
      finish('cancelled')
    })
    killer.once('exit', () => finish('cancelled'))
    return
  }
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  finish('cancelled')
}

/** 播放时优先选择已修复的产物 */
export function playablePath(input: unknown): { path: string; restored: boolean } {
  const filePath = validateInput(input)
  const restored = restoredPathFor(filePath)
  return existsSync(restored) ? { path: restored, restored: true } : { path: filePath, restored: false }
}

export function cancelCurrentJob(): void {
  cancelJob()
}

/**
 * 等当前 lada 进程**真的**退出，最多等 20 秒。
 * `taskkill` 一返回 `cancelJob` 就会把状态改成 cancelled，但那时进程往往还在收尾——
 * 此时立刻再起一个 lada，两个会一起抢显存互相打死（6GB 卡上必现，已实测）。
 */
export async function waitForLadaExit(): Promise<void> {
  const pending = childExit
  if (pending) {
    await Promise.race([pending, new Promise<void>(resolve => setTimeout(resolve, 20_000))])
  }
  // 再给驱动一点回收显存的时间
  await new Promise<void>(resolve => setTimeout(resolve, 1_000))
}

/** 覆盖 lada-cli / ffmpeg 路径（空串 = 恢复自动探测），校验后持久化 */
export async function setPathOverrides(changes: Overrides): Promise<LadaPaths> {
  const next: Overrides = { ...overrides }
  for (const key of ['cli', 'ffmpeg'] as const) {
    const value = changes[key]
    if (value === undefined) continue
    const text = String(value).trim()
    if (!text) delete next[key]
    else if (!isAbsolute(text)) throw new Error('必须填绝对路径')
    else if (!existsSync(text)) throw new Error(`路径不存在：${text}`)
    else next[key] = text
  }
  overrides = next
  await saveOverrides()
  return paths()
}

/** 发起整片去码；已有任务在跑时返回失败 */
export function startTask(input: string): { success: boolean; job?: LadaJob; error?: string } {
  try {
    if (job && job.state === 'running') throw new Error('已有一个去码任务在跑，请先取消')
    return { success: true, job: startJob(validateInput(input)) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 别的影盒实例是否正在跑任务（跨实例可见）——界面据此提示用户 */
export function otherInstanceJob(): JobLock | null {
  const lock = readLock(tempDir())
  return lock && lock.pid !== process.pid ? lock : null
}

/** 启动时加载路径覆盖、清扫上次遗留的临时文件，并在退出时取消任务 */
export async function initLada(): Promise<void> {
  await loadOverrides()
  sweepOrphans()
  app.on('before-quit', () => {
    if (job?.state === 'running') cancelJob()
  })
}
