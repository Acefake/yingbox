/**
 * 番号站点设置的纯规则：站点行（名称、说明、开关、能否上下移），以及开关 / 调整顺序后的新设置。
 * 不依赖 Vue，便于单测。
 */
import {
  JAV_SITES,
  type JavSettings,
  type JavSiteId,
} from '../../../../../shared/library/ipc'

/** 设置页的一行站点。 */
export interface JavSiteRow {
  id: JavSiteId
  name: string
  description: string
  enabled: boolean
  /** 1 起的优先级。 */
  rank: number
  canUp: boolean
  canDown: boolean
}

/** 设置 → 站点行（顺序即优先级）。 */
export function javSiteRows(settings: JavSettings): JavSiteRow[] {
  const info = new Map(JAV_SITES.map(s => [s.id, s]))
  return settings.sites.map((s, i) => ({
    id: s.id,
    name: info.get(s.id)?.name ?? s.id,
    description: info.get(s.id)?.description ?? '',
    enabled: s.enabled,
    rank: i + 1,
    canUp: i > 0,
    canDown: i < settings.sites.length - 1,
  }))
}

/** 打开 / 关闭一个站点。 */
export function toggleJavSite(
  settings: JavSettings,
  id: JavSiteId,
  enabled: boolean
): JavSettings {
  return {
    sites: settings.sites.map(s => (s.id === id ? { ...s, enabled } : s)),
  }
}

/** 站点上移（delta = -1）或下移（+1）；越界时原样返回。 */
export function moveJavSite(
  settings: JavSettings,
  id: JavSiteId,
  delta: -1 | 1
): JavSettings {
  const sites = [...settings.sites]
  const from = sites.findIndex(s => s.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= sites.length) return settings
  ;[sites[from], sites[to]] = [sites[to], sites[from]]
  return { sites }
}
