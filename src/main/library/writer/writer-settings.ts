/**
 * 写出设置的持久化：整份 JSON 存在 settings 表的 writer.settings 键下。
 *
 * 读取时与默认值逐层合并：旧版本存的设置缺少新加的字段也能用；存进来的值已经在 IPC 边界校验过。
 */
import {
  DEFAULT_WRITER_SETTINGS,
  type WriterSettings,
} from '../../../shared/library/ipc'
import type { SettingsStore } from '../providers/settings-store'

const KEY = 'writer.settings'

/** 写出设置仓库。 */
export class WriterSettingsStore {
  constructor(private readonly settings: SettingsStore) {}

  /** 当前设置（未保存过时为默认值）。 */
  get(source?: string): WriterSettings {
    const key = source === 'jav' ? `${KEY}.jav` : KEY
    const raw = this.settings.get(key)
    if (!raw && source === 'jav') {
      const initial = this.get()
      this.settings.set(key, JSON.stringify(initial), Date.now())
      return initial
    }
    if (!raw) return structuredClone(DEFAULT_WRITER_SETTINGS)
    let saved: Partial<WriterSettings>
    try {
      saved = JSON.parse(raw) as Partial<WriterSettings>
    } catch {
      return structuredClone(DEFAULT_WRITER_SETTINGS)
    }
    const d = DEFAULT_WRITER_SETTINGS
    return {
      nfo: { ...d.nfo, ...saved.nfo },
      artwork: { ...d.artwork, ...saved.artwork },
      autoWriteAfterIdentify:
        saved.autoWriteAfterIdentify ?? d.autoWriteAfterIdentify,
      organize: { ...d.organize, ...saved.organize },
    }
  }

  /** 保存（调用方已校验）。 */
  set(value: WriterSettings, now: number, source?: string): WriterSettings {
    if (source !== 'jav') this.get('jav')
    this.settings.set(
      source === 'jav' ? `${KEY}.jav` : KEY,
      JSON.stringify(value),
      now
    )
    return this.get(source)
  }
}
