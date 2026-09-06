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
        <!-- Header -->
        <div class="sw-header flex items-start justify-between flex-shrink-0">
          <div class="min-w-0 pr-3">
            <div class="sw-title">
              刮削工作台
            </div>
            <div class="sw-subtitle truncate" :title="item?.name">
              {{ displayItemName }}
              <span v-if="providerLabel" class="ml-2 yb-chip">{{ providerLabel }}</span>
            </div>
          </div>
          <button
            class="sw-close"
            aria-label="关闭"
            @click="emitClose"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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
            v-else-if="error && !meta && searchResults.length === 0"
            class="flex flex-col items-center justify-center py-14 gap-3 px-6"
          >
            <span class="text-sm text-center" style="color: var(--danger)">{{ error }}</span>
            <p class="text-xs yb-muted text-center">
              可修改上方关键词后重新搜索，或手动输入番号后获取预览
            </p>
          </div>

          <!-- JavBus preview -->
          <div v-else-if="meta" class="p-6 space-y-5">
            <img
              v-if="meta.cover"
              :src="proxyUrl(meta.cover)"
              class="w-full flex-shrink-0 rounded-[var(--radius-lg)] object-cover"
              style="aspect-ratio: 16/10.5"
              @error="hideBrokenImage"
            />

            <div class="space-y-3">
              <h2 class="font-semibold text-base leading-snug" style="color: var(--text-primary)">
                {{ meta.title }}
              </h2>
              <div class="flex flex-wrap gap-1.5">
                <span class="yb-chip yb-chip-accent">{{ meta.avid }}</span>
                <span v-if="meta.release_date" class="yb-chip">{{ meta.release_date }}</span>
                <span v-if="meta.duration" class="yb-chip">{{ meta.duration }}</span>
              </div>
              <p
                v-if="meta.description"
                class="yb-muted text-[12px] leading-relaxed line-clamp-4"
              >
                {{ meta.description }}
              </p>
              <div v-if="meta.keywords?.length" class="flex flex-wrap gap-1">
                <span v-for="kw in meta.keywords" :key="kw" class="yb-chip">{{ kw }}</span>
              </div>

              <div class="flex flex-wrap gap-2 pt-1">
                <button
                  class="yb-btn-primary text-sm"
                  :disabled="processing || !item"
                  @click="handleEnqueueMeta"
                >
                  {{ processing ? '加入中…' : '加入队列' }}
                </button>
                <button
                  class="yb-btn-soft text-sm"
                  :disabled="loading || searching"
                  @click="focusSearchMode"
                >
                  修改番号 / 搜索
                </button>
              </div>
              <div
                v-if="actionMsg"
                class="text-[11px] font-mono"
                :style="{ color: actionMsgIsError ? 'var(--danger)' : 'var(--success)' }"
              >
                {{ actionMsg }}
              </div>
            </div>

            <div v-if="meta.actress && Object.keys(meta.actress).length">
              <h3 class="yb-label mb-2">演员</h3>
              <div class="flex gap-3 flex-wrap">
                <div
                  v-for="(img, name) in meta.actress"
                  :key="name"
                  class="flex flex-col items-center gap-1"
                >
                  <img
                    :src="proxyUrl(img)"
                    :alt="String(name)"
                    class="w-12 h-12 rounded-full object-cover jb-avatar"
                    @error="hideBrokenImage"
                  />
                  <span class="text-[10px] yb-muted max-w-[48px] truncate text-center">{{ name }}</span>
                </div>
              </div>
            </div>

            <div v-if="meta.fanarts?.length">
              <h3 class="yb-label mb-2">预览图</h3>
              <div class="grid grid-cols-3 gap-2">
                <img
                  v-for="(img, i) in meta.fanarts"
                  :key="i"
                  :src="proxyUrl(img)"
                  class="w-full rounded-md object-cover cursor-pointer hover:opacity-80 transition-opacity"
                  style="aspect-ratio: 16/9"
                  @click="previewImg = proxyUrl(img)"
                  @error="hideBrokenImage"
                />
              </div>
            </div>
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
                <div class="sw-poster relative overflow-hidden rounded-t-[var(--radius-lg)]">
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
                  <div v-if="resultYear(result)" class="text-[10px] yb-dim mb-2">
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
              :style="{ color: actionMsgIsError ? 'var(--danger)' : 'var(--success)' }"
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

      <Teleport to="body">
        <div
          v-if="previewImg"
          class="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center"
          @click="previewImg = null"
        >
          <img :src="previewImg" class="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" />
        </div>
      </Teleport>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { backend, type BackendMeta } from '@/api/backend'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useTVScraping } from '@/views/TV/composables/use-tv-scraping'
