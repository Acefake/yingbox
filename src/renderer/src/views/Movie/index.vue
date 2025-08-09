<template>
  <div class="folder-content relative h-full text-white overflow-hidden">
    <!-- 左侧悬浮面板 -->
    <div class="absolute left-4 top-4 bottom-4 z-20 flex flex-col">
      <LeftPanel
        :processed-items="processedItems"
        :selected-index="selectedIndex"
        :left-panel-width="leftPanelWidth"
        :min-panel-width="minPanelWidth"
        :menu-background-color="'rgba(17, 24, 39, 0.3)'"
        :dir-loading="dirLoading"
        :scrape-queue-count="scrapeQueue.length"
        :is-processing-queue="isProcessingQueue"
        :is-multi-select-mode="isMultiSelectMode"
        :selected-items="selectedItems"
        :selected-items-count="selectedItemsData.length"
        @refresh="(targetPath) => refreshDirectory(targetPath)"
        @add-folder="readDir"
        @clear-cache="handleShowClearCacheDialog"
        @select-item="selectItem"
        @show-search-modal="handleShowSearchModal"
        @manual-scrape="handleManualScrape"
        @auto-scrape="handleAutoScrape"
        @show-queue="handleShowQueueModal"
        @toggle-multi-select="toggleMultiSelectMode"
        @toggle-select-all="toggleSelectAll"
        @add-selected-to-queue="addSelectedToScrapeQueue"
        @toggle-selection="toggleItemSelection"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div
      class="absolute inset-0 z-10"
      :style="{ paddingLeft: leftPanelWidth + 32 + 'px' }"
    >
      <div
        v-if="!selectedItem"
        class="flex items-center justify-center h-full text-gray-300"
      >
        <div class="flex flex-col items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke="currentColor"
            class="size-20"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
          <p class="text-2xl mb-2">欢迎使用本项目</p>
          <p class="text-sm">请先添加文件夹，点击[+添加]按钮添加文件夹</p>
        </div>
      </div>

      <div v-else class="p-6 h-full overflow-y-auto">
        <!-- 详情头部 -->
        <div class="flex items-start gap-6 mb-6">
          <!-- 海报/缩略图 -->
          <div
            class="w-48 h-72 bg-gray-800 bg-opacity-50 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden poster-3d backdrop-blur-sm"
          >
            <img
              v-if="posterImageDataUrl"
              :src="posterImageDataUrl"
              alt="海报"
              class="w-full h-full object-cover rounded-lg transition-transform duration-300"
              @error="handleImageError"
            />
            <svg
              v-else
              class="w-16 h-16 text-gray-600"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                clip-rule="evenodd"
              ></path>
            </svg>
          </div>

          <!-- 基本信息 -->
          <div class="flex-1">
            <h1 class="text-3xl font-bold text-white mb-2 drop-shadow-lg">
              {{ selectedItem.name }}
            </h1>
            <div class="py-2 rounded text-xs text-gray-300 font-mono mb-4">
              {{ selectedItem.path }}
            </div>

            <!-- 电影信息 -->
            <div>
              <MovieInfo
                v-if="movieInfo"
                :movie-info="movieInfo"
                :poster-url="posterImageDataUrl"
                :loading="false"
                @download-poster="downloadPoster"
              />

              <!-- 文件列表（如果是文件夹） -->
              <FileList
                v-if="selectedItem.type === 'folder' && selectedItem.files"
                :files="selectedItem.files"
                :selected-item="selectedItem"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 搜索结果弹窗 -->
    <SearchResultModal
      :visible="showSearchModal"
      :movies="searchMovies"
      @close="handleCloseSearchModal"
      @scrape="handleScrapeMovie"
    />

    <!-- 手动匹配弹窗 -->
    <Modal
      v-model:open="showManualScrapeModal"
      title="手动匹配电影"
      :width="500"
      ok-text="搜索"
      cancel-text="取消"
      @ok="performManualSearch"
      @cancel="handleCancelManualScrape"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            电影名称
          </label>
          <Input
            v-model:value="manualScrapeInput"
            placeholder="请输入电影名称进行搜索"
            class="w-full"
            @press-enter="performManualSearch"
          />
        </div>
        <div v-if="currentScrapeItem" class="text-sm text-gray-500">
          <p>当前项目: {{ currentScrapeItem.name }}</p>
          <p class="text-xs mt-1">
            提示：您可以修改上面的名称来获得更准确的搜索结果
          </p>
        </div>
      </div>
    </Modal>

    <!-- 刮削队列管理模态框 -->
    <Modal
      v-model:open="showQueueModal"
      title="刮削队列"
      width="800px"
      :mask-closable="true"
      :closable="true"
      @cancel="handleQueueModalClose"
    >
      <div class="space-y-4 bg-gray-50 rounded-lg">
        <!-- 队列状态 -->
        <div
          class="flex text-gray-600 items-center justify-between p-4 rounded-lg"
        >
          <div>
            <p class="text-sm">
              共 {{ scrapeQueue.length }} 个任务
              <span v-if="isProcessingQueue" class="text-blue-600">
                (正在处理第 {{ currentQueueIndex + 1 }} 个)
              </span>
            </p>
          </div>
        </div>

        <!-- 队列列表 -->
        <div v-if="scrapeQueue.length > 0" class="max-h-96 overflow-y-auto">
          <div
            v-for="(task, index) in scrapeQueue"
            :key="task.item.path"
            class="flex mx-2 items-center justify-between p-3 border border-gray-200 rounded-lg mb-2"
            :class="{
              'bg-blue-50 border-blue-200':
                isProcessingQueue && index === currentQueueIndex,
              'bg-gray-50': !isProcessingQueue || index !== currentQueueIndex,
            }"
          >
            <div class="flex-1">
              <div class="flex items-center space-x-2">
                <span class="text-sm font-medium text-gray-900">
                  {{ task.movie.title }}
                </span>
                <span
                  v-if="isProcessingQueue && index === currentQueueIndex"
                  class="text-xs text-blue-600"
                >
                  处理中...
                </span>
                <span
                  v-else-if="isProcessingQueue && index < currentQueueIndex"
                  class="text-xs text-green-600"
                >
                  已完成
                </span>
              </div>
              <div class="text-xs text-gray-500 mt-1">
                文件夹: {{ task.item.name }} | 年份:
                {{ task.movie.release_date?.split("-")[0] || "未知" }}
              </div>
            </div>
            <div class="flex space-x-2">
              <!-- 重新匹配按钮 -->
              <Button
                v-if="!isProcessingQueue || index !== currentQueueIndex"
                size="small"
                type="default"
                :disabled="isProcessingQueue && index < currentQueueIndex"
                @click="rematchMovie(task, index)"
              >
                重新匹配
              </Button>
              <!-- 移除按钮 -->
              <Button
                v-if="!isProcessingQueue || index !== currentQueueIndex"
                size="small"
                danger
                :disabled="isProcessingQueue && index < currentQueueIndex"
                @click="removeFromQueue(index)"
              >
                移除
              </Button>
              <span
                v-else-if="isProcessingQueue && index === currentQueueIndex"
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
            <Button
              :disabled="isProcessingQueue"
              danger
              @click="clearScrapeQueue"
            >
              清空队列
            </Button>

            <!-- <Button
              :disabled="isProcessingQueue || scrapeQueue.length > 0"
              type="default"
              @click="refreshDirectory"
            >
              刷新目录
            </Button> -->
            <Button
              v-if="isProcessingQueue"
              type="default"
              @click="stopProcessingQueue"
            >
              停止处理
            </Button>
          </div>
          <div class="flex space-x-2">
            <Button @click="handleQueueModalClose">关闭</Button>
            <Button
              v-if="!isProcessingQueue && scrapeQueue.length > 0"
              type="primary"
              @click="startProcessingQueue"
            >
              开始处理
            </Button>
            <Button v-else-if="isProcessingQueue" type="primary" disabled>
              处理中... ({{ currentQueueIndex + 1 }}/{{ scrapeQueue.length }})
            </Button>
          </div>
        </div>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, inject } from "vue";
import { message, Modal, Input, Button } from "ant-design-vue";
import LeftPanel from "./LeftPanel.vue";
import MovieInfo from "./MovieInfo.vue";
import FileList from "./FileList.vue";
import SearchResultModal from "./SearchResultModal.vue";
import { tmdb, TMDB_IMG_URL } from "../../api/tmdb";
import type { Movie } from "@tdanks2000/tmdb-wrapper";

// 注入 AppLayout 提供的背景控制方法
const appLayoutMethods = inject("appLayoutMethods") as
  | {
      setGlobalBackground: (
        backgroundImage: string,
        menuBackgroundColor: string,
      ) => void;
      clearGlobalBackground: () => void;
    }
  | undefined;

