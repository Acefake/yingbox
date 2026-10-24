<template>
  <section
    class="recap-card"
    :class="{ 'is-expanded': state.expanded.value }"
    aria-label="前情提要"
  >
    <header class="recap-card-head">
      <span class="recap-card-title">
        <UiIcon name="sparkle" size="sm" />前情提要
      </span>
      <span class="recap-card-scope">{{ scope }}</span>
      <UiIconButton
        icon="close"
        label="关闭前情提要"
        size="sm"
        @click="state.close"
      />
    </header>

    <div v-if="!state.expanded.value" class="recap-card-row">
      <span class="recap-card-note">{{ teaser }}</span>
      <UiButton size="sm" label="看看" @click="state.open" />
    </div>

    <template v-else>
      <p v-if="state.error.value" class="recap-card-error">
        {{ state.error.value }}
      </p>
      <p v-else-if="state.text.value" class="recap-card-text">
        {{ state.text.value }}
      </p>
      <UiLoadingDots
        v-if="state.loading.value"
        class="recap-card-note"
        :label="state.text.value ? undefined : '正在回顾之前几集…'"
      />
      <div v-if="!state.loading.value" class="recap-card-actions">
        <UiButton
          v-if="state.error.value || state.text.value"
          size="sm"
          variant="plain"
          icon="refresh"
          label="重新生成"
          @click="state.regenerate"
        />
        <UiButton
          size="sm"
          variant="primary"
          label="继续播放"
          @click="state.close"
        />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * 播放器左上角的「前情提要」卡：收起时一行提示，点「看看」后流式展示要点。
 * 状态与生成在 useRecap，这里只负责展示。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'

import { scopeText } from '../../../../../shared/recap/prompts'
import type { RecapState } from './use-recap'

const props = defineProps<{ state: RecapState }>()

const scope = computed(() =>
  scopeText(props.state.probe.value?.episode ?? null)
)

const teaser = computed(() => {
  const previous = props.state.probe.value?.previous ?? []
  if (!previous.length) return ''
  const first = previous[0].label
  const last = previous[previous.length - 1].label
  return previous.length === 1
    ? `回顾一下 ${first} 讲了什么`
    : `回顾一下 ${first}–${last} 讲了什么`
})
</script>

<style scoped>
.recap-card {
  position: absolute;
  top: var(--space-4);
  left: var(--space-4);
  width: min(320px, calc(100cqw - 2 * var(--space-4)));
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
}

.recap-card.is-expanded {
  width: min(380px, calc(100cqw - 2 * var(--space-4)));
  max-height: min(420px, calc(100cqh - 2 * var(--space-4)));
}

.recap-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.recap-card-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.recap-card-scope {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.recap-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.recap-card-note {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.recap-card-text {
  margin: 0;
  min-height: 0;
  overflow-y: auto;
  white-space: pre-wrap;
  font-size: var(--text-sm);
  line-height: 1.7;
}

.recap-card-error {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--danger);
}

.recap-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
