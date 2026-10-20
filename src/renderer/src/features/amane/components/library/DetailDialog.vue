<template>
  <dialog
    ref="dialog"
    class="amane-detail-dialog"
    :aria-label="taskDetail ? '任务详情' : '影片详情'"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <DialogTitlebar
      :title="taskDetail ? '任务详情' : '影片详情'"
      :icon="taskDetail ? 'list' : 'movie'"
      @close="emit('close')"
    />
    <div class="amane-detail-surface">
      <p v-if="loading" class="amane-loading" role="status">正在读取详情…</p>
      <slot v-else-if="detail" />
      <div v-else-if="taskDetail" class="amane-detail-body">
        <h2>{{ taskDetail.title || `任务 #${taskDetail.id}` }}</h2>
        <p>{{ statusNames[taskDetail.status] }}</p>
        <p v-if="taskDetail.error" class="amane-task-error">
          {{ taskDetail.error }}
        </p>
        <h3>执行结果</h3>
        <pre>{{
          JSON.stringify(taskDetail.result, null, 2) || '任务尚无结果'
        }}</pre>
        <h3 v-if="taskChildren.length">子任务</h3>
        <!-- 子任务是可点的列表行，不是操作按钮 -->
        <UiListRow
          v-for="task in taskChildren"
          :key="task.id"
          class="amane-task-child"
          @click="emit('showTask', task.id)"
        >
          {{ task.title || `#${task.id}` }} — {{ statusNames[task.status]
          }}<span v-if="task.error">：{{ task.error }}</span>
        </UiListRow>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
/**
 * 片库页的详情弹窗（模态 dialog）：影片详情（默认插槽）或任务详情与子任务。
 * 有内容（或正在加载）时打开并滚到顶；关闭后把焦点还给打开前的元素。
 */
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { nextTick, onDeactivated, ref, watch } from 'vue'
import { UiListRow } from '@/components/ui'
import { type AmaneDetail, type AmaneTask, statusNames } from '../../api/amane'

const props = defineProps<{
  detail: AmaneDetail | null
  taskDetail: AmaneTask | null
  taskChildren: AmaneTask[]
  loading: boolean
}>()
const emit = defineEmits<{ close: []; showTask: [id: number] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null

const hasContent = (): boolean =>
  Boolean(props.detail || props.taskDetail || props.loading)

watch(hasContent, async visible => {
  if (visible) {
    previousFocus = document.activeElement as HTMLElement | null
    await nextTick()
    // 页面卸载后模板引用为 null，不会再打开
    if (hasContent() && !dialog.value?.open) {
      dialog.value?.showModal()
      if (dialog.value) dialog.value.scrollTop = 0
    }
  } else {
    dialog.value?.close()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
})
onDeactivated(() => dialog.value?.close())
</script>
