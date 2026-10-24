/**
 * 托盘与媒体键的纯规则：菜单项、提示文字、媒体键与命令的对应、什么时候占用媒体键。
 * 不依赖 electron，便于测试；接线在同目录的 index.ts。
 */
import type { MediaCommand, NowPlaying } from '../../shared/now-playing'

/** 托盘菜单里能点的动作 */
export type TrayAction = MediaCommand | 'show' | 'quit'

/** 一项托盘菜单（index.ts 转成 Electron MenuItem） */
export type TrayMenuEntry =
  | { type: 'label'; label: string }
  | { type: 'separator' }
  | { type: 'action'; action: TrayAction; label: string; enabled: boolean }

/** 菜单里标题最多显示的字符数（再长的系统菜单会被撑得很宽） */
export const TRAY_TITLE_MAX = 40

/** 应用名（托盘提示文字的前缀） */
export const APP_NAME = '影盒'

/** 过长的标题截断加省略号 */
export function clipTitle(title: string, max = TRAY_TITLE_MAX): string {
  const chars = [...title.trim()]
  return chars.length > max
    ? `${chars.slice(0, max - 1).join('')}…`
    : chars.join('')
}

/** 托盘菜单：正在播放（只读）→ 播放 / 暂停、下一集 → 显示主窗口、退出 */
export function trayMenu(state: NowPlaying | null): TrayMenuEntry[] {
  const playing = state
    ? `正在播放：${clipTitle(state.title) || '未命名'}`
    : '没有正在播放的内容'
  return [
    { type: 'label', label: playing },
    { type: 'separator' },
    {
      type: 'action',
      action: 'playpause',
      label: state?.playing ? '暂停' : '播放',
      enabled: Boolean(state),
    },
    {
      type: 'action',
      action: 'next',
      label: '下一集',
      enabled: Boolean(state?.hasNext),
    },
    { type: 'separator' },
    { type: 'action', action: 'show', label: '显示主窗口', enabled: true },
    { type: 'action', action: 'quit', label: '退出', enabled: true },
  ]
}

/** 托盘悬停提示：应用名，在播时带上标题 */
export function trayTooltip(state: NowPlaying | null): string {
  if (!state) return APP_NAME
  const status = state.playing ? '正在播放' : '已暂停'
  return `${APP_NAME} · ${status}：${clipTitle(state.title, 60) || '未命名'}`
}

/** 媒体键（Electron accelerator）→ 播放命令 */
export const MEDIA_KEY_COMMANDS: ReadonlyArray<
  readonly [accelerator: string, command: MediaCommand]
> = [
  ['MediaPlayPause', 'playpause'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'previous'],
]

/**
 * 是否注册全局媒体键：设置打开、内置播放器正在会话中（播放或暂停都算）、系统允许。
 * 不在播时不占用，媒体键留给其他应用（音乐播放器等）。
 */
export function shouldGrabMediaKeys(input: {
  enabled: boolean
  state: NowPlaying | null
  /** macOS 需要「辅助功能」授权，否则注册的媒体键收不到 */
  permitted: boolean
}): boolean {
  return input.enabled && input.permitted && input.state !== null
}
