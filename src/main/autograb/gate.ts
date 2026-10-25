/**
 * 追更的 115 闸门：所有追更发出的 115 请求排成一队，限速、按天限额、遇到风控就熔断。
 *
 * - 串行：同一时间只有一个请求，两次之间至少 {@link GateOptions.gapMs} 加随机抖动；
 * - 限额：每天快照 / 转存（含撤销时的删除）次数有上限（本地日期，跨天清零），到上限当天不再发；
 * - 熔断：115 要求安全验证（911）或提示操作频繁时暂停 {@link TRIP_PAUSE_MS}；
 *   48 小时内第二次熔断就一直停，等用户在界面上点恢复；登录失效也一直停，重新扫码后自动恢复。
 * 状态是普通对象（存进追更状态文件），闸门只读写它。
 */
import { LOGIN_EXPIRED_CODES, Pan115Error } from '../pan115/errors'
import { dayKey } from './schedule-rules'

/** 熔断后暂停多久 */
export const TRIP_PAUSE_MS = 6 * 3_600_000
/** 多久内第二次熔断就停到手动恢复 */
const REPEAT_WINDOW_MS = 48 * 3_600_000
/** 「一直停」用的时间（远未来） */
export const FOREVER = 8_640_000_000_000_000
/** 风控错误码 */
const RISK_CODES = [911, 990009, 40140105]
const RISK_RE = /频繁|安全验证|验证码|稍后再试|too many/i

/** 闸门状态（持久化） */
export interface GateState {
  day: string
  snaps: number
  receives: number
  pausedUntil: number | null
  pauseReason: string | null
  /** 上一次熔断时间 */
  lastTrip: number | null
  /** 暂停是因为登录失效 */
  loginPause: boolean
}

/** 请求种类：快照 / 列目录 / 查空间算 snap，转存算 receive；删除（撤销）和转存同算写操作，共用转存限额 */
export type GateKind = 'snap' | 'receive' | 'delete'

/** 闸门参数 */
export interface GateOptions {
  now: () => number
  sleep: (ms: number) => Promise<void>
  random?: () => number
  gapMs?: number
  jitterMs?: number
  maxSnaps?: number
  maxReceives?: number
}

/** 闸门拦下的请求（暂停中 / 超限额） */
export class GateClosed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GateClosed'
  }
}

/** 空状态 */
export function emptyGate(now: number): GateState {
  return {
    day: dayKey(now),
    snaps: 0,
    receives: 0,
    pausedUntil: null,
    pauseReason: null,
    lastTrip: null,
    loginPause: false,
  }
}

/** 是不是风控类错误 */
export function isRiskError(error: unknown): boolean {
  if (!(error instanceof Pan115Error)) return false
  if (error.code !== undefined && RISK_CODES.includes(error.code)) return true
  return RISK_RE.test(error.message)
}

/** 是不是登录失效 */
export function isLoginError(error: unknown): boolean {
  return (
    error instanceof Pan115Error &&
    ((error.code !== undefined && LOGIN_EXPIRED_CODES.includes(error.code)) ||
      /登录/.test(error.message))
  )
}

/** 闸门 */
export interface Gate {
  run<T>(kind: GateKind, task: () => Promise<T>): Promise<T>
  /** 现在是否暂停（顺便处理跨天和到期） */
  paused(): boolean
  resume(): void
}

/** 创建闸门；state 由调用方持有并负责落盘（onChange 时） */
export function createGate(
  state: GateState,
  options: GateOptions,
  onChange: () => void
): Gate {
  const gap = options.gapMs ?? 3000
  const jitter = options.jitterMs ?? 2000
  const maxSnaps = options.maxSnaps ?? 200
  const maxReceives = options.maxReceives ?? 30
  const random = options.random ?? Math.random
  let chain: Promise<unknown> = Promise.resolve()
  let last = 0

  function roll(now: number): void {
    const day = dayKey(now)
    if (state.day !== day) {
      state.day = day
      state.snaps = 0
      state.receives = 0
      onChange()
    }
    if (state.pausedUntil !== null && now >= state.pausedUntil) {
      state.pausedUntil = null
      state.pauseReason = null
      state.loginPause = false
      onChange()
    }
  }

  function trip(now: number, error: unknown): void {
    if (isLoginError(error)) {
      state.pausedUntil = FOREVER
      state.pauseReason = '115 登录已失效，重新扫码后自动恢复'
      state.loginPause = true
    } else {
      const repeat =
        state.lastTrip !== null && now - state.lastTrip < REPEAT_WINDOW_MS
      state.lastTrip = now
      state.pausedUntil = repeat ? FOREVER : now + TRIP_PAUSE_MS
      state.pauseReason = repeat
        ? '115 连续触发风控，已停止追更，请确认账号正常后点恢复'
        : `115 触发风控（${(error as Error).message}），暂停 6 小时`
    }
    onChange()
  }

  async function guarded<T>(
    kind: GateKind,
    task: () => Promise<T>
  ): Promise<T> {
    roll(options.now())
    if (state.pausedUntil !== null)
      throw new GateClosed(state.pauseReason ?? '追更已暂停')
    if (kind === 'snap' && state.snaps >= maxSnaps)
      throw new GateClosed('今天的 115 查询次数已用完，明天继续')
    if (kind !== 'snap' && state.receives >= maxReceives)
      throw new GateClosed(
        '今天的 115 转存次数已用完（撤销的删除也算），明天继续'
      )
    const wait = last + gap + random() * jitter - options.now()
    if (wait > 0) await options.sleep(wait)
    if (kind === 'snap') state.snaps++
    else state.receives++
    onChange()
    try {
      return await task()
    } catch (error) {
      if (isRiskError(error) || isLoginError(error)) trip(options.now(), error)
      throw error
    } finally {
      last = options.now()
    }
  }

  return {
    run<T>(kind: GateKind, task: () => Promise<T>): Promise<T> {
      const result = chain.then(() => guarded(kind, task))
      chain = result.catch(() => {})
      return result
    },
    paused(): boolean {
      roll(options.now())
      return state.pausedUntil !== null
    },
    resume(): void {
      state.pausedUntil = null
      state.pauseReason = null
      state.loginPause = false
      onChange()
    },
  }
}
