/**
 * 外部工具定位：lada-cli / ffmpeg / ffprobe 的自动探测与用户覆盖（lada.json）。
 */
import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, promises as fs, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { LadaPaths } from '../../../shared/lada'
import { type Overrides, sanitizeOverrides } from './rules'

let overrides: Overrides = {}

const settingsPath = (): string => join(app.getPath('userData'), 'lada.json')

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

/** lada-cli：环境变量 → 用户覆盖 → 常见安装位置 */
export function detectCli(): string {
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

/** ffmpeg：环境变量 → 用户覆盖 → PATH → 常见安装位置 */
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

/** 当前生效的工具路径（供设置页、整片任务、边跑边看、续跑共用） */
export function ladaPaths(): LadaPaths {
  return {
    cli: detectCli(),
    ffmpeg: detectFfmpeg(),
    cliOverridden: Boolean(overrides.cli),
    ffmpegOverridden: Boolean(overrides.ffmpeg),
  }
}

/** 启动时读入路径覆盖 */
export async function loadOverrides(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as unknown
    const clean = sanitizeOverrides(raw)
    if (clean) overrides = clean
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
  return ladaPaths()
}

/** 与 ffmpeg 同目录的 ffprobe；找不到就退回 PATH 上的 ffprobe。 */
export function ffprobeFor(ffmpeg: string): string {
  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  if (ffmpeg && ffmpeg !== 'ffmpeg') {
    const sibling = join(dirname(ffmpeg), name)
    if (existsSync(sibling)) return sibling
  }
  return name
}
