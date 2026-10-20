<template>
  <section class="settings-list-section">
    <header class="settings-section-head">
      <UiIcon v-if="icon" class="settings-section-icon" :name="icon" />
      <h3 :id="headingId" class="settings-section-title">{{ title }}</h3>
      <UiIconButton
        size="sm"
        :icon="open ? 'chevronUp' : 'chevronDown'"
        :label="open ? `收起${title}` : `展开${title}`"
        :aria-expanded="open"
        :aria-controls="bodyId"
        @click="open = !open"
      />
    </header>

    <Transition name="section">
      <div
        v-if="open"
        :id="bodyId"
        class="settings-section-body"
        role="region"
        :aria-labelledby="headingId"
      >
        <slot />
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
/**
 * 可折叠的设置分组：标题行（图标 + 标题 + 展开/收起按钮）+ 内容插槽。
 * 目前没有页面引用；设置窗口改用 components/settings/ 下的 SettingsGroup。
 */
import { ref, useId } from 'vue'

import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'

defineProps<{ title: string; icon?: IconName }>()

const open = ref(true)
const uid = useId()
const headingId = `settings-section-${uid}`
const bodyId = `settings-section-body-${uid}`
</script>

<style scoped>
.settings-list-section {
  margin-bottom: var(--space-6);
}
.settings-section-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-1) var(--space-2);
}
.settings-section-icon {
  color: var(--text-secondary);
}
.settings-section-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.015em;
}
.section-enter-active,
.section-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
.section-enter-from,
.section-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .section-enter-from,
  .section-leave-to {
    transform: none;
  }
}
</style>
