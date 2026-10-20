<template>
  <section class="amane-agent" aria-label="智能体">
    <AgentSessionList
      :sessions="sessions"
      :selected="selected"
      :busy="busy"
      :loading-trace="loadingTrace"
      :running="running"
      :rename="renameSession"
      @create="createNewSession"
      @select="selectSession"
      @delete="deleteSession"
    />
    <div class="agent-conversation">
      <header class="agent-toolbar">
        <div class="agent-toolbar-title">
          <UiIcon :name="showQueries ? 'database' : 'sparkle'" /><span>{{
            showQueries ? '查询预设' : currentSession?.title || '智能体'
          }}</span
          ><small v-if="running">处理中</small>
        </div>
        <UiIconButton
          icon="database"
          label="查询预设"
          :active="showQueries"
          @click="toggleQueries"
        />
        <UiIconButton
          icon="refresh"
          label="刷新对话"
          :disabled="busy"
          @click="refresh"
        />
        <UiIconButton
          icon="settings"
          label="配置智能体模型"
          @click="emit('settings')"
        />
      </header>
      <div v-if="error" class="agent-error-banner">
        <AgentErrorCard
          :message="error"
          @settings="emit('settings')"
        /><UiIconButton icon="close" label="关闭错误提示" @click="error = ''" />
      </div>
      <AgentQueryList
        v-if="showQueries"
        :queries="queries"
        :result="queryResult"
        :query-id="queryId"
        :offset="queryOffset"
        :busy="busy"
        @view="viewQuery"
        @action="queryAction"
        @export="exportQuery"
      />
      <div
        v-else
        ref="messageList"
        class="agent-message-list primary-scroll"
        role="log"
        aria-label="对话消息"
        :aria-busy="loadingTrace"
      >
        <AgentThread
          :messages="folded.messages"
          :loading-trace="loadingTrace"
          :running="running"
          @hint="draft = $event"
          @settings="emit('settings')"
        />
      </div>
      <AgentApprovals
        v-if="folded.interrupts.length && !showQueries"
        :interrupts="folded.interrupts"
        :decisions="decisions"
        :disabled="busy || running"
        :complete="allDecided"
        @decide="(id, approved) => (decisions[id] = approved)"
        @submit="resume"
      />
      <AgentComposer
        v-if="!showQueries"
        v-model="draft"
        :thinking="currentSession?.thinking || ''"
        :input-disabled="
          busy || loadingTrace || running || !!folded.interrupts.length
        "
        :thinking-disabled="!selected || busy || running"
        :send-disabled="
          busy || loadingTrace || !draft.trim() || !!folded.interrupts.length
        "
        :running="running"
        :busy="busy"
        @send="send"
        @stop="stop"
        @thinking="setThinking"
      />
    </div>
  </section>
</template>
<script setup lang="ts">
/**
 * Amane 智能体面板：会话列表 + 对话 / 查询预设两种视图 + 审批 + 输入区。
 * 状态与动作在 use-agent-chat / use-saved-queries，子组件只负责展示。
 */
import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
} from 'vue'
import { UiIcon, UiIconButton } from '@/components/ui'
import { useAgentChat } from '../composables/use-agent-chat'
import { useSavedQueries } from '../composables/use-saved-queries'
import AgentErrorCard from './AgentErrorCard.vue'
import AgentApprovals from './agent/AgentApprovals.vue'
import AgentComposer from './agent/AgentComposer.vue'
import AgentQueryList from './agent/AgentQueryList.vue'
import AgentSessionList from './agent/AgentSessionList.vue'
import AgentThread from './agent/AgentThread.vue'

const emit = defineEmits<{ settings: [] }>()
const messageList = ref<HTMLElement | null>(null)
const {
  sessions,
  selected,
  draft,
  error,
  busy,
  loadingTrace,
  decisions,
  folded,
  running,
  currentSession,
  allDecided,
  isDisposed,
  act,
  selectSession,
  createSession,
  renameSession,
  deleteSession,
  refresh,
  send,
  resume,
  stop,
  setThinking,
  start,
  activate,
  deactivate,
  dispose,
} = useAgentChat({
  messageList,
  // 回合结束刷新查询预设（只在运行时调用，此时 refreshQueries 已就绪）
  onTurnEnd: () => refreshQueries(),
})
const {
  showQueries,
  queries,
  queryResult,
  queryId,
  queryOffset,
  refreshQueries,
  toggleQueries,
  queryAction,
  viewQuery,
  exportQuery,
} = useSavedQueries({ act, error, isDisposed })

/** 新建对话后回到对话视图 */
async function createNewSession(): Promise<void> {
  if (await createSession()) showQueries.value = false
}

onMounted(start)
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(dispose)
</script>
<style src="../styles/agent.css"></style>
