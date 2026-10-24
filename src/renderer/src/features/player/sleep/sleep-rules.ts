/**
 * 睡眠定时的纯规则：菜单选项、计时状态、剩余时间、渐弱音量与每次检查该做什么。
 * 不碰 DOM 与播放器，便于单测；接线见 sleep-timer.ts。
 */

/** 菜单里的一项：关 / N 分钟 / 看完本集 */
export type SleepChoice = 'off' | 'episode' | 30 | 60 | 90

/** 设置菜单的选项（顺序即显示顺序） */
export const SLEEP_CHOICES: readonly SleepChoice[] = [
  'off',
  30,
  60,
  90,
  'episode',
]

/** 到点前多久开始渐弱（毫秒） */
export const SLEEP_FADE_MS = 10_000

/** 「看完本集」在片尾前多久暂停（毫秒），赶在 ended 之前，避免自动连播下一集 */
export const SLEEP_EPISODE_GUARD_MS = 500

/**
 * 关掉播放器后多久内又开播（自动连播换集）仍沿用定时；超过就视为新的观看，定时作废（毫秒）
 */
export const SLEEP_REATTACH_MS = 10_000

/** 计时状态：按分钟（绝对截止时刻）或看完本集 */
export type SleepState =
  | { mode: 'minutes'; minutes: number; deadline: number }
  | { mode: 'episode' }

/** 当前播放进度（只读这几个字段） */
export interface SleepMedia {
  currentTime: number
  duration: number
  playbackRate: number
}

/** 一次检查的结论 */
export type SleepStep =
  | { kind: 'idle' }
  /** 渐弱中：音量乘以 factor（0–1） */
  | { kind: 'fade'; factor: number }
  /** 到点：暂停、恢复音量、清掉定时 */
  | { kind: 'stop' }

/**
 * 菜单项的文案。
 * @param choice 选项
 */
export function sleepChoiceLabel(choice: SleepChoice): string {
  if (choice === 'off') return '关'
  if (choice === 'episode') return '看完本集'
  return `${choice} 分钟`
}

/**
 * 选中一项后的计时状态；「关」返回 null。
 * @param choice 选项
 * @param now 当前时刻（毫秒）
 */
export function startSleep(
  choice: SleepChoice,
  now: number
): SleepState | null {
  if (choice === 'off') return null
  if (choice === 'episode') return { mode: 'episode' }
  return { mode: 'minutes', minutes: choice, deadline: now + choice * 60_000 }
}

/**
 * 状态对应的菜单项（给菜单标出当前选中）。
 * @param state 计时状态
 */
export function sleepChoiceOf(state: SleepState | null): SleepChoice {
  if (!state) return 'off'
  if (state.mode === 'episode') return 'episode'
  return SLEEP_CHOICES.includes(state.minutes as SleepChoice)
    ? (state.minutes as SleepChoice)
    : 'off'
}

/**
 * 离暂停还剩多少毫秒；无法判断（时长未知的直播流选了「看完本集」）返回 null。
 * 「看完本集」按播放速度换算成真实时间，并扣掉片尾保护时间。
 * @param state 计时状态
 * @param now 当前时刻（毫秒）
 * @param media 播放进度
 */
export function sleepRemainingMs(
  state: SleepState,
  now: number,
  media: SleepMedia
): number | null {
  if (state.mode === 'minutes') return Math.max(0, state.deadline - now)
  const { currentTime, duration } = media
  if (!Number.isFinite(duration) || duration <= 0) return null
  if (!Number.isFinite(currentTime)) return null
  const rate = media.playbackRate > 0 ? media.playbackRate : 1
  const left = ((duration - currentTime) * 1000) / rate - SLEEP_EPISODE_GUARD_MS
  return Math.max(0, left)
}

/**
 * 渐弱系数：剩余时间进入最后 fadeMs 后从 1 线性降到 0。
 * @param remainingMs 剩余毫秒
 * @param fadeMs 渐弱时长
 */
export function sleepFadeFactor(
  remainingMs: number,
  fadeMs = SLEEP_FADE_MS
): number {
  if (!(fadeMs > 0) || remainingMs >= fadeMs) return 1
  return Math.min(1, Math.max(0, remainingMs / fadeMs))
}

/**
 * 每次检查该做什么。暂停中不渐弱（没有声音可减）；按分钟计时暂停中到点也直接结束。
 * @param state 计时状态
 * @param now 当前时刻（毫秒）
 * @param media 播放进度
 * @param playing 是否正在播放
 */
export function sleepStep(
  state: SleepState | null,
  now: number,
  media: SleepMedia,
  playing: boolean
): SleepStep {
  if (!state) return { kind: 'idle' }
  const remaining = sleepRemainingMs(state, now, media)
  if (remaining === null) return { kind: 'idle' }
  if (remaining <= 0) return { kind: 'stop' }
  if (!playing) return { kind: 'idle' }
  const factor = sleepFadeFactor(remaining)
  return factor < 1 ? { kind: 'fade', factor } : { kind: 'idle' }
}

/**
 * 播放到结尾（ended）时睡眠定时是否该生效：「看完本集」一定生效；按分钟计时已到点也生效。
 * 生效即本次暂停、不连播下一集，并清掉定时。片尾前的轮询可能被拖动进度或主线程卡顿错过，
 * 所以结束事件 / 自动连播入口要同步再判一次。
 * @param state 计时状态
 * @param now 当前时刻（毫秒）
 */
export function sleepEndsAtVideoEnd(
  state: SleepState | null,
  now: number
): boolean {
  if (!state) return false
  if (state.mode === 'episode') return true
  return state.deadline - now <= 0
}

/**
 * 剩余时间的短文案（菜单右侧提示）：「剩 29:05」「剩 1:02:00」。
 * @param remainingMs 剩余毫秒
 */
export function formatSleepRemaining(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `剩 ${h}:${pad(m)}:${pad(s)}` : `剩 ${m}:${pad(s)}`
}

/**
 * 新播放器挂上来时是否沿用已有定时：上一个播放器拆掉不久（自动连播换集）才沿用。
 * @param detachedAt 上一个播放器拆掉的时刻；null 表示一直有播放器在
 * @param now 当前时刻（毫秒）
 */
export function keepSleepOnAttach(
  detachedAt: number | null,
  now: number
): boolean {
  if (detachedAt === null) return true
  return now - detachedAt <= SLEEP_REATTACH_MS
}
