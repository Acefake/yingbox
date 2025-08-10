<template>
  <div
    ref="rightPanel"
    :style="{
      width: rightPanelWidth + 'px',
      minWidth: minPanelWidth + 'px',
      backgroundColor: menuBackgroundColor,
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }"
    class="border-l border-gray-700 overflow-y-auto flex-shrink-0 relative rounded-md glass-panel"
  >
    <div v-if="!selectedItem" class="p-4 text-gray-400 text-center">
      <div class="text-sm">请选择一个文件夹或视频文件</div>
    </div>

    <div v-else class="p-4">
      <!-- 文件夹详情 -->
      <div v-if="selectedItem.type === 'folder'">
        <h3 class="text-lg font-semibold text-white mb-4">文件夹详情</h3>

        <!-- 基本信息 -->
        <div class="mb-4">
          <div class="text-sm text-gray-300 mb-2">名称: {{ selectedItem.name }}</div>
          <div class="text-sm text-gray-300 mb-2">路径: {{ selectedItem.path }}</div>
          <div v-if="selectedItem.fileCount" class="text-sm text-gray-300 mb-2">
            文件数量: {{ selectedItem.fileCount }}
          </div>
        </div>

        <!-- 电视剧信息 -->
        <TVInfo
          v-if="tvInfo"
          :tv-info="tvInfo"
          :poster-url="posterUrl"
          :loading="loading"
          @download-poster="$emit('downloadPoster')"
        />

        <!-- 文件列表 -->
        <FileList
          v-if="selectedItem.files && selectedItem.files.length > 0"
          :files="selectedItem.files"
          :selected-item="selectedItem"
        />
      </div>

      <!-- 视频文件详情 -->
      <div v-else-if="selectedItem.type === 'video'">
        <h3 class="text-lg font-semibold text-white mb-4">视频文件详情</h3>

        <div class="mb-4">
          <div class="text-sm text-gray-300 mb-2">名称: {{ selectedItem.name }}</div>
          <div class="text-sm text-gray-300 mb-2">路径: {{ selectedItem.path }}</div>
          <div v-if="selectedItem.size" class="text-sm text-gray-300 mb-2">
            大小: {{ formatFileSize(selectedItem.size) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import TVInfo from './TVInfo.vue'
import FileList from './FileList.vue'

/**
 * 文件项接口
 */
interface FileItem {
  name: string
  path: string
  size: number
  isDirectory: boolean
  isFile: boolean
}

/**
 * 处理后的项目接口
 */
interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: FileItem[]
}

/**
 * 电视剧信息接口
 */
interface TVInfoType {
  title: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actors?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
  seasons?: Season[]
}

/**
 * 季信息接口
 */
interface Season {
  number: number
  title?: string
  episodeCount?: number
  year?: string
  plot?: string
}

/**
 * 组件Props接口
 */
interface Props {
  selectedItem: ProcessedItem | null
  rightPanelWidth: number
  minPanelWidth: number
  menuBackgroundColor: string
  tvInfo: TVInfoType | null
  posterUrl: string
  loading: boolean
}

defineProps<Props>()

defineEmits<{
  downloadPoster: []
}>()

const rightPanel = ref<HTMLElement | null>(null)

/**
 * 格式化文件大小
 * @param bytes - 字节数
 * @returns 格式化后的文件大小字符串
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>