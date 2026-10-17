<template>
  <section class="agent-error-card" role="alert">
    <AppIcon name="warning" />
    <div class="agent-error-content"><strong>{{ info.title }}</strong><p>{{ info.message }}</p><span v-if="info.model" class="agent-error-model">{{ info.model }}</span><div class="agent-error-actions"><button v-if="info.settings" type="button" class="yb-btn-soft" @click="$emit('settings')"><AppIcon name="settings" size="sm" />智能体设置</button><details><summary>技术详情</summary><pre>{{ redactAgentError(message) }}</pre></details></div></div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { describeAgentError, redactAgentError } from '@/api/amane-agent-error'
const props = defineProps<{ message: string }>()
defineEmits<{ settings: [] }>()
const info = computed(() => describeAgentError(props.message))
</script>
