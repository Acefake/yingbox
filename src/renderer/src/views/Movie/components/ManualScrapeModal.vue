<template>
  <!-- 手动匹配弹窗 -->
  <Modal
    v-model:open="visible"
    title="手动匹配电影"
    :width="500"
    ok-text="搜索"
    cancel-text="取消"
    @ok="performManualSearch"
    @cancel="handleCancel"
  >
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          电影名称
        </label>
        <Input
          v-model:value="searchInput"
          placeholder="请输入电影名称进行搜索"
          class="w-full"
          @keydown.enter.prevent="performManualSearch"
        />
      </div>
      <div v-if="currentItem" class="text-sm text-gray-500">
        <p>当前项目: {{ currentItem.name }}</p>
        <p class="text-xs mt-1">
          提示：您可以修改上面的名称来获得更准确的搜索结果
        </p>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input, Modal, message } from 'ant-design-vue'

// 接口定义
interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: any[]
}

// Props定义
interface Props {
  visible: boolean
  currentItem: ProcessedItem | null
}

const props = defineProps<Props>()

// Emits定义
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'search': [query: string]
  cancel: []
}>()

// 响应式数据
const searchInput = ref('')
const visible = ref(false)
const searching = ref(false)

// 监听props变化
watch(
  () => props.visible,
  newVal => {
    visible.value = newVal
    if (newVal && props.currentItem) {
      searchInput.value = props.currentItem.name
    }
  }
)

watch(visible, newVal => {
  emit('update:visible', newVal)
})

/**
 * 执行手动搜索 - 将关键词交给父组件处理（父组件会走 provider 选择逻辑）
 */
const performManualSearch = (): void => {
  if (searching.value) return
  if (!searchInput.value.trim()) {
    message.error('请输入电影名称')
    return
  }

  searching.value = true
  const query = searchInput.value.trim()
  visible.value = false
  searchInput.value = ''
  emit('search', query)
  setTimeout(() => { searching.value = false }, 300)
}

/**
 * 取消手动匹配
 */
const handleCancel = (): void => {
  visible.value = false
  searchInput.value = ''
  emit('cancel')
}
</script>
