/** 主窗口仅承载应用页面，系统浏览器只接收 HTTP(S) 链接。 */
import type { WebContents } from 'electron'

export function isExternalWebUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function installWindowSecurity(
  contents: WebContents,
  openExternal: (url: string) => Promise<unknown>
): void {
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-frame-navigate', event => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
}
