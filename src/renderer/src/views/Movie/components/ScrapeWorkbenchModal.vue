<template>
  <Transition name="modal-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[960] flex items-center justify-center"
    >
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        @click="emitClose"
      />

      <div
        class="sw-sheet relative w-[820px] max-h-[90vh] flex flex-col overflow-hidden glass-panel-floating"
        @click.stop
      >
        <DialogTitlebar title="刮削工作台" icon="search" @close="emitClose" />
        <div class="sw-subtitle truncate px-5 py-3" :title="item?.name">{{ displayItemName }}<span v-if="providerLabel" class="ml-2 yb-chip">{{ providerLabel }}</span></div>

        <!-- Search / avid bar (always available) -->
        <div class="sw-search-row flex gap-2.5 flex-shrink-0">
          <input
            v-model="queryInput"
            class="sw-input flex-1"
            :placeholder="searchPlaceholder"
            @keydown.enter.prevent="handleSearch"
          />
          <button
            class="yb-btn-primary text-xs font-semibold px-4 sw-search-btn"
            :disabled="loading || searching"
            @click="handleSearch"
          >
            {{ searching ? '搜索中…' : '搜索' }}
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto custom-scrollbar min-h-[280px]">
          <!-- loading -->
          <div
            v-if="loading"
            class="flex items-center justify-center py-16 yb-muted text-sm"
          >
            {{ loadingText }}
          </div>

          <!-- error (still allow search) -->
          <div
            v-else-if="error && searchResults.length === 0"
            class="flex flex-col items-center justify-center py-14 gap-3 px-6"
          >
            <span class="text-sm text-center" style="color: var(--danger)">{{
              error
            }}</span>
            <p class="text-xs yb-muted text-center">
              可修改上方片名后重新搜索
            </p>
          </div>

          <!-- TMDB / TV / search results -->
          <div v-else-if="searchResults.length > 0" class="p-5">
            <div class="text-xs yb-muted mb-3">
              找到 {{ searchResults.length }} 个结果，点击选用并加入队列
            </div>
            <div class="grid grid-cols-4 gap-3">
              <div
                v-for="result in searchResults"
                :key="result.id"
                class="sw-card group cursor-pointer"
                @click="handlePickResult(result)"
              >
                <div
                  class="sw-poster relative overflow-hidden rounded-t-[var(--radius-lg)]"
                >
                  <img
                    v-if="result.poster_path"
                    :src="String(result.poster_path)"
                    :alt="resultTitle(result)"
                    class="sw-poster-img w-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                    @error="hideBrokenImage"
                  />
                  <div
                    v-else
                    class="sw-poster-img w-full yb-poster-ph flex items-center justify-center text-sm"
                  >
                    无海报
                  </div>
                </div>
                <div class="p-2.5">
                  <h4
                    class="font-medium text-xs mb-1 line-clamp-2 leading-snug"
                    style="color: var(--text-primary)"
                  >
                    {{ resultTitle(result) }}
                  </h4>
                  <div
                    v-if="resultYear(result)"
                    class="text-[10px] yb-dim mb-2"
                  >
                    {{ resultYear(result) }}
                  </div>
                  <button
                    class="sw-pick-btn"
                    :disabled="processing"
                    @click.stop="handlePickResult(result)"
                  >
                    {{ isTV ? '选用并刮削' : '加入队列' }}
                  </button>
                </div>
              </div>
            </div>
            <div
              v-if="actionMsg"
              class="mt-3 text-[11px] font-mono"
              :style="{
                color: actionMsgIsError ? 'var(--danger)' : 'var(--success)',
              }"
            >
              {{ actionMsg }}
            </div>
          </div>

          <!-- empty -->
          <div
            v-else
            class="flex flex-col items-center justify-center py-14 gap-2 px-6"
          >
            <span class="text-sm yb-muted">{{ emptyText }}</span>
            <span class="text-xs yb-dim text-center">
              {{ emptyHint }}
            </span>
          </div>
        </div>
      </div>

    </div>
  </Transition>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useTVScraping } from '@/views/TV/composables/use-tv-scraping'
