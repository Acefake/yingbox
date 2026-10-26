/**
 * 主窗口的 DevTools 快捷键：F12，或 Ctrl+Shift+I（macOS Cmd+Option+I），只在主窗口聚焦时生效。
 *
 * 走窗口自己的 before-input-event，不注册 globalShortcut：全局快捷键是系统级的，影盒开着（哪怕缩在托盘里）
 * 时会把别的程序（浏览器、IDE）里的 F12 / Ctrl+Shift+I 一起吞掉。
 * 只认精确组合（多按一个修饰键不算），按住不放产生的重复按键也不算，避免 DevTools 反复开关。
 * 开发模式下 F12 已由 @electron-toolkit 的 watchWindowShortcuts 处理，这里不重复切换。
 */
import type { Input } from 'electron'

/** 判定用到的按键字段（Electron Input 的子集） */
export type ShortcutInput = Pick<
  Input,
  'type' | 'code' | 'isAutoRepeat' | 'control' | 'meta' | 'alt' | 'shift'
>

/** 判定选项：平台与是否开发模式 */
export interface DevToolsShortcutOptions {
  platform: NodeJS.Platform
  dev: boolean
}

/** 这次按键是否要切换 DevTools */
export function isDevToolsToggle(
  input: ShortcutInput,
  options: DevToolsShortcutOptions
): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false
  if (input.code === 'F12') {
    const bare = !input.control && !input.meta && !input.alt && !input.shift
    return bare && !options.dev
  }
  if (input.code !== 'KeyI') return false
  return options.platform === 'darwin'
    ? input.meta && input.alt && !input.control && !input.shift
    : input.control && input.shift && !input.alt && !input.meta
}

/** installDevToolsShortcut 需要的最小 webContents 接口（便于测试注入） */
export interface ShortcutContents {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: ShortcutInput) => void
  ): unknown
  isDestroyed(): boolean
  toggleDevTools(): void
}

/** 给主窗口装上 DevTools 快捷键；窗口正在销毁时按键直接忽略 */
export function installDevToolsShortcut(
  contents: ShortcutContents,
  options: DevToolsShortcutOptions
): void {
  contents.on('before-input-event', (event, input) => {
    if (!isDevToolsToggle(input, options)) return
    event.preventDefault()
    if (!contents.isDestroyed()) contents.toggleDevTools()
  })
}
