/**
 * 115 扫码登录的界面状态：取二维码 → 轮询直到终态。
 * loginStart / loginPoll 抛错时不会卡在「等待扫码」：取码失败提示后可再点扫码登录；
 * 轮询出错停在错误态，二维码保留，可「重试」接着轮询同一张码，或重新获取二维码。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type {
  Pan115Account,
  Pan115LoginPoll,
} from '../../../../../shared/contract/pan115'

import { type LoginOutcome, errorText, pollLogin } from '../utils/netdisk-rules'

/** 依赖 */
export interface QrLoginDeps {
  api: () => Pick<Api['pan115'], 'loginStart' | 'loginPoll'>
  /** 登录成功 */
  onDone(account: Pan115Account): void
  /** 取二维码失败的提示 */
  notifyError(message: string): void
  /** 两次轮询的间隔（测试用 0） */
  intervalMs?: number
}

/** 扫码登录的状态与动作 */
export interface QrLogin {
  qrUrl: Ref<string>
  /** 正在取二维码 */
  loading: Ref<boolean>
  status: Ref<Pan115LoginPoll['status']>
  error: Ref<string>
  /** 出错且二维码还在：可以接着轮询 */
  canRetry: ComputedRef<boolean>
  start(): Promise<void>
  retry(): Promise<void>
  stop(): void
}

export function useQrLogin(deps: QrLoginDeps): QrLogin {
  const qrUrl = ref('')
  const loading = ref(false)
  const status = ref<Pan115LoginPoll['status']>('waiting')
  const error = ref('')
  let polling: AbortController | null = null

  function stop(): void {
    polling?.abort()
    polling = null
  }

  /** 轮询当前二维码直到终态 */
  async function watch(): Promise<void> {
    stop()
    const controller = new AbortController()
    polling = controller
    status.value = 'waiting'
    error.value = ''
    let outcome: LoginOutcome
    try {
      outcome = await pollLogin(() => deps.api().loginPoll(), {
        signal: controller.signal,
        onStatus: next => (status.value = next),
        intervalMs: deps.intervalMs,
      })
    } catch (e) {
      outcome = { status: 'error', error: `查询扫码状态失败：${errorText(e)}` }
    }
    if (controller.signal.aborted) return
    polling = null
    status.value = outcome.status
    if (outcome.status === 'done') {
      qrUrl.value = ''
      deps.onDone(outcome.account)
    } else if (outcome.status === 'error') error.value = outcome.error
  }

  async function start(): Promise<void> {
    stop()
    loading.value = true
    let started: Awaited<ReturnType<Api['pan115']['loginStart']>>
    try {
      started = await deps.api().loginStart()
    } catch (e) {
      started = { ok: false, error: `取二维码失败：${errorText(e)}` }
    } finally {
      loading.value = false
    }
    if (!started.ok) {
      qrUrl.value = ''
      deps.notifyError(started.error)
      return
    }
    qrUrl.value = started.imageUrl
    await watch()
  }

  const canRetry = computed(
    () => status.value === 'error' && Boolean(qrUrl.value)
  )

  return {
    qrUrl,
    loading,
    status,
    error,
    canRetry,
    start,
    retry: watch,
    stop,
  }
}
