/**
 * 统一入口（搜索 + AI 助手）feature 的公共出口：应用根组件挂一次的入口（快捷键 + 按需加载的浮层）、侧栏搜索框入口用的开合函数、
 * 「AI 助手」设置分区（由应用入口登记）、私密技能的按需加载，以及写技能包要用的类型与工具。
 * 主进程部分见 src/main/assistant。
 */
import type { SettingsSection } from '@/features/settings'

export { default as AssistantLauncher } from './AssistantLauncher.vue'
export { ENTRY_HOTKEY_LABEL } from './assistant-hotkey'
export { assistantOpen, openAssistant } from './assistant-open'
export { clearAssistantSession } from './assistant-session'
export {
  type PrivateSkillModule,
  type PrivateSkillsOptions,
  installPrivateSkills,
} from './private-skills'
/** 写技能包用：卡片、动作声明与继续播放卡片 */
export {
  type ActionOutcome,
  type AssistantContext,
  type AssistantMediaCard,
  type AssistantResult,
  type AssistantSkill,
  type SkillEnv,
  type SkillGate,
  type SkillRaw,
  closeOutcome,
  defineAction,
} from './skills/skill-types'
export { cardInfos, withLibraryInfo } from './skills/card-info'
export { continueCardsWhere } from './skills/continue-cards'
export { privateRouteSections } from './skills/core-skills'

/** 「AI 助手」设置分区：全局快捷键 */
export const assistantSettingsSection: SettingsSection = {
  id: 'assistant',
  title: 'AI 助手',
  icon: 'sparkle',
  keywords: 'ai 助手 快捷键 siri 语音 唤起 alt space',
  load: () => import('./AssistantSettings.vue'),
  order: 68,
  desktopOnly: true,
}
