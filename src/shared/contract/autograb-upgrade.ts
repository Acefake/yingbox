/**
 * 追更的两个子功能（只有桌面端，115 请求和剧集追更共用一道闸门）：
 *
 * - 洗版（autograbUpgrade）：片库里分辨率低于目标（默认 1080p，可选 2160p）的电影 / 剧集，每周搜一次
 *   更高清的 115 分享；找到只列成「可替换」，用户确认后把新文件存到旧文件所在的 115 文件夹，
 *   旧文件保留并标成「已有新版」，删不删由用户手动决定。
 * - 电影上线追踪（autograbMovies）：用户把还没上线的电影加进追踪，TMDB 数字发行日期之后
 *   每天搜一次 WEB-DL / BluRay，30 天没找到就停；默认待确认。
 */
import {
  ContractError,
  bool,
  call,
  defineDomain,
  event,
  int,
  oneOf,
  optStr,
  record,
  str,
} from './define'

/** 一个 115 候选文件（分享里认出的那个视频） */
export interface GrabCandidate {
  shareUrl: string
  password: string
  /** 分享标题（PanSou 的 note） */
  shareTitle: string
  /** 115 里的文件 id */
  fileId: string
  fileName: string
  size: number
  /** 匹配分 0–100：有多确定是这一集 / 这部片，过线才允许全自动 */
  score: number
  /** 版本分 0–100：画质合不合资源偏好，用来挑版本（老记录为 0） */
  quality: number
  /** 短规格（4K · WEB · DV · 中字） */
  specs: string[]
  /** 文件名里认出的分辨率（2160 / 1080 / 720 / 480）；认不出为 null */
  resolution: number | null
  /** 加分理由（给用户看） */
  reasons: string[]
}

/** 操作结果：成功或人话 */
export type GrabResult = { ok: true } | { ok: false; error: string }

// ─── 洗版 ───────────────────────────────────────────────

/** 洗版目标分辨率 */
export const UPGRADE_TARGETS = [1080, 2160] as const
export type UpgradeTarget = (typeof UPGRADE_TARGETS)[number]

/** 一个低分辨率文件的洗版状态 */
export type UpgradeStatus =
  /** 等下一次（每周）搜索 */
  | 'waiting'
  /** 有更高清的候选，等用户确认替换 */
  | 'found'
  /** 新文件已存到同一个 115 文件夹，等它出现在本地挂载里 */
  | 'saved'
  /** 新文件已就位，旧文件还在（标成「已有新版」） */
  | 'replaced'
  /** 旧文件已由用户删除 */
  | 'cleaned'
  /** 用户选择不洗这个文件 */
  | 'ignored'

/** 一条洗版记录（界面用） */
export interface UpgradeEntry {
  /** 键：条目 id（电影或单集） */
  key: string
  itemId: number
  kind: 'movie' | 'episode'
  /** 电影名或剧名 */
  title: string
  year: number | null
  season: number | null
  episode: number | null
  /** 旧文件的本地路径 */
  filePath: string
  /** 旧文件的分辨率；认不出为 null */
  resolution: number | null
  status: UpgradeStatus
  attempts: number
  /** 下一次搜索（毫秒时间戳）；不再搜时为 null */
  nextTry: number | null
  candidates: GrabCandidate[]
  /** 存进 115 的新文件名 */
  savedName: string | null
  error: string | null
}

/** 洗版总览 */
export interface UpgradeOverview {
  enabled: boolean
  target: UpgradeTarget
  ready: {
    loggedIn: boolean
    pansou: boolean
    /** 有放在 115（CloudDrive2 挂载）上的媒体库 */
    cloudLibraries: boolean
  }
  /** 最近一次清点片库的时间；没清点过为 null */
  scannedAt: number | null
  /** 熔断暂停原因（和剧集追更同一道闸门）；没暂停为 null */
  pauseReason: string | null
  /** 各状态的条数 */
  counts: Record<UpgradeStatus, number>
  /** 需要用户看的条目（有候选、已转存、已替换、出错的），最多 100 条 */
  entries: UpgradeEntry[]
  running: boolean
}

/** 洗版设置 */
export interface UpgradeOptionsPatch {
  enabled?: boolean
  target?: UpgradeTarget
}

const upgradePatchOf = (value: unknown): UpgradeOptionsPatch => {
  const raw = record<Record<string, unknown>>(value, 'patch')
  const patch: UpgradeOptionsPatch = {}
  if (raw.enabled !== undefined) patch.enabled = bool(raw.enabled, 'enabled')
  if (raw.target !== undefined)
    patch.target = oneOf(raw.target, 'target', UPGRADE_TARGETS)
  return patch
}

const cidOf = (value: unknown, name: string): string | undefined => {
  const cid = optStr(value, name)
  if (cid !== undefined && !/^\d+$/.test(cid))
    throw new ContractError(`参数 ${name} 应为数字`)
  return cid
}

