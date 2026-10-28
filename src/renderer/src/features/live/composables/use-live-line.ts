/**
 * 直播播放区的线路状态机：每换一条线路，先让主进程探测（格式 / 状态码 / 超时），再决定交给 hls.js、
 * <video> 还是判为内置播放器不支持；当前线路报错、探测失败或 30 秒内没开始播放，就记下原因并切到下一条，
 * 全部失败后停下，把每条线路的原因交给界面（可一键改用 mpv）。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'

import { toast } from '@/components/ui/toast'
import { liveApi } from '../api'
import { isWebRuntime } from '@/services/library-server'
import { streamProxyPath } from '../../../../../shared/engine-http'

import { type LinePlan, failureSummary, planLine } from '../utils/line-plan'
import { nextLine } from '../utils/live-rules'
import type { LiveChannel } from '../utils/playlist-parse'
import type { StreamProbe } from '../../../../../shared/contract/iptv'

/** 开播超时：探测通过、播放器建好后，超过这么久还没有画面就当作线路失败 */
export const START_TIMEOUT_MS = 30_000
/** 换线后这段时间内的错误视为上一条线路的余波（旧播放器销毁前补发的错误） */
const ERROR_GRACE_MS = 300

/** 探测一条线路；没有接口时返回 null，按扩展名猜。 */
async function probe(url: string): Promise<StreamProbe | null> {
  const iptv = liveApi()
  if (!iptv?.probeStream) return null
  try {
    return await iptv.probeStream(url)
  } catch (error) {
    return { ok: false, failure: 'network', error: (error as Error).message }
  }
}

/** useLiveLine 的返回值 */
export interface LiveLineState {
  /** 当前线路下标 */
  line: Ref<number>
  /** 全部线路都失败了 */
  failed: Ref<boolean>
  /** 重试计数（播放器 key） */
  attempt: Ref<number>
  plan: Ref<LinePlan | null>
  probing: Ref<boolean>
  reasons: Ref<(string | undefined)[]>
  /** 全部失败时的逐条原因 */
  summary: ComputedRef<string>
  /** 当前线路地址 */
  url: ComputedRef<string>
  pickLine: (index: number) => void
  retry: () => void
  onPlaying: () => void
  onPlayerError: (event?: Event) => void
}

/** 线路状态与操作 */
export function useLiveLine(channel: Ref<LiveChannel | null>): LiveLineState {
  const line = ref(0)
  const failed = ref(false)
  /** 重试时换 key，强制重建播放器 */
  const attempt = ref(0)
  /** 当前线路的播放方案；探测中为 null */
  const plan = ref<LinePlan | null>(null)
  const probing = ref(false)
  /** 每条线路失败的原因（下标 = 线路） */
  const reasons = ref<(string | undefined)[]>([])

  let startTimer: ReturnType<typeof setTimeout> | undefined
  let started = false
  let switchedAt = 0
  let token = 0

  const url = computed(() => channel.value?.urls[line.value] ?? '')
  const summary = computed(() => failureSummary(reasons.value))

  function clearStartTimer(): void {
    clearTimeout(startTimer)
    startTimer = undefined
  }

  /** 当前线路失败：记原因，切下一条，没有了就停下等用户重试 */
  function lineFailed(reason: string): void {
    clearStartTimer()
    const current = channel.value
    if (!current || failed.value) return
    const next = [...reasons.value]
    next[line.value] = reason
    reasons.value = next
    plan.value = null
    const following = nextLine(line.value, current.urls.length)
    if (following === null) {
      failed.value = true
      return
    }
    toast.info(
      `线路 ${line.value + 1}：${reason}，已切换到线路 ${following + 1}`
    )
    line.value = following
  }

  /** 开始当前线路：探测 → 定方案 → 建播放器并计时 */
  async function startLine(): Promise<void> {
    clearStartTimer()
    const ticket = ++token
    plan.value = null
    started = false
    switchedAt = Date.now()
    const target = url.value
    if (!target || failed.value) {
      probing.value = false
      return
    }
    probing.value = true
    const result = await probe(target)
    if (ticket !== token) return
    probing.value = false
    const next = planLine(
      target,
      result,
      isWebRuntime() ? streamProxyPath : undefined
    )
    if (next.mode === 'fail' || next.mode === 'external') {
      lineFailed(next.reason)
      return
    }
    plan.value = next
    switchedAt = Date.now()
    startTimer = setTimeout(
      () => lineFailed(`${START_TIMEOUT_MS / 1000} 秒内没有开始播放`),
      START_TIMEOUT_MS
    )
  }

  /** 播放器开始走时间：停掉开播计时 */
  function onPlaying(): void {
    if (started) return
    started = true
    clearStartTimer()
  }

  /** 播放器报错（CustomEvent.detail 是原因） */
  function onPlayerError(event?: Event): void {
    if (Date.now() - switchedAt < ERROR_GRACE_MS) return
    const detail = (event as CustomEvent<string | undefined> | undefined)
      ?.detail
    lineFailed(typeof detail === 'string' && detail ? detail : '播放出错')
  }

  function pickLine(index: number): void {
    failed.value = false
    if (index === line.value) {
      attempt.value++
      void startLine()
    }
    line.value = index
  }

  function retry(): void {
    failed.value = false
    reasons.value = []
    attempt.value++
    if (line.value === 0) void startLine()
    line.value = 0
  }

  // 换频道：清掉失败状态回到线路 1（线路号变了会再触发一次，由那次开始）；换线路：开始新线路
  watch(
    () => [channel.value?.id, url.value] as const,
    ([id], previous) => {
      if (previous && id !== previous[0]) {
        failed.value = false
        reasons.value = []
        if (line.value !== 0) {
          line.value = 0
          return
        }
      }
      void startLine()
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    token++
    clearStartTimer()
  })

  return {
    line,
    failed,
    attempt,
    plan,
    probing,
    reasons,
    summary,
    url,
    pickLine,
    retry,
    onPlaying,
    onPlayerError,
  }
}