import { cleanSearchParams, extractAvid, stripMediaExtension } from '@/utils/avid'
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
    /** movie：TMDB/JavBus；tv：电视剧 TMDB 搜索 */
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
const meta = ref<BackendMeta | null>(null)
const searchResults = ref<WorkbenchMediaResult[]>([])
const queryInput = ref('')
const previewImg = ref<string | null>(null)
const provider = ref(getScrapeProviderConfig().provider)

const isTV = computed(() => props.mediaType === 'tv')
const isJavBus = computed(() => !isTV.value && provider.value === 'javbus')

const providerLabel = computed(() => {
  if (isTV.value) return 'TMDB/TV'
  if (provider.value === 'javbus') return 'JavBus'
  if (provider.value === 'tmdb') return 'TMDB'
  return '自定义'
})

const searchPlaceholder = computed(() => {
  if (isTV.value) return '输入电视剧名称搜索'
  if (isJavBus.value) return '输入番号或关键词（如 MIDE-123）'
  return '输入电影名称搜索'
})

const loadingText = computed(() => {
  if (isTV.value) return '正在搜索电视剧…'
  return isJavBus.value ? '正在获取元数据预览…' : '正在搜索匹配结果…'
})

const emptyText = computed(() => {
  if (error.value) return error.value
  return '暂无预览或搜索结果'
})

