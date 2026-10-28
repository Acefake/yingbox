/** 重复启动交给已有进程显示主窗口，避免争用同一份用户数据。 */
import type { App } from 'electron'

/** 在打开设置、数据库或创建窗口之前取得实例锁。 */
export function installSingleInstance(
  app: Pick<App, 'requestSingleInstanceLock' | 'exit' | 'whenReady'> & {
    on(event: 'second-instance', listener: () => void): unknown
  },
  showMainWindow: () => void
): void {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return
  }
  app.on('second-instance', () => {
    void app.whenReady().then(showMainWindow)
  })
}
