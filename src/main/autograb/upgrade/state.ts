/**
 * 洗版状态：开关与目标、每个低分辨率文件一条记录、本地目录 → 115 cid 的缓存、拉黑的分享、每天的子限额，
 * 存在 userData/autograb-upgrade.json。读的时候逐字段校验，认不出的丢掉。
 *
 * 键是条目 id（电影或单集），即幂等键：同一个条目只有一条记录，替换过的不会再替换。
 */
import {
  type GrabCandidate,
  UPGRADE_TARGETS,
  type UpgradeEntry,
  type UpgradeStatus,
  type UpgradeTarget,
} from '../../../shared/contract/autograb-upgrade'
import { type Budget, emptyBudget } from './quality-rules'
import type { ScanHit } from './library-scan'

/** 一条记录（比界面多几个内部字段） */
export interface UpgradeRecord extends UpgradeEntry {
  savedAt: number | null
  savedCid: string | null
}

/** 整份状态 */
export interface UpgradeState {
  version: 1
  enabled: boolean
  target: UpgradeTarget
  scannedAt: number | null
  records: Record<string, UpgradeRecord>
  /** 本地目录 → 115 cid */
  dirCids: Record<string, string>
  /** 分享码 → 拉黑到期时间 */
  blacklist: Record<string, number>
  budget: Budget
}

const STATUSES: readonly UpgradeStatus[] = [
  'waiting',
  'found',
  'saved',
  'replaced',
  'cleaned',
  'ignored',
]
/** 还没有结果的状态：清点时文件路径变了就重来 */
const TRANSIENT: readonly UpgradeStatus[] = ['waiting', 'found', 'ignored']
/** 清点时不再出现就删掉的状态（文件已换掉 / 删了 / 目标改了；已清理的也不用再列） */
const DROP_WHEN_GONE: readonly UpgradeStatus[] = [...TRANSIENT, 'cleaned']

/** 空状态：默认关着（每周去搜要花 115 次数，由用户打开） */
export function emptyUpgradeState(now: number): UpgradeState {
  return {
    version: 1,
    enabled: false,
    target: 1080,
    scannedAt: null,
    records: {},
    dirCids: {},
    blacklist: {},
    budget: emptyBudget(now),
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const n = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const nOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const sOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null

/** 候选（洗版与电影追踪共用） */
export function parseCandidate(raw: unknown): GrabCandidate | null {
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
    resolution: nOrNull(raw.resolution),
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(s) : [],
  }
}

/** 候选列表 */
export function parseCandidates(raw: unknown): GrabCandidate[] {
  return Array.isArray(raw)
    ? raw.map(parseCandidate).filter(c => c !== null)
    : []
}

function parseRecord(key: string, raw: unknown): UpgradeRecord | null {
  if (!isObj(raw)) return null
  const status = s(raw.status) as UpgradeStatus
  const kind = raw.kind === 'episode' ? 'episode' : 'movie'
  if (!STATUSES.includes(status) || !s(raw.filePath)) return null
  return {
    key,
    itemId: n(raw.itemId),
    kind,
    title: s(raw.title),
    year: nOrNull(raw.year),
    season: nOrNull(raw.season),
    episode: nOrNull(raw.episode),
    filePath: s(raw.filePath),
    resolution: nOrNull(raw.resolution),
    status,
    attempts: n(raw.attempts),
    nextTry: nOrNull(raw.nextTry),
    candidates: parseCandidates(raw.candidates),
    savedName: sOrNull(raw.savedName),
    error: sOrNull(raw.error),
    savedAt: nOrNull(raw.savedAt),
    savedCid: sOrNull(raw.savedCid),
  }
}

/** 文件内容 → 状态 */
export function parseUpgradeState(raw: unknown, now: number): UpgradeState {
  const state = emptyUpgradeState(now)
  if (!isObj(raw) || raw.version !== 1) return state
  state.enabled = raw.enabled === true
  state.target = UPGRADE_TARGETS.includes(raw.target as UpgradeTarget)
    ? (raw.target as UpgradeTarget)
    : 1080
  state.scannedAt = nOrNull(raw.scannedAt)
  if (isObj(raw.records))
    for (const [key, value] of Object.entries(raw.records)) {
      const record = parseRecord(key, value)
      if (record) state.records[key] = record
    }
  if (isObj(raw.dirCids))
    for (const [dir, cid] of Object.entries(raw.dirCids))
      if (typeof cid === 'string' && /^\d+$/.test(cid)) state.dirCids[dir] = cid
  if (isObj(raw.blacklist))
    for (const [code, until] of Object.entries(raw.blacklist))
      if (typeof until === 'number' && until > now)
        state.blacklist[code] = until
  if (isObj(raw.budget))
    state.budget = { day: s(raw.budget.day), snaps: n(raw.budget.snaps) }
  return state
}

/**
 * 清点结果 → 记录：新出现的低分辨率文件建一条马上可搜的记录；已有记录跟着更新文件路径；
 * 不再出现的等待 / 有候选 / 已忽略 / 已清理记录删掉；已转存、已替换的留着（还要跟进）。
 * @returns 是否有改动
 */
export function applyScan(
  state: UpgradeState,
  hits: ScanHit[],
  now: number
): boolean {
  let changed = false
  const seen = new Set<string>()
  for (const hit of hits) {
    const key = String(hit.itemId)
    seen.add(key)
    const record = state.records[key]
    if (!record) {
      state.records[key] = {
        key,
        ...hit,
        status: 'waiting',
        attempts: 0,
        nextTry: now,
        candidates: [],
        savedName: null,
        error: null,
        savedAt: null,
        savedCid: null,
      }
      changed = true
    } else if (
      TRANSIENT.includes(record.status) &&
      record.filePath !== hit.filePath
    ) {
      Object.assign(record, hit, {
        status: 'waiting',
        nextTry: now,
        candidates: [],
      })
      changed = true
    }
  }
  for (const [key, record] of Object.entries(state.records))
    if (!seen.has(key) && DROP_WHEN_GONE.includes(record.status)) {
      delete state.records[key]
      changed = true
    }
  return changed
}
