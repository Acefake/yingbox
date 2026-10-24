/**
 * 播放器里的问剧情：侧面板里提问，主进程准备「之前各集摘要 + 本集当前进度之前的台词」，
 * 渲染层流式回答。会话随本集：换集或关掉播放器就清空。
 *
 * 每次提问一个 generation：停止 / 换集立刻推进 generation、busy 归零，
 * 之后才到的 prepare 结果与流式增量按 generation 丢弃；prepare 经 requestId 在主进程一并取消。
 */
import { type Ref, onScopeDispose, ref, watch } from 'vue'

import { chatStream, toAiError } from '@/features/ai'

import { type QaTurn, qaMessages } from '../../../../../shared/recap/prompts'
import { prepareRecap, recapAvailable } from './recap-api'
import { isAbortError, recapErrorText } from './recap-rules'

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
  /** 给读屏的一句状态（回答完成 / 失败 / 已停止时写入） */
  announcement: Ref<string>
  openPanel: () => void
  close: () => void
  ask: () => Promise<void>
  stop: () => void
}

/** 正在进行的一次提问 */
interface Running {
  token: number
  controller: AbortController
  answer: QaMessage
}

/** 创建问剧情状态 */
export function usePlotQa(options: PlotQaOptions): PlotQaState {
  const open = ref(false)
  const messages = ref<QaMessage[]>([])
  const input = ref('')
  const busy = ref(false)
  const announcement = ref('')
  let nextId = 0
  let generation = 0
  let running: Running | null = null

  const supported = (): boolean =>
    recapAvailable() && options.source().startsWith('local://')

  /** 放弃当前提问：推进 generation、取消请求、busy 归零；返回被放弃的回答 */
  const abandon = (): QaMessage | null => {
    generation += 1
    const current = running
    running = null
    busy.value = false
    current?.controller.abort()
    return current?.answer ?? null
  }

  const stop = (): void => {
    const answer = abandon()
    if (!answer) return
    answer.text = answer.text.trim() || '已停止'
    announcement.value = '已停止'
  }

  // 会话随本集：换集清空
  watch(options.source, () => {
    abandon()
    messages.value = []
    input.value = ''
    announcement.value = ''
  })

  const ask = async (): Promise<void> => {
    const question = input.value.trim()
    if (!question || running || !supported()) return
    const source = options.source()
    const isPrivate = options.isPrivate()
    const seconds = Math.max(0, options.currentTime() || 0)
    const history: QaTurn[] = messages.value
      .filter(item => !item.error)
      .map(item => ({ role: item.role, text: item.text }))
    input.value = ''
    announcement.value = ''
    messages.value.push({ id: ++nextId, role: 'user', text: question, seconds })
    messages.value.push({ id: ++nextId, role: 'assistant', text: '' })
    // 取回响应式代理，之后的修改才会刷新界面
    const answer = messages.value[messages.value.length - 1]
    generation += 1
    const token = generation
    const controller = new AbortController()
    running = { token, controller, answer }
    busy.value = true
    const live = (): boolean => token === generation
    try {
      const context = await prepareRecap(
        source,
        {
          purpose: 'qa',
          seconds,
          ...(isPrivate ? { private: true } : {}),
        },
        controller.signal
      )
      if (!live()) return
      const result = await chatStream(
        {
          messages: qaMessages({ context, question, history }),
          temperature: 0.3,
          maxTokens: 600,
          ...(isPrivate ? { private: true } : {}),
        },
        {
          signal: controller.signal,
          onDelta: delta => {
            if (live()) answer.text += delta
          },
        }
      )
      if (!live()) return
      answer.text = result.content.trim() || answer.text.trim()
      announcement.value = '回答已生成'
    } catch (err) {
      if (!live()) return
      const failure = isAbortError(err)
        ? { code: 'cancelled' as const, message: '' }
        : toAiError(err)
      if (failure.code === 'cancelled') {
        answer.text = answer.text.trim() || '已停止'
        announcement.value = '已停止'
      } else {
        answer.text = recapErrorText(failure)
        answer.error = true
        announcement.value = '回答失败'
      }
    } finally {
      if (live()) {
        running = null
        busy.value = false
      }
    }
  }

  const openPanel = (): void => {
    open.value = true
  }

  const close = (): void => {
    open.value = false
  }

  onScopeDispose(() => {
    abandon()
  })

  return {
    supported,
    open,
    messages,
    input,
    busy,
    announcement,
    openPanel,
    close,
    ask,
    stop,
  }
}