// 接口定义
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
  title?: string;
  originaltitle?: string;
  year?: string;
  plot?: string;
  genre?: string[];
  director?: string;
  actor?: string[];
  rating?: string;
  runtime?: string;
  country?: string;
  studio?: string;
  premiered?: string;
}

// 可以在需要时添加emits
// const emit = defineEmits<{
//   openItem: [item: ProcessedItem]
//   showDetails: [item: ProcessedItem]
// }>()

// 响应式数据
const fileData = ref<FileItem[]>([]);
const currentDirectoryPath = ref<string>("");
const selectedItem = ref<ProcessedItem | null>(null);
const selectedIndex = ref(-1);
const dirLoading = ref(false);
const leftPanelWidth = ref(300);

// 多选相关状态
const isMultiSelectMode = ref(false);
const selectedItems = ref<Set<number>>(new Set());
const selectedItemsData = ref<ProcessedItem[]>([]);

const minPanelWidth = ref(200);
const menuBackgroundColor = ref("rgba(0, 0, 0, 0.6)");
const posterImageDataUrl = ref("");
const fanartImageDataUrl = ref("");
const nfoContent = ref("");
const movieInfo = ref<MovieInfoType | null>(null);

// 全局弹窗状态管理
const showSearchModal = ref(false);
const searchMovies = ref([]);

// 手动匹配相关状态
const showManualScrapeModal = ref(false);
const manualScrapeInput = ref("");
const currentScrapeItem = ref<ProcessedItem | null>(null);

// 刮削队列相关状态
const scrapeQueue = ref<Array<{ item: ProcessedItem; movie: Movie }>>([]);
const isProcessingQueue = ref(false);
const currentQueueIndex = ref(0);
const showQueueModal = ref(false);

// 计算属性
const posterImagePath = computed(() => {
  if (!selectedItem.value || !selectedItem.value.files) {
    return null;
  }

  const posterExtensions = [".jpg", ".jpeg", ".png", ".webp"];

  if (selectedItem.value.type === "folder") {
    const folderName = selectedItem.value.name.toLowerCase();
    const posterFile = selectedItem.value.files.find((file) => {
      const fileName = file.name.toLowerCase();
      return (
        posterExtensions.some((ext) => fileName.endsWith(ext)) &&
        // 排除fanart和backdrop文件
        !fileName.includes("fanart") &&
        !fileName.includes("backdrop") &&
        (fileName.includes("poster") ||
          fileName.includes("cover") ||
          fileName.includes("folder") ||
          fileName.includes("thumb") ||
          fileName === "poster.jpg" ||
          fileName === "folder.jpg" ||
          fileName === "movie.jpg" ||
          fileName === "cover.jpg" ||
          (fileName.includes(folderName.split("(")[0].trim()) &&
            !fileName.includes("fanart") &&
            !fileName.includes("backdrop"))) // 支持包含电影名字的文件，但排除fanart
      );
    });
    return posterFile ? posterFile.path : null;
  } else if (selectedItem.value.type === "video") {
    // 视频文件的海报检测
    const videoBaseName = selectedItem.value.name
      .replace(/\.[^/.]+$/, "")
      .toLowerCase();
    const posterFile = selectedItem.value.files.find((file) => {
      const fileName = file.name.toLowerCase();
      return (
        posterExtensions.some((ext) => fileName.endsWith(ext)) &&
        (fileName === `${videoBaseName}-poster.jpg` || // {视频文件名}-poster.jpg
          fileName === `${videoBaseName}-folder.jpg` || // {视频文件名}-folder.jpg
          fileName === `${videoBaseName}-movie.jpg` || // {视频文件名}-movie.jpg
          fileName === "poster.jpg" || // 标准海报文件名
          fileName === "folder.jpg" || // 标准文件夹图片
          fileName === "movie.jpg") // 标准电影图片
      );
    });
    return posterFile ? posterFile.path : null;
  }

  return null;
});

const fanartImagePath = computed(() => {
  if (!selectedItem.value || !selectedItem.value.files) {
    return null;
  }

  const fanartExtensions = [".jpg", ".jpeg", ".png", ".webp"];

  if (selectedItem.value.type === "folder") {
    const folderName = selectedItem.value.name.toLowerCase();
    const fanartFile = selectedItem.value.files.find((file) => {
      const fileName = file.name.toLowerCase();
      return (
        fanartExtensions.some((ext) => fileName.endsWith(ext)) &&
        (fileName.includes("fanart") ||
          fileName.includes("backdrop") ||
          fileName === "fanart.jpg" ||
          (fileName.includes(folderName.split("(")[0].trim()) &&
            fileName.includes("fanart")) ||
          (fileName.includes(folderName.split("(")[0].trim()) &&
            fileName.includes("backdrop")))
      );
    });
    return fanartFile ? fanartFile.path : null;
  } else if (selectedItem.value.type === "video") {
    // 视频文件的艺术图检测
    const videoBaseName = selectedItem.value.name
      .replace(/\.[^/.]+$/, "")
      .toLowerCase();
    const fanartFile = selectedItem.value.files.find((file) => {
      const fileName = file.name.toLowerCase();
      return (
        fanartExtensions.some((ext) => fileName.endsWith(ext)) &&
        (fileName === `${videoBaseName}-fanart.jpg` || // {视频文件名}-fanart.jpg
          fileName === "fanart.jpg")
      ); // fanart.jpg
    });
    return fanartFile ? fanartFile.path : null;
  }

  return null;
});

const nfoFilePath = computed(() => {
  if (!selectedItem.value || !selectedItem.value.files) {
    return null;
  }

  if (selectedItem.value.type === "folder") {
    const nfoFile = selectedItem.value.files.find((file) =>
      file.name.toLowerCase().endsWith(".nfo"),
    );
    return nfoFile ? nfoFile.path : null;
  } else if (selectedItem.value.type === "video") {
    // 视频文件的NFO检测 - 只要同目录下有NFO文件就认为有对应的NFO
    const nfoFile = selectedItem.value.files.find((file) => {
      const fileName = file.name.toLowerCase();
      return fileName.endsWith(".nfo");
    });
    return nfoFile ? nfoFile.path : null;
  }

  return null;
});

// 视频文件扩展名
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

// 工具函数
const isVideoFile = (fileName: string): boolean => {
  return videoExtensions.some((ext) => fileName.toLowerCase().endsWith(ext));
};

const isHiddenFile = (fileName: string): boolean => {
  return fileName.startsWith(".") || fileName.startsWith("__");
};

const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement;
  if (target) target.style.display = "none";
};

// 处理文件列表，按照规则分组
const processedItems = computed((): ProcessedItem[] => {
  if (!fileData.value || fileData.value.length === 0) return [];

  const result: ProcessedItem[] = [];
  const processedPaths = new Set<string>();

  // 过滤掉隐藏文件
  const visibleFiles = fileData.value.filter(
    (file) => !isHiddenFile(file.name),
  );

  // 找出所有顶级文件夹
  const allFolders = visibleFiles.filter((f) => f.isDirectory);
  const topLevelFolders = allFolders.filter((folder) => {
    return !allFolders.some(
      (otherFolder) =>
        otherFolder.path !== folder.path &&
        folder.path.startsWith(otherFolder.path + "/"),
    );
  });

  // 处理顶级文件夹
  topLevelFolders.forEach((folder) => {
    const folderFiles = visibleFiles.filter(
      (f) => f.isFile && f.path.startsWith(folder.path + "/"),
    );
    const hasVideoFiles = folderFiles.some((file) => isVideoFile(file.name));

    if (folderFiles.length > 0 && hasVideoFiles) {
      result.push({
        name: folder.name,
        path: folder.path,
        type: "folder",
        fileCount: folderFiles.length,
        files: folderFiles,
      });

      folderFiles.forEach((file) => {
        processedPaths.add(file.path);
      });
    }
  });

  // 处理独立的视频文件
  const independentVideoFiles = visibleFiles.filter(
    (file) =>
      file.isFile && isVideoFile(file.name) && !processedPaths.has(file.path),
  );

  independentVideoFiles.forEach((video) => {
    // 获取视频文件所在目录的所有文件
    const videoDir = video.path.substring(0, video.path.lastIndexOf("/"));
    const sameDirectoryFiles = visibleFiles.filter(
      (file) =>
        file.isFile &&
        file.path.startsWith(videoDir + "/") &&
        file.path.lastIndexOf("/") === videoDir.length,
    );

    result.push({
      name: video.name,
      path: video.path,
      type: "video",
      size: video.size,
      files: sameDirectoryFiles,
    });
  });

  return result;
});

