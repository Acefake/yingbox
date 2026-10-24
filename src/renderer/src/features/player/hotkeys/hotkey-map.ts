/**
 * 播放弹窗的键盘快捷键与双击手势（照 YouTube 网页播放器）：按键 → 动作的纯映射，不碰 DOM。
 *
 * 空格 / K 播放暂停，J / L ±10 秒，← / → ±5 秒，↑ / ↓ 音量 ±5%，M 静音，F 全屏，I 缩成小窗，
 * C 字幕，0–9 跳到 0%–90%，< / > 调速，Shift+N 下一集。
 * 输入法组字中（isComposing / keyCode 229）、焦点在输入框里、带 Ctrl / ⌘ / Alt 的组合键一律不处理。
 */

/** 一个快捷键动作 */
export type HotkeyAction =
  | { kind: 'toggle' }
  | { kind: 'seek'; delta: number }
  | { kind: 'seekTo'; fraction: number }
  | { kind: 'volume'; delta: number }
  | { kind: 'mute' }
  | { kind: 'fullscreen' }
  | { kind: 'mini' }
  | { kind: 'subtitle' }
  | { kind: 'rate'; dir: 1 | -1 }
  | { kind: 'next' }

/** 键盘事件里用到的字段 */
export interface HotkeyEvent {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
  target?: EventTarget | null
}

/**
 * 倍速档位：< / > 快捷键与 Artplayer 内置「播放速度」菜单共用（art-core 把 Artplayer.PLAYBACK_RATE 设为它）。
 * 不放 0.25 / 1.75：内置菜单按 toFixed(1) 显示，会变成「0.3」「1.8」。
 */
export const RATE_STEPS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 单字母键（不分大小写） */
const LETTER_ACTIONS: Record<string, HotkeyAction> = {
  k: { kind: 'toggle' },
  j: { kind: 'seek', delta: -10 },
  l: { kind: 'seek', delta: 10 },
  m: { kind: 'mute' },
  f: { kind: 'fullscreen' },
  i: { kind: 'mini' },
  c: { kind: 'subtitle' },
}

/** 其余键 */
const KEY_ACTIONS: Record<string, HotkeyAction> = {
  ' ': { kind: 'toggle' },
  ArrowLeft: { kind: 'seek', delta: -5 },
  ArrowRight: { kind: 'seek', delta: 5 },
  ArrowUp: { kind: 'volume', delta: 0.05 },
  ArrowDown: { kind: 'volume', delta: -0.05 },
  '<': { kind: 'rate', dir: -1 },
  '>': { kind: 'rate', dir: 1 },
}

/** 事件目标是否可输入（输入框、文本域、下拉框、可编辑区） */
export function isTypingTarget(
  target: EventTarget | null | undefined
): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: unknown; isContentEditable?: unknown }
  if (el.isContentEditable === true) return true
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 按键 → 动作；不处理的键返回 null */
export function resolveHotkey(event: HotkeyEvent): HotkeyAction | null {
  if (event.isComposing || event.keyCode === 229) return null
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (isTypingTarget(event.target)) return null
  const { key } = event
  if (key === 'N' && event.shiftKey) return { kind: 'next' }
  if (/^[0-9]$/.test(key)) return { kind: 'seekTo', fraction: Number(key) / 10 }
  const letter =
    key.length === 1 ? LETTER_ACTIONS[key.toLowerCase()] : undefined
  return letter ?? KEY_ACTIONS[key] ?? null
}

/** 按档位升降倍速；不在档位上的先吸到相邻档位，到头不再变 */
export function stepRate(current: number, dir: 1 | -1): number {
  if (dir > 0)
    return RATE_STEPS.find(r => r > current + 1e-9) ?? RATE_STEPS.at(-1)!
  return (
    [...RATE_STEPS].reverse().find(r => r < current - 1e-9) ?? RATE_STEPS[0]
  )
}

/** 双击区域：左三分之一后退 10 秒，右三分之一快进 10 秒，中间切全屏 */
export function dblclickZone(
  x: number,
  width: number
): 'back' | 'fullscreen' | 'forward' {
  if (!(width > 0)) return 'fullscreen'
  if (x < width / 3) return 'back'
  if (x > (width * 2) / 3) return 'forward'
  return 'fullscreen'
}
