/**
 * 播放命令（托盘菜单 / 媒体键 / 系统媒体控件）的纯规则：上一集的含义、换集的目标、重复命令去抖。
 */
import type { MediaCommand } from '../../../../../shared/now-playing'

/** 播放超过这么多秒时「上一集」先回到本集开头（与常见播放器一致） */
export const RESTART_THRESHOLD_S = 3

/** 同一命令在这么短的时间内重复到达视为一次（全局媒体键与系统媒体控件可能同时送达） */
export const COMMAND_DEDUPE_MS = 300

/** 「上一集」实际要做的事：回到本集开头，或切到上一集 */
export function previousAction(
  currentTime: number,
  position: number
): 'restart' | 'previous' {
  if (currentTime > RESTART_THRESHOLD_S || position <= 0) return 'restart'
  return 'previous'
}

/** 换集目标下标；越界返回 null */
export function stepTarget(
  position: number,
  length: number,
  delta: number
): number | null {
  const target = position + delta
  return target >= 0 && target < length ? target : null
}

/** 命令闸门：返回 true 表示执行，短时间内重复的同一命令返回 false */
export function createCommandGate(
  now: () => number = Date.now,
  windowMs = COMMAND_DEDUPE_MS
): (command: MediaCommand) => boolean {
  let last: { command: MediaCommand; at: number } | null = null
  return command => {
    const at = now()
    if (last && last.command === command && at - last.at < windowMs)
      return false
    last = { command, at }
    return true
  }
}