// 方法
const selectItem = (item: ProcessedItem, index: number): void => {
  if (isMultiSelectMode.value) {
    // 多选模式
    toggleItemSelection(index);
  } else {
    // 单选模式
    selectedItem.value = item;
    selectedIndex.value = index;
  }
};

/**
 * 切换项目选中状态（多选模式）
 * @param item - 项目对象（可选，用于事件处理）
 * @param index - 项目索引
 */
const toggleItemSelection = (
  item: ProcessedItem | number,
  index?: number,
): void => {
  // 处理两种调用方式：toggleItemSelection(index) 和 toggleItemSelection(item, index)
  const targetIndex = typeof item === "number" ? item : index!;

  if (selectedItems.value.has(targetIndex)) {
    selectedItems.value.delete(targetIndex);
  } else {
    selectedItems.value.add(targetIndex);
  }
  updateSelectedItemsData();
};

/**
 * 更新选中项目数据
 */
const updateSelectedItemsData = (): void => {
  selectedItemsData.value = Array.from(selectedItems.value)
    .map((index) => processedItems.value[index])
    .filter(Boolean);
};

/**
 * 切换多选模式
 */
const toggleMultiSelectMode = (): void => {
  isMultiSelectMode.value = !isMultiSelectMode.value;
  if (!isMultiSelectMode.value) {
    // 退出多选模式时清空选择
    selectedItems.value.clear();
    selectedItemsData.value = [];
  }
};

/**
 * 全选/取消全选
 */
const toggleSelectAll = (): void => {
  if (selectedItems.value.size === processedItems.value.length) {
    // 当前全选，执行取消全选
    selectedItems.value.clear();
  } else {
    // 执行全选
    selectedItems.value.clear();
    processedItems.value.forEach((_, index) => {
      selectedItems.value.add(index);
    });
  }
  updateSelectedItemsData();
};

/**
 * 批量搜索电影信息
 * @param movieName 电影名称
 * @returns 搜索结果中的第一个电影，如果没有结果则返回null
 */
const searchMovieForBatch = async (
  movieName: string,
): Promise<Movie | null> => {
  try {
    // 清理电影名称
    const cleanName = movieName
      .replace(/\.[^/.]+$/, "") // 去除扩展名
      .replace(/[[](){}]/g, "") // 去除括号
      .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|3gp|ts|m2ts)$/i, "") // 去除视频扩展名
      .trim();

    if (!cleanName) {
      return null;
    }

    // 提取年份
    const yearMatch = cleanName.match(/(19|20)\d{2}/);
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
    const nameWithoutYear = cleanName.replace(/(19|20)\d{2}/g, "").trim();

    console.log(`批量搜索电影: ${cleanName}, 年份: ${year}`);

    // 首先尝试中文搜索
    let res = await tmdb.search.movies({
      query: cleanName,
      language: "zh-CN",
      ...(year && { year }),
    });

    // 如果没有结果且有年份，尝试不使用年份搜索
    if (res.results.length === 0 && year) {
      res = await tmdb.search.movies({
        query: nameWithoutYear,
        language: "zh-CN",
      });
    }

    // 如果还是没有结果，尝试英文搜索
    if (res.results.length === 0) {
      res = await tmdb.search.movies({
        query: nameWithoutYear || cleanName,
        language: "en-US",
        ...(year && { year }),
      });
    }

    if (res.results.length === 0) {
      console.log(`未找到电影: ${cleanName}`);
      return null;
    }

    // 返回第一个搜索结果
    const firstMovie = res.results[0];
    return {
      ...firstMovie,
      poster_path: firstMovie.poster_path
        ? TMDB_IMG_URL + firstMovie.poster_path
        : null,
      id: firstMovie.id as number,
    };
  } catch (error) {
    console.error(`搜索电影 ${movieName} 时出错:`, error);
    return null;
  }
};

/**
 * 批量添加选中项目到刮削队列
 */
const addSelectedToScrapeQueue = async (): Promise<void> => {
  if (selectedItemsData.value.length === 0) {
    message.warning("请先选择要添加到队列的项目");
    return;
  }

  const loadingMessage = message.loading(
    `正在批量搜索电影信息... (0/${selectedItemsData.value.length})`,
    0,
  );

  let successCount = 0;
  let failedCount = 0;

  try {
    // 为每个选中的项目搜索电影信息
    for (let i = 0; i < selectedItemsData.value.length; i++) {
      const item = selectedItemsData.value[i];

      // 更新加载消息
      loadingMessage();
      message.loading(
        `正在批量搜索电影信息... (${i + 1}/${selectedItemsData.value.length})`,
        0,
      );

      // 从文件名提取电影名称
      const movieName = item.name
        .replace(/\.[^/.]+$/, "") // 去除扩展名
        .replace(/[[](){}]/g, "") // 去除括号
        .trim();

      // 搜索电影信息
      const searchedMovie = await searchMovieForBatch(movieName);

      let movieToAdd: Movie;

      if (searchedMovie) {
        // 如果搜索到了电影，使用搜索结果
        movieToAdd = searchedMovie;
        successCount++;
      } else {
        // 如果没有搜索到，创建默认电影信息
        movieToAdd = {
          id: Date.now() + Math.random(), // 临时ID
          title: movieName || item.name,
          overview: `未找到匹配的电影：${movieName || item.name}`,
          release_date: "",
          poster_path: null,
          backdrop_path: null,
          vote_average: 0,
          vote_count: 0,
          genre_ids: [],
          adult: false,
          original_language: "zh",
          original_title: movieName || item.name,
          popularity: 0,
          video: false,
        };
        failedCount++;
      }

      // 检查是否已经在队列中
      const existingIndex = scrapeQueue.value.findIndex(
        (task) => task.item.path === item.path,
      );

      if (existingIndex >= 0) {
        // 如果已存在，更新电影信息
        scrapeQueue.value[existingIndex].movie = { ...movieToAdd };
      } else {
        // 添加新任务到队列
        scrapeQueue.value.push({
          item: { ...item },
          movie: { ...movieToAdd },
        });
      }

      // 添加短暂延迟，避免API请求过快
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    message.destroy();

    if (successCount > 0 && failedCount > 0) {
      message.success(
        `批量添加完成：成功匹配 ${successCount} 个，未匹配 ${failedCount} 个项目`,
      );
    } else if (successCount > 0) {
      message.success(
        `已批量添加 ${successCount} 个项目到刮削队列，全部匹配成功`,
      );
    } else {
      message.warning(
        `已添加 ${selectedItemsData.value.length} 个项目到队列，但未找到匹配的电影信息`,
      );
    }

    // 清空选择
    selectedItems.value.clear();
    selectedItemsData.value = [];
  } catch (error) {
    message.destroy();
    console.error("批量添加到队列失败:", error);
    message.error("批量添加失败，请重试");
  }
};

const readDir = async (): Promise<void> => {
  try {
    dirLoading.value = true;
    const result = await window.api.dialog.openDirectory();
    if (
      result.success &&
      !result.canceled &&
      result.filePaths &&
      result.filePaths.length > 0
    ) {
      const selectedPath = result.filePaths[0];
      currentDirectoryPath.value = selectedPath;
      const files = await window.api.file.readdirRecursive(selectedPath);
      if (files.success && files.data) {
        fileData.value = files.data as FileItem[];
        saveToCache();
        message.success(`成功扫描 ${(files.data as FileItem[]).length} 个文件`);
      }
    }
  } catch (error) {
    console.error("读取目录失败:", error);
    message.error("读取目录失败");
  } finally {
    dirLoading.value = false;
  }
};

/**
 * 节流函数 - 在指定时间间隔内只执行一次函数
 * @param delay 节流延迟时间（毫秒），默认10秒
 * @param forceRefresh 是否强制刷新（忽略节流限制）
 * @param delayExecution 是否延迟执行刷新（true=延迟执行，false=立即执行）
 */

const refreshFiles = async (): Promise<void> => {
  const pathToRefresh = currentDirectoryPath.value;

  if (!pathToRefresh) {
    const loaded = loadFromCache();
    if (loaded) {
      message.success("已从缓存加载数据");
    } else {
      message.info("请先添加文件夹");
    }
    return;
  }

  try {
    dirLoading.value = true;
    message.info("正在刷新文件列表...");

    // 全量刷新
    const files = await window.api.file.readdirRecursive(pathToRefresh);
    if (files.success && files.data) {
      fileData.value = files.data as FileItem[];

      // 如果有选中的项目，需要更新其files数组以包含新的NFO文件
      if (selectedItem.value && selectedIndex.value >= 0) {
        const updatedProcessedItems = processedItems.value;
        if (updatedProcessedItems[selectedIndex.value]) {
          // 更新选中项目的数据
          selectedItem.value = updatedProcessedItems[selectedIndex.value];
          // 强制重新加载图片和NFO文件
          await loadPosterImage();
          await loadFanartImage();
          await loadNfoContent();
        }
      }

      saveToCache();
      message.success(
        `刷新完成：找到 ${(files.data as FileItem[]).length} 个文件`,
      );
    } else {
      message.error("刷新失败: " + (files.error || "未知错误"));
    }
  } catch (error) {
    console.error("刷新目录失败:", error);
    message.error("刷新目录失败");
  } finally {
    dirLoading.value = false;
  }
};

const clearCacheAndData = (): void => {
  clearCache();
  fileData.value = [];
  currentDirectoryPath.value = "";
  selectedItem.value = null;
  selectedIndex.value = -1;
  posterImageDataUrl.value = "";
  fanartImageDataUrl.value = "";
  menuBackgroundColor.value = "rgba(0, 0, 0, 0.6)";
  nfoContent.value = "";
  movieInfo.value = null;
  message.success("缓存和数据已清除");
};

// 全局弹窗处理函数
const handleShowSearchModal = (movies): void => {
  searchMovies.value = movies;
  showSearchModal.value = true;
};

const handleCloseSearchModal = (): void => {
  showSearchModal.value = false;
  searchMovies.value = [];
};

/**
 * 处理自动刮削功能
 * @param item 要刮削的项目（文件夹或视频文件）
 */
const handleAutoScrape = async (item: ProcessedItem): Promise<void> => {
  try {
    // 设置当前刮削项目
    currentScrapeItem.value = item;

    let searchName = "";

    // 根据item类型提取搜索关键词
    if (item.type === "folder") {
      // 对于文件夹，使用文件夹名称
      searchName = item.name;
    } else {
      // 对于视频文件，使用文件名（不包含扩展名）
      searchName = item.name.replace(/\.[^.]*$/, "");
    }

    console.log("自动刮削项目:", item.name, "类型:", item.type);
    console.log("原始搜索名称:", searchName);

    // 清理搜索名称
    const cleanName = handleSearchParams(searchName);
    console.log("清理后名称:", cleanName);

    if (!cleanName) {
      message.error("无法解析电影名称");
      return;
    }

    // 提取年份信息
    const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
    const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, "").trim();

    console.log("提取的年份:", year);
    console.log("无年份名称:", nameWithoutYear);

    // 显示加载提示
    const loadingMessage = message.loading("正在搜索电影信息...", 0);

    try {
      // 首次搜索：使用清理后的完整名称和年份
      let res = await tmdb.search.movies({
        query: nameWithoutYear || cleanName,
        language: "zh-CN",
        ...(year && { year }),
      });

      // 只有在没有结果时才进行后续搜索
      if (res.results.length === 0) {
        // 如果有年份，尝试不使用年份搜索
        if (year) {
          console.log("尝试无年份搜索:", nameWithoutYear);
          res = await tmdb.search.movies({
            query: nameWithoutYear,
            language: "zh-CN",
          });
        }

        // 如果还是没有结果，尝试英文搜索
        if (res.results.length === 0) {
          console.log("尝试英文搜索:", nameWithoutYear || cleanName);
          res = await tmdb.search.movies({
            query: nameWithoutYear || cleanName,
            language: "en-US",
            ...(year && { year }),
          });
        }
      }

      loadingMessage();

      if (res.results.length === 0) {
        message.error("未找到该电影");
        return;
      }

      // 处理搜索结果
      const movies = res.results.map((movie: Movie) => ({
        ...movie,
        poster_path: movie.poster_path
          ? TMDB_IMG_URL + movie.poster_path
          : null,
        id: movie.id as number,
      }));

      console.log("搜索结果:", movies);

      // 显示搜索结果弹窗
      handleShowSearchModal(movies);
      message.success(`找到 ${movies.length} 个匹配结果`);
    } catch (searchError) {
      loadingMessage();
      console.error("搜索电影时出错:", searchError);
      message.error("搜索电影时出错");
      // 清空当前刮削项目
      currentScrapeItem.value = null;
    }
  } catch (error) {
    console.error("自动刮削时出错:", error);
    message.error("自动刮削时出错");
    // 清空当前刮削项目
    currentScrapeItem.value = null;
  }
};

