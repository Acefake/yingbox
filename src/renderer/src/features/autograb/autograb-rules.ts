/**
 * 追更界面的纯规则：状态文案、模式选项、集号、体积、暂停提示、日历卡片上的小标记。
 */
import type {
  AutograbEpisode,
  AutograbMode,
  AutograbOverview,
  AutograbSeries,
  AutograbStatus,
} from '../../../../shared/contract/autograb'
import { normalizeCid } from '../../../../shared/netdisk/target-folder'

/** 模式选项（分段控件） */
export const MODE_OPTIONS: { value: AutograbMode; label: string }[] = [
  { value: 'off', label: '不追' },
  { value: 'confirm', label: '待确认' },
  { value: 'auto', label: '全自动' },
]

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

/** 总览上方的提示；没问题时为 null */
export function overviewNotice(o: AutograbOverview): string | null {
  if (!o.ready.loggedIn) return '先在设置 · 网盘里扫码登录 115'
  if (!o.ready.pansou) return '先在设置 · 网盘里填写 PanSou 地址'
  if (o.pausedUntil !== null) return o.pauseReason ?? '追更已暂停'
  if (o.spacePaused) return o.spacePaused
  if (!o.enabled) return '追更已关闭'
  return null
}

/** 全自动模式下还要手动确认几集 */
export function confirmsLeft(confirmed: number, need = 3): number {
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

/** 有暂停（风控 / 登录 / 空间不足）可以点「恢复」 */
export function canResume(o: AutograbOverview): boolean {
  return o.pausedUntil !== null || o.spacePaused !== null
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
