/**
 * 主窗口的 DevTools 快捷键：F12，或 Ctrl+Shift+I（macOS Cmd+Option+I），只在主窗口聚焦时生效。
 *
 * 走窗口自己的 before-input-event，不注册 globalShortcut：全局快捷键是系统级的，影盒开着（哪怕缩在托盘里）
 * 时会把别的程序（浏览器、IDE）里的 F12 / Ctrl+Shift+I 一起吞掉。
 * 开发模式下 F12 已由 @electron-toolkit 的 watchWindowShortcuts 处理，这里不重复切换。
 */
import type { Input, WebContents } from 'electron'

/** 判定用到的按键字段（Electron Input 的子集） */
export type ShortcutInput = Pick<
  Input,
  'type' | 'code' | 'control' | 'meta' | 'alt' | 'shift'
>

/** 这次按键是否要切换 DevTools */
export function isDevToolsToggle(
  input: ShortcutInput,
  options: { platform: NodeJS.Platform; dev: boolean }
): boolean {
  if (input.type !== 'keyDown') return false
  if (input.code === 'F12') return !options.dev
  if (input.code !== 'KeyI') return false
  return options.platform === 'darwin'
    ? input.meta && input.alt && !input.control
    : input.control && input.shift && !input.meta
}

/** 给主窗口装上 DevTools 快捷键 */
export function installDevToolsShortcut(
  contents: WebContents,
  options: { platform: NodeJS.Platform; dev: boolean }
): void {
  contents.on('before-input-event', (event, input) => {
    if (!isDevToolsToggle(input, options)) return
    event.preventDefault()
    contents.toggleDevTools()
  })
}
