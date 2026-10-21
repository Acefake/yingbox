/**
 * 演员资料设置的持久化：整份 JSON 存在 settings 表的 provider.jav.actors 键下。
 *
 * 读取时与默认值合并：存的设置里没有的来源（以后新增的）按默认开启、排在最后；
 * 不认识的来源丢掉。存进来的值已经在 IPC 边界校验过。
 */
import {
  type ActorSettings,
  DEFAULT_ACTOR_SETTINGS,
} from '../../../shared/library/ipc'
import type { SettingsStore } from '../providers/settings-store'

const KEY = 'provider.jav.actors'

/** 已存设置与默认值合并。 */
export function mergeActorSettings(
  saved: Partial<ActorSettings> | undefined
): ActorSettings {
  const known = new Set(DEFAULT_ACTOR_SETTINGS.sources.map(s => s.id))
  const seen = new Set<string>()
  const sources: ActorSettings['sources'] = []
  for (const s of saved?.sources ?? []) {
    if (!known.has(s.id) || seen.has(s.id)) continue
    seen.add(s.id)
    sources.push({ id: s.id, enabled: s.enabled !== false })
  }
  for (const s of DEFAULT_ACTOR_SETTINGS.sources) {
    if (!seen.has(s.id)) sources.push({ ...s })
  }
  return { sources, autoLookup: saved?.autoLookup !== false }
}

/** 演员资料设置仓库。 */
export class ActorSettingsStore {
  constructor(private readonly settings: SettingsStore) {}

  /** 当前设置（未保存过时为默认值）。 */
  get(): ActorSettings {
    const raw = this.settings.get(KEY)
    try {
      return mergeActorSettings(
        raw ? (JSON.parse(raw) as Partial<ActorSettings>) : undefined
      )
    } catch {
      return mergeActorSettings(undefined)
    }
  }

  /** 保存（调用方已校验）并返回生效的设置。 */
  set(value: ActorSettings, now: number): ActorSettings {
    const merged = mergeActorSettings(value)
    this.settings.set(KEY, JSON.stringify(merged), now)
    return merged
  }
}