/**
 * 显示清除缓存确认对话框
 */
const handleShowClearCacheDialog = (): void => {
  Modal.confirm({
    title: "确认清除缓存",
    content: "此操作将清除所有缓存数据，包括文件列表和路径信息。确定要继续吗？",
    okText: "确认清除",
    cancelText: "取消",
    okType: "danger",
    onOk() {
      clearCacheAndData();
    },
  });
};

/**
 * 清理电影名称，移除不必要的字符和信息
 * @param movieName 原始电影名称
 * @returns 清理后的电影名称
 */
const handleSearchParams = (movieName: string): string => {
  let cleanName = movieName;

  // 1. 移除文件扩展名
  cleanName = cleanName.replace(/\.[^.]*$/, "");

  // 2. 移除常见的视频质量标识
  const qualityPatterns = [
    /\b(4K|2160p|1080p|720p|480p|360p)\b/gi,
    /\b(UHD|HD|SD|CAM|TS|TC|SCR|R5|DVDRip|BRRip|BluRay|WEBRip|HDTV)\b/gi,
    /\b(x264|x265|H264|H265|HEVC|AVC)\b/gi,
    /\b(AAC|AC3|DTS|MP3|FLAC)\b/gi,
    /\b(5\.1|7\.1|2\.0)\b/gi,
  ];

  qualityPatterns.forEach((pattern) => {
    cleanName = cleanName.replace(pattern, " ");
  });

  // 3. 移除发布组信息（通常在方括号或圆括号中）
  cleanName = cleanName.replace(/\[[^\]]*\]/g, " ");
  cleanName = cleanName.replace(
    /\([^)]*(?:rip|cam|ts|tc|scr|r5|web|hdtv)[^)]*\)/gi,
    " ",
  );

  // 4. 移除常见的分隔符和替换为空格
  cleanName = cleanName.replace(/[._-]/g, " ");

  // 5. 移除多余的空格
  cleanName = cleanName.replace(/\s+/g, " ").trim();

  // 6. 提取年份（保留用于后续处理）
  const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";

  // 7. 移除年份周围的括号
  cleanName = cleanName.replace(/\(\s*(19|20)\d{2}\s*\)/g, ` ${year} `);

  // 8. 移除常见的无用词汇
  const uselessWords = [
    "complete",
    "proper",
    "repack",
    "internal",
    "limited",
    "festival",
    "retail",
    "extended",
    "unrated",
    "directors",
    "cut",
    "edition",
    "version",
    "remastered",
    "criterion",
    "collection",
    "anthology",
    "series",
    "season",
    "episode",
    "disc",
    "cd1",
    "cd2",
    "part1",
    "part2",
    "pt1",
    "pt2",
  ];

  const uselessPattern = new RegExp(`\\b(${uselessWords.join("|")})\\b`, "gi");
  cleanName = cleanName.replace(uselessPattern, " ");

  // 9. 移除数字序列（如果不是年份）
  cleanName = cleanName.replace(/\b\d{3,}(?!\d*\b(19|20)\d{2}\b)\b/g, " ");

  // 10. 移除单独的数字和字母
  cleanName = cleanName.replace(/\b[a-zA-Z]\b/g, " ");
  cleanName = cleanName.replace(/\b\d{1,2}\b(?!\d)/g, " ");

  // 11. 再次提取年份（可能在清理过程中位置发生变化）
  const finalYearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
  const finalYear = finalYearMatch ? finalYearMatch[0] : "";

  // 12. 将点号替换为空格（常见于英文电影文件名）
  cleanName = cleanName.replace(/\./g, " ");

  // 13. 移除特殊字符，保留字母、数字、空格和中文
  cleanName = cleanName.replace(/[^a-zA-Z0-9\s\u4e00-\u9fa5]/g, " ");

  // 14. 清理多余空格
  cleanName = cleanName.replace(/\s+/g, " ").trim();

  // 15. 如果有年份，确保年份在末尾
  if (finalYear) {
    cleanName = cleanName
      .replace(new RegExp(`\\b${finalYear}\\b`, "g"), "")
      .trim();
    cleanName += ` ${finalYear}`;
  }

  return cleanName || movieName; // 如果清理后为空，返回原始名称
};

/**
 * 处理手动匹配事件
 * @param item 要匹配的项目
 */
const handleManualScrape = (item: ProcessedItem): void => {
  currentScrapeItem.value = item;
  manualScrapeInput.value = item.name;
  showManualScrapeModal.value = true;
};

/**
 * 执行手动搜索
 */
