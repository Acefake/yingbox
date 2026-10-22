/**
 * 主进程设置模块：打开 settings.json（首启并入旧 config.json 的下载目录），实现 settings 域，并把变更广播给所有窗口。
 * 其他主进程模块经 {@link settingsStore} 读写（例如 TMDB 令牌）。
 */
import { BrowserWindow, type OpenDialogOptions, app, dialog } from 'electron'
import { join } from 'node:path'
import { chooseDownloadDir, migrateLegacyConfig } from '../download-dir'
import { emit, implement } from '../rpc'
import { settings } from '../../shared/contract/settings'
import type { SecretKey, SettingChange } from '../../shared/settings/schema'
import { safeStorageCodec } from './secrets'
import { type SettingsStore, openSettingsStore } from './store'

let store: SettingsStore | null = null
/** 密钥保存后要跑的主进程逻辑（如把 TMDB 令牌下发给媒体库引擎） */
const secretListeners = new Set<
  (key: SecretKey, value: string) => Promise<void> | void
>()

/** 普通设置变更后要跑的主进程逻辑（如外部变更通知端点按开关启停） */
const changeListeners = new Set<(change: SettingChange) => void>()

/** 订阅普通设置变更（任一窗口或主进程自己写入后触发） */
export function onSettingChanged(
  listener: (change: SettingChange) => void
): void {
  changeListeners.add(listener)
}

/** 订阅密钥保存：settings.setSecret 等这些回调跑完才返回给渲染层 */
export function onSecretSaved(
  listener: (key: SecretKey, value: string) => Promise<void> | void
): void {
  secretListeners.add(listener)
}

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
    onChange: change => {
      emit(settings, 'changed', change)
      for (const listener of changeListeners) listener(change)
    },
  })
  const opened = store
  // 老版本的下载目录在 config.json；userData 此时已固定，按当前 profile 解析
  await migrateLegacyConfig(
    opened,
    join(app.getPath('userData'), 'config.json')
  )
  implement(settings, {
    snapshot: () => opened.snapshot(),
    migrateLegacy: (_, legacy) => opened.migrateLegacy(legacy),
    set: (_, key, value) => {
      opened.set(key, value)
    },
    setSecret: async (_, key, value) => {
      await opened.setSecret(key, value)
      await Promise.all([...secretListeners].map(fn => fn(key, value)))
      emit(settings, 'secretChanged', {
        key,
        configured: opened.snapshot().secrets[key],
      })
    },
    chooseDownloadDir: ({ sender }) =>
      chooseDownloadDir({
        store: opened,
        videosDir: app.getPath('videos'),
        pickFolder: async defaultPath => {
          const options: OpenDialogOptions = {
            title: '选择下载目录',
            defaultPath,
            properties: ['openDirectory', 'createDirectory'],
          }
          const owner = BrowserWindow.fromWebContents(sender)
          const result = owner
            ? await dialog.showOpenDialog(owner, options)
            : await dialog.showOpenDialog(options)
          return result.canceled ? null : (result.filePaths[0] ?? null)
        },
      }),
  })
}
