/**
 * 演员资料来源设置的纯规则：来源行（名称、说明、开关、能否上下移），以及开关 / 调整顺序 / 自动查资料后的新设置。
 * 不依赖 Vue，便于单测。
 */
import {
  ACTOR_SOURCES,
  type ActorSettings,
  type ActorSourceId,
} from '../../../../../shared/library/ipc'

/** 设置页的一行来源。 */
export interface ActorSourceRow {
  id: ActorSourceId
  name: string
  description: string
  enabled: boolean
  /** 1 起的优先级。 */
  rank: number
  canUp: boolean
  canDown: boolean
}

/** 设置 → 来源行（顺序即优先级）。 */
export function actorSourceRows(settings: ActorSettings): ActorSourceRow[] {
  const info = new Map(ACTOR_SOURCES.map(s => [s.id, s]))
  return settings.sources.map((s, i) => ({
    id: s.id,
    name: info.get(s.id)?.name ?? s.id,
    description: info.get(s.id)?.description ?? '',
    enabled: s.enabled,
    rank: i + 1,
    canUp: i > 0,
    canDown: i < settings.sources.length - 1,
  }))
}

/** 打开 / 关闭一个来源。 */
export function toggleActorSource(
  settings: ActorSettings,
  id: ActorSourceId,
  enabled: boolean
): ActorSettings {
  return {
    ...settings,
    sources: settings.sources.map(s => (s.id === id ? { ...s, enabled } : s)),
  }
}

/** 来源上移（delta = -1）或下移（+1）；越界时原样返回。 */
export function moveActorSource(
  settings: ActorSettings,
  id: ActorSourceId,
  delta: -1 | 1
): ActorSettings {
  const sources = [...settings.sources]
  const from = sources.findIndex(s => s.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= sources.length) return settings
  ;[sources[from], sources[to]] = [sources[to], sources[from]]
  return { ...settings, sources }
}
