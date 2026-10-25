/**
 * 追更状态：每部剧的设置、每集的记录、拉黑的分享、115 闸门计数，存在 userData/autograb.json。
 *
 * 读的时候逐字段校验（文件被改坏也不至于崩），写由 service 节流后整份原子替换。
 * 每集一行，键是「剧 id:季:集」，即幂等键：同一集只会有一条记录，转存前先看它的状态。
 */
import {
  AUTOGRAB_MODES,
  type AutograbCandidate,
  type AutograbEpisode,
  type AutograbMode,
  type AutograbStatus,
} from '../../shared/contract/autograb'
import { type GateState, emptyGate } from './gate'

/** 一部剧的设置 */
export interface SeriesSetting {
  title: string
  mode: AutograbMode
  cid: string
  cidName: string
  confirmed: number
}

/** 一集的记录 */
export interface EpisodeRecord extends AutograbEpisode {
  /** 转存时间 */
  savedAt: number | null
  /** 转存的文件名 */
  savedName: string | null
  /** 转存到的文件夹 cid */
  savedCid: string | null
  /** 已主动通知媒体库扫描 */
  notified: boolean
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
}

const STATUSES: readonly AutograbStatus[] = [
  'waiting',
  'found',
  'saved',
  'done',
  'notFound',
  'skipped',
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
    savedName: typeof raw.savedName === 'string' ? raw.savedName : null,
    savedCid: typeof raw.savedCid === 'string' ? raw.savedCid : null,
    notified: raw.notified === true,
  }
}

/** 文件内容 → 状态；认不出的部分丢掉 */
export function parseState(raw: unknown, now: number): AutograbState {
  const state = emptyState(now)
  if (!isObj(raw) || raw.version !== 1) return state
  state.enabled = raw.enabled !== false
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
