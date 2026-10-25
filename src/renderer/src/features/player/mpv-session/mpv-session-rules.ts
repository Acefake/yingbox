/**
 * mpv 会话的纯规则：mpv 推来的状态怎么判成「播到结尾」、这一刻该做什么（记进度 / 记看完 / 倒计时 / 取消）。
 *
 * mpv 用 --keep-open=yes 启动：播到结尾停在最后一帧并暂停，不发 eof 事件，所以按位置判断。
 * 不依赖 Vue 和 window，状态与副作用在 mpv-session.ts。
 */
import type { MpvStatus } from '@shared/mpv'

/** 离结尾不到这么多秒、且暂停着，算播到结尾。 */
export const END_SLACK = 1.5
/** 两次记进度之间的最短间隔（毫秒），与内置播放器一致。 */
export const SAVE_INTERVAL = 2000
/** 播完后「下一集」倒计时（秒）。 */
export const MPV_NEXT_COUNTDOWN = 5

/** 是否停在结尾。 */
export function atEnd(
  status: Pick<MpvStatus, 'position' | 'duration' | 'paused'>
): boolean {
  const { position = 0, duration = 0 } = status
  return status.paused && duration > 0 && position >= duration - END_SLACK
}

/** 会话里与判断有关的状态。 */
export interface SessionTick {
  /** 这一集已经记过看完 */
  finished: boolean
  /** 正在倒计时 */
  counting: boolean
  /** 上次记进度的时间 */
  lastSave: number
}

/** 这一刻要做的事。 */
export type MpvStep =
  | { kind: 'stop' }
  | { kind: 'idle' }
  | { kind: 'save' }
  | { kind: 'finish' }
  | { kind: 'cancel' }

/**
 * 根据 mpv 状态决定这一刻做什么：
 * - mpv 退出 → stop（记最后的位置、结束会话）；
 * - 加载中 → idle；
 * - 倒计时中离开了结尾（拖回去、继续播）→ cancel；
 * - 第一次停在结尾 → finish（记看完，有下一集时开始倒计时）；
 * - 否则距上次记进度满 SAVE_INTERVAL → save。
 */
export function mpvStep(
  status: Pick<
    MpvStatus,
    'running' | 'loading' | 'position' | 'duration' | 'paused'
  >,
  tick: SessionTick,
  now: number
): MpvStep {
  if (!status.running) return { kind: 'stop' }
  if (status.loading) return { kind: 'idle' }
  const end = atEnd(status)
  if (tick.counting) return end ? { kind: 'idle' } : { kind: 'cancel' }
  if (end) return tick.finished ? { kind: 'idle' } : { kind: 'finish' }
  if (!((status.position ?? 0) > 0)) return { kind: 'idle' }
  return now - tick.lastSave >= SAVE_INTERVAL
    ? { kind: 'save' }
    : { kind: 'idle' }
}
