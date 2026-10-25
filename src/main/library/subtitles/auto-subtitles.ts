/**
 * 自动字幕：新入库的电影 / 集没有中文字幕时，从 OpenSubtitles 下一份最匹配的放到视频旁边。
 *
 * 设置在宿主（桌面端主进程设置 subtitles.auto.*，默认关闭）；没给设置的宿主（独立服务）不做。
 * 每个视频按顺序做一次（状态与幂等见 subtitle-state.ts）：
 * 1. 跳过：远程源（WebDAV，不能写）、番号库、目录不可写（网盘挂载只读 / 没权限）——记原因；
 * 2. 已有中文字幕（外挂 / 内封 / 文件名写了中字，规则见 subtitle-rules.ts）→ done；
 *    网盘上不读视频内容，内封字幕不探测；
 * 3. 按 TMDB id（集用剧的 id + 季集）和文件哈希搜，挑一份人工中文字幕，存成 `<视频名>.zh.srt`（UTF-8 带 BOM）；
 * 4. 没搜到 / 网络失败：1 小时、6 小时、1 天后各再试一次，都不行记为跳过。
 * 限额：每天最多下载 dailyLimit 份（本地日期清零），OpenSubtitles 回额度用完时也停到明天；key 没配或无效时整轮停。
 */
import { constants } from 'node:fs'
import {
  access,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LibraryArrival } from '../../../shared/library/arrivals'
import { isRemotePath } from '../../../shared/webdav/remote-path'
import { decodeSubtitleText } from '../../subtitle'
import { type LibraryDb, StatementCache } from '../db/database'
import { SettingsStore } from '../providers/settings-store'
import {
  OsAuthError,
  OsQuotaError,
  type OsSearch,
  type OsSubtitleClient,
} from './os-subtitles'
import {
  localDay,
  nameSaysChinese,
  nextLocalMidnight,
  nextRetry,
  pickSubtitle,
  scanSidecars,
  streamsHaveChinese,
  subtitleFileName,
  textLooksChinese,
} from './subtitle-rules'
import {
  type SubtitleEntry,
  type SubtitleState,
  nextDue,
  parseSubtitleState,
  pruneEntries,
} from './subtitle-state'

/** 宿主给的设置。 */
export interface AutoSubtitleSettings {
  enabled: boolean
  dailyLimit: number
}

/** 依赖。 */
export interface AutoSubtitlesDeps {
  db: LibraryDb
  client: OsSubtitleClient
  settings: () => Promise<AutoSubtitleSettings>
  /** 库是否按网盘处理（不读视频内容）。 */
  isCloud: (libraryId: number) => Promise<boolean>
  /** ffprobe 读字幕流（JSON）；没有 ffprobe 或读失败为 null。 */
  probeStreams?: (path: string) => Promise<unknown>
  now?: () => number
  log?: (message: string) => void
}

const STATE_KEY = 'subtitles.auto.state'

/** 搜索要用的条目信息。 */
const ITEM_SQL = `SELECT i.type, i.season_number, i.episode_number,
    t.tmdb_id, t.title, t.year, l.source,
    (SELECT f.fingerprint FROM files f WHERE f.display_path = ?2) AS hash
  FROM media_items i
  LEFT JOIN media_items p ON p.id = i.parent_id
  JOIN media_items t ON t.id = CASE
    WHEN i.type = 'movie' THEN i.id
    WHEN p.type = 'series' THEN p.id
    ELSE p.parent_id END
  JOIN libraries l ON l.id = i.library_id
  WHERE i.id = ?1`

/** 一个视频这次的结果。 */
type Outcome =
  | { status: 'done' | 'skipped'; reason: string }
  | { status: 'retry'; reason: string }

