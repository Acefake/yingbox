<template>
  <div class="mb-4">
    <h4 class="text-md font-semibold text-white mb-3">文件列表</h4>

    <div class="space-y-1 max-h-64 overflow-y-auto">
      <div
        v-for="file in files"
        :key="file.path"
        class="flex items-center p-2 rounded hover:bg-gray-700 transition-colors duration-200"
      >
        <!-- 文件图标 -->
        <div class="flex-shrink-0 mr-3">
          <svg
            v-if="file.isDirectory"
            class="w-4 h-4 text-blue-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"
            ></path>
          </svg>

          <svg
            v-else-if="isVideoFile(file.name)"
            class="w-4 h-4 text-red-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
              clip-rule="evenodd"
            ></path>
          </svg>

          <svg
            v-else-if="isImageFile(file.name)"
            class="w-4 h-4 text-green-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
              clip-rule="evenodd"
            ></path>
          </svg>

          <svg
            v-else-if="isNfoFile(file.name)"
            class="w-4 h-4 text-yellow-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
              clip-rule="evenodd"
            ></path>
          </svg>

          <svg
            v-else
            class="w-4 h-4 text-gray-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
              clip-rule="evenodd"
            ></path>
          </svg>
        </div>

        <!-- 文件信息 -->
        <div class="flex-1 min-w-0">
          <div class="text-xs text-white truncate">{{ file.name }}</div>
          <div v-if="!file.isDirectory" class="text-xs text-gray-400">
            {{ formatFileSize(file.size) }}
          </div>
        </div>

        <!-- 文件标签 -->
        <div class="flex gap-1">
          <span
            v-if="isNfoFile(file.name)"
            class="px-1 py-0.5 bg-yellow-600 text-yellow-100 rounded text-xs"
          >
            NFO
          </span>
          <span
            v-if="isPosterFile(file.name)"
            class="px-1 py-0.5 bg-green-600 text-green-100 rounded text-xs"
          >
            海报
          </span>
          <span
            v-if="isFanartFile(file.name)"
            class="px-1 py-0.5 bg-blue-600 text-blue-100 rounded text-xs"
          >
            艺术图
          </span>
          <span
            v-if="isVideoFile(file.name)"
            class="px-1 py-0.5 bg-red-600 text-red-100 rounded text-xs"
          >
            视频
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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

interface Props {
  files: FileItem[];
  selectedItem: ProcessedItem;
}

defineProps<Props>();

// 检查是否为视频文件
const isVideoFile = (fileName: string): boolean => {
  const videoExtensions = [
    ".mp4",
    ".avi",
    ".mkv",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".m4v",
  ];
  return videoExtensions.some((ext) => fileName.toLowerCase().endsWith(ext));
};

// 检查是否为图片文件
const isImageFile = (fileName: string): boolean => {
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".svg",
  ];
  return imageExtensions.some((ext) => fileName.toLowerCase().endsWith(ext));
};

// 检查是否为NFO文件
const isNfoFile = (fileName: string): boolean => {
  return fileName.toLowerCase().endsWith(".nfo");
};

// 检查是否为海报文件
const isPosterFile = (fileName: string): boolean => {
  const fileName_lower = fileName.toLowerCase();
  const posterExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  return (
    posterExtensions.some((ext) => fileName_lower.endsWith(ext)) &&
    (fileName_lower.includes("poster") ||
      fileName_lower.includes("cover") ||
      fileName_lower.includes("folder") ||
      fileName_lower.includes("thumb") ||
      fileName_lower === "poster.jpg" ||
      fileName_lower === "folder.jpg" ||
      fileName_lower === "movie.jpg" ||
      fileName_lower === "cover.jpg")
  );
};

// 检查是否为艺术图文件
const isFanartFile = (fileName: string): boolean => {
  const fileName_lower = fileName.toLowerCase();
  const fanartExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  return (
    fanartExtensions.some((ext) => fileName_lower.endsWith(ext)) &&
    (fileName_lower.includes("fanart") ||
      fileName_lower.includes("backdrop") ||
      fileName_lower === "fanart.jpg")
  );
};

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};
</script>
