/**
 * 播放器里的前情提要：开播时探测（不调模型），第 2 集起从头播放就在左上角浮出提示卡；
 * 点开后先要之前 1–3 集的摘要（主进程现算并缓存），再流式生成 150–250 字的要点，结果按集缓存。
 *
 * 两个计数：session 跟着换集走（作废探测结果），run 跟着每次生成走；关闭卡片立刻推进 run、
 * loading 归零，迟到的结果按 run 丢弃，prepare 经 requestId 在主进程一并取消。
 */
import {
  type ComputedRef,
  type Ref,
  type ShallowRef,
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { aiKeyConfigured, chatStream, toAiError } from '@/features/ai'
import { useSetting } from '@/features/settings'

import { recapMessages } from '../../../../../shared/recap/prompts'
import type { RecapProbe } from '../../../../../shared/recap/types'
import {
  prepareRecap,
  probeRecap,
  recapAvailable,
  saveRecap,
} from './recap-api'
import {
  CARD_AUTO_HIDE_MS,
  isAbortError,
  recapAiReady,
  recapErrorText,
  shouldOfferRecap,
} from './recap-rules'

/** useRecap 的依赖 */
export interface RecapOptions {
  /** 当前播放地址（解析后）；local:// 才支持 */
  source: () => string
  /** 来自私密板块 */
  isPrivate: () => boolean
  /** 起播位置（秒） */
  startAt: () => number
}

/** useRecap 的返回值 */
export interface RecapState {
  /** 开播探测结果 */
  probe: ShallowRef<RecapProbe | null>
  /** 之前几集有素材，可以生成 */
  available: ComputedRef<boolean>
  /** 提示卡是否显示 */
  visible: Ref<boolean>
  /** 是否已点开 */
  expanded: Ref<boolean>
  /** 前情提要正文（流式累加） */
  text: Ref<string>
  loading: Ref<boolean>
  error: Ref<string>
  /** 给读屏的一句状态（生成完成 / 失败时写入） */
  announcement: Ref<string>
  open: () => void
  show: () => void
  close: () => void
  regenerate: () => Promise<void>
}

/** 创建前情提要状态 */
export function useRecap(options: RecapOptions): RecapState {
  const enabled = useSetting('ai.recap.prompt')
  const provider = useSetting('ai.provider')
  const baseUrl = useSetting('ai.baseUrl')
  const model = useSetting('ai.model')
  const probe = shallowRef<RecapProbe | null>(null)
  const visible = ref(false)
  const expanded = ref(false)
  const text = ref('')
  const loading = ref(false)
  const error = ref('')
  const announcement = ref('')
  const available = computed(() => Boolean(probe.value?.previous.length))

  let session = 0
  let run = 0
  let controller: AbortController | null = null
  let hideTimer: number | undefined

  const clearTimer = (): void => {
    if (hideTimer) window.clearTimeout(hideTimer)
    hideTimer = undefined
  }

  /** 放弃正在进行的生成：推进 run、取消请求、loading 归零 */
  const abort = (): void => {
    run += 1
    controller?.abort()
    controller = null
    loading.value = false
  }

  const reset = (): void => {
    session += 1
    abort()
    clearTimer()
    probe.value = null
    visible.value = false
    expanded.value = false
    text.value = ''
    loading.value = false
    error.value = ''
    announcement.value = ''
  }

  watch(
    options.source,
    async source => {
      reset()
      if (!recapAvailable() || !source.startsWith('local://')) return
      const token = session
      const found = await probeRecap(source, options.isPrivate()).catch(
        () => null
      )
      if (token !== session) return
      probe.value = found
      const aiReady = recapAiReady({
        provider: provider.value,
        baseUrl: baseUrl.value,
        model: model.value,
        keySaved: aiKeyConfigured(provider.value),
      })
      if (
        shouldOfferRecap({
          enabled: enabled.value,
          aiReady,
          probe: found,
          startAt: options.startAt(),
        })
      ) {
        visible.value = true
        hideTimer = window.setTimeout(() => {
          if (!expanded.value) visible.value = false
        }, CARD_AUTO_HIDE_MS)
      }
    },
    { immediate: true }
  )

  const generate = async (): Promise<void> => {
    const source = options.source()
    const isPrivate = options.isPrivate()
    abort()
    const token = run
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = ''
    text.value = ''
    announcement.value = ''
    const live = (): boolean => token === run
    try {
      const context = await prepareRecap(
        source,
        {
          purpose: 'recap',
          ...(isPrivate ? { private: true } : {}),
        },
        current.signal
      )
      if (!live()) return
      if (!context.previous.length) {
        error.value = '之前几集没有可用的字幕或分集简介'
        announcement.value = error.value
        return
      }
      const result = await chatStream(
        {
          messages: recapMessages(context),
          temperature: 0.5,
          maxTokens: 800,
          ...(isPrivate ? { private: true } : {}),
        },
        {
          signal: current.signal,
          onDelta: delta => {
            if (live()) text.value += delta
          },
        }
      )
      if (!live()) return
      text.value = result.content.trim() || text.value.trim()
      announcement.value = '前情提要已生成'
      if (text.value && context.cacheKey) {
        void saveRecap({
          cacheKey: context.cacheKey,
          text: text.value,
          ...(isPrivate ? { private: true } : {}),
        })
        if (probe.value) probe.value = { ...probe.value, cached: text.value }
      }
    } catch (err) {
      if (!live()) return
      const failure = isAbortError(err)
        ? { code: 'cancelled' as const, message: '' }
        : toAiError(err)
      if (failure.code === 'cancelled') text.value = ''
      else {
        error.value = recapErrorText(failure)
        announcement.value = error.value
      }
    } finally {
      if (live()) {
        loading.value = false
        controller = null
      }
    }
  }

  /** 点开提示卡：有缓存直接展示，否则生成 */
  const open = (): void => {
    clearTimer()
    expanded.value = true
    if (loading.value || (text.value && !error.value)) return
    const cached = probe.value?.cached
    if (cached) text.value = cached
    else void generate()
  }

  /** 从播放器菜单手动打开 */
  const show = (): void => {
    if (!available.value) return
    visible.value = true
    open()
  }

  /** 关掉提示卡：生成中的请求一并取消，没生成完的半截正文丢掉（再打开时重新生成） */
  const close = (): void => {
    if (loading.value) {
      abort()
      text.value = ''
    }
    clearTimer()
    visible.value = false
    expanded.value = false
  }

  onScopeDispose(() => {
    session += 1
    abort()
    clearTimer()
  })

  return {
    probe,
    available,
    visible,
    expanded,
    text,
    loading,
    error,
    announcement,
    open,
    show,
    close,
    regenerate: generate,
  }
}
