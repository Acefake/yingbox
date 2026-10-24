/**
 * 播放器里的前情提要：开播时探测（不调模型），第 2 集起从头播放就在左上角浮出提示卡；
 * 点开后先要之前 1–3 集的摘要（主进程现算并缓存），再流式生成 150–250 字的要点，结果按集缓存。
 */
import {
  type ComputedRef,
  type Ref,
  type ShallowRef,
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { chatStream, toAiError } from '@/features/ai'
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
  open: () => void
  show: () => void
  close: () => void
  regenerate: () => Promise<void>
}

/** 创建前情提要状态 */
export function useRecap(options: RecapOptions): RecapState {
  const enabled = useSetting('ai.recap.prompt')
  const probe = shallowRef<RecapProbe | null>(null)
  const visible = ref(false)
  const expanded = ref(false)
  const text = ref('')
  const loading = ref(false)
  const error = ref('')
  const available = computed(() => Boolean(probe.value?.previous.length))

  let generation = 0
  let controller: AbortController | null = null
  let hideTimer: number | undefined

  const clearTimer = (): void => {
    if (hideTimer) window.clearTimeout(hideTimer)
    hideTimer = undefined
  }

  const abort = (): void => {
    controller?.abort()
    controller = null
  }

  const reset = (): void => {
    generation += 1
    abort()
    clearTimer()
    probe.value = null
    visible.value = false
    expanded.value = false
    text.value = ''
    loading.value = false
    error.value = ''
  }

  watch(
    options.source,
    async source => {
      reset()
      if (!recapAvailable() || !source.startsWith('local://')) return
      const token = generation
      const found = await probeRecap(source, options.isPrivate()).catch(
        () => null
      )
      if (token !== generation) return
      probe.value = found
      if (
        shouldOfferRecap({
          enabled: enabled.value,
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
    const token = generation
    const isPrivate = options.isPrivate()
    abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = ''
    text.value = ''
    try {
      const context = await prepareRecap(source, {
        purpose: 'recap',
        ...(isPrivate ? { private: true } : {}),
      })
      if (token !== generation || current.signal.aborted) return
      if (!context.previous.length) {
        error.value = '之前几集没有可用的字幕或分集简介'
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
            if (token === generation) text.value += delta
          },
        }
      )
      if (token !== generation) return
      text.value = result.content.trim() || text.value.trim()
      if (text.value && context.cacheKey) {
        void saveRecap({
          cacheKey: context.cacheKey,
          text: text.value,
          ...(isPrivate ? { private: true } : {}),
        })
        if (probe.value) probe.value = { ...probe.value, cached: text.value }
      }
    } catch (err) {
      if (token !== generation) return
      const failure = toAiError(err)
      if (failure.code === 'cancelled') text.value = ''
      else error.value = recapErrorText(failure)
    } finally {
      if (token === generation) loading.value = false
      if (controller === current) controller = null
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

  /** 关掉提示卡（生成中的请求一并取消） */
  const close = (): void => {
    abort()
    clearTimer()
    visible.value = false
    expanded.value = false
  }

  onBeforeUnmount(() => {
    generation += 1
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
    open,
    show,
    close,
    regenerate: generate,
  }
}
