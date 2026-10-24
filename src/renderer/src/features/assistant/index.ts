/**
 * AI 助手 feature 的公共出口：应用根组件挂一次的入口（光球按钮 + 快捷键 + 按需加载的浮层），
 * 以及「AI 助手」设置分区（由应用入口登记）。主进程部分见 src/main/assistant。
 */
import type { SettingsSection } from '@/features/settings'

export { default as AssistantLauncher } from './AssistantLauncher.vue'

/** 「AI 助手」设置分区：全局快捷键 */
export const assistantSettingsSection: SettingsSection = {
  id: 'assistant',
  title: 'AI 助手',
  icon: 'sparkle',
  keywords: 'ai 助手 快捷键 siri 语音 唤起 alt space',
  load: () => import('./AssistantSettings.vue'),
  order: 68,
}
