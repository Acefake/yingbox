/**
 * 网盘页的纯函数：显示格式与扫码轮询循环。
 */
import type { SpecBadge } from '@/components/ui/spec-badge'
import type { Pan115LoginPoll } from '../../../../../shared/contract/pan115'

/** 字节数 → 「1.5 GB」；0 显示为空串 */
export function formatBytes(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`
}

/** ISO 时间 → 「2026-10-01」；没有或不合法时为空串 */
export function formatDay(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 从分享标题里认出的规格标签（Apple TV 式）：分辨率（4K / 1080P）、动态范围（DOLBY VISION / HDR）、
 * 音轨（DOLBY ATMOS）、中文字幕（中字）。只看标题文字，认不出的不显示；杜比视界和 HDR 同时出现时只留杜比视界。
 * @param title 分享标题
 */
export function titleSpecs(title: string): SpecBadge[] {
  const t = title.toLowerCase()
  const specs: SpecBadge[] = []
  if (/4k|2160p|uhd/.test(t)) specs.push({ variant: 'solid', text: '4K' })
  else if (/1080p/.test(t)) specs.push({ variant: 'outline', text: '1080P' })
  // 杜比视界允许空格 / 点 / 下划线 / 连字符分隔；HDR 要求前后不是字母（HDR10 / HDR10+ 算，HDRip 片源标签不算）
  const dv = /杜比视界|dolby[\s._-]*vision|(^|[^a-z])dv([^a-z]|$)|dovi/.test(t)
  if (dv) specs.push({ variant: 'dolby', text: 'VISION' })
  else if (/(^|[^a-z])hdr([^a-z]|$)/.test(t))
    specs.push({ variant: 'solid', text: 'HDR' })
  if (/atmos|全景声/.test(t)) specs.push({ variant: 'dolby', text: 'ATMOS' })
  if (/中字|中英|简繁|简中|繁中|中文字幕|双语字幕/.test(t))
    specs.push({ variant: 'outline', text: '中字' })
  return specs
}

/** 异常 → 给用户看的一句话 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** PanSou 来源 → 「TG · 频道」/「插件 · 名字」 */
export function sourceLabel(source: string): string {
  const [kind, ...rest] = source.split(':')
  const name = rest.join(':')
  if (kind === 'tg' && name) return `TG · ${name}`
  if (kind === 'plugin' && name) return `插件 · ${name}`
  return source === 'unknown' ? '' : source
}

/** 一次轮询的最终结果（不再是 waiting / scanned） */
export type LoginOutcome = Exclude<
  Pan115LoginPoll,
  { status: 'waiting' } | { status: 'scanned' }
>

/**
 * 反复查二维码状态直到有结果；每次状态都交给 onStatus。
 * 状态接口本身是长轮询，这里只在两次之间留一点间隔；signal 取消时以 canceled 结束。
 */
export async function pollLogin(
  poll: () => Promise<Pan115LoginPoll>,
  options: {
    signal: AbortSignal
    onStatus: (status: Pan115LoginPoll['status']) => void
    intervalMs?: number
  }
): Promise<LoginOutcome> {
  const interval = options.intervalMs ?? 1000
  while (!options.signal.aborted) {
    const result = await poll()
    if (options.signal.aborted) break
    options.onStatus(result.status)
    if (result.status !== 'waiting' && result.status !== 'scanned')
      return result
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return { status: 'canceled' }
}