import {
  cleanSearchParams,
  stripMediaExtension,
} from '@/utils/avid'
import type { ProcessedItem } from '@/types'
import type { ScrapedMovie } from '@/types/scraping'

/** TV / movie 搜索结果共用展示形状 */
export interface WorkbenchMediaResult {
  id: number
  poster_path?: string | null
  vote_average?: number
  overview?: string
  title?: string
  original_title?: string
  release_date?: string
  name?: string
  original_name?: string
  first_air_date?: string
  [key: string]: unknown
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    item: ProcessedItem | null
    /** 打开时优先使用的番号 / 关键词 */
    initialQuery?: string
    /** movie：TMDB；tv：电视剧 TMDB 搜索 */
    mediaType?: 'movie' | 'tv'
  }>(),
  {
    mediaType: 'movie',
    initialQuery: '',
  }
)

const emit = defineEmits<{
  close: []
  scrape: [movie: ScrapedMovie, item: ProcessedItem]
  'scrape-tv': [result: WorkbenchMediaResult, item: ProcessedItem]
}>()

const { searchMovieInfo } = useScraping()
const { searchTVInfo } = useTVScraping()

const loading = ref(false)
const searching = ref(false)
const processing = ref(false)
const error = ref('')
const actionMsg = ref('')
const searchResults = ref<WorkbenchMediaResult[]>([])
const queryInput = ref('')
const provider = ref(getScrapeProviderConfig().provider)

const isTV = computed(() => props.mediaType === 'tv')

const providerLabel = computed(() => {
  if (isTV.value) return 'TMDB/TV'
  if (provider.value === 'tmdb') return 'TMDB'
  return '自定义'
})

const searchPlaceholder = computed(() => {
  if (isTV.value) return '输入电视剧名称搜索'
  return '输入电影名称搜索'
})

const loadingText = computed(() => {
  if (isTV.value) return '正在搜索电视剧…'
  return '正在搜索匹配结果…'
})

const emptyText = computed(() => {
  if (error.value) return error.value
  return '暂无预览或搜索结果'
})

const emptyHint = computed(() => {
  if (isTV.value) return '请修改关键词后搜索，从结果中选择匹配项'
  return '请修改关键词后搜索，从结果中选择匹配项'
})

const actionMsgIsError = computed(() => {
  const msg = actionMsg.value
  return msg.startsWith('❌') || msg.includes('失败')
})

/** 标题栏展示名：文件夹保留全名，文件去掉视频扩展名 */
const displayItemName = computed(() => {
  const item = props.item
  if (!item) return '未选择项目'
  if (item.type === 'folder') return item.name
  return stripMediaExtension(item.name)
})


const hideBrokenImage = (e: Event): void => {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = 'none'
}

const resultTitle = (result: WorkbenchMediaResult): string =>
  String(
    result.title ||
      result.name ||
      result.original_title ||
      result.original_name ||
      ''
  )

const resultYear = (result: WorkbenchMediaResult): string => {
  const raw = String(result.release_date || result.first_air_date || '')
  return raw ? raw.slice(0, 4) : ''
}

const emitClose = (): void => {
  emit('close')
}

const resetBody = (): void => {
  loading.value = false
  searching.value = false
  processing.value = false
  error.value = ''
  actionMsg.value = ''
  searchResults.value = []
}

const runMovieSearch = async (query: string): Promise<void> => {
  if (!props.item) return
  searching.value = true
  loading.value = true
  error.value = ''
  searchResults.value = []
  try {
    const movies = await searchMovieInfo({ ...props.item, name: query })
    searchResults.value = (movies || []) as unknown as WorkbenchMediaResult[]
    if (!movies || movies.length === 0) {
      error.value = '没有搜索结果，请修改关键词后重试'
      message.info(error.value)
    }
  } catch (e: unknown) {
    error.value = `搜索失败: ${e instanceof Error ? e.message : String(e)}`
    message.error(error.value)
  } finally {
    searching.value = false
    loading.value = false
  }
}

