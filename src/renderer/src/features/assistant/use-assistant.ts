/**
 * AI 助手的状态机：待命（idle）→ 聆听中（listening）→ 思考中（thinking）→ 回答中（answering）→ 待命。
 *
 * - 一次提问：取当前状态与生效技能，用 chatJson 把话归成某个技能的动作（严格校验 + 路由，见 skills/skill-prompt.ts），
 *   动作由技能自己的执行器执行并逐字显示回复；只回答文字的走 chatStream 流式显示；
 * - 每轮问答交给 remember 记进内存里的对话上下文（不落盘，私密 / 普通切换时清空）；
 * - 新提问、关闭、Esc 都会取消上一轮（AbortController + 世代号丢弃迟到的结果），关闭时停掉录音与逐字计时器，
 *   正在逐字显示的那次 reveal 当场结算，ask() 不会悬在 await 上；
 * - 录满上限自动停止并转写；停止录音后被取消的，录音不会再交去转写；
 * - 依赖全部经 {@link AssistantDeps} 注入，测试可替换（模型、动作、录音）。
 */
import { type Ref, ref, shallowRef } from 'vue'

import { AiCallError } from '@/features/ai'

import { type ParsedIntent, clipText, routeIntent } from './skills/skill-prompt'
import type {
  AssistantContext,
  AssistantResult,
  AssistantSkill,
  SkillEnv,
} from './skills/skill-types'

/** 助手的阶段（状态文字、输入胶囊渐变的亮度跟着变） */
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
  /** 开始录音；onLevel 每帧给 0–1 的音量，录满上限时调 onLimit */
  start(
    onLevel: (level: number) => void,
    onLimit?: () => void
  ): Promise<VoiceSession>
  transcribe(audio: Uint8Array, isPrivate: boolean): Promise<string>
}

/** useAssistant 的依赖 */
export interface AssistantDeps {
  /** 当前状态（页面、播放中、私密等） */
  context(): AssistantContext
  /** 当前状态下生效的技能包 */
  skills(context: AssistantContext): AssistantSkill[]
  /** AI 是否已配置 */
  aiReady(): boolean
  classify(
    text: string,
    context: AssistantContext,
    skills: AssistantSkill[],
    signal: AbortSignal
  ): Promise<ParsedIntent>
  stream(
    text: string,
    context: AssistantContext,
    onDelta: (delta: string) => void,
    signal: AbortSignal
  ): Promise<void>
  /** 执行动作时交给技能的应用能力 */
  env(signal: AbortSignal): SkillEnv
  /** 记一轮问答到对话上下文 */
  remember?(user: string, reply: string, isPrivate: boolean): void
  /** 动作要求收起助手（跳转页面、打开设置等） */
  close(): void
  voice?: VoiceDeps | null
  /** 当前模式下能不能用语音（私密模式只允许本地识别）；缺省可用 */
  voiceReady?(isPrivate: boolean): boolean
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

/**
 * 助手的一次会话（浮层挂载期间）：提问、语音、取消与显示状态。
 * @param deps 模型、技能、动作环境与录音等依赖
 */
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
  /** 正在进行的逐字显示的结算函数 */
  let revealDone: (() => void) | null = null

  const send = (event: AssistantEvent): void => {
    phase.value = nextPhase(phase.value, event)
  }

  /** 停掉逐字计时器，并结算正在等它的 reveal() */
  const stopReveal = (): void => {
    if (revealTimer !== undefined) clearInterval(revealTimer)
    revealTimer = undefined
    const done = revealDone
    revealDone = null
    done?.()
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
      revealDone = resolve
      revealTimer = setInterval(() => {
        if (token !== generation) {
          stopReveal()
          return
        }
        shown += 1
        answer.value = chars.slice(0, shown).join('')
        if (shown >= chars.length) {
          send('finish')
          stopReveal()
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
      const remember = (reply: string): void =>
        deps.remember?.(text, reply, context.private)
      const parsed = await deps.classify(
        text,
        context,
        deps.skills(context),
        current.signal
      )
      if (!live()) return
      const route = routeIntent(parsed.intent, context)
      if (route.kind === 'explain') {
        remember(route.text)
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
        if (!live()) return
        remember(answer.value)
        send('finish')
        return
      }
      const { action, params } = route.intent
      const outcome = await action.run(params, deps.env(current.signal))
      if (!live()) return
      result.value = outcome.result
      const receipt = outcome.result?.kind === 'done' ? outcome.result.text : ''
      remember(outcome.message || parsed.reply || receipt)
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
    if (deps.voiceReady && !deps.voiceReady(deps.context().private)) return
    cancel()
    const token = generation
    transcript.value = ''
    answer.value = ''
    result.value = null
    notice.value = ''
    try {
      const session = await deps.voice.start(
        value => {
          if (token === generation) level.value = value
        },
        () => {
          if (token === generation && voice === session) void stopListening()
        }
      )
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
      // 停止期间被取消（关闭、Esc、新提问）：录音不再交去转写
      if (token !== generation) return
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
