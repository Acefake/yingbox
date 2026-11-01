/**
 * 追更状态：每部剧的设置、每集的记录、拉黑的分享、115 闸门计数，存在 userData/autograb.json。
 *
 * 读的时候逐字段校验（文件被改坏也不至于崩），写由 service 节流后整份原子替换。
 * 每集一行，键是「剧 id:季:集」，即幂等键：同一集只会有一条记录，转存前先看它的状态。
 * 后加的字段（空间暂停、转存出的文件 id、拉黑候选）在老文件里没有，读成默认值，版本号不变。
 *
 * 剧集的全局策略（policy：默认方式、新剧先确认几集、资源偏好）也存在这里。没有 policy 的老文件迁移一次：
 * 全局偏好 ← 老的 prefs，全局方式 = 不追；「不追」的剧读成跟随全局（全局也是不追，等价）；
 * 单独设了待确认 / 全自动的剧保持原样，并记下原来的确认门槛 3 集（{@link LEGACY_CONFIRM_FIRST}），行为不变。
 */
import {
  type SeriesCategory,
  categoryOf,
} from '../../shared/contract/series-category'
import {
  AUTOGRAB_MODES,
  AUTOGRAB_SERIES_MODES,
  type AutograbCandidate,
  type AutograbEpisode,
  type AutograbMode,
  type AutograbSeriesMode,
  type AutograbStatus,
} from '../../shared/contract/autograb'
import {
  type AutograbPrefsOverride,
  prefsOf,
  prefsOverrideOf,
} from '../../shared/contract/autograb-prefs'
import {
  DEFAULT_TV_POLICY,
  type GrabPolicy,
  confirmFirstOf,
  policyOf,
} from '../../shared/contract/grab-policy'
import { type GateState, emptyGate } from './gate'

/** 一部剧的设置 */
export interface SeriesSetting {
  title: string
  /** 方式设置：inherit = 跟随全局 */
  mode: AutograbSeriesMode
  cid: string
  cidName: string
  confirmed: number
  /** 这部剧自己的确认门槛（迁移前单独设过方式的老剧为 3）；没有时用全局「新剧先确认」 */
  confirmFirst?: number
  /** 覆盖全局的偏好项 */
  prefs: AutograbPrefsOverride
  /** 剧的 TMDB id（在日历里出现过才有）：条目 id 变了时靠它认出同一部剧 */
  tmdbId?: string
}

/** 一集的记录 */
export interface EpisodeRecord extends Omit<AutograbEpisode, 'revertable'> {
  /** 转存时间 */
  savedAt: number | null
  /** 转存的文件名 */
  savedName: string | null
  /** 转存到的文件夹 cid */
  savedCid: string | null
  /** 已主动通知媒体库扫描 */
  notified: boolean
  /** 转存出的那个文件在自己 115 里的 id（撤销只删它）；老记录或同名文件本来就在时为 null */
  savedFileId: string | null
  /** 转存出的文件体积（撤销前核对） */
  savedSize: number | null
  /** 转存的是哪个候选（{@link candidateKey}） */
  savedFrom: string | null
  /** 撤销过、不再要的候选（{@link candidateKey}） */
  banned: string[]
  /** 撤销删掉的文件名：媒体库还没刷新、日历里还挂着这个文件时不算已入库 */
  revertedName: string | null
}

/** 整份状态 */
export interface AutograbState {
  version: 1
  /** 各分类默认存到哪（没设的分类用剧集默认目录） */
  categoryFolders: Partial<
    Record<SeriesCategory, { cid: string; name: string }>
  >
  enabled: boolean
  series: Record<string, SeriesSetting>
  episodes: Record<string, EpisodeRecord>
  /** 分享码 → 拉黑到期时间 */
  blacklist: Record<string, number>
  gate: GateState
  /** 剧集的全局策略 */
  policy: GrabPolicy
  /** 115 空间不足时暂停自动转存的原因；null = 没暂停 */
  spacePause: string | null
}

/** 迁移前单独设了待确认 / 全自动的剧沿用的确认门槛 */
export const LEGACY_CONFIRM_FIRST = 3

/** 打不开的分享拉黑多久 */
export const BLOCK_MS = 7 * 24 * 3_600_000

/** 候选的身份：分享码 / 分享里的文件 id（拉黑候选、记下转存来源用） */
export function candidateKey(shareCode: string, fileId: string): string {
  return `${shareCode}/${fileId}`
}

const STATUSES: readonly AutograbStatus[] = [
  'waiting',
  'found',
  'saved',
  'done',
  'notFound',
  'skipped',
  'noSpace',
]

