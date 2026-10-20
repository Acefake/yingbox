<template>
  <div class="amane-toolbar">
    <UiSelect v-model="status" aria-label="任务状态" @change="emit('filter')">
      <option value="">全部任务</option>
      <option v-for="s in TASK_FILTERS" :key="s" :value="s">
        {{ statusNames[s] }}
      </option>
    </UiSelect>
    <UiIconButton
      :icon="workerPaused ? 'play' : 'pause'"
      :label="workerPaused ? '继续队列' : '暂停队列'"
      :disabled="busy"
      @click="emit('setWorker', !workerPaused)"
    />
    <span class="amane-muted">{{
      workerPaused ? '队列已暂停，正在运行的任务会继续完成' : '队列运行中'
    }}</span>
  </div>
  <div class="amane-table-wrap">
    <table class="amane-table">
      <thead>
        <tr>
          <th>任务</th>
          <th>状态</th>
          <th>详情</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id">
          <td>
            <strong>{{ task.title || `任务 #${task.id}` }}</strong
            ><small>{{ taskNames[task.type] || task.type }}</small>
          </td>
          <td>
            <span :class="['amane-task-state', task.status]">{{
              statusNames[task.status] || task.status
            }}</span
            ><small v-if="task.child_count"
              >子任务 {{ task.child_status.done || 0 }}/{{
                task.child_count
              }}</small
            >
          </td>
          <td>
            <span class="amane-task-error">{{ task.error || '—' }}</span>
          </td>
          <td>
            <div class="amane-row-actions">
              <UiIconButton
                icon="info"
                label="任务详情"
                size="sm"
                @click="emit('show', task.id)"
              />
              <UiIconButton
                v-if="task.status === 'failed'"
                icon="refresh"
                label="重试"
                size="sm"
                :disabled="busy"
                @click="emit('retry', task.id)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!tasks.length" class="amane-empty">暂无任务</p>
  </div>
</template>

<script setup lang="ts">
/** 任务视图：按状态筛选、暂停 / 继续队列、任务表（详情、失败重试）。 */
import { UiIconButton, UiSelect } from '@/components/ui'
import { type AmaneTask, statusNames, taskNames } from '../../api/amane'

/** 可筛选的任务状态 */
const TASK_FILTERS = ['queued', 'running', 'done', 'failed']

defineProps<{ tasks: AmaneTask[]; workerPaused: boolean; busy: boolean }>()
const status = defineModel<string>('status', { required: true })
const emit = defineEmits<{
  filter: []
  setWorker: [paused: boolean]
  show: [id: number]
  retry: [id: number]
}>()
</script>
