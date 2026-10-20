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
  get(): WriterSettings {
    const raw = this.settings.get(KEY)
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
  set(value: WriterSettings, now: number): WriterSettings {
    this.settings.set(KEY, JSON.stringify(value), now)
    return this.get()
  }
}
