<template>
  <section class="agent-error-card" role="alert">
    <UiIcon name="warning" />
    <div class="agent-error-content">
      <strong>{{ info.title }}</strong>
      <p>{{ info.message }}</p>
      <span v-if="info.model" class="agent-error-model">{{ info.model }}</span>
      <div class="agent-error-actions">
        <UiButton
          v-if="info.settings"
          size="sm"
          icon="settings"
          label="智能体设置"
          @click="$emit('settings')"
        />
        <details>
          <summary>技术详情</summary>
          <pre>{{ redactAgentError(message) }}</pre>
        </details>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { UiButton, UiIcon } from '@/components/ui'
import { describeAgentError, redactAgentError } from '@/api/amane-agent-error'
const props = defineProps<{ message: string }>()
defineEmits<{ settings: [] }>()
const info = computed(() => describeAgentError(props.message))
</script>