/** 空状态（默认开着总开关，但没有任何剧在追） */
export function emptyState(now: number): AutograbState {
  return {
    version: 1,
    categoryFolders: {},
    enabled: true,
    series: {},
    episodes: {},
    blacklist: {},
    gate: emptyGate(now),
    policy: policyOf(undefined, 'tv'),
    spacePause: null,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const s = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback
const n = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const nOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const sOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null

function parseCandidate(raw: unknown): AutograbCandidate | null {
  if (!isObj(raw) || !s(raw.shareUrl) || !s(raw.fileId)) return null
  return {
    shareUrl: s(raw.shareUrl),
    password: s(raw.password),
    shareTitle: s(raw.shareTitle),
    fileId: s(raw.fileId),
    fileName: s(raw.fileName),
    size: n(raw.size),
    score: n(raw.score),
    quality: n(raw.quality),
    specs: Array.isArray(raw.specs) ? raw.specs.map(r => s(r)) : [],
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(r => s(r)) : [],
  }
}

function parseEpisode(key: string, raw: unknown): EpisodeRecord | null {
  if (!isObj(raw)) return null
  const status = s(raw.status) as AutograbStatus
  if (!STATUSES.includes(status) || !/^\d{4}-\d{2}-\d{2}$/.test(s(raw.airDate)))
    return null
  return {
    key,
    seriesId: n(raw.seriesId),
    seriesTitle: s(raw.seriesTitle),
    season: n(raw.season),
    episode: n(raw.episode),
    airDate: s(raw.airDate),
    status,
    attempts: n(raw.attempts),
    nextTry: nOrNull(raw.nextTry),
    candidates: Array.isArray(raw.candidates)
      ? raw.candidates.map(parseCandidate).filter(c => c !== null)
      : [],
    error: typeof raw.error === 'string' ? raw.error : null,
    savedAt: nOrNull(raw.savedAt),
    savedName: sOrNull(raw.savedName),
    savedCid: sOrNull(raw.savedCid),
    notified: raw.notified === true,
    savedFileId: /^\d+$/.test(s(raw.savedFileId)) ? s(raw.savedFileId) : null,
    savedSize: nOrNull(raw.savedSize),
    savedFrom: sOrNull(raw.savedFrom),
    banned: Array.isArray(raw.banned)
      ? raw.banned.filter(b => typeof b === 'string')
      : [],
    revertedName: sOrNull(raw.revertedName),
  }
}

/** 方式设置：认不出时跟随全局 */
function seriesMode(raw: unknown): AutograbSeriesMode {
  return AUTOGRAB_SERIES_MODES.includes(raw as AutograbSeriesMode)
    ? (raw as AutograbSeriesMode)
    : 'inherit'
}

/** 老文件的方式：不追（及认不出的）→ 跟随全局，待确认 / 全自动保持 */
function legacyMode(raw: unknown): AutograbSeriesMode {
  const mode = raw as AutograbMode
  return AUTOGRAB_MODES.includes(mode) && mode !== 'off' ? mode : 'inherit'
}

/** 一部剧的设置；没有时建一条跟随全局的 */
export function ensureSetting(
  state: AutograbState,
  seriesId: number,
  title: string
): SeriesSetting {
  const key = String(seriesId)
  state.series[key] ??= {
    title,
    mode: 'inherit',
    cid: '',
    cidName: '',
    confirmed: 0,
    prefs: {},
  }
  return state.series[key]
}

/** 文件内容 → 状态；认不出的部分丢掉 */
export function parseState(raw: unknown, now: number): AutograbState {
  const state = emptyState(now)
  if (!isObj(raw) || raw.version !== 1) return state
  state.enabled = raw.enabled !== false
  const legacy = !isObj(raw.policy)
  state.policy = legacy
    ? { ...DEFAULT_TV_POLICY, prefs: prefsOf(raw.prefs) }
    : policyOf(raw.policy, 'tv')
  state.spacePause = sOrNull(raw.spacePause)
  if (isObj(raw.series))
    for (const [id, value] of Object.entries(raw.series)) {
      if (!/^\d+$/.test(id) || !isObj(value)) continue
      const setting: SeriesSetting = {
        title: s(value.title),
        mode: legacy ? legacyMode(value.mode) : seriesMode(value.mode),
        cid: /^\d*$/.test(s(value.cid)) ? s(value.cid) : '',
        cidName: s(value.cidName),
        confirmed: n(value.confirmed),
        prefs: prefsOverrideOf(value.prefs),
      }
      const confirmFirst = legacy
        ? setting.mode === 'inherit'
          ? undefined
          : LEGACY_CONFIRM_FIRST
        : confirmFirstOf(value.confirmFirst)
      if (confirmFirst !== undefined) setting.confirmFirst = confirmFirst
      if (/^\d+$/.test(s(value.tmdbId))) setting.tmdbId = s(value.tmdbId)
      state.series[id] = setting
    }
  if (isObj(raw.categoryFolders))
    for (const [name, folder] of Object.entries(raw.categoryFolders)) {
      const category = categoryOf(name)
      if (category && isObj(folder) && /^d+$/.test(s(folder.cid)))
        state.categoryFolders[category] = {
          cid: s(folder.cid),
          name: s(folder.name),
        }
    }
  if (isObj(raw.episodes))
    for (const [key, value] of Object.entries(raw.episodes)) {
      const record = parseEpisode(key, value)
      if (record) state.episodes[key] = record
    }
  if (isObj(raw.blacklist))
    for (const [code, until] of Object.entries(raw.blacklist))
      if (typeof until === 'number' && until > now)
        state.blacklist[code] = until
  if (isObj(raw.gate)) {
    const g = raw.gate
    state.gate = {
      day: s(g.day, state.gate.day),
      snaps: n(g.snaps),
      receives: n(g.receives),
      pausedUntil: nOrNull(g.pausedUntil),
      pauseReason: typeof g.pauseReason === 'string' ? g.pauseReason : null,
      lastTrip: nOrNull(g.lastTrip),
      loginPause: g.loginPause === true,
    }
  }
  return state
}

/** 去掉早就过期的记录（已入库 / 跳过 / 找不到且播出超过 60 天） */
export function pruneEpisodes(state: AutograbState, cutoffDate: string): void {
  for (const [key, record] of Object.entries(state.episodes))
    if (
      record.airDate < cutoffDate &&
      (record.status === 'done' ||
        record.status === 'skipped' ||
        record.status === 'notFound')
    )
      delete state.episodes[key]
}
