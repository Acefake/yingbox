<template>
  <AModal
    :open="visible"
    :title="title"
    :width="1000"
    :footer="null"
    :centered="true"
    :destroy-on-close="true"
    :z-index="9999"
    @cancel="$emit('close')"
  >
    <div class="mb-4 flex gap-2">
      <AInput
        v-model:value="searchQuery"
        :placeholder="type === 'tv' ? '输入电视剧名称搜索' : '输入电影名称搜索'"
        size="large"
        @pressEnter="handleResearch"
      />
      <AButton
        type="primary"
        size="large"
        :loading="isSearching"
        @click="handleResearch"
      >
        重新搜索
      </AButton>
    </div>
    <div class="max-h-[80vh] overflow-y-auto custom-scrollbar">
      <div
        v-if="results.length === 0 && !isSearching"
        class="text-center py-8 text-gray-500"
      >
        <p>没有搜索结果</p>
        <p class="text-sm mt-2">请修改搜索关键词后点击"重新搜索"</p>
      </div>
      <div v-else class="grid grid-cols-5 gap-4 my-5">
        <div
          v-for="item in results"
          :key="item.id"
          class="modal-card group cursor-pointer"
          @click="handlePick(item)"
        >
          <div class="relative overflow-hidden rounded-t-xl">
            <img
              v-if="getPoster(item)"
              :src="getPoster(item)"
              :alt="getTitle(item)"
              class="h-56 w-full object-cover group-hover:scale-105 transition-transform duration-300"
              @error="handleImageError"
            />
            <div
              v-else
              class="h-56 w-full bg-gray-700/30 flex items-center justify-center"
            >
              <span class="text-gray-400 text-sm">无海报</span>
            </div>
            <!-- 评分角标 -->
            <div
              v-if="item.vote_average"
              class="absolute top-2 right-2 flex items-center gap-0.5 bg-black/60 backdrop-blur-sm rounded-md px-1.5 py-0.5 text-[11px] text-yellow-400 font-medium"
            >
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                />
              </svg>
              {{ item.vote_average.toFixed(1) }}
            </div>
          </div>

          <div class="p-3">
            <h4
              class="text-white font-medium text-sm mb-1 line-clamp-2 leading-snug"
            >
              {{ getTitle(item) }}
            </h4>
            <div
              v-if="
                getOriginalTitle(item) &&
                getOriginalTitle(item) !== getTitle(item)
              "
              class="text-[10px] text-gray-500 -mt-0.5 mb-1 truncate"
            >
              {{ getOriginalTitle(item) }}
            </div>
            <div v-if="getYear(item)" class="text-[11px] text-gray-400 mb-2">
              {{ getYear(item) }}
            </div>
            <p
              v-if="item.overview"
              class="text-[11px] text-gray-400/80 line-clamp-2 mb-3 leading-relaxed"
            >
              {{ item.overview }}
            </p>

            <button
              class="w-full py-1.5 rounded-lg text-xs font-medium text-white bg-blue-500/40 border border-blue-500/20 hover:bg-blue-500/60 transition-all backdrop-blur-sm"
              :class="{
                'opacity-60 pointer-events-none': loadingId === item.id,
              }"
              @click.stop="handlePick(item)"
            >
              {{ loadingId === item.id ? '处理中...' : '使用此结果' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </AModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Modal as AModal,
  Input as AInput,
  Button as AButton,
} from 'ant-design-vue'

export interface MediaResult {
  id: number
  poster_path?: string | null
  vote_average?: number
  overview?: string
  // movie
  title?: string
  original_title?: string
  release_date?: string
  // tv
  name?: string
  original_name?: string
  first_air_date?: string
}

interface Props {
  visible: boolean
  type: 'movie' | 'tv'
  results: MediaResult[]
  /** 正在处理的条目 ID（显示 loading 状态） */
  loadingId?: number | null
  /** 初始搜索查询 */
  initialQuery?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialQuery: '',
})

const emit = defineEmits<{
  close: []
  /** 用户选中某个结果，触发刮削流程 */
  scrape: [item: MediaResult]
  /** 用户重新搜索 */
  research: [query: string]
}>()

const searchQuery = ref(props.initialQuery)
const isSearching = ref(false)

watch(
  () => props.initialQuery,
  newVal => {
    searchQuery.value = newVal
  }
)

const handleResearch = (): void => {
  if (!searchQuery.value.trim()) return
  isSearching.value = true
  emit('research', searchQuery.value)
}

watch(
  () => props.results,
  () => {
    isSearching.value = false
  }
)

const title = computed(() =>
  props.type === 'tv'
    ? `搜索结果 (${props.results.length} 部电视剧)`
    : `搜索结果 (${props.results.length} 部电影)`
)

const handlePick = (item: MediaResult): void => {
  if (props.loadingId != null) return
  emit('scrape', item)
}

const getTitle = (item: MediaResult): string => item.title ?? item.name ?? ''
const getOriginalTitle = (item: MediaResult): string =>
  item.original_title ?? item.original_name ?? ''

const getYear = (item: MediaResult): string => {
  const d = item.release_date ?? item.first_air_date
  return d ? String(new Date(d).getFullYear()) : ''
}

const getPoster = (item: MediaResult): string => {
  return item.poster_path || ''
}

const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement | null
  if (target) target.style.display = 'none'
}
</script>

<style scoped>
.modal-card {
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 12px;
  border: 1px solid var(--border-glass);
  overflow: hidden;
  transition: var(--transition-fast);
}
.modal-card:hover {
  border-color: var(--border-glass-light);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}
</style>
