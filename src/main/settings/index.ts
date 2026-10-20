/**
 * 主进程设置模块：打开 settings.json，实现 settings 域，并把变更广播给所有窗口。
 * 其他主进程模块经 {@link settingsStore} 读写（例如 Amane 令牌）。
 */
import { app } from 'electron'
import { join } from 'node:path'
import { emit, implement } from '../rpc'
import { settings } from '../../shared/contract/settings'
import { safeStorageCodec } from './secrets'
import { type SettingsStore, openSettingsStore } from './store'

let store: SettingsStore | null = null

/** 已打开的设置存储；必须在 {@link initSettings} 之后调用 */
export function settingsStore(): SettingsStore {
  if (!store) throw new Error('[settings] 尚未初始化')
  return store
}

/** 打开设置存储并注册 settings 域（应用启动时、创建窗口前调用一次） */
export async function initSettings(): Promise<void> {
  store = await openSettingsStore({
    file: join(app.getPath('userData'), 'settings.json'),
    codec: safeStorageCodec,
    onChange: change => emit(settings, 'changed', change),
  })
  const opened = store
  implement(settings, {
    snapshot: () => opened.snapshot(),
    migrateLegacy: (_, legacy) => opened.migrateLegacy(legacy),
    set: (_, key, value) => {
      opened.set(key, value)
    },
  })
}
