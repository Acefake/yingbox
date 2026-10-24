/**
 * AI 助手的状态机：待命（idle）→ 聆听中（listening）→ 思考中（thinking）→ 回答中（answering）→ 待命。
 *
 * - 一次提问：先用 chatJson 把话归成意图（严格校验 + 路由，见 assistant-intents.ts），
 *   动作交给 assistant-actions 执行并逐字显示回复；只回答文字的走 chatStream 流式显示；
 * - 新提问、关闭、Esc 都会取消上一轮（AbortController + 世代号丢弃迟到的结果），关闭时停掉录音与逐字计时器；
 * - 依赖全部经 {@link AssistantDeps} 注入，测试可替换（模型、动作、录音）。
 */
import { type Ref, ref, shallowRef } from 'vue'

import { AiCallError } from '@/features/ai'

import type { ActionOutcome, AssistantResult } from './assistant-actions'
import {
  type AssistantContext,
  type AssistantIntent,
  type ParsedIntent,
  clipText,
  routeIntent,
} from './assistant-intents'

/** 光球与状态文字对应的阶段 */
export type AssistantPhase = 'idle' | 'listening' | 'thinking' | 'answering'

/** 推动阶段变化的事件 */
export type AssistantEvent = 'listen' | 'submit' | 'reply' | 'finish' | 'cancel'

/** 合法的阶段转移；表里没有的事件保持原阶段 */
const TRANSITIONS: Record<
  AssistantPhase,
  Partial<Record<AssistantEvent, AssistantPhase>>
> = {
  idle: { listen: 'listening', submit: 'thinking' },
  listening: { submit: 'thinking', cancel: 'idle', finish: 'idle' },
  thinking: { reply: 'answering', finish: 'idle', cancel: 'idle' },
  answering: { finish: 'idle', cancel: 'idle' },
}

/** 阶段转移（纯函数） */
export function nextPhase(
  phase: AssistantPhase,
  event: AssistantEvent
): AssistantPhase {
  return TRANSITIONS[phase][event] ?? phase
}

/** 各阶段的状态文字 */
export const PHASE_LABELS: Record<AssistantPhase, string> = {
  idle: '待命',
  listening: '聆听中',
  thinking: '思考中',
  answering: '回答中',
}

/** 一次录音：停止时交出 WAV，取消时丢弃 */
export interface VoiceSession {
  stop(): Promise<Uint8Array>
  cancel(): void
}

/** 语音输入的依赖（没有可用的语音识别时不提供） */
export interface VoiceDeps {
  /** 开始录音；onLevel 每帧给 0–1 的音量 */
  start(onLevel: (level: number) => void): Promise<VoiceSession>
  transcribe(audio: Uint8Array, isPrivate: boolean): Promise<string>
}

/** useAssistant 的依赖 */
export interface AssistantDeps {
  /** 当前状态（播放中、私密等） */
  context(): AssistantContext
  /** AI 是否已配置 */
  aiReady(): boolean
  classify(
    text: string,
    context: AssistantContext,
    signal: AbortSignal
  ): Promise<ParsedIntent>
  stream(
    text: string,
    context: AssistantContext,
    onDelta: (delta: string) => void,
    signal: AbortSignal
  ): Promise<void>
  execute(intent: AssistantIntent, signal: AbortSignal): Promise<ActionOutcome>
  /** 动作要求收起助手（跳转页面、打开设置等） */
  close(): void
  voice?: VoiceDeps | null
  /** 逐字显示的间隔（毫秒）；0 表示一次显示完（减少动态效果时） */
  revealMs?: () => number
}

/** useAssistant 的返回值 */
export interface UseAssistant {
  phase: Ref<AssistantPhase>
  /** 用户这次说的话（大字显示） */
  transcript: Ref<string>
  /** 助手的回答（逐字增长） */
  answer: Ref<string>
  result: Ref<AssistantResult | null>
  /** 出错说明 */
  notice: Ref<string>
  /** AI 未配置：显示「去设置 AI」 */
  needsSetup: Ref<boolean>
  /** 聆听时的音量 0–1 */
  level: Ref<number>
  ask: (text: string) => Promise<void>
  listen: () => Promise<void>
  /** 结束录音并转写提问 */
  stopListening: () => Promise<void>
  /** 取消进行中的一切（关闭面板时调用） */
  cancel: () => void
}

/** 模型错误 → 给用户看的一句话；取消返回 null */
export function errorText(error: unknown): string | null {
  const code = error instanceof AiCallError ? error.code : 'network'
  switch (code) {
    case 'cancelled':
      return null
    case 'not_configured':
      return 'AI 还没配置好，先去设置里填写服务商和 Key。'
    case 'private_blocked':
      return '私密内容只发给本地模型，当前的 AI 服务不是本地的。'
    case 'timeout':
      return 'AI 响应超时了，再说一次试试。'
    case 'bad_json':
    case 'bad_response':
      return '没听懂这句话，换个说法试试。'
    default:
      return 'AI 暂时连不上，稍后再试。'
  }
}