const performManualSearch = async (): Promise<void> => {
  if (!manualScrapeInput.value.trim()) {
    message.error("请输入电影名称");
    return;
  }

  try {
    const cleanName = handleSearchParams(manualScrapeInput.value);
    console.log("原始输入:", manualScrapeInput.value);
    console.log("清理后名称:", cleanName);

    if (!cleanName) {
      message.error("无法解析电影名称");
      return;
    }

    // 提取年份信息
    const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
    const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, "").trim();

    console.log("提取的年份:", year);
    console.log("无年份名称:", nameWithoutYear);

    // 首次搜索：使用清理后的完整名称和年份
    let res = await tmdb.search.movies({
      query: nameWithoutYear || cleanName,
      language: "zh-CN",
      ...(year && { year }),
    });

    // 只有在没有结果时才进行后续搜索
    if (res.results.length === 0) {
      // 如果有年份，尝试不使用年份搜索
      if (year) {
        console.log("尝试无年份搜索:", nameWithoutYear);
        res = await tmdb.search.movies({
          query: nameWithoutYear,
          language: "zh-CN",
        });
      }

      // 如果还是没有结果，尝试英文搜索
      if (res.results.length === 0) {
        console.log("尝试英文搜索:", nameWithoutYear || cleanName);
        res = await tmdb.search.movies({
          query: nameWithoutYear || cleanName,
          language: "en-US",
          ...(year && { year }),
        });
      }
    }

    if (res.results.length === 0) {
      message.error("未找到该电影");
      return;
    }

    // 处理搜索结果
    const movies = res.results.map((movie: Movie) => ({
      ...movie,
      poster_path: movie.poster_path ? TMDB_IMG_URL + movie.poster_path : null,
      id: movie.id as number,
    }));

    console.log("搜索结果:", movies);

    // 关闭手动匹配弹窗
    showManualScrapeModal.value = false;
    manualScrapeInput.value = "";
    // 注意：不要在这里清空 currentScrapeItem，需要在刮削完成后清空

    // 显示搜索结果弹窗
    handleShowSearchModal(movies);
    message.success(`找到 ${movies.length} 个匹配结果`);
  } catch (error) {
    console.error("搜索电影时出错:", error);
    message.error("搜索电影时出错");
  }
};

/**
 * 取消手动匹配
 */
const handleCancelManualScrape = (): void => {
  showManualScrapeModal.value = false;
  manualScrapeInput.value = "";
  currentScrapeItem.value = null;
};

/**
 * 添加刮削任务到队列
 * @param movie 电影数据
 */
const addToScrapeQueue = (movie: Movie): void => {
  if (!currentScrapeItem.value) {
    message.error("没有选中的刮削项目");
    return;
  }

  // 检查是否已经在队列中
  const existingIndex = scrapeQueue.value.findIndex(
    (task) => task.item.path === currentScrapeItem.value!.path,
  );

  if (existingIndex >= 0) {
    // 如果已存在，更新电影信息
    scrapeQueue.value[existingIndex].movie = movie;
    message.success(`已更新队列中的 ${currentScrapeItem.value.name}`);
  } else {
    // 添加新任务到队列
    scrapeQueue.value.push({
      item: { ...currentScrapeItem.value },
      movie: { ...movie },
    });
    message.success(`已添加 ${currentScrapeItem.value.name} 到刮削队列`);
  }

  // 关闭搜索模态框
  handleCloseSearchModal();

  // 清空当前刮削项目
  currentScrapeItem.value = null;

  // 显示队列管理界面
  // handleShowQueueModal();
};

/**
 * 批量添加刮削任务到队列
 * @param items 要添加的项目数组
 * @param defaultMovie 默认电影数据（用于所有项目）
 */
const addBatchToScrapeQueue = (
  items: ProcessedItem[],
  defaultMovie: Movie,
): void => {
  if (!items || items.length === 0) {
    message.error("没有选中的项目");
    return;
  }

  if (!defaultMovie) {
    message.error("没有提供默认电影信息");
    return;
  }

  let addedCount = 0;
  let updatedCount = 0;

  items.forEach((item) => {
    // 检查是否已经在队列中
    const existingIndex = scrapeQueue.value.findIndex(
      (task) => task.item.path === item.path,
    );

    if (existingIndex >= 0) {
      // 如果已存在，更新电影信息
      scrapeQueue.value[existingIndex].movie = { ...defaultMovie };
      updatedCount++;
    } else {
      // 添加新任务到队列
      scrapeQueue.value.push({
        item: { ...item },
        movie: { ...defaultMovie },
      });
      addedCount++;
    }
  });

  // 显示批量操作结果
  if (addedCount > 0 && updatedCount > 0) {
    message.success(
      `批量操作完成：新增 ${addedCount} 个，更新 ${updatedCount} 个任务`,
    );
  } else if (addedCount > 0) {
    message.success(`已批量添加 ${addedCount} 个任务到刮削队列`);
  } else if (updatedCount > 0) {
    message.success(`已批量更新 ${updatedCount} 个队列中的任务`);
  }

  console.log(
    `[DEBUG] 批量添加完成 - 新增: ${addedCount}, 更新: ${updatedCount}`,
  );
};

/**
 * 开始处理刮削队列
 */
