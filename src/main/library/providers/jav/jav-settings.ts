/**
 * 番号站点设置的持久化：整份 JSON 存在 settings 表的 provider.jav.settings 键下。
 *
 * 读取时与默认值合并：存的设置里没有的站点（以后新增的）按默认开启、排在最后；
 * 不认识的站点 id 丢掉。存进来的值已经在 IPC 边界校验过。
 */
import {
  DEFAULT_JAV_SETTINGS,
  type JavSettings,
} from '../../../../shared/library/ipc'
import type { SettingsStore } from '../settings-store'

const KEY = 'provider.jav.settings'

/** 已存设置与默认值合并。 */
export function mergeJavSettings(
  saved: Partial<JavSettings> | undefined
): JavSettings {
  const known = new Set(DEFAULT_JAV_SETTINGS.sites.map(s => s.id))
  const seen = new Set<string>()
  const sites: JavSettings['sites'] = []
  for (const s of saved?.sites ?? []) {
    if (!known.has(s.id) || seen.has(s.id)) continue
    seen.add(s.id)
    sites.push({ id: s.id, enabled: s.enabled !== false })
  }
  for (const s of DEFAULT_JAV_SETTINGS.sites) {
    if (!seen.has(s.id)) sites.push({ ...s })
  }
  return { sites }
}

/** 番号站点设置仓库。 */
export class JavSettingsStore {
  constructor(private readonly settings: SettingsStore) {}

  /** 当前设置（未保存过时为默认值）。 */
  get(): JavSettings {
    const raw = this.settings.get(KEY)
    if (!raw) return mergeJavSettings(undefined)
    try {
      return mergeJavSettings(JSON.parse(raw) as Partial<JavSettings>)
    } catch {
      return mergeJavSettings(undefined)
    }
  }

  /** 保存（调用方已校验）并返回生效的设置。 */
  set(value: JavSettings, now: number): JavSettings {
    const merged = mergeJavSettings(value)
    this.settings.set(KEY, JSON.stringify(merged), now)
    return merged
  }
}
