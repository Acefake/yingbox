/**
 * 追更界面的纯规则：状态文案、模式选项、集号、体积、暂停提示。
 */
import type {
  AutograbEpisode,
  AutograbMode,
  AutograbOverview,
  AutograbStatus,
} from '../../../../shared/contract/autograb'

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
  if (!o.enabled) return '追更已关闭'
  return null
}

/** 全自动模式下还要手动确认几集 */
export function confirmsLeft(confirmed: number, need = 3): number {
  return Math.max(0, need - confirmed)
}
