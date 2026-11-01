/**
 * 追更界面的纯规则：状态文案、集号、体积、暂停提示、日历卡片上的小标记。
 */
import type {
  AutograbEpisode,
  AutograbOverview,
  AutograbSeries,
  AutograbStatus,
} from '../../../../shared/contract/autograb'
import { normalizeCid } from '../../../../shared/netdisk/target-folder'

/** 状态文案 */
export const STATUS_LABEL: Record<AutograbStatus, string> = {
  waiting: '等待搜索',
  found: '有资源',
  saved: '已转存',
  done: '已入库',
  notFound: '找不到',
  skipped: '已跳过',
  noSpace: '空间不足',
}

/** S01E05 */
export function episodeCode(
  ep: Pick<AutograbEpisode, 'season' | 'episode'>
): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `S${pad(ep.season)}E${pad(ep.episode)}`
}

/** 字节 → 1.2 GB / 830 MB */
export function sizeText(bytes: number): string {
  if (bytes <= 0) return ''
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** 时间戳 → 「10月26日 08:00」（本地时间） */
export function timeText(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 一集的次要说明：下次搜索时间 / 失败原因 */
export function episodeNote(ep: AutograbEpisode): string {
  if (ep.error) return ep.error
  if (ep.status === 'waiting' && ep.nextTry !== null)
    return ep.attempts
      ? `已搜 ${ep.attempts} 次，${timeText(ep.nextTry)} 再搜`
      : `${timeText(ep.nextTry)} 开始搜`
  return ''
}

/** 全自动模式下还要手动确认几集 */
export function confirmsLeft(confirmed: number, need: number): number {
  return Math.max(0, need - confirmed)
}

/**
 * 切到全自动前要不要先选文件夹：与主进程 targetCid 同一解析（这部剧选的 > 剧集默认目录，
 * 后者已含原转存目标兜底），解析出来是根目录就不能全自动。
 */
export function needsFolderForAuto(
  series: Pick<AutograbSeries, 'cid'>,
  defaultFolder: AutograbOverview['defaultFolder']
): boolean {
  return normalizeCid(series.cid || defaultFolder.cid) === '0'
}

/** 日历卡片上追更小标记的种类 */
export type AutograbMarkKind =
  | 'searching'
  | 'pending'
  | 'saved'
  | 'ingesting'
  | 'failed'

/** 日历卡片上的追更小标记 */
export interface AutograbMark {
  key: string
  kind: AutograbMarkKind
  /** 搜索中 / 待确认 / 已转存 / 入库中 / 失败 */
  label: string
  /** 悬停说明 */
  title: string
}

const MARK_LABEL: Record<AutograbMarkKind, string> = {
  searching: '搜索中',
  pending: '待确认',
  saved: '已转存',
  ingesting: '入库中',
  failed: '失败',
}

/**
 * 一集 → 卡片小标记；已入库、已跳过不显示（卡片本身已说明）。
 * 已转存且已通知媒体库算入库中；转存后报了错、找不到、空间不足都算失败。
 */
export function episodeMark(ep: AutograbEpisode): AutograbMark | null {
  const kind = ((): AutograbMarkKind | null => {
    switch (ep.status) {
      case 'waiting':
        return 'searching'
      case 'found':
        return 'pending'
      case 'saved':
        if (ep.error) return 'failed'
        return ep.notified ? 'ingesting' : 'saved'
      case 'notFound':
      case 'noSpace':
        return 'failed'
      default:
        return null
    }
  })()
  if (!kind) return null
  const note = episodeNote(ep) || STATUS_LABEL[ep.status]
  return {
    key: ep.key,
    kind,
    label: MARK_LABEL[kind],
    title: `追更 · ${note}`,
  }
}

/** 总览 → 「剧 id:季:集」到小标记 */
export function marksOf(o: AutograbOverview | null): Map<string, AutograbMark> {
  const marks = new Map<string, AutograbMark>()
  for (const ep of o?.episodes ?? []) {
    const mark = episodeMark(ep)
    if (mark) marks.set(ep.key, mark)
  }
  return marks
}

/** 日历条目的追更键（与主进程 episodeKey 一致） */
export function markKey(
  seriesId: number,
  season: number,
  episode: number
): string {
  return `${seriesId}:${season}:${episode}`
}

/** 要用户处理的状态：有候选待确认、空间不足、找不到 */
const PENDING_STATUSES: ReadonlySet<AutograbStatus> = new Set([
  'found',
  'noSpace',
  'notFound',
])

/** 记录里列出的状态：已转存、已入库、已跳过 */
const HISTORY_STATUSES: ReadonlySet<AutograbStatus> = new Set([
  'saved',
  'done',
  'skipped',
])

/** 待处理的集（有候选的在前，再按播出日倒序） */
export function pendingEpisodes(o: AutograbOverview | null): AutograbEpisode[] {
  return (o?.episodes ?? [])
    .filter(ep => PENDING_STATUSES.has(ep.status))
    .sort(
      (a, b) =>
        Number(b.status === 'found') - Number(a.status === 'found') ||
        b.airDate.localeCompare(a.airDate) ||
        b.episode - a.episode
    )
}

/** 记录：已转存 / 已入库 / 已跳过的集（总览里本来就是新播出的在前） */
export function historyEpisodes(o: AutograbOverview | null): AutograbEpisode[] {
  return (o?.episodes ?? []).filter(ep => HISTORY_STATUSES.has(ep.status))
}

/** 侧栏角标：待处理集数；连着不带 pendingCount 的片库服务时数总览里列出的 */
export function pendingBadge(o: AutograbOverview | null): number {
  if (!o) return 0
  return o.pendingCount ?? pendingEpisodes(o).length
}

/** 实际在追的剧 */
export function trackedSeries(o: AutograbOverview | null): AutograbSeries[] {
  return (o?.series ?? []).filter(s => s.effectiveMode !== 'off')
}

/** 没在追的剧（在播或即将开播，实际方式是「不追」） */
export function untrackedSeries(o: AutograbOverview | null): AutograbSeries[] {
  return (o?.series ?? []).filter(s => s.effectiveMode === 'off')
}

/** 「11月3日」；不是 YYYY-MM-DD 返回空串 */
export function monthDayText(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${Number(match[1])}月${Number(match[2])}日` : ''
}

/** 在追列表里一部剧的说明：「下一集 11月3日」 */
export function nextAirText(series: AutograbSeries): string {
  const text = series.nextAirDate ? monthDayText(series.nextAirDate) : ''
  return text ? `下一集 ${text}` : ''
}

/** 一天里的时刻「14:00」 */
function clockText(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 页头状态句：「开启 · 上次 14:00 检查 · 下次 14:30」；服务没给时间就只说开关 */
export function statusLine(o: AutograbOverview): string {
  const parts = [o.enabled ? '开启' : '已关闭']
  if (o.running) parts.push('正在检查')
  else if (o.enabled) {
    if (o.lastRunAt) parts.push(`上次 ${clockText(o.lastRunAt)} 检查`)
    if (o.nextRunAt) parts.push(`下次约 ${clockText(o.nextRunAt)}`)
  }
  return parts.join(' · ')
}

/** 缺什么前置条件 */
export interface Prerequisite {
  kind: 'login' | 'pansou' | 'paused' | 'space'
  text: string
  /** 就地操作；没有就只是说明 */
  action?: { label: string; to: 'settings-pan' | 'resume' }
}

/** 前置条件与暂停原因（没问题时为空） */
export function prerequisites(o: AutograbOverview): Prerequisite[] {
  const list: Prerequisite[] = []
  if (!o.ready.loggedIn)
    list.push({
      kind: 'login',
      text: '还没登录 115，追更搜不了也存不了',
      action: { label: '去登录', to: 'settings-pan' },
    })
  if (!o.ready.pansou)
    list.push({
      kind: 'pansou',
      text: '还没填 PanSou 地址，搜不到分享',
      action: { label: '去填写', to: 'settings-pan' },
    })
  if (o.pausedUntil !== null)
    list.push({
      kind: 'paused',
      text: o.pauseReason ?? '追更已暂停',
      action: { label: '恢复', to: 'resume' },
    })
  if (o.spacePaused)
    list.push({
      kind: 'space',
      text: o.spacePaused,
      action: { label: '恢复', to: 'resume' },
    })
  return list
}

/**
 * 待处理卡片上那句「为什么要你处理」：找不到说搜了几次，空间不足说怎么办；
 * 有资源时按这部剧的方式说——待确认每集都要点，全自动还没过「新剧先确认」就说还差几集，过了就是匹配分不够高。
 */
export function pendingReason(
  ep: AutograbEpisode,
  series: AutograbSeries | undefined
): string {
  if (ep.status === 'notFound')
    return (
      ep.error ??
      `已搜 ${ep.attempts} 次，PanSou 上还没有这一集的分享。点「现在重搜」再找一遍。`
    )
  if (ep.status === 'noSpace')
    return ep.error ?? '115 剩余空间不够存这个资源，清理空间后再转存。'
  if (!series) return '找到了资源，等你确认。'
  if (series.effectiveMode === 'off')
    return '这部剧已经不追了，这一集的资源还留着，要的话可以转存。'
  if (series.effectiveMode === 'confirm')
    return '这部剧设为待确认，每一集都由你来点转存。'
  const left = confirmsLeft(series.confirmed, series.confirmFirst)
  return left
    ? `这部剧还要你确认 ${left} 集，之后会自动转存。`
    : '匹配分不够高，没有替你自动转存，请看一眼文件名。'
}

/** 单集侧板的进度条一格 */
export interface EpisodeStep {
  label: string
  state: 'done' | 'current' | 'problem' | 'todo'
}

/** 一集走到哪一步：播出 → 搜资源 → 确认 → 转存 115 → 入库（当前一步的字样随状态说清楚） */
export function episodeSteps(ep: AutograbEpisode): EpisodeStep[] {
  const found = ep.candidates.length
  const at: Record<AutograbStatus, [number, string, EpisodeStep['state']]> = {
    waiting: [1, '搜索中', 'current'],
    notFound: [1, '找不到', 'problem'],
    skipped: [1, '已跳过', 'problem'],
    found: [2, '等你确认', 'current'],
    noSpace: [3, '空间不足', 'problem'],
    saved: ep.error ? [4, '入库失败', 'problem'] : [4, '入库中', 'current'],
    done: [5, '', 'done'],
  }
  const [index, text, state] = at[ep.status]
  const labels = [
    '播出',
    found ? `搜到 ${found} 个` : '搜资源',
    '确认',
    '转存 115',
    '入库',
  ]
  return labels.map((label, i) => {
    if (i < index) return { label, state: 'done' }
    if (i === index) return { label: text || label, state }
    return { label, state: 'todo' }
  })
}