const runTVSearch = async (query: string): Promise<void> => {
  if (!props.item) return
  searching.value = true
  loading.value = true
  error.value = ''
  searchResults.value = []
  try {
    const shows = await searchTVInfo({ ...props.item, name: query })
    searchResults.value = (shows || []) as WorkbenchMediaResult[]
    if (!shows || shows.length === 0) {
      error.value = '没有搜索结果，请修改关键词后重试'
      // searchTVInfo 已有提示，避免重复打扰
    }
  } catch (e: unknown) {
    error.value = `搜索失败: ${e instanceof Error ? e.message : String(e)}`
    message.error(error.value)
  } finally {
    searching.value = false
    loading.value = false
  }
}

const bootstrap = async (): Promise<void> => {
  resetBody()
  provider.value = getScrapeProviderConfig().provider
  if (!props.item) {
    error.value = '未选择要刮削的项目'
    message.warning(error.value)
    return
  }

  const raw = (props.initialQuery || props.item.name).trim()
  const query = cleanSearchParams(stripMediaExtension(raw)) || stripMediaExtension(raw)
  queryInput.value = query

  if (isTV.value) {
    await runTVSearch(query)
    return
  }

  await runMovieSearch(query)
}

const handleSearch = async (): Promise<void> => {
  const q = queryInput.value.trim()
  if (!q) {
    message.error(
      isTV.value ? '请输入电视剧名称' : '请输入电影名称'
    )
    return
  }

  if (isTV.value) {
    await runTVSearch(q)
    return
  }

  await runMovieSearch(q)
}

const handlePickResult = (result: WorkbenchMediaResult): void => {
  if (!props.item) {
    message.warning('未选择要刮削的项目')
    return
  }
  processing.value = true
  actionMsg.value = ''
  if (isTV.value) {
    emit('scrape-tv', result, props.item)
    actionMsg.value = '✅ 已加入刮削队列'
    message.success('已加入刮削队列')
  } else {
    emit('scrape', result as unknown as ScrapedMovie, props.item)
    actionMsg.value = '✅ 已加入刮削队列'
    message.success('已加入刮削队列')
  }
  processing.value = false
}

watch(
  () => props.visible,
  async v => {
    if (!v) {
      resetBody()
      return
    }
    await bootstrap()
  }
)

defineExpose({
  setResult(msg: string, isError = false) {
    actionMsg.value = msg
    processing.value = false
    if (!isError) {
      setTimeout(() => {
        actionMsg.value = ''
      }, 3000)
    }
  },
})
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.22s var(--ease-out, ease);
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.sw-sheet {
  border-radius: 10px;
  box-shadow:
    var(--shadow-lg),
    0 0 0 0.5px color-mix(in srgb, var(--border-glass-light) 80%, transparent);
}

.sw-subtitle {
  margin-top: 4px;
  font-size: var(--text-xs, 12px);
  color: var(--text-tertiary);
  line-height: 1.35;
}

.sw-search-row {
  padding: 14px 22px 14px;
  border-bottom: 1px solid var(--separator);
}

.sw-input {
  height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
  transition: var(--transition-fast);
}

.sw-input:focus {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  background: var(--bg-elevated, var(--bg-fill-secondary));
}

.sw-search-btn {
  height: 40px;
  border-radius: 999px !important;
  padding-left: 18px !important;
  padding-right: 18px !important;
}

.jb-avatar {
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}

.sw-card {
  background: transparent;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: var(--transition-fast);
}

.sw-card:hover {
  border-color: var(--border-glass-light);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.sw-poster {
  width: 100%;
}

.sw-poster-img {
  width: 100%;
  aspect-ratio: 2 / 3;
  height: auto;
  object-fit: cover;
  display: block;
}

.sw-pick-btn {
  width: 100%;
  padding: 6px 0;
  border-radius: 999px;
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  color: var(--accent-text);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  cursor: pointer;
  transition: var(--transition-fast);
}

.sw-pick-btn:hover {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
}

.sw-pick-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .sw-card:hover {
    transform: none;
  }
}
</style>
