/**
 * 进度条缩略图服务（不依赖 Electron）：查缓存、排队、调 ffmpeg 生成雪碧图、落盘、通知、淘汰。
 *
 * - 一次只跑一个 ffmpeg，低优先级、单线程、只解关键帧；队列后进先出（刚打开的视频先做），
 *   最多排 MAX_QUEUE 个，多出来的丢掉（下次打开再排）。
 * - 先写到同级的 .partial 临时目录，成功后整体改名，清单最后写入；中途失败或超时不留半成品。
 * - 找不到 ffmpeg、生成失败都静默：渲染层拿不到清单就不显示缩略图。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  SEEK_COLUMNS,
  SEEK_FRAME_HEIGHT,
  SEEK_FRAME_WIDTH,
  SEEK_INTERVAL,
  SEEK_ROWS,
  type SeekManifest,
  type SeekStatus,
  parseSeekManifest,
  parseSeekUrl,
  seekLayout,
  seekPageFile,
  shouldGenerateSeek,
} from '../../shared/seek-thumbnails'
import {
  MANIFEST_FILE,
  type SeekCacheEntry,
  planSeekEviction,
  seekCacheKey,
  seekDir,
  seekFfmpegArgs,
  seekRoot,
} from './rules'

/** Response 构造参数里的 body 类型（主进程 tsconfig 没有 DOM 的 BodyInit）。 */
type Body = ConstructorParameters<typeof Response>[0]

/** 排队上限。 */
const MAX_QUEUE = 3
/** 单部视频的生成时限。 */
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000
/** 命中后多久内不重复刷新清单 mtime（淘汰按它算最近使用）。 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

/** 服务依赖。 */
export interface SeekServiceDeps {
  /** 媒体库图片目录（缩略图缓存在它的 thumb/ 下）。 */
  mediaDir: string
  /** 找可用的 ffmpeg；没有返回 null。 */
  locateFfmpeg(): Promise<string | null>
  /** 子进程起来后调低优先级（宿主实现，失败忽略）。 */
  lowerPriority?(child: ChildProcess): void
  /** 某部视频生成完。 */
  notify(manifest: SeekManifest): void
  log(message: string): void
}

/** 排队中的一部视频。 */
interface SeekJob {
  key: string
  path: string
  duration: number
}

/** 进度条缩略图服务。 */
export class SeekThumbnailService {
  private readonly queue: SeekJob[] = []
  private readonly pending = new Set<string>()
  private running: { key: string; child: ChildProcess | null } | null = null
  private swept = false

  constructor(private readonly deps: SeekServiceDeps) {}

  /**
   * 某个本地文件的缩略图：已生成就带上清单；没有就排队生成（生成完经 notify 通知，按 key 对应），
   * 清单为 null。文件读不到、时长不值得生成时返回 null。
   * @param path 视频文件绝对路径
   * @param duration 渲染层读到的时长（秒），决定帧数与是否值得生成
   */
  async request(path: string, duration: number): Promise<SeekStatus | null> {
    let info
    try {
      info = await stat(path)
    } catch {
      return null
    }
    if (!info.isFile()) return null
    const key = seekCacheKey(path, info.size, info.mtimeMs)
    const cached = await this.readManifest(key)
    if (cached) return { key, manifest: cached }
    if (!shouldGenerateSeek(duration)) return null
    if (!this.pending.has(key) && this.running?.key !== key) {
      this.pending.add(key)
      this.queue.push({ key, path, duration })
      while (this.queue.length > MAX_QUEUE) {
        const dropped = this.queue.shift()!
        this.pending.delete(dropped.key)
      }
      void this.pump()
    }
    return { key, manifest: null }
  }

