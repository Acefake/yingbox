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
          <div class="text-sm text-gray-300 mb-2">
            名称: {{ selectedItem.name }}
          </div>
          <div class="text-sm text-gray-300 mb-2">
            路径: {{ selectedItem.path }}
          </div>
          <div v-if="selectedItem.fileCount" class="text-sm text-gray-300 mb-2">
            文件数量: {{ selectedItem.fileCount }}
          </div>
        </div>

        <!-- 电影信息 -->
        <MovieInfo
          v-if="movieInfo"
          :movie-info="movieInfo"
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
          <div class="text-sm text-gray-300 mb-2">
            名称: {{ selectedItem.name }}
          </div>
          <div class="text-sm text-gray-300 mb-2">
            路径: {{ selectedItem.path }}
          </div>
          <div v-if="selectedItem.size" class="text-sm text-gray-300 mb-2">
            大小: {{ formatFileSize(selectedItem.size) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import MovieInfo from "./MovieInfo.vue";
import FileList from "./FileList.vue";

interface FileItem {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
}

interface ProcessedItem {
  name: string;
  path: string;
  type: "folder" | "video";
  size?: number;
  fileCount?: number;
  files?: FileItem[];
}

interface MovieInfoType {
  title: string;
  year?: string;
  plot?: string;
  genre?: string;
  director?: string;
  actors?: string;
  rating?: string;
  runtime?: string;
}

interface Props {
  selectedItem: ProcessedItem | null;
  rightPanelWidth: number;
  minPanelWidth: number;
  menuBackgroundColor: string;
  movieInfo: MovieInfoType | null;
  posterUrl: string;
  loading: boolean;
}

defineProps<Props>();

defineEmits<{
  downloadPoster: [];
}>();

const rightPanel = ref<HTMLElement | null>(null);

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};
</script>
