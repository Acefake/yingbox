/**
 * 外部变更通知接到 Electron：读写设置、把通知转给媒体库引擎、注册 libraryNotify 域、退出时关端点。
 * 逻辑在 controller.ts（端点生命周期）、server.ts（HTTP）、payload.ts（请求体格式）。
 */
import { app } from 'electron'
import { networkInterfaces } from 'node:os'
import { libraryNotify } from '../../../shared/contract/library-notify'
import { emit, implement } from '../../rpc'
import { onSettingChanged, settingsStore } from '../../settings'
import type { LibraryEngineClient } from '../host'
import { createNotifyController } from './controller'

/** 本机第一个非内部 IPv4（局域网访问时展示的地址）。 */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    const found = list?.find(a => a.family === 'IPv4' && !a.internal)
    if (found) return found.address
  }
  return undefined
}

/** 注册通知端点；须在 initSettings 与 registerLibraryIpc 之后调用。 */
export function registerLibraryNotify(client: LibraryEngineClient): void {
  const controller = createNotifyController({
    store: settingsStore(),
    notify: request => client.call('notifyChanges', request),
    lanAddress,
    onStatus: status => emit(libraryNotify, 'changed', status),
  })
  implement(libraryNotify, {
    status: () => controller.status(),
    resetToken: () => controller.resetToken(),
  })
  // 挂载目录每次收到通知时现读，改它不用重启端点
  onSettingChanged(change => {
    if (
      change.key.startsWith('library.notify.') &&
      change.key !== 'library.notify.mountRoot'
    )
      void controller.apply()
  })
  void controller.apply()
  app.on('will-quit', () => void controller.close())
}
