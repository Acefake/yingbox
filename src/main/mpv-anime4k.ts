/**
 * mpv 的 Anime4K 超分：按需下载官方着色器（userData/anime4k/<版本>/，SHA-256 校验），
 * 按设置与当前条目通过 mpv 的 glsl-shaders 属性挂载 / 清除。
 *
 * 规则（模式 → 着色器列表、是否启用）在 src/shared/anime4k.ts；这里只管下载、落盘与发 mpv 命令。
 * 用 `change-list glsl-shaders clr` + 逐个 `append`，避开列表分隔符（Windows 是 ;，其它平台是 :）与路径冲突。
 * 下载或挂载失败只在 mpv 窗口提示，不影响播放。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ANIME4K_FILES,
  ANIME4K_LICENSE,
  ANIME4K_OFF,
  ANIME4K_VERSION,
  type Anime4kConfig,
  type Anime4kFile,
  anime4kLabel,
  anime4kShaders,
  anime4kSourceUrls,
  shouldApplyAnime4k,
} from '../shared/anime4k'
import { fetchHttp, readLimited } from './http-client'

/** 单个着色器最大体积（最大的 VL 约 150 KB）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** 提示在 mpv 窗口停留的时长。 */
const OSD_MS = 3000

/** 发一条 mpv 命令。 */
type MpvCommand = (...args: unknown[]) => Promise<unknown>

const sha256 = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

/**
 * 着色器目录 userData/anime4k/<版本>/。
 * electron 按需加载：mpv-player 引用本模块，它的单测不启动 Electron。
 */
export async function anime4kDir(): Promise<string> {
  const { app } = await import('electron')
  return join(app.getPath('userData'), 'anime4k', ANIME4K_VERSION)
}

/** 依次从各个来源下载，校验通过就返回内容；全部失败抛最后一个错误。 */
async function download(repoPath: string, expected: string): Promise<Buffer> {
  let lastError: unknown = new Error('没有可用的下载地址')
  for (const url of anime4kSourceUrls(repoPath)) {
    try {
      const response = await fetchHttp(url, {}, 20000)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await readLimited(response, MAX_FILE_BYTES)
      if (sha256(body) !== expected) throw new Error('校验值不符')
      return body
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/** 确保文件在目录里且校验值正确，缺了就下载（先写临时文件再改名）。 */
async function ensureFile(
  dir: string,
  name: string,
  repoPath: string,
  expected: string
): Promise<string> {
  const target = join(dir, name)
  try {
    if (sha256(await readFile(target)) === expected) return target
  } catch {
    // 还没下载
  }
  const body = await download(repoPath, expected)
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, body)
  await rename(temp, target).catch(async error => {
    await rm(temp, { force: true })
    throw error
  })
  return target
}

/**
 * 确保这些着色器都已下载，返回绝对路径（顺序不变）。许可证一并保存。
 * 同一时间多次调用共享同一批下载。
 */
const inflight = new Map<string, Promise<string>>()
export async function ensureAnime4kShaders(
  files: readonly Anime4kFile[]
): Promise<string[]> {
  const dir = await anime4kDir()
  await mkdir(dir, { recursive: true })
  const once = (
    name: string,
    repoPath: string,
    hash: string
  ): Promise<string> => {
    let task = inflight.get(name)
    if (!task) {
      task = ensureFile(dir, name, repoPath, hash).finally(() =>
        inflight.delete(name)
      )
      inflight.set(name, task)
    }
    return task
  }
  void once('LICENSE', ANIME4K_LICENSE.path, ANIME4K_LICENSE.sha256).catch(
    () => {}
  )
  return Promise.all(
    files.map(name => {
      const file = ANIME4K_FILES[name]
      return once(name, `glsl/${file.path}`, file.sha256)
    })
  )
}

/** mpv 里的着色器列表处于半途（挂载被打断或命令失败），下次同步必须重新清空。 */
const PARTIAL = '\0partial'

/**
 * 一个 mpv 会话里的 Anime4K 状态：设置（setConfig）与当前条目（apply）任一变化都重新计算；
 * 应挂载的着色器列表没变就不重复发命令。
 *
 * 挂载串行执行（链式 Promise）：同一时间只有一个任务在发 clr / append。
 * 每条命令返回后都核对 generation，过期就停下，由排在后面的最新任务按最新配置重来，
 * 所以最终的 mpv 着色器列表总与最后一次设置一致。
 */
export class Anime4kSync {
  private config: Anime4kConfig = { ...ANIME4K_OFF }
  private anime: boolean | undefined
  /** mpv 里实际的列表签名（空串 = 未挂载，PARTIAL = 半途）；只在挂载队列里改写 */
  private active = ''
  /** 每次重新计算加一，丢弃过期的任务 */
  private generation = 0
  /** 挂载队列的尾部 */
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly command: MpvCommand,
    /** mpv 是否在运行且 IPC 已连上；没在运行时只记下设置，等下次开播再挂 */
    private readonly running: () => boolean,
    private readonly log: (message: string) => void = message =>
      console.warn(`[anime4k] ${message}`)
  ) {}

  /** 设置变了（来自渲染层「设置 → 播放器」）。 */
  async setConfig(config: Anime4kConfig): Promise<void> {
    this.config = config
    await this.sync()
  }

  /** 新开一个条目：记下它是不是动画，再同步。 */
  async apply(anime: boolean | undefined): Promise<void> {
    this.anime = anime
    await this.sync()
  }

  /** mpv 退出：下次启动是新进程，没有任何已挂载的着色器。 */
  reset(): void {
    this.active = ''
    this.generation++
  }

  /** 排进挂载队列；返回的 Promise 在这次（或被更新的任务取代后）结束时完成。 */
  private sync(): Promise<void> {
    const generation = ++this.generation
    if (!this.running()) return this.queue
    this.queue = this.queue.then(() => this.mount(generation))
    return this.queue
  }

  /** 实际挂载：按执行时的最新配置计算，每步等待后若已过期就停下。 */
  private async mount(generation: number): Promise<void> {
    const stale = (): boolean =>
      generation !== this.generation || !this.running()
    if (stale()) return
    const { mode, quality } = this.config
    const files = shouldApplyAnime4k(this.config, this.anime)
      ? anime4kShaders(mode, quality)
      : []
    const signature = files.join('|')
    if (signature === this.active) return
    try {
      const paths = files.length ? await ensureAnime4kShaders(files) : []
      if (stale()) return
      this.active = PARTIAL
      await this.command('change-list', 'glsl-shaders', 'clr', '')
      for (const path of paths) {
        if (stale()) return
        await this.command('change-list', 'glsl-shaders', 'append', path)
      }
      if (stale()) return
      this.active = signature
      if (files.length) {
        void this.command(
          'show-text',
          anime4kLabel(mode, quality),
          OSD_MS
        ).catch(() => {})
      }
    } catch (error) {
      this.log(`挂载失败：${(error as Error).message}`)
      if (files.length && !stale()) {
        void this.command(
          'show-text',
          'Anime4K 着色器下载失败，已按原画播放',
          OSD_MS
        ).catch(() => {})
      }
    }
  }
}