/** 洗版域 */
export const autograbUpgrade = defineDomain(
  'autograbUpgrade',
  {
    overview: call<UpgradeOverview>(),
    setOptions: call<[patch: UpgradeOptionsPatch], void>(a => [
      upgradePatchOf(a[0]),
    ]),
    /**
     * 用第 index 个候选替换：新文件存到旧文件所在的 115 文件夹（旧文件不动）。
     * 认不出那个文件夹时返回 needFolder，界面让用户选一个后带 cid 再调一次。
     */
    replace: call<
      [key: string, index: number, cid?: string],
      GrabResult | { ok: false; error: string; needFolder: true }
    >(a => [str(a[0], 'key'), int(a[1], 'index'), cidOf(a[2], 'cid')]),
    /** 不洗这个文件（不再搜） */
    ignore: call<[key: string], void>(a => [str(a[0], 'key')]),
    /** 马上重搜这个文件 */
    retry: call<[key: string], void>(a => [str(a[0], 'key')]),
    /** 删掉已有新版的旧文件（经本地挂载删除，新文件必须已在本地） */
    deleteOld: call<[key: string], GrabResult>(a => [str(a[0], 'key')]),
    /** 立刻清点片库并跑一轮 */
    runNow: call<void>(),
  },
  { changed: event<void>() }
)

// ─── 电影上线追踪 ─────────────────────────────────────────

/** 一部追踪中电影的状态 */
export type MovieTrackStatus =
  /** 还没到数字发行日期 */
  | 'upcoming'
  /** 已发行，每天搜一次 */
  | 'searching'
  /** 有候选，等用户确认 */
  | 'found'
  /** 已转存，等入库 */
  | 'saved'
  /** 片库里已有这部电影 */
  | 'done'
  /** 发行后 30 天没搜到 */
  | 'notFound'

/** 电影的转存方式 */
export const MOVIE_MODES = ['confirm', 'auto'] as const
export type MovieMode = (typeof MOVIE_MODES)[number]

/** 一部追踪中的电影（界面用） */
export interface TrackedMovie {
  tmdbId: number
  title: string
  year: number | null
  /** TMDB 海报完整地址；没有为 null */
  poster: string | null
  /** 开始搜的日期 YYYY-MM-DD（数字发行日；TMDB 没有时见 dateSource）；还不知道为 null */
  releaseDate: string | null
  /** releaseDate 的来历：数字发行 / 实体发行 / 首映已久 */
  dateSource: 'digital' | 'physical' | 'premiere' | null
  mode: MovieMode
  status: MovieTrackStatus
  attempts: number
  nextTry: number | null
  candidates: GrabCandidate[]
  error: string | null
  addedAt: number
}

/** 电影追踪总览 */
export interface MoviesOverview {
  /** 转存到的 115 文件夹 cid；空串 = 电影默认目录 */
  cid: string
  cidName: string
  ready: { loggedIn: boolean; pansou: boolean; tmdb: boolean }
  pauseReason: string | null
  movies: TrackedMovie[]
  running: boolean
}

/** TMDB 搜电影的一条结果 */
export interface MovieSearchHit {
  tmdbId: number
  title: string
  year: number | null
  poster: string | null
}

/** 电影追踪域 */
export const autograbMovies = defineDomain(
  'autograbMovies',
  {
    overview: call<MoviesOverview>(),
    /** TMDB 按片名搜电影（加入追踪前选片） */
    search: call<[query: string], MovieSearchHit[]>(a => [
      str(a[0], 'query').slice(0, 200),
    ]),
    /** 某部电影的追踪状态；没在追为 null（详情页按钮用） */
    status: call<[tmdbId: number], MovieTrackStatus | null>(a => [
      int(a[0], 'tmdbId'),
    ]),
    track: call<[tmdbId: number], GrabResult>(a => [int(a[0], 'tmdbId')]),
    untrack: call<[tmdbId: number], void>(a => [int(a[0], 'tmdbId')]),
    setMode: call<[tmdbId: number, mode: MovieMode], GrabResult>(a => [
      int(a[0], 'tmdbId'),
      oneOf(a[1], 'mode', MOVIE_MODES),
    ]),
    /** 电影统一转存到的 115 文件夹 */
    setFolder: call<[cid: string, cidName: string], void>(a => [
      cidOf(a[0], 'cid') ?? '',
      str(a[1], 'cidName').slice(0, 500),
    ]),
    grab: call<[tmdbId: number, index: number], GrabResult>(a => [
      int(a[0], 'tmdbId'),
      int(a[1], 'index'),
    ]),
    /** 重新开始搜（找不到之后再给 30 天） */
    retry: call<[tmdbId: number], void>(a => [int(a[0], 'tmdbId')]),
    runNow: call<void>(),
  },
  { changed: event<void>() }
)
