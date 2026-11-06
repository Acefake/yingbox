/**
 * Windows 应用更新（ADR-0038 / ADR-0046）：读本仓库 GitHub Releases 的发布列表，
 * 官方不可达时经白名单镜像回退；下载时边写边算 SHA-256，与 digest 一致才完成。
 * 全部外部能力（网络、文件、进程）由 deps 注入，规则见 shared/desktop-update。
 */
import type { NetworkPreferences } from '../../shared/network/preferences'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { Readable as NodeReadable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  type DesktopUpdate,
  pickDesktopUpdate,
} from '../../shared/desktop-update'
import type {
  UpdateResult,
  UpdateStatusEvent,
} from '../../shared/contract/update'
import { fetchFirstOk } from '../../shared/release/fetch-first'
import {
  githubAssetCandidates,
  mirrorCandidates,
  shouldTryNextMirror,
} from '../../shared/release/mirrors'

const RELEASES_URL =
  'https://api.github.com/repos/Acefake/yingbox/releases?per_page=30'
const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 15_000
/** 静默安装；--force-run 让安装包装完后拉起新版 */
const SILENT_ARGS = ['/S', '--updated', '--force-run']
/** 下载中这么久没有数据就放弃 */
const IDLE_MS = 30_000

/** 更新器依赖 */
export interface DesktopUpdaterDeps {
  networkPreferences?: () => NetworkPreferences
  fetch: typeof fetch
  platform: NodeJS.Platform
  /** 已安装版本 */
  version: string
  /** 安装包下载目录 */
  dir: string
  now(): number
  emit(status: UpdateStatusEvent): void
  /** 发现新版后是否自动下载，也决定退出时是否顺带安装已下载的更新 */
  autoDownload(): boolean
  /** 启动安装包（脱离本进程）；进程起不来时 reject */
  launch(file: string, args: string[]): Promise<void>
  quit(): void
}

/** 桌面更新器 */
export interface DesktopUpdater {
  check(): Promise<UpdateResult>
  download(): Promise<UpdateResult>
  /** 静默安装并重启到新版 */
  install(): Promise<void>
  /** 应用退出时，把已下载的更新静默装上（不拉起新版）；未开自动更新或没有已下载的更新则什么也不做 */
  installOnQuit(): void
}

const failure = (error: unknown): UpdateResult => ({
  success: false,
  error: error instanceof Error ? error.message : String(error),
})

function httpStatusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null
  const m = /HTTP (\d+)/.exec(error.message)
  return m ? Number(m[1]) : null
}

function canRetryDownload(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('校验失败')) return true
  const status = httpStatusOf(error)
  if (status !== null) return shouldTryNextMirror(status, error)
  return shouldTryNextMirror(null, error)
}

