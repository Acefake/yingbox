<template>
  <!-- 刮削队列管理模态框 -->
  <Modal
    v-model:open="visible"
    title="刮削队列"
    width="800px"
    :mask-closable="true"
    :closable="true"
    @cancel="handleClose"
  >
    <div class="space-y-4 bg-gray-50 rounded-lg">
      <!-- 队列状态 -->
      <div class="flex text-gray-600 items-center justify-between p-4 rounded-lg">
        <div>
          <p class="text-sm">
            共 {{ queue.length }} 个任务
            <span v-if="isProcessing" class="text-blue-600">
              (正在处理第 {{ currentIndex + 1 }} 个)
            </span>
          </p>
        </div>
      </div>

      <!-- 队列列表 -->
      <div v-if="queue.length > 0" class="max-h-96 overflow-y-auto">
        <div
          v-for="(task, index) in queue"
          :key="task.item.path"
          class="flex mx-2 items-center justify-between p-3 border border-gray-200 rounded-lg mb-2"
          :class="{
            'bg-blue-50 border-blue-200': isProcessing && index === currentIndex,
            'bg-gray-50': !isProcessing || index !== currentIndex,
          }"
        >
          <div class="flex-1">
            <div class="flex items-center space-x-2">
              <span class="text-sm font-medium text-gray-900">
                {{ task.movie.title }}
              </span>
              <span
                v-if="isProcessing && index === currentIndex"
                class="text-xs text-blue-600"
              >
                处理中...
              </span>
              <span
                v-else-if="isProcessing && index < currentIndex"
                class="text-xs text-green-600"
              >
                已完成
              </span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              文件夹: {{ task.item.name }} | 年份:
              {{ task.movie.release_date?.split('-')[0] || '未知' }}
            </div>
          </div>
          <div class="flex space-x-2">
            <!-- 重新匹配按钮 -->
            <Button
              v-if="!isProcessing || index !== currentIndex"
              size="small"
              type="default"
              :disabled="isProcessing && index < currentIndex"
              @click="$emit('rematch', task, index)"
            >
              重新匹配
            </Button>
            <!-- 移除按钮 -->
            <Button
              v-if="!isProcessing || index !== currentIndex"
              size="small"
              danger
              :disabled="isProcessing && index < currentIndex"
              @click="removeFromQueue(index)"
            >
              移除
            </Button>
            <span
              v-else-if="isProcessing && index === currentIndex"
              class="text-xs text-blue-600 px-2 py-1"
            >
              处理中
            </span>
          </div>
        </div>
      </div>

      <!-- 空队列提示 -->
      <div v-else class="text-center py-8 text-gray-500">
        <p>队列为空</p>
        <p class="text-sm mt-1">选择文件并搜索电影后，可以添加到队列中</p>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-between items-center">
        <div class="flex space-x-2">
          <Button :disabled="isProcessing" danger @click="clearQueue">
            清空队列
          </Button>
          <Button v-if="isProcessing" type="default" @click="stopProcessing">
            停止处理
          </Button>
        </div>
        <div class="flex space-x-2">
          <Button @click="handleClose">关闭</Button>
          <Button
            v-if="!isProcessing && queue.length > 0"
            type="primary"
            @click="startProcessing"
          >
            开始处理
          </Button>
          <Button v-else-if="isProcessing" type="primary" disabled>
            处理中... ({{ currentIndex + 1 }}/{{ queue.length }})
          </Button>
        </div>
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button, Modal, message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'

// 接口定义
interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: any[]
}

interface ScrapeTask {
  item: ProcessedItem
  movie: Movie
}

// Props定义
interface Props {
  visible: boolean
  queue: ScrapeTask[]
  isProcessing: boolean
  currentIndex: number
}

const props = defineProps<Props>()

// Emits定义
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:queue': [queue: ScrapeTask[]]
  'update:isProcessing': [value: boolean]
  'update:currentIndex': [value: number]
  'start-processing': []
  'stop-processing': []
  'clear-queue': []
  'rematch': [task: ScrapeTask, index: number]
  'close': []
}>()

// 响应式数据
const visible = ref(false)
const queue = ref<ScrapeTask[]>([])
const isProcessing = ref(false)
const currentIndex = ref(0)

// 监听props变化
watch(() => props.visible, (newVal) => {
  visible.value = newVal
})

watch(() => props.queue, (newVal) => {
  queue.value = [...newVal]
}, { deep: true })

watch(() => props.isProcessing, (newVal) => {
  isProcessing.value = newVal
})

watch(() => props.currentIndex, (newVal) => {
  currentIndex.value = newVal
})

watch(visible, (newVal) => {
  emit('update:visible', newVal)
})

/**
 * 从队列中移除任务
 * @param index 任务索引
 */
const removeFromQueue = (index: number): void => {
  if (index >= 0 && index < queue.value.length) {
    // 不允许删除正在处理的任务
    if (isProcessing.value && index === currentIndex.value) {
      message.warning('无法删除正在处理的任务')
      return
    }

    // 不允许删除已完成的任务
    if (isProcessing.value && index < currentIndex.value) {
      message.warning('无法删除已完成的任务')
      return
    }

    const task = queue.value[index]
    queue.value.splice(index, 1)

    // 如果删除的是当前索引之后的任务，不需要调整索引
    // 如果删除的是当前索引之前的任务，需要调整当前索引
    if (isProcessing.value && index < currentIndex.value) {
      const newIndex = currentIndex.value - 1
      emit('update:currentIndex', newIndex)
    }

    emit('update:queue', queue.value)
    message.success(`已从队列中移除 ${task.item.name}`)

    // 如果队列为空，停止处理
    if (queue.value.length === 0 && isProcessing.value) {
      emit('update:isProcessing', false)
      emit('update:currentIndex', 0)
      message.info('队列已清空，处理已停止')
    }
  }
}

/**
 * 清空刮削队列
 */
const clearQueue = (): void => {
  if (isProcessing.value) {
    message.warning('请先停止处理再清空队列')
    return
  }

  queue.value = []
  emit('update:queue', [])
  emit('update:currentIndex', 0)
  emit('clear-queue')
  message.success('队列已清空')
}

/**
 * 开始处理队列
 */
const startProcessing = (): void => {
  if (queue.value.length === 0) {
    message.info('队列为空')
    return
  }

  if (isProcessing.value) {
    message.info('队列正在处理中')
    return
  }

  emit('start-processing')
}

/**
 * 停止处理队列
 */
const stopProcessing = (): void => {
  if (!isProcessing.value) {
    message.info('队列未在处理中')
    return
  }

  emit('stop-processing')
}

/**
 * 处理队列模态框关闭事件
 */
const handleClose = (): void => {
  visible.value = false
  emit('close')

  // 如果正在处理队列，给用户提示
  if (isProcessing.value) {
    message.info('队列仍在后台处理中，您可以随时重新打开查看进度')
  }
}
</script>