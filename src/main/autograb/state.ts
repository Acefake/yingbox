/**
 * 追更状态：每部剧的设置、每集的记录、拉黑的分享、115 闸门计数，存在 userData/autograb.json。
 *
 * 读的时候逐字段校验（文件被改坏也不至于崩），写由 service 节流后整份原子替换。
 * 每集一行，键是「剧 id:季:集」，即幂等键：同一集只会有一条记录，转存前先看它的状态。
 * 后加的字段（偏好、空间暂停、转存出的文件 id、拉黑候选）在老文件里没有，读成默认值，版本号不变。
 */
import {
  AUTOGRAB_MODES,
  type AutograbCandidate,
  type AutograbEpisode,
  type AutograbMode,
  type AutograbStatus,
} from '../../shared/contract/autograb'
import {
  type AutograbPrefs,
  type AutograbPrefsOverride,
  DEFAULT_PREFS,
  prefsOf,
  prefsOverrideOf,
} from '../../shared/contract/autograb-prefs'
import { type GateState, emptyGate } from './gate'

/** 一部剧的设置 */
export interface SeriesSetting {
  title: string
  mode: AutograbMode
  cid: string
  cidName: string
  confirmed: number
  /** 覆盖全局的偏好项 */
  prefs: AutograbPrefsOverride
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
  enabled: boolean
  series: Record<string, SeriesSetting>
  episodes: Record<string, EpisodeRecord>
  /** 分享码 → 拉黑到期时间 */
  blacklist: Record<string, number>
  gate: GateState
  /** 全局偏好 */
  prefs: AutograbPrefs
  /** 115 空间不足时暂停自动转存的原因；null = 没暂停 */
  spacePause: string | null
}

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
    enabled: true,
    series: {},
    episodes: {},
    blacklist: {},
    gate: emptyGate(now),
    prefs: { ...DEFAULT_PREFS },
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

/** 文件内容 → 状态；认不出的部分丢掉 */
export function parseState(raw: unknown, now: number): AutograbState {
  const state = emptyState(now)
  if (!isObj(raw) || raw.version !== 1) return state
  state.enabled = raw.enabled !== false
  state.prefs = prefsOf(raw.prefs)
  state.spacePause = sOrNull(raw.spacePause)
  if (isObj(raw.series))
    for (const [id, value] of Object.entries(raw.series)) {
      if (!/^\d+$/.test(id) || !isObj(value)) continue
      const mode = s(value.mode) as AutograbMode
      state.series[id] = {
        title: s(value.title),
        mode: AUTOGRAB_MODES.includes(mode) ? mode : 'off',
        cid: /^\d*$/.test(s(value.cid)) ? s(value.cid) : '',
        cidName: s(value.cidName),
        confirmed: n(value.confirmed),
        prefs: prefsOverrideOf(value.prefs),
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
