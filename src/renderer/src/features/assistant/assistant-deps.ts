/**
 * 把 useAssistant 的依赖接到应用上：模型调用（chatJson 归意图、chatStream 回答）、AI 是否已配置、
 * 当前状态（播放中、私密）、动作执行与录音转写。只有助手浮层用它，测试直接给 useAssistant 传替身。
 *
 * 隐私：当前路由是成人板块，或正在播放私密内容时，所有模型请求带 private: true
 * （「私密板块只用本地模型」打开时由主进程拦下非本地服务商）；语音转写同样带上这个标记。
 */
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

import {
  aiAvailable,
  aiConfigured,
  aiKeyConfigured,
  chatJson,
  chatStream,
} from '@/features/ai'
import { playerRemoteState } from '@/features/player'
import { getSetting } from '@/features/settings'

import { createAssistantActions } from './assistant-actions'
import {
  type AssistantContext,
  type AssistantSettingsSection,
  INTENT_SCHEMA,
  buildAnswerMessages,
  buildIntentMessages,
  isIntentShape,
  parseIntent,
} from './assistant-intents'
import { startVoice, transcribeVoice, voiceSupported } from './assistant-voice'
import type { AssistantDeps } from './use-assistant'

/** 打开设置面板的某个分区（与其他功能一样经 app:open-settings 事件） */
export function openSettingsSection(section: string): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: section })
  )
}

/** AI 是否已配置到能发请求（读设置，响应式） */
export function assistantAiReady(): boolean {
  const provider = getSetting('ai.provider')
  return aiConfigured({
    available: aiAvailable(),
    provider,
    baseUrl: getSetting('ai.baseUrl'),
    model: getSetting('ai.model'),
    keyConfigured: aiKeyConfigured(provider),
  })
}

/** 有可用的语音识别（设置里选了识别方式且能录音）时才显示麦克风 */
export function assistantVoiceReady(): boolean {
  return getSetting('ai.speech.engine') !== 'off' && voiceSupported()
}

/** 当前状态：播放情况 + 是否私密 */
export function assistantContext(
  route: RouteLocationNormalizedLoaded
): AssistantContext {
  const player = playerRemoteState()
  return {
    playing: player.playing,
    controllable: player.controllable,
    plotQa: player.plotQa,
    private: route.meta.adultOnly === true || player.private,
  }
}

/** 浮层需要的应用能力 */
export interface AssistantDepsHost {
  router: Router
  route: RouteLocationNormalizedLoaded
  /** 收起助手 */
  close: () => void
  /** 减少动态效果：回答一次显示完 */
  reducedMotion: () => boolean
}

/** 组装 useAssistant 的依赖 */
export function createAssistantDeps(host: AssistantDepsHost): AssistantDeps {
  const execute = createAssistantActions({
    router: host.router,
    openSettings: (section: AssistantSettingsSection) =>
      openSettingsSection(section),
  })
  return {
    context: () => assistantContext(host.route),
    aiReady: assistantAiReady,
    async classify(text, context, signal) {
      const result = await chatJson(
        {
          messages: buildIntentMessages(text, context),
          schema: INTENT_SCHEMA,
          schemaName: 'assistant_intent',
          temperature: 0.2,
          maxTokens: 300,
          private: context.private,
        },
        { signal, validate: isIntentShape }
      )
      return parseIntent(result.data)
    },
    async stream(text, context, onDelta, signal) {
      await chatStream(
        {
          messages: buildAnswerMessages(text, context),
          temperature: 0.6,
          maxTokens: 400,
          private: context.private,
        },
        { signal, onDelta }
      )
    },
    execute,
    close: host.close,
    voice: assistantVoiceReady()
      ? { start: startVoice, transcribe: transcribeVoice }
      : null,
    revealMs: () => (host.reducedMotion() ? 0 : 28),
  }
}
