<template>
  <SettingsGroup
    title="唤起方式"
    footer="应用内按 Cmd/Ctrl+K 或点右下角的光球也能唤起助手。助手用的模型与语音识别在「AI」分区里设置。"
  >
    <SettingsRow
      v-if="!bridge"
      title="全局快捷键"
      description="只在桌面端可用"
    />
    <template v-else>
      <SettingsRow
        title="全局快捷键"
        description="应用在后台时也能唤起，并把窗口带到前台"
      >
        <UiSwitch v-model="enabled" label="全局快捷键" />
      </SettingsRow>
      <SettingsRow v-if="enabled" title="快捷键" stacked>
        <UiInput
          v-model="draft"
          v-enter="commit"
          aria-label="全局快捷键"
          :placeholder="DEFAULT_ASSISTANT_SHORTCUT"
          autocomplete="off"
          :invalid="statusInfo.kind === 'warn'"
          @blur="commit"
        />
        <p
          v-if="statusInfo.text"
          class="assistant-settings-status"
          :class="{ 'is-warn': statusInfo.kind === 'warn' }"
        >
          {{ statusInfo.text }}
        </p>
      </SettingsRow>
    </template>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · AI 助手：全局快捷键开关（assistant.shortcutEnabled）与组合（assistant.shortcut）。
 *
 * - 关掉开关只改开关，组合保留，再打开直接恢复上次的组合；
 * - 输入框清空后提交：回填当前生效的组合，不写空串（要停用请关开关）；
 * - 主进程注册结果（成功 / 被占用 / 写法不对，以及仍在生效的旧组合）经 assistant.shortcutChanged 实时显示；
 *   还没取到结果时不显示状态行；网页端（没有主进程）只说明仅桌面端可用。
 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { UiInput, UiSwitch } from '@/components/ui'
import { vEnter } from '@/directives/enter'
import { SettingsGroup, SettingsRow, useSetting } from '@/features/settings'

import type { AssistantShortcutStatus } from '../../../../shared/assistant'
import {
  DEFAULT_ASSISTANT_SHORTCUT,
  shortcutStatusText,
} from './assistant-hotkey'

const shortcutOn = useSetting('assistant.shortcutEnabled')
const shortcut = useSetting('assistant.shortcut')
const draft = ref(shortcut.value || DEFAULT_ASSISTANT_SHORTCUT)
/** 主进程的注册状态；null = 还没取到 */
const status = shallowRef<AssistantShortcutStatus | null>(null)
const bridge = window.api?.assistant

const enabled = computed({
  get: () => shortcutOn.value && shortcut.value !== '',
  set: on => {
    if (on && !shortcut.value)
      shortcut.value = draft.value.trim() || DEFAULT_ASSISTANT_SHORTCUT
    shortcutOn.value = on
  },
})

const statusInfo = computed(() => shortcutStatusText(status.value))

watch(shortcut, value => {
  if (value) draft.value = value
})

function commit(): void {
  const next = draft.value.trim()
  if (!next) {
    draft.value = shortcut.value || DEFAULT_ASSISTANT_SHORTCUT
    return
  }
  if (next !== shortcut.value) shortcut.value = next
}

onMounted(async () => {
  if (!bridge) return
  bridge.onShortcutChanged(next => {
    status.value = next
  })
  const first = await bridge.shortcutStatus()
  // 等待期间已收到推送的更新状态时不覆盖
  status.value ??= first
})

onBeforeUnmount(() => bridge?.offShortcutChanged())
</script>

<style scoped>
.assistant-settings-status {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.assistant-settings-status.is-warn {
  color: var(--warning);
}
</style>