  /** 处理一个 yingbox-media://seek/<key>/<页>.jpg 请求；不是 seek 地址返回 null。 */
  async handle(request: Request): Promise<Response | null> {
    const target = parseSeekUrl(request.url)
    if (!target) return null
    try {
      const body = await readFile(
        join(seekDir(this.deps.mediaDir, target.key), seekPageFile(target.page))
      )
      return new Response(request.method === 'HEAD' ? null : (body as Body), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  }

  /** 是否有 ffmpeg 在跑（退出清理用）。 */
  get busy(): boolean {
    return Boolean(this.running?.child)
  }

  /** 清空队列并结束正在跑的 ffmpeg（应用退出时）。 */
  stop(): void {
    this.queue.length = 0
    this.pending.clear()
    this.running?.child?.kill()
  }

  private async readManifest(key: string): Promise<SeekManifest | null> {
    const file = join(seekDir(this.deps.mediaDir, key), MANIFEST_FILE)
    try {
      const manifest = parseSeekManifest(
        JSON.parse(await readFile(file, 'utf8'))
      )
      if (!manifest || manifest.key !== key) return null
      const info = await stat(file)
      if (Date.now() - info.mtimeMs > TOUCH_INTERVAL_MS) {
        const now = new Date()
        await utimes(file, now, now).catch(() => {})
      }
      return manifest
    } catch {
      return null
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const job = this.queue.pop()
    if (!job) return
    this.pending.delete(job.key)
    this.running = { key: job.key, child: null }
    try {
      if (!this.swept) {
        this.swept = true
        await this.sweep(new Set())
      }
      const manifest = await this.generate(job)
      if (manifest) {
        this.deps.notify(manifest)
        await this.sweep(new Set([job.key]))
      }
    } catch (error) {
      this.deps.log(`生成失败：${(error as Error).message}`)
    } finally {
      this.running = null
      void this.pump()
    }
  }

  private async generate(job: SeekJob): Promise<SeekManifest | null> {
    const ffmpeg = await this.deps.locateFfmpeg()
    if (!ffmpeg) {
      // 没有 ffmpeg：后面排着的也做不了
      this.queue.length = 0
      this.pending.clear()
      return null
    }
    const finalDir = seekDir(this.deps.mediaDir, job.key)
    const tempDir = `${finalDir}.${randomUUID().slice(0, 8)}.partial`
    await mkdir(tempDir, { recursive: true })
    try {
      const ok = await this.runFfmpeg(ffmpeg, seekFfmpegArgs(job.path, tempDir))
      if (!ok) return null
      const pages = (await readdir(tempDir)).filter(f =>
        /^sprite-\d{3}\.jpg$/.test(f)
      ).length
      if (pages === 0) return null
      const manifest: SeekManifest = {
        key: job.key,
        interval: SEEK_INTERVAL,
        width: SEEK_FRAME_WIDTH,
        height: SEEK_FRAME_HEIGHT,
        columns: SEEK_COLUMNS,
        rows: SEEK_ROWS,
        pages,
        frames: Math.min(
          seekLayout(job.duration).frames,
          pages * SEEK_COLUMNS * SEEK_ROWS
        ),
      }
      await writeFile(join(tempDir, MANIFEST_FILE), JSON.stringify(manifest))
      await rm(finalDir, { recursive: true, force: true })
      await mkdir(dirname(finalDir), { recursive: true })
      await rename(tempDir, finalDir)
      return manifest
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private runFfmpeg(bin: string, args: string[]): Promise<boolean> {
    return new Promise(resolve => {
      const child = spawn(bin, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
      if (this.running) this.running.child = child
      this.deps.lowerPriority?.(child)
      let errorText = ''
      child.stderr?.on('data', chunk => {
        if (errorText.length < 2000) errorText += String(chunk)
      })
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS)
      timer.unref?.()
      const done = (ok: boolean): void => {
        clearTimeout(timer)
        if (this.running) this.running.child = null
        if (!ok && errorText) this.deps.log(errorText.trim().slice(0, 300))
        resolve(ok)
      }
      child.once('error', () => done(false))
      child.once('exit', code => done(code === 0))
    })
  }

  /** 清理上次异常退出留下的临时目录，并按上限淘汰最久未用的视频。 */
  private async sweep(keep: ReadonlySet<string>): Promise<void> {
    const root = seekRoot(this.deps.mediaDir)
    const list = (dir: string): Promise<string[]> =>
      readdir(dir).catch(() => [])
    const entries: SeekCacheEntry[] = []
    for (const shard of await list(root)) {
      for (const name of await list(join(root, shard))) {
        const full = join(root, shard, name)
        if (name.endsWith('.partial')) {
          if (
            !this.running ||
            !full.startsWith(seekDir(this.deps.mediaDir, this.running.key))
          ) {
            await rm(full, { recursive: true, force: true }).catch(() => {})
          }
          continue
        }
        try {
          const info = await stat(join(full, MANIFEST_FILE))
          entries.push({ key: name, usedAt: info.mtimeMs })
        } catch {
          await rm(full, { recursive: true, force: true }).catch(() => {})
        }
      }
    }
    for (const key of planSeekEviction(entries, undefined, keep)) {
      await rm(seekDir(this.deps.mediaDir, key), {
        recursive: true,
        force: true,
      }).catch(() => {})
    }
  }
}