const emptyHint = computed(() => {
  if (isTV.value) return '请修改关键词后搜索，从结果中选择匹配项'
  if (isJavBus.value) return '请输入番号后搜索，确认预览再加入队列'
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

const proxyUrl = (url: string) => (url ? backend.proxyUrl(url) : '')

const hideBrokenImage = (e: Event): void => {
  const el = e.target as HTMLImageElement | null
  if (el) el.style.display = 'none'
}

const resultTitle = (result: WorkbenchMediaResult): string =>
  String(result.title || result.name || result.original_title || result.original_name || '')

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
  meta.value = null
  searchResults.value = []
  previewImg.value = null
}

const buildJavBusMovie = (data: BackendMeta): ScrapedMovie => ({
  id: data.avid as any,
  title: data.title || data.avid,
  original_title: data.avid,
  overview: data.description || '',
  release_date: data.release_date || '',
  vote_average: 0,
  vote_count: 0,
  poster_path: data.cover || '',
  backdrop_path: data.fanarts?.[0] || '',
  adult: false,
  genre_ids: [],
  original_language: 'ja',
  popularity: 0,
  video: false,
  _javbus: data,
})

const fetchJavBusPreview = async (avid: string): Promise<void> => {
  loading.value = true
  error.value = ''
  meta.value = null
  searchResults.value = []
  try {
    const data = await backend.fetchMeta(avid)
    if (data.error) {
      error.value = `获取失败: ${data.error}`
      message.warning(error.value)
    } else {
      meta.value = data
      queryInput.value = data.avid || avid
    }
  } catch (e: unknown) {
    error.value = `请求失败: ${e instanceof Error ? e.message : String(e)}`
    message.error(error.value)
  } finally {
    loading.value = false
  }
}

const runMovieSearch = async (query: string): Promise<void> => {
  if (!props.item) return
  searching.value = true
  loading.value = true
  error.value = ''
  meta.value = null
  searchResults.value = []
  try {
    const movies = await searchMovieInfo({ ...props.item, name: query })
    searchResults.value = (movies || []) as WorkbenchMediaResult[]
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
  meta.value = null
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

/** 构建搜索框初始值：永不塞入原始 xxx.mp4 */
const resolveBootstrapQuery = (
  item: ProcessedItem
): { query: string; avid: string | null } => {
  const fromProp = (props.initialQuery || '').trim()

  if (isTV.value) {
    const raw = fromProp || (item.type === 'folder' ? item.name : stripMediaExtension(item.name))
    return { query: cleanSearchParams(raw) || stripMediaExtension(raw), avid: null }
  }

  if (fromProp) {
    const avid = extractAvid(fromProp)
    if (isJavBus.value) {
      return { query: avid || stripMediaExtension(fromProp), avid }
    }
    // TMDB / 自定义：像番号则保留番号，否则走 cleanSearchParams（保留年份）
    return { query: avid || cleanSearchParams(fromProp), avid }
  }

  const avid = extractAvid(item.name)
  if (isJavBus.value) {
    return { query: avid || stripMediaExtension(item.name), avid }
  }
  return { query: cleanSearchParams(item.name), avid }
}

const bootstrap = async (): Promise<void> => {
  resetBody()
  provider.value = getScrapeProviderConfig().provider
  if (!props.item) {
    error.value = '未选择要刮削的项目'
    message.warning(error.value)
    return
  }

  const { query, avid } = resolveBootstrapQuery(props.item)
  queryInput.value = query

  if (isTV.value) {
    await runTVSearch(query)
    return
  }

  if (isJavBus.value && !avid && !(props.initialQuery || '').trim()) {
    message.warning('未能从文件名提取番号，请手动输入后搜索')
  }

  if (isJavBus.value) {
    if (avid) {
      await fetchJavBusPreview(avid)
    } else {
      error.value = '未能识别番号，请在上方输入番号后搜索'
    }
    return
  }

  await runMovieSearch(query)
}

const handleSearch = async (): Promise<void> => {
  const q = queryInput.value.trim()
  if (!q) {
    message.error(
      isTV.value ? '请输入电视剧名称' : isJavBus.value ? '请输入番号或关键词' : '请输入电影名称'
    )
    return
  }

  if (isTV.value) {
    await runTVSearch(q)
    return
  }

  if (isJavBus.value) {
    const avid = extractAvid(q) || q.toUpperCase()
    queryInput.value = avid
    await fetchJavBusPreview(avid)
    return
  }

  await runMovieSearch(q)
}

const focusSearchMode = (): void => {
  meta.value = null
  searchResults.value = []
  error.value = ''
  actionMsg.value = ''
  // keep queryInput so user can edit
}

const handleEnqueueMeta = (): void => {
  if (!meta.value || !props.item) {
    message.warning('暂无可用元数据，请先搜索')
    return
  }
  processing.value = true
  actionMsg.value = ''
  emit('scrape', buildJavBusMovie(meta.value), props.item)
  actionMsg.value = '✅ 已加入刮削队列'
  processing.value = false
  message.success('已加入刮削队列')
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
    emit('scrape', result as ScrapedMovie, props.item)
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
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), 0 0 0 0.5px color-mix(in srgb, var(--border-glass-light) 80%, transparent);
}

.sw-header {
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--separator);
}

.sw-title {
  font-size: var(--text-md, 15px);
  font-weight: var(--font-weight-semibold, 600);
  letter-spacing: -0.02em;
  color: var(--text-primary);
  line-height: 1.3;
}

.sw-subtitle {
  margin-top: 4px;
  font-size: var(--text-xs, 12px);
  color: var(--text-tertiary);
  line-height: 1.35;
}

.sw-close {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--text-tertiary);
  background: var(--bg-fill-secondary);
  border: 0;
  cursor: pointer;
  transition: var(--transition-fast);
}

.sw-close:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
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
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-glass);
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
