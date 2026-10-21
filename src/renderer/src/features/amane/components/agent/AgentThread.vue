<template>
  <div class="agent-thread">
    <div v-if="loadingTrace" class="amane-muted" role="status">
      正在读取对话…
    </div>
    <div v-else-if="!messages.length" class="agent-welcome">
      <UiIcon name="sparkle" size="lg" />
      <h2>想在片库中找什么？</h2>
      <p>查询影片、演员和媒体文件，或让智能体帮你整理查询条件。</p>
      <div class="agent-suggestions">
        <!-- 建议是可点的提示卡（多行文字），不是操作按钮 -->
        <UiListRow
          v-for="hint in AGENT_HINTS"
          :key="hint"
          class="agent-suggestion"
          @click="emit('hint', hint)"
        >
          <template #leading><UiIcon name="search" size="sm" /></template>
          {{ hint }}
        </UiListRow>
      </div>
      <p class="amane-muted">首次使用，请先在设置的「智能体」中配置模型。</p>
    </div>
    <article
      v-for="message in messages"
      :key="message.id"
      class="agent-message"
      :class="message.role"
    >
      <span v-if="message.role === 'assistant'" class="agent-role"
        ><UiIcon name="sparkle" size="sm" />Amane</span
      >
      <template v-for="(part, index) in message.parts" :key="index">
        <AgentMarkdown v-if="part.kind === 'text'" :text="part.text" />
        <details v-else-if="part.kind === 'reasoning'" class="agent-thought">
          <summary>思考过程</summary>
          <AgentMarkdown :text="part.text" />
        </details>
        <details v-else-if="part.kind === 'tool'" class="agent-tool">
          <summary>
            <UiIcon name="settings" size="sm" />{{ part.name }}
            <span>{{ part.result === undefined ? '等待结果' : '已完成' }}</span>
          </summary>
          <p>参数</p>
          <pre>{{ cellText(part.args) }}</pre>
          <template v-if="part.result !== undefined"
            ><p>结果</p>
            <pre>{{ cellText(part.result) }}</pre>
          </template>
        </details>
        <p v-else-if="part.kind === 'usage'" class="agent-usage">
          {{ part.text }}
        </p>
        <AgentErrorCard
          v-else
          :message="part.text"
          @settings="emit('settings')"
        />
      </template>
    </article>
    <p v-if="running" class="amane-muted" role="status">正在处理…</p>
  </div>
</template>

<script setup lang="ts">
/** 对话消息流：欢迎页与提示卡、文本 / 思考 / 工具调用 / 用量 / 错误各类消息片段。 */
import { UiIcon, UiListRow } from '@/components/ui'
import type { AgentMessage } from '../../api/amane-agent'
import { AGENT_HINTS, cellText } from '../../utils/agent'
import AgentErrorCard from '../AgentErrorCard.vue'
import AgentMarkdown from '../AgentMarkdown.vue'

defineProps<{
  messages: AgentMessage[]
  loadingTrace: boolean
  running: boolean
}>()
const emit = defineEmits<{ hint: [text: string]; settings: [] }>()
</script>