/** 自动字幕。 */
export class AutoSubtitles {
  private readonly sql: StatementCache
  private readonly settingsStore: SettingsStore
  private readonly now: () => number
  private readonly log: (message: string) => void
  private state: SubtitleState
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(private readonly deps: AutoSubtitlesDeps) {
    this.sql = new StatementCache(deps.db)
    this.settingsStore = new SettingsStore(deps.db)
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => {})
    this.state = parseSubtitleState(
      this.settingsStore.get(STATE_KEY),
      localDay(this.now())
    )
  }

  /** 启动：接着做上次没做完的。 */
  start(): void {
    this.schedule()
  }

  close(): void {
    this.closed = true
    clearTimeout(this.timer)
  }

  /** 当前状态（测试 / 排查用）。 */
  snapshot(): SubtitleState {
    return structuredClone(this.state)
  }

  /** 新入库：开着自动字幕时登记，然后开始做。返回这一轮跑完的 Promise。 */
  async enqueue(arrivals: readonly LibraryArrival[]): Promise<void> {
    const settings = await this.deps.settings()
    if (!settings.enabled || !arrivals.length) return
    const now = this.now()
    for (const a of arrivals) {
      const key = String(a.itemId)
      if (this.state.entries[key]) continue
      this.state.entries[key] = {
        itemId: a.itemId,
        libraryId: a.libraryId,
        path: a.filePath,
        status: 'pending',
        attempts: 0,
        nextTry: null,
        reason: null,
        updatedAt: now,
      }
    }
    this.save()
    return this.run()
  }

  /** 跑一轮（已在跑时排一轮在后面）。 */
  run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.drain().finally(() => {
      this.running = null
      if (this.again && !this.closed) {
        this.again = false
        void this.run()
      } else this.schedule()
    })
    return this.running
  }

  private async drain(): Promise<void> {
    const settings = await this.deps.settings()
    if (!settings.enabled || this.closed) return
    for (;;) {
      const now = this.now()
      this.rollDay(now)
      const entry = Object.values(this.state.entries)
        .filter(e => e.status === 'pending' && (e.nextTry ?? 0) <= now)
        .sort(
          (a, b) =>
            (a.nextTry ?? 0) - (b.nextTry ?? 0) || a.updatedAt - b.updatedAt
        )[0]
      if (!entry || this.closed) return
      if (this.state.downloads >= settings.dailyLimit) {
        this.deferAll(nextLocalMidnight(now), '今天的自动字幕次数已用完')
        return
      }
      let outcome: Outcome
      try {
        outcome = await this.handle(entry)
      } catch (error) {
        if (error instanceof OsAuthError) {
          this.log(`自动字幕暂停：${error.message}`)
          return
        }
        if (error instanceof OsQuotaError) {
          this.deferAll(nextLocalMidnight(this.now()), error.message)
          return
        }
        outcome = { status: 'retry', reason: (error as Error).message }
      }
      this.apply(entry, outcome)
    }
  }

  /** 处理一个视频。 */
  private async handle(entry: SubtitleEntry): Promise<Outcome> {
    const path = entry.path
    if (isRemotePath(path))
      return { status: 'skipped', reason: '远程源（WebDAV）上不能写字幕' }
    const row = this.sql.get(ITEM_SQL).get(entry.itemId, path)
    if (!row) return { status: 'skipped', reason: '条目已不在片库里' }
    if (row.source === 'jav')
      return { status: 'skipped', reason: '番号库不自动找字幕' }
    if (nameSaysChinese(path))
      return { status: 'done', reason: '文件名标着中文字幕' }
    const dir = dirname(path)
    const entries = await readdir(dir).catch(() => null)
    if (!entries) return { status: 'retry', reason: '读不到视频所在的文件夹' }
    if (await this.hasSidecar(path, dir, entries))
      return { status: 'done', reason: '已有中文外挂字幕' }
    const cloud = await this.deps.isCloud(entry.libraryId)
    if (!cloud && this.deps.probeStreams) {
      const streams = await this.deps.probeStreams(path)
      if (streamsHaveChinese(streams))
        return { status: 'done', reason: '已有中文内封字幕' }
    }
    if (!(await writable(dir)))
      return {
        status: 'skipped',
        reason: cloud ? '网盘文件夹不可写' : '文件夹不可写',
      }
    const search = searchOf(row, cloud)
    if (!search)
      return {
        status: 'skipped',
        reason: '没有识别到 TMDB，不知道找哪部片的字幕',
      }
    const best = pickSubtitle(await this.deps.client.search(search))
    if (!best)
      return { status: 'retry', reason: 'OpenSubtitles 上还没有中文字幕' }
    const bytes = await this.deps.client.download(best.fileId)
    this.state.downloads++
    const name = subtitleFileName(path, best.language)
    await writeSubtitle(join(dir, name), bytes)
    this.log(`自动字幕：${name}`)
    return { status: 'done', reason: `已下载 ${name}` }
  }

  /** 外挂字幕里有没有中文（没有语言标记的看内容）。 */
  private async hasSidecar(
    path: string,
    dir: string,
    entries: string[]
  ): Promise<boolean> {
    const found = scanSidecars(path, entries)
    if (found.chinese.length) return true
    for (const name of found.unlabeled) {
      const bytes = await readFile(join(dir, name)).catch(() => null)
      if (
        bytes &&
        textLooksChinese(decodeSubtitleText(bytes.subarray(0, 64 * 1024)))
      )
        return true
    }
    return false
  }

  private apply(entry: SubtitleEntry, outcome: Outcome): void {
    const now = this.now()
    entry.updatedAt = now
    entry.reason = outcome.reason
    if (outcome.status === 'retry') {
      entry.attempts++
      entry.nextTry = nextRetry(entry.attempts, now)
      if (entry.nextTry === null) entry.status = 'skipped'
    } else {
      entry.status = outcome.status
      entry.nextTry = null
      if (outcome.status === 'skipped')
        this.log(`自动字幕跳过 ${entry.path}：${outcome.reason}`)
    }
    this.save()
  }

  /** 等着做的全部推到 at（额度用完）。 */
  private deferAll(at: number, reason: string): void {
    for (const e of Object.values(this.state.entries))
      if (e.status === 'pending' && (e.nextTry ?? 0) < at) {
        e.nextTry = at
        e.reason = reason
      }
    this.save()
  }

  private rollDay(now: number): void {
    const day = localDay(now)
    if (this.state.day === day) return
    this.state.day = day
    this.state.downloads = 0
  }

  private save(): void {
    pruneEntries(this.state)
    this.settingsStore.set(STATE_KEY, JSON.stringify(this.state), this.now())
  }

  /** 按最早一个到期的时间定时唤醒。 */
  private schedule(): void {
    clearTimeout(this.timer)
    const due = nextDue(this.state)
    if (due === null || this.closed) return
    // setTimeout 上限约 24.8 天；到点前醒来只会空转一轮
    const delay = Math.min(Math.max(1000, due - this.now()), 86_400_000)
    this.timer = setTimeout(() => void this.run(), delay)
    this.timer.unref?.()
  }
}