/** 默认逐字间隔（毫秒） */
const REVEAL_MS = 28

export function useAssistant(deps: AssistantDeps): UseAssistant {
  const phase = ref<AssistantPhase>('idle')
  const transcript = ref('')
  const answer = ref('')
  const result = shallowRef<AssistantResult | null>(null)
  const notice = ref('')
  const needsSetup = ref(false)
  const level = ref(0)

  let generation = 0
  let controller: AbortController | null = null
  let voice: VoiceSession | null = null
  let revealTimer: ReturnType<typeof setInterval> | undefined

  const send = (event: AssistantEvent): void => {
    phase.value = nextPhase(phase.value, event)
  }

  const stopReveal = (): void => {
    if (revealTimer !== undefined) clearInterval(revealTimer)
    revealTimer = undefined
  }

  /** 逐字显示一段话，显示完回到待命 */
  const reveal = (text: string, token: number): Promise<void> =>
    new Promise(resolve => {
      const chars = [...text]
      const step = deps.revealMs?.() ?? REVEAL_MS
      send('reply')
      if (!step || !chars.length) {
        answer.value = text
        send('finish')
        resolve()
        return
      }
      let shown = 0
      answer.value = ''
      stopReveal()
      revealTimer = setInterval(() => {
        if (token !== generation) {
          stopReveal()
          resolve()
          return
        }
        shown += 1
        answer.value = chars.slice(0, shown).join('')
        if (shown >= chars.length) {
          stopReveal()
          send('finish')
          resolve()
        }
      }, step)
    })

  function cancel(): void {
    generation += 1
    controller?.abort()
    controller = null
    voice?.cancel()
    voice = null
    stopReveal()
    level.value = 0
    send('cancel')
  }

  async function ask(input: string): Promise<void> {
    const text = clipText(input)
    if (!text) return
    cancel()
    const token = generation
    const current = new AbortController()
    controller = current
    const live = (): boolean => token === generation
    transcript.value = text
    answer.value = ''
    result.value = null
    notice.value = ''
    needsSetup.value = false
    send('submit')

    if (!deps.aiReady()) {
      needsSetup.value = true
      await reveal(
        '还没配置 AI。配置好服务商和 Key 后，就能让我推荐、搜索和控制播放了。',
        token
      )
      return
    }
    try {
      const context = deps.context()
      const parsed = await deps.classify(text, context, current.signal)
      if (!live()) return
      const route = routeIntent(parsed.intent, context)
      if (route.kind === 'explain') {
        await reveal(route.text, token)
        return
      }
      if (route.intent.kind === 'answer') {
        send('reply')
        await deps.stream(
          text,
          context,
          delta => {
            if (live()) answer.value += delta
          },
          current.signal
        )
        if (live()) send('finish')
        return
      }
      const outcome = await deps.execute(route.intent, current.signal)
      if (!live()) return
      result.value = outcome.result
      if (outcome.close) {
        send('finish')
        deps.close()
        return
      }
      await reveal(outcome.message || parsed.reply, token)
    } catch (error) {
      if (!live()) return
      const text = errorText(error)
      if (error instanceof AiCallError && error.code === 'not_configured')
        needsSetup.value = true
      notice.value = text ?? ''
      send('finish')
    } finally {
      if (controller === current) controller = null
    }
  }

  async function listen(): Promise<void> {
    if (!deps.voice || phase.value === 'listening') return
    cancel()
    const token = generation
    transcript.value = ''
    answer.value = ''
    result.value = null
    notice.value = ''
    try {
      const session = await deps.voice.start(value => {
        if (token === generation) level.value = value
      })
      if (token !== generation) {
        session.cancel()
        return
      }
      voice = session
      send('listen')
    } catch {
      if (token === generation)
        notice.value = '打不开麦克风，检查一下系统的麦克风权限。'
    }
  }

  async function stopListening(): Promise<void> {
    const session = voice
    if (!session || !deps.voice) return
    voice = null
    level.value = 0
    const token = generation
    send('submit')
    try {
      const audio = await session.stop()
      const text = await deps.voice.transcribe(audio, deps.context().private)
      if (token !== generation) return
      if (!text.trim()) {
        notice.value = '没听清，再说一次试试。'
        send('finish')
        return
      }
      await ask(text)
    } catch (error) {
      if (token !== generation) return
      notice.value =
        error instanceof Error && error.message
          ? `语音识别失败：${error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`
          : '语音识别失败'
      send('finish')
    }
  }

  return {
    phase,
    transcript,
    answer,
    result,
    notice,
    needsSetup,
    level,
    ask,
    listen,
    stopListening,
    cancel,
  }
}
