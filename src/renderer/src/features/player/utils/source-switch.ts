/**
 * 播放中换源的纯规则：选下一条备用源、卡顿判定、换源提示文案。
 * 计时与 <video> 事件在 composables/use-stall-watch.ts，切换动作在 PlayerSession。
 */
import type { PlaylistEntry } from './play-queue'

/** 换源原因：卡顿超时 / 播放出错（含 hls 致命错误） */
export type SwitchReason = 'stall' | 'error'

/** 当前用第 active 条备用源（-1 = 主源）时，下一条可用的备用源下标；没有了返回 -1。 */
export function nextFallbackIndex(active: number, total: number): number {
  const next = Math.max(-1, active) + 1
  return next < total ? next : -1
}

/** 是否算卡顿：开始缓冲后已持续 seconds 秒（seconds ≤ 0 时不判定）。 */
export function isStalled(
  waitingSince: number,
  now: number,
  seconds: number
): boolean {
  return seconds > 0 && waitingSince > 0 && now - waitingSince >= seconds * 1000
}

/** 源的展示名：站点名优先，其次条目名。 */
export function sourceName(
  entry: PlaylistEntry | null | undefined,
  fallback = '当前源'
): string {
  const site = typeof entry?.siteName === 'string' ? entry.siteName.trim() : ''
  if (site) return site
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  return name || fallback
}

/** 换到的源的展示名：和原来同一站点时带上线路名（备用源的 name 是「站点 · 线路」）。 */
export function targetName(
  from: PlaylistEntry | null | undefined,
  to: PlaylistEntry | null | undefined
): string {
  const site = sourceName(to, '备用源')
  const name = typeof to?.name === 'string' ? to.name.trim() : ''
  return site === sourceName(from, '') && name ? name : site
}

/** 秒数 → mm:ss（满一小时为 h:mm:ss）。 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 换源提示：「X 卡顿，已切换到 Y · 从 mm:ss 继续」（出错时为「X 播放失败，…」；从头播不带进度）。 */
export function switchNotice(
  reason: SwitchReason,
  from: string,
  to: string,
  at: number
): string {
  const head = `${from} ${reason === 'stall' ? '卡顿' : '播放失败'}，已切换到 ${to}`
  return at >= 1 ? `${head} · 从 ${formatClock(at)} 继续` : head
}