const startProcessingQueue = async (): Promise<void> => {
  if (scrapeQueue.value.length === 0) {
    message.info("队列为空");
    return;
  }

  if (isProcessingQueue.value) {
    message.info("队列正在处理中");
    return;
  }

  try {
    isProcessingQueue.value = true;
    currentQueueIndex.value = 0;

    message.loading(
      `开始处理刮削队列，共 ${scrapeQueue.value.length} 个任务...`,
      0,
    );

    // 逐个处理队列中的任务
    await processNextQueueItem();
  } catch (error) {
    message.destroy();
    console.error("处理队列失败:", error);
    message.error(
      `处理队列失败: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  } finally {
    isProcessingQueue.value = false;
    currentScrapeItem.value = null;
  }
};

/**
 * 处理队列中的下一个项目
 */
const processNextQueueItem = async (): Promise<void> => {
  // 检查是否还有待处理的任务
  if (currentQueueIndex.value >= scrapeQueue.value.length) {
    // 所有任务处理完成
    message.destroy();
    message.success(
      `队列处理完成！共处理了 ${scrapeQueue.value.length} 个任务`,
    );

    // 清空队列
    scrapeQueue.value = [];
    currentQueueIndex.value = 0;
    isProcessingQueue.value = false;
    currentScrapeItem.value = null;

    // 关闭队列界面
    showQueueModal.value = false;

    // 队列完成后延迟5秒刷新目录
    console.log("[DEBUG] 队列完成，触发延迟自动刷新");
    setTimeout(() => {
      refreshFiles();
    }, 5000); // 延迟5秒执行刷新
    return;
  }

  // 检查处理是否被停止
  if (!isProcessingQueue.value) {
    return;
  }

  const task = scrapeQueue.value[currentQueueIndex.value];

  try {
    message.destroy();
    message.loading(
      `正在处理 ${task.movie.title} (${currentQueueIndex.value + 1}/${scrapeQueue.value.length})...`,
      0,
    );

    // 设置当前刮削项目
    currentScrapeItem.value = task.item;

    // 执行刮削
    await processSingleScrapeTask(task.movie);

    // 移动到下一个任务
    currentQueueIndex.value++;

    // 短暂延迟，避免过快处理
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 递归处理下一个任务
    await processNextQueueItem();
  } catch (error) {
    console.error(`处理任务 ${task.movie.title} 失败:`, error);
    message.destroy();
    message.error(
      `处理 ${task.movie.title} 失败: ${error instanceof Error ? error.message : "未知错误"}`,
    );

    // 即使当前任务失败，也继续处理下一个
    currentQueueIndex.value++;

    await processNextQueueItem();
  }
};

/**
 * 从队列中移除任务
 * @param index 任务索引
 */
const removeFromQueue = (index: number): void => {
  if (index >= 0 && index < scrapeQueue.value.length) {
    // 不允许删除正在处理的任务
    if (isProcessingQueue.value && index === currentQueueIndex.value) {
      message.warning("无法删除正在处理的任务");
      return;
    }

    // 不允许删除已完成的任务
    if (isProcessingQueue.value && index < currentQueueIndex.value) {
      message.warning("无法删除已完成的任务");
      return;
    }

    const task = scrapeQueue.value[index];
    scrapeQueue.value.splice(index, 1);

    // 如果删除的是当前索引之后的任务，不需要调整索引
    // 如果删除的是当前索引之前的任务，需要调整当前索引
    if (isProcessingQueue.value && index < currentQueueIndex.value) {
      currentQueueIndex.value--;
    }

    message.success(`已从队列中移除 ${task.item.name}`);

    // 如果队列为空，停止处理
    if (scrapeQueue.value.length === 0 && isProcessingQueue.value) {
      isProcessingQueue.value = false;
      currentQueueIndex.value = 0;
      currentScrapeItem.value = null;
      message.info("队列已清空，处理已停止");
    }
  }
};

/**
 * 清空刮削队列
 */
const clearScrapeQueue = (): void => {
  if (isProcessingQueue.value) {
    message.warning("请先停止处理再清空队列");
    return;
  }

  scrapeQueue.value = [];
  currentQueueIndex.value = 0;
  message.success("队列已清空");
};

/**
 * 停止处理队列
 */
const stopProcessingQueue = (): void => {
  if (!isProcessingQueue.value) {
    message.info("队列未在处理中");
    return;
  }

  // 停止处理
  isProcessingQueue.value = false;
  currentScrapeItem.value = null;

  // 移除已完成的任务，保留未处理的任务
  const remainingTasks = scrapeQueue.value.slice(currentQueueIndex.value + 1);
  scrapeQueue.value = remainingTasks;
  currentQueueIndex.value = 0;

  message.destroy();
  message.success(`队列处理已停止，剩余 ${remainingTasks.length} 个未处理任务`);
};

// 定义刮削任务类型
interface ScrapeTask {
  item: ProcessedItem;
  movie: Movie;
}

/**
 * 重新匹配队列中的电影
 * @param task 队列任务
 */
const rematchMovie = async (task: ScrapeTask): Promise<void> => {
  if (isProcessingQueue.value) {
    message.warning("队列处理中，无法重新匹配");
    return;
  }

  try {
    // 设置当前刮削项目
    currentScrapeItem.value = task.item;

    // 从文件名提取电影名称
    const movieName = task.item.name
      .replace(/\.[^/.]+$/, "") // 去除扩展名
      .replace(/[[](){}]/g, "") // 去除括号
      .trim();

    // 设置手动搜索输入框的值
    manualScrapeInput.value = movieName;

    // 显示手动匹配弹窗
    showManualScrapeModal.value = true;

    message.info(`正在为 "${task.item.name}" 重新匹配电影`);
  } catch (error) {
    console.error("重新匹配电影时出错:", error);
    message.error("重新匹配失败");
  }
};

/**
 * 刷新目录 - 使用节流机制刷新媒体目录
 */
/**
 * 刷新目录
 * @param targetPath 可选的目标路径，如果提供则只刷新该路径，否则刷新当前目录
 */
const refreshDirectory = (targetPath?: string): void => {
  console.log("[DEBUG] refreshDirectory 被调用", { targetPath });
  console.log(
    "[DEBUG] 队列状态 - isProcessingQueue:",
    isProcessingQueue.value,
    "scrapeQueue.length:",
    scrapeQueue.value.length,
  );

  // 检查是否有队列正在处理或有未处理任务
  if (isProcessingQueue.value || scrapeQueue.value.length > 0) {
    message.warning("刮削队列处理中，将在队列完成后自动刷新目录");
    console.log("[DEBUG] 队列处理中，等待队列完成后自动刷新");
    return;
  }

  console.log("[DEBUG] 立即执行刷新");

  if (targetPath) {
    // 如果提供了目标路径，刷新特定路径
    refreshSpecificPath(targetPath);
  } else {
    // 否则刷新当前目录
    refreshFiles();
  }
};

/**
 * 刷新特定路径
 * @param targetPath 目标路径
 */
const refreshSpecificPath = async (targetPath: string): Promise<void> => {
  try {
    console.log("[DEBUG] 刷新特定路径:", targetPath);

    // 检查目标路径是否是当前目录或其子目录
    if (targetPath === currentDirectoryPath.value) {
      // 如果是当前目录，直接刷新整个目录
      refreshFiles();
      return;
    }

    // 检查目标路径是否在当前目录下
    if (targetPath.startsWith(currentDirectoryPath.value)) {
      // 如果是子目录，刷新整个当前目录以更新文件列表
      refreshFiles();
      message.success(`已刷新路径: ${targetPath}`);
    } else {
      // 如果不在当前目录下，提示用户
      message.info(`目标路径不在当前目录下: ${targetPath}`);
    }
  } catch (error) {
    console.error("刷新特定路径失败:", error);
    message.error("刷新失败");
  }
};

/**
 * 检查队列状态一致性
 * 修复处理状态与队列数据不一致的问题
 */
const checkQueueStateConsistency = (): void => {
  // 如果标记为处理中但队列为空，重置处理状态
  if (isProcessingQueue.value && scrapeQueue.value.length === 0) {
    console.warn("检测到队列状态不一致：处理中但队列为空，正在重置状态");
    isProcessingQueue.value = false;
    currentQueueIndex.value = 0;
    currentScrapeItem.value = null;
  }

  // 如果当前队列索引超出范围，重置索引
  if (currentQueueIndex.value >= scrapeQueue.value.length) {
    console.warn("检测到队列索引超出范围，正在重置索引");
    currentQueueIndex.value = 0;
  }
};

/**
 * 处理队列模态框关闭事件
 */
const handleQueueModalClose = (): void => {
  // 允许在任何时候关闭模态框
  showQueueModal.value = false;

  // 如果正在处理队列，给用户提示
  if (isProcessingQueue.value) {
    message.info("队列仍在后台处理中，您可以随时重新打开查看进度");
  }
};

/**
 * 显示队列模态框
 * 在显示前检查状态一致性
 */
const handleShowQueueModal = (): void => {
  // 检查并修复状态一致性
  checkQueueStateConsistency();

  // 显示模态框
  showQueueModal.value = true;
};

/**
 * 处理单个刮削任务：重命名视频文件，创建电影文件夹，移动文件，然后下载海报和NFO
 * @param movie 电影数据
 */
const processSingleScrapeTask = async (movie: Movie): Promise<void> => {
  try {
    message.loading("正在处理电影文件...", 0);

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

    let videoFile:
      | { name: string; isDirectory: boolean; isFile: boolean }
      | undefined;
    let searchPath: string;
    let isAlreadyScraped = false;

    // 根据 currentScrapeItem 确定搜索路径和处理方式
    if (currentScrapeItem.value) {
      if (currentScrapeItem.value.type === "folder") {
        // 如果是文件夹类型，说明已经刮削过，在该文件夹中查找视频文件
        searchPath = currentScrapeItem.value.path;
        isAlreadyScraped = true;
      } else {
        // 如果是视频文件类型，在当前目录中查找
        searchPath = currentDirectoryPath.value;
        isAlreadyScraped = false;
      }
    } else {
      // 如果没有 currentScrapeItem，默认在当前目录查找
      searchPath = currentDirectoryPath.value;
      isAlreadyScraped = false;
    }

    // 获取指定路径中的文件
    const folderFiles = await window.api.file.readdir(searchPath);
    const files = folderFiles.data as Array<{
      name: string;
      isDirectory: boolean;
      isFile: boolean;
    }>;

    videoFile = files.find((file) =>
      videoExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)),
    );

    if (!videoFile) {
      message.destroy();
      message.error("未找到视频文件");
      return;
    }

    // 获取视频文件扩展名
    const videoExtension = videoFile.name.substring(
      videoFile.name.lastIndexOf("."),
    );

    // 清理电影名称，移除特殊字符以确保文件名安全
    const cleanMovieName = movie.title
      .replace(/[<>:"/\\|?*]/g, "") // 移除Windows不允许的字符
      .replace(/\s+/g, " ") // 合并多个空格
      .trim();

    // 构建新的文件名和文件夹名
    const newVideoFileName = `${cleanMovieName}${videoExtension}`;
    const movieFolderName = cleanMovieName;

    let movieFolderPath: string;
    let currentVideoPath: string;
    let newVideoPath: string;

    if (isAlreadyScraped) {
      // 如果已经刮削过，检查是否需要重命名文件夹和视频文件
      const currentFolderName = await window.api.path.basename(searchPath);
      const expectedVideoFileName = `${cleanMovieName}${videoExtension}`;

      // 检查文件夹名是否需要更新
      if (currentFolderName !== movieFolderName) {
        // 需要重命名文件夹
        const parentPath = await window.api.path.dirname(searchPath);
        const newFolderPath = await window.api.path.join(
          parentPath,
          movieFolderName,
        );

        const renameFolderResult = await window.api.file.move(
          searchPath,
          newFolderPath,
        );
        if (!renameFolderResult.success) {
          throw new Error(`重命名文件夹失败: ${renameFolderResult.error}`);
        }

        movieFolderPath = newFolderPath;
        console.log(
          `文件夹已重命名: ${currentFolderName} → ${movieFolderName}`,
        );
      } else {
        movieFolderPath = searchPath;
      }

      currentVideoPath = await window.api.path.join(
        movieFolderPath,
        videoFile.name,
      );

      // 检查视频文件是否需要重命名
      if (videoFile.name !== expectedVideoFileName) {
        // 需要重命名视频文件
        newVideoPath = await window.api.path.join(
          movieFolderPath,
          expectedVideoFileName,
        );
        const moveResult = await window.api.file.move(
          currentVideoPath,
          newVideoPath,
        );
        if (!moveResult.success) {
          throw new Error(`重命名视频文件失败: ${moveResult.error}`);
        }
        console.log(
          `视频文件已重命名: ${videoFile.name} → ${expectedVideoFileName}`,
        );
      } else {
        // 文件名已经正确，无需移动
        newVideoPath = currentVideoPath;
      }
    } else {
      // 如果是新刮削，按原有逻辑处理
      currentVideoPath = await window.api.path.join(
        currentDirectoryPath.value,
        videoFile.name,
      );
      movieFolderPath = await window.api.path.join(
        currentDirectoryPath.value,
        movieFolderName,
      );
      newVideoPath = await window.api.path.join(
        movieFolderPath,
        newVideoFileName,
      );

      // 检查电影文件夹是否已存在，如果不存在则创建
      const folderExists = await window.api.file.exists(movieFolderPath);
      if (!folderExists.exists) {
        const createResult = await window.api.file.mkdir(movieFolderPath);
        if (!createResult.success) {
          throw new Error(`创建文件夹失败: ${createResult.error}`);
        }
      }

      // 重命名并移动视频文件到新文件夹
      const moveResult = await window.api.file.move(
        currentVideoPath,
        newVideoPath,
      );
      if (!moveResult.success) {
        throw new Error(`移动视频文件失败: ${moveResult.error}`);
      }
    }

    message.destroy();
    if (isAlreadyScraped) {
      message.success("电影信息已更新");
    } else {
      message.success(`文件已重命名为: ${newVideoFileName}`);
    }

    // 现在调用现有的刮削逻辑来下载海报和NFO文件
    await scrapeMovieInFolder(movie, movieFolderPath, cleanMovieName);

    // 注意：不在这里刷新目录，将在队列处理完成后统一刷新
  } catch (error) {
    message.destroy();
    console.error("处理电影文件失败:", error);
    message.error(
      `处理失败: ${error instanceof Error ? error.message : "未知错误"}`,
    );
    // 即使失败也要清空当前刮削项目
    currentScrapeItem.value = null;
  }
};

/**
 * 处理电影刮削：添加到队列或立即处理
 * @param movie 电影数据
 */
const handleScrapeMovie = async (movie: Movie): Promise<void> => {
  // 添加到刮削队列
  addToScrapeQueue(movie);
  // 开始处理队列
  // await startProcessingQueue();
};

/**
 * 在指定文件夹中刮削电影信息（下载海报和创建NFO文件）
 * @param movieData 电影数据
 * @param folderPath 文件夹路径
 * @param videoBaseName 视频文件基础名称（不含扩展名）
 */
const scrapeMovieInFolder = async (
  movieData: Movie,
  folderPath: string,
  videoBaseName: string,
): Promise<void> => {
  try {
    message.loading("正在清理旧文件并下载电影信息...", 0);

    const TMDB_IMG_URL = "https://image.tmdb.org/t/p/w500";

    // 首先清理文件夹中的旧海报、艺术图和NFO文件
    await cleanOldMovieFiles(folderPath);

    // 构建文件路径
    const nfoFileName = `${videoBaseName}.nfo`;
    const posterFileNames = [
      `${videoBaseName}-poster.jpg`,
      `${videoBaseName}-movie.jpg`,
      `${videoBaseName}-folder.jpg`,
    ];
    const fanartFileNames = [`${videoBaseName}-fanart.jpg`];

    const nfoPath = await window.api.path.join(folderPath, nfoFileName);

    // 创建海报路径
    const posterPaths: { fileName: string; path: string }[] = [];
    for (const fileName of posterFileNames) {
      const path = await window.api.path.join(folderPath, fileName);
      posterPaths.push({ fileName, path });
    }

    // 创建艺术图路径
    const fanartPaths: { fileName: string; path: string }[] = [];
    for (const fileName of fanartFileNames) {
      const path = await window.api.path.join(folderPath, fileName);
      fanartPaths.push({ fileName, path });
    }

    // 创建NFO文件内容
    const nfoContent = createNfoContent(movieData);

    // 写入NFO文件
    const nfoResult = await window.api.file.write(nfoPath, nfoContent);
    if (!nfoResult.success) {
      throw new Error(`创建NFO文件失败: ${nfoResult.error}`);
    }

    // 下载海报
    if (movieData.poster_path) {
      const posterUrl = movieData.poster_path.startsWith("http")
        ? movieData.poster_path
        : `${TMDB_IMG_URL}${movieData.poster_path}`;

      for (const { fileName, path } of posterPaths) {
        const posterResult = await window.api.http.download(posterUrl, path);
        if (!posterResult.success) {
          console.error(`下载 ${fileName} 失败: ${posterResult.error}`);
        }
      }
    }

    // 下载背景图
    if (movieData.backdrop_path) {
      const fanartUrl = `${TMDB_IMG_URL}${movieData.backdrop_path}`;

      for (const { fileName, path } of fanartPaths) {
        const fanartResult = await window.api.http.download(fanartUrl, path);
        if (!fanartResult.success) {
          console.error(`下载 ${fileName} 失败: ${fanartResult.error}`);
        }
      }
    }

    message.destroy();
    message.success("电影信息刮削完成！");
  } catch (error) {
    message.destroy();
    console.error("刮削电影信息失败:", error);
    message.error(
      `刮削失败: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
};

/**
 * 清理文件夹中的旧电影相关文件（海报、艺术图、NFO文件）
 * @param folderPath 文件夹路径
 */
const cleanOldMovieFiles = async (folderPath: string): Promise<void> => {
  try {
    // 获取文件夹中的所有文件
    const folderFiles = await window.api.file.readdir(folderPath);
    const files = folderFiles.data as Array<{
      name: string;
      isDirectory: boolean;
      isFile: boolean;
    }>;

    // 定义需要清理的文件类型
    const filesToDelete: string[] = [];

    for (const file of files) {
      if (file.isFile) {
        const fileName = file.name.toLowerCase();

        // 检查是否是需要清理的文件类型
        const shouldDelete =
          // NFO 文件
          fileName.endsWith(".nfo") ||
          // 海报文件
          fileName.includes("poster") ||
          fileName.includes("movie") ||
          fileName.includes("folder") ||
          // 艺术图文件
          fileName.includes("fanart") ||
          fileName.includes("backdrop") ||
          // 常见的图片文件（但排除视频缩略图）
          ((fileName.endsWith(".jpg") ||
            fileName.endsWith(".jpeg") ||
            fileName.endsWith(".png") ||
            fileName.endsWith(".webp")) &&
            !fileName.includes("thumb"));

        if (shouldDelete) {
          const filePath = await window.api.path.join(folderPath, file.name);
          filesToDelete.push(filePath);
        }
      }
    }

    // 删除旧文件
    for (const filePath of filesToDelete) {
      try {
        const deleteResult = await window.api.file.delete(filePath);
        if (deleteResult.success) {
          console.log(
            `已删除旧文件: ${await window.api.path.basename(filePath)}`,
          );
        } else {
          console.warn(
            `删除文件失败: ${filePath}, 错误: ${deleteResult.error}`,
          );
        }
      } catch (error) {
        console.warn(`删除文件时出错: ${filePath}`, error);
      }
    }

    if (filesToDelete.length > 0) {
      console.log(`已清理 ${filesToDelete.length} 个旧文件`);
    }
  } catch (error) {
    console.warn("清理旧文件时出错:", error);
    // 不抛出错误，继续执行后续操作
  }
};

/**
 * 创建NFO文件内容
 * @param movieData 电影数据
 * @returns NFO XML内容
 */
const createNfoContent = (movieData: Movie): string => {
  const releaseYear = movieData.release_date
    ? new Date(movieData.release_date).getFullYear()
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${movieData.title || ""}</title>
  <originaltitle>${movieData.original_title || movieData.title || ""}</originaltitle>
  <year>${releaseYear}</year>
  <plot>${movieData.overview || ""}</plot>
  <runtime>${movieData.runtime || ""}</runtime>
  <mpaa></mpaa>
  <id>${movieData.id || ""}</id>
  <tmdbid>${movieData.id || ""}</tmdbid>
  <premiered>${movieData.release_date || ""}</premiered>
  <releasedate>${movieData.release_date || ""}</releasedate>
  <rating>${movieData.vote_average || ""}</rating>
  <votes>${movieData.vote_count || ""}</votes>
  <genre>${movieData.genres ? movieData.genres.map((g) => g.name).join(" / ") : ""}</genre>
  <country></country>
  <studio></studio>
  <trailer></trailer>
  <fileinfo>
    <streamdetails>
      <video>
        <codec></codec>
        <aspect></aspect>
        <width></width>
        <height></height>
        <durationinseconds></durationinseconds>
      </video>
      <audio>
        <codec></codec>
        <language></language>
        <channels></channels>
      </audio>
    </streamdetails>
  </fileinfo>
</movie>`;
};

const downloadPoster = async (): Promise<void> => {
  // 下载海报的逻辑
  message.info("下载海报功能待实现");
};

// 缓存相关方法
const saveToCache = (): void => {
  try {
    localStorage.setItem(
      "folderContent_fileData",
      JSON.stringify(fileData.value),
    );
    localStorage.setItem(
      "folderContent_currentPath",
      currentDirectoryPath.value,
    );
  } catch (error) {
    console.error("保存缓存失败:", error);
  }
};

const loadFromCache = (): boolean => {
  try {
    const cachedData = localStorage.getItem("folderContent_fileData");
    const cachedPath = localStorage.getItem("folderContent_currentPath");
    if (cachedData && cachedPath) {
      fileData.value = JSON.parse(cachedData) as FileItem[];
      currentDirectoryPath.value = cachedPath as string;
      return true;
    }
  } catch (error) {
    console.error("加载缓存失败:", error);
  }
  return false;
};

const clearCache = (): void => {
  try {
    localStorage.removeItem("folderContent_fileData");
    localStorage.removeItem("folderContent_currentPath");
  } catch (error) {
    console.error("清除缓存失败:", error);
  }
};

// 拖拽调整大小
// const startResize = (event: MouseEvent): void => {
//   event.preventDefault();
//   const startX = event.clientX;
//   const startWidth = leftPanelWidth.value;

//   const handleMouseMove = (e: MouseEvent): void => {
//     const deltaX = e.clientX - startX;
//     const newWidth = Math.max(
//       minPanelWidth.value,
//       Math.min(600, startWidth + deltaX),
//     );
//     leftPanelWidth.value = newWidth;
//   };

//   const handleMouseUp = (): void => {
//     document.removeEventListener("mousemove", handleMouseMove);
//     document.removeEventListener("mouseup", handleMouseUp);
//   };

//   document.addEventListener("mousemove", handleMouseMove);
//   document.addEventListener("mouseup", handleMouseUp);
// };

// 图片和NFO加载相关方法
const loadPosterImage = async (): Promise<void> => {
  posterImageDataUrl.value = "";
  if (!posterImagePath.value) return;

  try {
    const result = await window.api.file.readImage(posterImagePath.value);
    if (result.success && result.data) {
      posterImageDataUrl.value = result.data as string;
    }
  } catch (error) {
    console.error("Failed to load poster image:", error);
  }
};

const loadFanartImage = async (): Promise<void> => {
  fanartImageDataUrl.value = "";
  menuBackgroundColor.value = "rgba(0, 0, 0, 0.6)";
  if (!fanartImagePath.value) return;

  try {
    const result = await window.api.file.readImage(fanartImagePath.value);
    if (result.success && result.data) {
      fanartImageDataUrl.value = result.data as string;
    }
  } catch (error) {
    console.error("Failed to load fanart image:", error);
  }
};

const loadNfoContent = async (): Promise<void> => {
  nfoContent.value = "";
  movieInfo.value = null;
  if (!nfoFilePath.value) return;

  try {
    const result = await window.api.file.read(nfoFilePath.value);
    if (result.success && result.data) {
      nfoContent.value = result.data as string;
      parseNfoContent(result.data as string);
    }
  } catch (error) {
    console.error("Failed to load NFO file:", error);
  }
};

const parseNfoContent = (content: string): void => {
  movieInfo.value = null;
  if (!content) return;

  try {
    const info: MovieInfoType = {};

    // 提取标题
    const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) info.title = titleMatch[1].trim();

    // 提取原始标题
    const originalTitleMatch = content.match(
      /<originaltitle>([^<]+)<\/originaltitle>/i,
    );
    if (originalTitleMatch) info.originaltitle = originalTitleMatch[1].trim();

    // 提取年份
    const yearMatch = content.match(/<year>(\d{4})<\/year>/i);
    if (yearMatch) info.year = yearMatch[1];

    // 提取剧情简介
    const plotMatch = content.match(/<plot>([^<]+)<\/plot>/i);
    if (plotMatch) info.plot = plotMatch[1].trim();

    // 提取类型
    const genreMatches = content.match(/<genre>([^<]+)<\/genre>/gi);
    if (genreMatches) {
      info.genre = genreMatches.map((match) =>
        match.replace(/<\/?genre>/gi, "").trim(),
      );
    }

    // 提取导演
    const directorMatch = content.match(/<director>([^<]+)<\/director>/i);
    if (directorMatch) info.director = directorMatch[1].trim();

    // 提取演员
    const actorMatches = content.match(/<actor>\s*<name>([^<]+)<\/name>/gi);
    if (actorMatches) {
      info.actor = actorMatches
        .map((match) => {
          const nameMatch = match.match(/<name>([^<]+)<\/name>/i);
          return nameMatch ? nameMatch[1].trim() : "";
        })
        .filter((name) => name);
    }

    // 提取评分
    const ratingMatch = content.match(/<rating>([^<]+)<\/rating>/i);
    if (ratingMatch) info.rating = ratingMatch[1].trim();

    // 提取时长
    const runtimeMatch = content.match(/<runtime>([^<]+)<\/runtime>/i);
    if (runtimeMatch) info.runtime = runtimeMatch[1].trim();

    // 提取国家
    const countryMatch = content.match(/<country>([^<]+)<\/country>/i);
    if (countryMatch) info.country = countryMatch[1].trim();

    // 提取制片公司
    const studioMatch = content.match(/<studio>([^<]+)<\/studio>/i);
    if (studioMatch) info.studio = studioMatch[1].trim();

    // 提取首映日期
    const premieredMatch = content.match(/<premiered>([^<]+)<\/premiered>/i);
    if (premieredMatch) info.premiered = premieredMatch[1].trim();

    movieInfo.value = info;
  } catch (error) {
    console.error("解析NFO内容失败:", error);
  }
};

// 监听器
watch(posterImagePath, loadPosterImage, { immediate: true });
watch(fanartImagePath, loadFanartImage, { immediate: true });
watch(nfoFilePath, loadNfoContent, { immediate: true });

/**
 * 监听背景图变化，控制全局背景
 */
watch(
  [selectedItem, fanartImageDataUrl],
  ([newSelectedItem, newFanartImageDataUrl]) => {
    if (appLayoutMethods) {
      if (newSelectedItem && newFanartImageDataUrl) {
        // 设置全局背景艺术图
        appLayoutMethods.setGlobalBackground(
          newFanartImageDataUrl,
          "rgba(17, 24, 39, 0.2)", // 更透明的菜单背景色
        );
      } else {
        // 清除全局背景
        appLayoutMethods.clearGlobalBackground();
      }
    }
  },
  { immediate: true },
);

// 生命周期
onMounted(() => {
  const loaded = loadFromCache();
  if (loaded) {
    console.log("组件启动时已从缓存加载数据");
  }
});

// 组件卸载时清理定时器

// 导出函数供外部组件使用
defineExpose({
  addBatchToScrapeQueue,
  addToScrapeQueue,
  refreshFiles,
  refreshDirectory,
  toggleMultiSelectMode,
  toggleSelectAll,
  addSelectedToScrapeQueue,
});
</script>

<style scoped>
.folder-item {
  transition: all 0.2s ease-in-out;
}

.folder-item:hover {
  transform: translateY(-2px);
}

.empty-state {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
  transition: background-color 0.3s ease;
}

.glass-panel::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: inherit;
  backdrop-filter: inherit;
  -webkit-backdrop-filter: inherit;
  z-index: -1;
}

.selected-item {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 1, 0.2);
  transition: all 0.3s ease;
}

/* 海报3D悬浮效果 */
.poster-3d {
  perspective: 1000px;
  transform-style: preserve-3d;
  transition: all 0.3s ease;
}

.poster-3d:hover {
  transform: rotateY(-5deg) rotateX(5deg) translateZ(20px);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.3),
    0 10px 20px rgba(0, 0, 0, 0.2),
    -10px 0 20px rgba(0, 0, 0, 0.1);
}

.poster-3d:hover img {
  transform: scale(1.05);
}

/* 悬浮面板样式 */
.glass-panel-floating {
  background: rgba(17, 24, 39, 0.3);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.glass-panel-floating:hover {
  background: rgba(17, 24, 39, 0.4);
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow:
    0 32px 64px -12px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.1);
}
</style>