/** 创建桌面更新器 */
export function createDesktopUpdater(deps: DesktopUpdaterDeps): DesktopUpdater {
  let cache: { at: number; releases: unknown } | null = null
  let found: DesktopUpdate | null = null
  let downloaded: { version: string; file: string } | null = null
  let inflight: Promise<UpdateResult> | null = null
  let installing = false

  async function releases(): Promise<unknown> {
    if (cache && deps.now() - cache.at < CACHE_MS) return cache.releases
    const response = await fetchFirstOk(
      mirrorCandidates(RELEASES_URL, deps.networkPreferences?.()),
      deps.fetch,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'yingbox-desktop',
        },
        timeoutMs: TIMEOUT_MS,
      }
    )
    const list: unknown = await response.json()
    if (!Array.isArray(list)) throw new Error('更新发布列表格式错误')
    cache = { at: deps.now(), releases: list }
    return list
  }

  async function check(): Promise<UpdateResult> {
    if (deps.platform !== 'win32')
      return failure('当前系统不支持应用内更新，请到发布页下载')
    if (inflight) return failure('正在下载更新，请稍候')
    deps.emit({ status: 'checking' })
    try {
      found = pickDesktopUpdate(await releases(), deps.version)
      if (downloaded && downloaded.version !== found?.version) downloaded = null
      if (!found) {
        deps.emit({
          status: 'not-available',
          info: { version: deps.version },
        })
        return { success: true, data: null }
      }
      const info = { version: found.version, releaseNotes: found.notes }
      deps.emit({
        status: downloaded ? 'downloaded' : 'available',
        info,
      })
      if (!downloaded && deps.autoDownload()) void download()
      return { success: true, data: info }
    } catch (error) {
      deps.emit({
        status: 'error',
        error: failure(error).error ?? '检查更新失败',
      })
      return failure(error)
    }
  }

  function download(): Promise<UpdateResult> {
    if (inflight) return inflight
    const update = found
    if (!update)
      return Promise.resolve(failure('没有可下载的更新，请先检查更新'))
    if (downloaded?.version === update.version)
      return Promise.resolve({ success: true })
    inflight = fetchInstaller(update).finally(() => {
      inflight = null
    })
    return inflight
  }

  async function writeOne(
    url: string,
    update: DesktopUpdate,
    partial: string
  ): Promise<void> {
    const abort = new AbortController()
    let idle = setTimeout(() => abort.abort(), IDLE_MS)
    const response = await deps.fetch(url, {
      headers: { 'User-Agent': 'yingbox-desktop' },
      signal: abort.signal,
    })
    if (!response.ok || !response.body)
      throw new Error(`下载更新失败：HTTP ${response.status}`)
    const hash = createHash('sha256')
    let received = 0
    const source: Readable = NodeReadable.fromWeb(
      response.body as Parameters<typeof NodeReadable.fromWeb>[0]
    )
    let reported = -1
    source.on('data', (chunk: Buffer) => {
      clearTimeout(idle)
      idle = setTimeout(() => abort.abort(), IDLE_MS)
      hash.update(chunk)
      received += chunk.length
      if (received > update.size) {
        abort.abort()
        return
      }
      const percent = Math.floor((received / update.size) * 100)
      if (percent === reported) return
      reported = percent
      deps.emit({ status: 'downloading', progress: { percent } })
    })
    try {
      await pipeline(source, createWriteStream(partial), {
        signal: abort.signal,
      })
    } finally {
      clearTimeout(idle)
    }
    if (received !== update.size || hash.digest('hex') !== update.sha256)
      throw new Error('安装包校验失败，已丢弃，请重试')
  }

  async function fetchInstaller(update: DesktopUpdate): Promise<UpdateResult> {
    const target = join(deps.dir, update.name)
    const partial = `${target}.part`
    const urls = githubAssetCandidates(update.url, deps.networkPreferences?.())
    if (urls.length === 0) return failure('没有可用的更新地址')
    let lastError: unknown = new Error('下载更新失败')
    try {
      await mkdir(deps.dir, { recursive: true })
      await clearOthers(deps.dir)
      for (const url of urls) {
        try {
          await writeOne(url, update, partial)
          await rename(partial, target)
          downloaded = { version: update.version, file: target }
          deps.emit({
            status: 'downloaded',
            info: { version: update.version, releaseNotes: update.notes },
          })
          return { success: true }
        } catch (error) {
          await rm(partial, { force: true })
          lastError = error
          if (!canRetryDownload(error)) break
        }
      }
      deps.emit({
        status: 'error',
        error: failure(lastError).error ?? '下载更新失败',
      })
      return failure(lastError)
    } catch (error) {
      await rm(partial, { force: true })
      deps.emit({
        status: 'error',
        error: failure(error).error ?? '下载更新失败',
      })
      return failure(error)
    }
  }

  async function install(): Promise<void> {
    if (!downloaded || installing) return
    installing = true
    try {
      await deps.launch(downloaded.file, SILENT_ARGS)
    } catch (error) {
      installing = false
      deps.emit({
        status: 'error',
        error: failure(error).error ?? '启动安装包失败',
      })
      return
    }
    deps.quit()
  }

  function installOnQuit(): void {
    if (!downloaded || installing || !deps.autoDownload()) return
    installing = true
    deps.launch(downloaded.file, ['/S']).catch(() => {
      installing = false
    })
  }

  return { check, download, install, installOnQuit }
}

/** 清掉下载目录里其他版本的安装包和残留的未完成文件 */
async function clearOthers(dir: string): Promise<void> {
  for (const name of await readdir(dir))
    await rm(join(dir, name), { force: true })
}
