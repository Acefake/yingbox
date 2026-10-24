/**
 * 播放器里的问剧情：侧面板里提问，主进程准备「之前各集摘要 + 本集当前进度之前的台词」，
 * 渲染层流式回答。会话随本集：换集或关掉播放器就清空。
 */
import { type Ref, onBeforeUnmount, ref, watch } from 'vue'

import { chatStream, toAiError } from '@/features/ai'

import { type QaTurn, qaMessages } from '../../../../../shared/recap/prompts'
import { prepareRecap, recapAvailable } from './recap-api'
import { recapErrorText } from './recap-rules'

/** 面板里的一条消息 */
export interface QaMessage extends QaTurn {
  id: number
  /** 提问时的播放进度（秒，只有提问有） */
  seconds?: number
  /** 回答失败（错误说明放在 text） */
  error?: boolean
}

/** usePlotQa 的依赖 */
export interface PlotQaOptions {
  /** 当前播放地址（解析后）；local:// 才支持 */
  source: () => string
  /** 来自私密板块 */
  isPrivate: () => boolean
  /** 当前播放进度（秒） */
  currentTime: () => number
}

/** usePlotQa 的返回值 */
export interface PlotQaState {
  /** 当前视频能否问（桌面端 + 本地文件） */
  supported: () => boolean
  open: Ref<boolean>
  messages: Ref<QaMessage[]>
  input: Ref<string>
  busy: Ref<boolean>
  openPanel: () => void
  close: () => void
  ask: () => Promise<void>
  stop: () => void
}

/** 创建问剧情状态 */
export function usePlotQa(options: PlotQaOptions): PlotQaState {
  const open = ref(false)
  const messages = ref<QaMessage[]>([])
  const input = ref('')
  const busy = ref(false)
  let nextId = 0
  let generation = 0
  let controller: AbortController | null = null

  const supported = (): boolean =>
    recapAvailable() && options.source().startsWith('local://')

  const stop = (): void => {
    controller?.abort()
    controller = null
  }

  // 会话随本集：换集清空
  watch(options.source, () => {
    generation += 1
    stop()
    messages.value = []
    input.value = ''
    busy.value = false
  })

  const ask = async (): Promise<void> => {
    const question = input.value.trim()
    if (!question || busy.value || !supported()) return
    const source = options.source()
    const isPrivate = options.isPrivate()
    const seconds = Math.max(0, options.currentTime() || 0)
    const token = generation
    const history: QaTurn[] = messages.value
      .filter(item => !item.error)
      .map(item => ({ role: item.role, text: item.text }))
    input.value = ''
    messages.value.push({ id: ++nextId, role: 'user', text: question, seconds })
    messages.value.push({ id: ++nextId, role: 'assistant', text: '' })
    const answer = messages.value[messages.value.length - 1]
    const current = new AbortController()
    controller = current
    busy.value = true
    try {
      const context = await prepareRecap(source, {
        purpose: 'qa',
        seconds,
        ...(isPrivate ? { private: true } : {}),
      })
      if (token !== generation || current.signal.aborted)
        throw new DOMException('aborted', 'AbortError')
      const result = await chatStream(
        {
          messages: qaMessages({ context, question, history }),
          temperature: 0.3,
          maxTokens: 600,
          ...(isPrivate ? { private: true } : {}),
        },
        {
          signal: current.signal,
          onDelta: delta => {
            if (token === generation) answer.text += delta
          },
        }
      )
      if (token === generation)
        answer.text = result.content.trim() || answer.text.trim()
    } catch (err) {
      if (token !== generation) return
      const failure =
        err instanceof DOMException
          ? { code: 'cancelled' as const, message: '' }
          : toAiError(err)
      if (failure.code === 'cancelled') {
        answer.text = answer.text.trim() || '已停止'
      } else {
        answer.text = recapErrorText(failure)
        answer.error = true
      }
    } finally {
      if (token === generation) busy.value = false
      if (controller === current) controller = null
    }
  }

  const openPanel = (): void => {
    open.value = true
  }

  const close = (): void => {
    open.value = false
  }

  onBeforeUnmount(() => {
    generation += 1
    stop()
  })

  return {
    supported,
    open,
    messages,
    input,
    busy,
    openPanel,
    close,
    ask,
    stop,
  }
}
