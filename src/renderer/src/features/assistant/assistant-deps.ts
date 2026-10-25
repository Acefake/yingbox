/**
 * 把 useAssistant 的依赖接到应用上：当前状态（页面、播放、私密）、生效技能、模型调用
 * （chatJson 归意图、chatStream 回答）、动作执行与录音转写。只有助手浮层用它，测试直接给 useAssistant 传替身。
 *
 * 隐私：当前路由是私密分区，或正在播放私密内容时为私密模式——所有模型请求带 private + localOnly
 * （主进程拦下非本地服务商，不看设置）；语音输入只在本地识别时提供。
 */
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

import {
  aiAvailable,
  aiConfigured,
  aiKeyConfigured,
  chatJson,
  chatStream,
} from '@/features/ai'
import { playerNowPlaying, playerRemoteState } from '@/features/player'
import { getSetting } from '@/features/settings'

import { assistantHistory, recordAssistantTurn } from './assistant-session'
import { startVoice, transcribeVoice, voiceSupported } from './assistant-voice'
import { isPrivateRoute } from './skills/navigation-skill'
import {
  buildAnswerMessages,
  buildIntentMessages,
  intentSchema,
  isIntentShape,
  parseIntent,
} from './skills/skill-prompt'
import type { SkillRegistry } from './skills/skill-registry'
import type { AssistantContext } from './skills/skill-types'
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

/**
 * 有可用的语音识别时才显示麦克风；私密模式只允许本地识别（云端转写不发私密录音）。
 * @param isPrivate 当前是否私密模式
 */
export function assistantVoiceReady(isPrivate = false): boolean {
  const engine = getSetting('ai.speech.engine')
  if (engine === 'off' || !voiceSupported()) return false
  return !isPrivate || engine === 'local-whisper'
}

/** 当前状态：页面、播放情况、在播片名与时间点、是否私密 */
export function assistantContext(
  route: RouteLocationNormalizedLoaded
): AssistantContext {
  const player = playerRemoteState()
  const now = player.controllable ? playerNowPlaying() : null
  const title = route.meta.title
  return {
    route: {
      path: route.path,
      title: typeof title === 'string' && title ? title : '影盒',
    },
    playing: player.playing,
    controllable: player.controllable,
    plotQa: player.plotQa,
    private: isPrivateRoute(route) || player.private,
    nowPlaying: now ? { title: now.title, seconds: now.seconds } : null,
  }
}

/** 浮层需要的应用能力 */
export interface AssistantDepsHost {
  router: Router
  route: RouteLocationNormalizedLoaded
  registry: SkillRegistry
  /** 收起助手 */
  close: () => void
  /** 减少动态效果：回答一次显示完 */
  reducedMotion: () => boolean
}

/** 私密模式下模型请求的隐私字段 */
export function privacyFields(context: Pick<AssistantContext, 'private'>): {
  private?: true
  localOnly?: true
} {
  return context.private ? { private: true, localOnly: true } : {}
}

/** 组装 useAssistant 的依赖 */
export function createAssistantDeps(host: AssistantDepsHost): AssistantDeps {
  return {
    context: () => assistantContext(host.route),
    skills: context => host.registry.active(context),
    remember: recordAssistantTurn,
    aiReady: assistantAiReady,
    async classify(text, context, skills, signal) {
      const result = await chatJson(
        {
          messages: buildIntentMessages(
            text,
            context,
            skills,
            assistantHistory(context.private)
          ),
          schema: intentSchema(skills),
          schemaName: 'assistant_intent',
          temperature: 0.2,
          maxTokens: 300,
          ...privacyFields(context),
        },
        { signal, validate: isIntentShape }
      )
      return parseIntent(result.data, skills)
    },
    async stream(text, context, onDelta, signal) {
      await chatStream(
        {
          messages: buildAnswerMessages(
            text,
            context,
            assistantHistory(context.private)
          ),
          temperature: 0.6,
          maxTokens: 400,
          ...privacyFields(context),
        },
        { signal, onDelta }
      )
    },
    env: signal => ({
      router: host.router,
      openSettings: openSettingsSection,
      signal,
    }),
    close: host.close,
    voice: { start: startVoice, transcribe: transcribeVoice },
    voiceReady: assistantVoiceReady,
    revealMs: () => (host.reducedMotion() ? 0 : 28),
  }
}
