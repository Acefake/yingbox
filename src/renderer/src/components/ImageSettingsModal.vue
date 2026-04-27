<template>
  <Modal
    :open="visible"
    title="图片下载设置"
    @cancel="handleClose"
    :footer="null"
    width="400px"
  >
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-2"
          >图片下载分辨率</label
        >
        <div class="space-y-2">
          <div
            v-for="option in sizeOptions"
            :key="option.value"
            class="flex items-center p-3 rounded-lg border cursor-pointer transition-all"
            :class="
              selectedSize === option.value
                ? 'bg-blue-600/20 border-blue-500'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            "
            @click="selectedSize = option.value"
          >
            <div class="flex-1">
              <div class="text-sm font-medium text-white">
                {{ option.label }}
              </div>
              <div class="text-xs text-gray-400 mt-0.5">
                {{ option.description }}
              </div>
            </div>
            <div
              class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
              :class="
                selectedSize === option.value
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-gray-600'
              "
            >
              <svg
                v-if="selectedSize === option.value"
                class="w-3 h-3 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div class="pt-4 border-t border-white/10">
        <button
          @click="handleSave"
          class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-all"
        >
          保存设置
        </button>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Modal } from 'ant-design-vue'

interface Props {
  visible: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  save: [size: string]
}>()

const sizeOptions = [
  {
    value: 'w342',
    label: '小 (w342)',
    description: '342px 宽度，适合小屏幕显示，下载速度快',
  },
  {
    value: 'w780',
    label: '中 (w780)',
    description: '780px 宽度，平衡质量和文件大小',
  },
  {
    value: 'original',
    label: '最大 (原始分辨率)',
    description: '最高分辨率，质量最佳但文件较大',
  },
]

const selectedSize = ref('original')

// 从 localStorage 加载设置
const loadSettings = () => {
  const savedSize = localStorage.getItem('imageDownloadSize')
  if (savedSize && sizeOptions.some(opt => opt.value === savedSize)) {
    selectedSize.value = savedSize
  }
}

watch(
  () => props.visible,
  visible => {
    if (visible) {
      loadSettings()
    }
  }
)

const handleClose = () => {
  emit('close')
}

const handleSave = () => {
  localStorage.setItem('imageDownloadSize', selectedSize.value)
  emit('save', selectedSize.value)
  emit('close')
}
</script>