/** 条目 → 搜索条件；没识别到 TMDB 又没有文件哈希时不搜（按片名搜太容易下错）。 */
function searchOf(
  row: Record<string, unknown>,
  cloud: boolean
): OsSearch | null {
  const tmdb =
    typeof row.tmdb_id === 'string' && row.tmdb_id ? row.tmdb_id : undefined
  const hash =
    !cloud && typeof row.hash === 'string' && /^[0-9a-f]{16}$/.test(row.hash)
      ? row.hash
      : undefined
  if (!tmdb && !hash) return null
  if (row.type === 'episode') {
    return {
      parentTmdbId: tmdb,
      season:
        row.season_number === null ? undefined : Number(row.season_number),
      episode:
        row.episode_number === null ? undefined : Number(row.episode_number),
      moviehash: hash,
    }
  }
  return { tmdbId: tmdb, moviehash: hash }
}

/** 目录能不能写：先看权限，再真写一个空文件（网盘挂载常常 access 说能写、实际写不进）。 */
async function writable(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK)
    const probe = join(dir, `.yingbox-write-probe-${process.pid}`)
    await writeFile(probe, '', { flag: 'w' })
    await unlink(probe)
    return true
  } catch {
    return false
  }
}

/** 写字幕：统一转成 UTF-8（带 BOM，老播放器也能认中文），先写临时文件再改名；同名已在就不覆盖。 */
async function writeSubtitle(target: string, bytes: Uint8Array): Promise<void> {
  const exists = await access(target).then(
    () => true,
    () => false
  )
  if (exists) return
  const text = decodeSubtitleText(Buffer.from(bytes))
  const temp = `${target}.part`
  await writeFile(temp, `\ufeff${text}`, 'utf8')
  await rename(temp, target)
}
