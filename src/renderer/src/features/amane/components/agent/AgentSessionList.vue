<template>
  <aside class="agent-sessions">
    <div class="agent-session-heading">
      <strong>对话</strong
      ><UiIconButton
        icon="plus"
        label="新建对话"
        :disabled="busy || loadingTrace"
        @click="emit('create')"
      />
    </div>
    <p v-if="!sessions.length" class="amane-muted">新建对话，开始查询片库</p>
    <div
      v-for="session in sessions"
      :key="session.id"
      class="agent-session-row"
      :class="{ active: session.id === selected }"
    >
      <UiInput
        v-if="renaming === session.id"
        v-model="renameText"
        size="sm"
        maxlength="200"
        aria-label="对话名称"
        @keydown.enter.prevent="commitRename(session.id)"
        @keydown.esc="renaming = null"
      />
      <UiListRow
        v-else
        class="agent-session-link"
        :aria-current="selected === session.id ? 'page' : undefined"
        @click="emit('select', session.id)"
      >
        {{ session.title }}
        <template v-if="session.status === 'awaiting_approval'" #description
          ><small>等待审批</small></template
        >
      </UiListRow>
      <UiIconButton
        v-if="renaming === session.id"
        icon="check"
        label="保存对话名称"
        :disabled="busy || !renameText.trim()"
        @click="commitRename(session.id)"
      />
      <UiIconButton
        v-else
        icon="edit"
        label="重命名对话"
        :disabled="busy"
        @click="startRename(session)"
      />
      <UiIconButton
        icon="trash"
        label="删除对话"
        danger
        :disabled="busy || (selected === session.id && running)"
        @click="emit('delete', session)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 智能体的会话列表：新建、切换、就地重命名（Enter 保存 / Esc 取消）、删除。
 * 重命名的编辑状态在这里；保存交给父级的 rename，成功后才退出编辑。
 */
import { ref } from 'vue'
import { UiIconButton, UiInput, UiListRow } from '@/components/ui'
import type { AgentSession } from '../../api/amane-agent'

const props = defineProps<{
  sessions: AgentSession[]
  selected: number | null
  busy: boolean
  loadingTrace: boolean
  running: boolean
  /** 保存新标题；返回是否成功 */
  rename: (id: number, title: string) => Promise<boolean>
}>()
const emit = defineEmits<{
  create: []
  select: [id: number]
  delete: [session: AgentSession]
}>()
const renaming = ref<number | null>(null),
  renameText = ref('')

/** 进入重命名状态，输入框预填当前标题 */
function startRename(session: { id: number; title: string }): void {
  renaming.value = session.id
  renameText.value = session.title
}

async function commitRename(id: number): Promise<void> {
  if (await props.rename(id, renameText.value)) renaming.value = null
}
</script>
