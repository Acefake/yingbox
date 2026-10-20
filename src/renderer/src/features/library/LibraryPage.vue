<template>
  <div class="lib-page">
    <!-- 工具栏：标题与数量、视图切换、搜索筛选排序、操作 -->
    <header class="lib-toolbar">
      <div class="lib-toolbar-title">
        <h1>{{ kindLabel }}</h1>
        <span v-if="view === 'wall' && ready" class="lib-toolbar-count">{{
          total.toLocaleString('zh-CN')
        }}</span>
      </div>
      <UiSegmented
        v-if="hasLibraries"
        v-model="view"
        class="lib-toolbar-views"
        size="sm"
        label="视图"
        :options="viewOptions"
      />
      <div class="lib-toolbar-tools">
        <template v-if="hasLibraries && view === 'wall'">
          <UiInput
            ref="searchInput"
            v-model="searchText"
            class="lib-search"
            variant="filled"
            size="sm"
            icon="search"
            clearable
            :placeholder="`搜索${kindLabel}`"
            :aria-label="`搜索${kindLabel}`"
          />
          <UiSelect
            v-model="state.filter"
            class="lib-select"
            size="sm"
            aria-label="筛选"
            :options="filterOptions"
          />
          <UiSelect
            v-if="libraries.length > 1"
            v-model="libraryChoice"
            class="lib-select"
            size="sm"
            aria-label="媒体库"
            :options="libraryOptions"
          />
          <UiSelect
            :model-value="state.sort"
            class="lib-select"
            size="sm"
            aria-label="排序"
            :options="sortOptions"
            @update:model-value="setSort"
          />
          <UiIconButton
            :icon="state.order === 'asc' ? 'arrowUp' : 'arrowDown'"
            size="sm"
            :label="state.order === 'asc' ? '升序' : '降序'"
            @click="toggleOrder"
          />
        </template>
        <UiIconButton
          v-if="hasLibraries"
          icon="refresh"
          size="sm"
          label="扫描文件夹"
          @click="scanAll"
        />
        <UiIconButton
          v-if="hasLibraries"
          icon="sparkle"
          size="sm"
          label="识别全部"
          @click="identifyAll"
        />
        <UiIconButton
          icon="settings"
          size="sm"
          :label="`${kindLabel}库设置`"
          @click="openSettings"
        />
      </div>
    </header>

    <!-- 后台任务：一条细进度线 + 状态文字 -->
    <div class="lib-activity" :class="{ 'is-on': activity }" aria-live="polite">
      <template v-if="activity">
        <div class="lib-activity-track">
          <div
            class="lib-activity-fill"
            :class="{ 'is-indeterminate': activity.progress === undefined }"
            :style="
              activity.progress === undefined
                ? undefined
                : { transform: `scaleX(${activity.progress})` }
            "
          />
        </div>
        <span class="lib-activity-label">{{ activity.label }}</span>
      </template>
    </div>

    <main class="lib-main">
      <!-- 不在桌面版 -->
      <div v-if="!available" class="lib-empty">
        <UiIcon :name="kind === 'movie' ? 'movie' : 'tv'" size="lg" />
        <h2>本地{{ kindLabel }}库仅在桌面版可用</h2>
        <p>媒体库需要读取本机文件夹，请在影盒桌面版中使用。</p>
      </div>

      <!-- 还没有文件夹 -->
      <div v-else-if="librariesLoaded && !hasLibraries" class="lib-empty">
        <UiIcon :name="kind === 'movie' ? 'movie' : 'tv'" size="lg" />
        <h2>添加你的{{ kindLabel }}文件夹</h2>
        <p>影盒会扫描文件夹里的视频，自动识别片名并补全海报、简介和演职员。</p>
        <UiButton
          variant="primary"
          size="lg"
          icon="plus"
          label="添加文件夹…"
          @click="addFolder"
        />
      </div>

      <template v-else-if="hasLibraries">
        <PosterWall
          v-show="view === 'wall'"
          ref="wall"
          :list="list"
          :version="version"
          :count="total"
          :selected="selection"
          :selection-version="selectionVersion"
          :label="`${kindLabel}海报墙`"
          :show-state-badge="state.filter === 'all'"
          @visible="setVisible"
          @activate="onActivate"
        >
          <template #after>
            <div v-if="ready && total === 0" class="lib-empty is-inline">
              <h2>{{ emptyTitle }}</h2>
              <p v-if="queryError">{{ queryError }}</p>
            </div>
          </template>
        </PosterWall>
        <ReviewQueue
          v-if="view === 'review'"
          :kind="kind"
          :library-ids="libraryIds"
        />
      </template>
    </main>

    <!-- 详情覆盖整页（海报墙留在下面，返回时滚动位置不变） -->
    <ItemDetail
      v-if="detailId !== null"
      :item-id="detailId"
      @close="closeDetail"
      @fix-match="openMatchSheet"
      @organize="openOrganize"
    />

    <!-- 多选操作条 -->
    <Transition name="lib-selection">
      <div v-if="selection.size > 0 && view === 'wall'" class="lib-selection">
        <span class="lib-selection-count">已选 {{ selection.size }} 项</span>
        <UiButton
          size="sm"
          variant="plain"
          icon="sparkle"
          label="重新识别"
          @click="identifySelected"
        />
        <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
          <UiButton
            size="sm"
            variant="plain"
            icon="save"
            label="写出 NFO 与图片"
            :disabled="!writerAvailable"
            @click="writeSelected"
          />
        </span>
        <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
          <UiButton
            size="sm"
            variant="plain"
            icon="folder"
            label="整理…"
            :disabled="!writerAvailable"
            @click="openOrganize([...selection])"
          />
        </span>
        <UiIconButton
          icon="close"
          size="sm"
          label="取消选择"
          @click="clearSelection"
        />
      </div>
    </Transition>

    <LibrarySettings
      v-if="settingsMounted"
      :open="settingsOpen"
      :kind="kind"
      @close="settingsOpen = false"
    />
    <LibrarySheet
      :open="matchItemId !== null"
      title="修正匹配"
      icon="wand"
      size="lg"
      @close="matchItemId = null"
    >
      <MatchPane :item-id="matchItemId" @resolved="matchItemId = null" />
    </LibrarySheet>
    <OrganizeSheet
      v-if="organizeIds.length"
      :open="organizeIds.length > 0"
      :item-ids="organizeIds"
      @close="organizeIds = []"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 本地媒体库页面（电影与剧集共用，按 kind 区分）：工具栏、后台任务进度、海报墙 / 待确认队列、
 * 详情（覆盖在海报墙上，返回时保留滚动位置）、设置、修正匹配、整理。
 *
 * 详情由路由 query（?item=123）驱动：浏览器后退即返回海报墙。
 */
import { useDebounceFn } from '@vueuse/core'
import { message } from 'ant-design-vue'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type {
  LibraryItemSummary,
  LibraryKind,
} from '../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { vTooltip } from '@/components/ui/tooltip'

import { errorText, libraryBridge } from './api/bridge'
import ItemDetail from './detail/ItemDetail.vue'
import MatchPane from './review/MatchPane.vue'
import ReviewQueue from './review/ReviewQueue.vue'
import LibrarySettings from './settings/LibrarySettings.vue'
import LibrarySheet from './shared/LibrarySheet.vue'
import {
  FILTER_OPTIONS,
  SORT_OPTIONS,
  type WallQueryState,
  type WallSort,
  defaultOrder,
  defaultWallQuery,
  loadSavedSort,
  reviewQuery,
  saveSort,
  toLibraryQuery,
} from './state/query-state'
import { useLibraries } from './state/use-libraries'
import { usePagedQuery } from './state/use-paged-query'
import PosterWall from './wall/PosterWall.vue'
import OrganizeSheet from './writer/OrganizeSheet.vue'
import {
  WRITER_UNAVAILABLE,
  useWriter,
  writerActivity,
} from './writer/use-writer'

const props = defineProps<{ kind: LibraryKind }>()

const route = useRoute()
const router = useRouter()
const bridge = libraryBridge()
const kindLabel = computed(() => (props.kind === 'movie' ? '电影' : '剧集'))

// —— 媒体库 ——
const {
  available,
  libraries,
  loaded: librariesLoaded,
  activity: libraryActivity,
  addFolder: pickFolder,
  scanAll: scanLibraries,
  identifyAll: identifyLibraries,
} = useLibraries(props.kind)
const hasLibraries = computed(() => libraries.value.length > 0)
const libraryIds = computed(() => libraries.value.map(lib => lib.id))

// —— 查询条件 ——
const state = reactive<WallQueryState>({
  ...defaultWallQuery(),
  ...loadSavedSort(props.kind),
})
const searchText = ref('')
const applySearch = useDebounceFn((text: string) => {
  state.search = text
}, 200)
watch(searchText, text => void applySearch(text))

// 顶栏全局搜索（Ctrl + K）把关键词放在 ?q= 里
watch(
  () => route.query.q,
  q => {
    if (typeof q === 'string') searchText.value = q
  },
  { immediate: true }
)

const sortOptions = SORT_OPTIONS.map(o => ({ ...o }))
const filterOptions = FILTER_OPTIONS.map(o => ({ ...o }))
const libraryOptions = computed(() => [
  { value: 0, label: '全部文件夹' },
  ...libraries.value.map(lib => ({ value: lib.id, label: lib.name })),
])
const libraryChoice = computed({
  get: () => state.libraryId ?? 0,
  set: value => {
    state.libraryId = value ? Number(value) : null
  },
})

function setSort(value: WallSort): void {
  state.sort = value
  state.order = defaultOrder(value)
  saveSort(props.kind, state)
}

function toggleOrder(): void {
  state.order = state.order === 'asc' ? 'desc' : 'asc'
  saveSort(props.kind, state)
}

const wall = ref<InstanceType<typeof PosterWall> | null>(null)
const {
  list,
  version,
  total,
  ready,
  error: queryError,
  setVisible,
} = usePagedQuery(
  () => toLibraryQuery(props.kind, state),
  event => libraryIds.value.includes(event.libraryId)
)

// 换查询条件回到顶部
watch(
  () => [state.sort, state.order, state.filter, state.libraryId, state.search],
  () => wall.value?.scrollToTop()
)

const emptyTitle = computed(() => {
  if (state.search) return `没有找到“${state.search}”`
  if (state.filter !== 'all') return '没有符合筛选条件的条目'
  return '文件夹里还没有扫描到视频'
})

// —— 待确认数量（视图切换上的角标）——
const reviewCount = usePagedQuery(
  () => ({ ...reviewQuery(props.kind), limit: 1 }),
  event => libraryIds.value.includes(event.libraryId),
  1
)
type View = 'wall' | 'review'
const view = ref<View>('wall')
const viewOptions = computed<SegmentedOption<View>[]>(() => [
  { value: 'wall', label: '资料库' },
  {
    value: 'review',
    label: reviewCount.total.value
      ? `待确认 ${reviewCount.total.value.toLocaleString('zh-CN')}`
      : '待确认',
  },
])

// —— 多选 ——
const selection = shallowRef(new Set<number>())
const selectionVersion = ref(0)
let anchorIndex = -1

function commitSelection(next: Set<number>): void {
  selection.value = next
  selectionVersion.value++
}

function clearSelection(): void {
  commitSelection(new Set())
  anchorIndex = -1
}

function onActivate(
  index: number,
  item: LibraryItemSummary,
  modifiers: { toggle: boolean; range: boolean; double: boolean }
): void {
  if (modifiers.range && anchorIndex >= 0) {
    const next = new Set(selection.value)
    const [from, to] = [
      Math.min(anchorIndex, index),
      Math.max(anchorIndex, index),
    ]
    for (let i = from; i <= to; i++) {
      const it = list.at(i)
      if (it) next.add(it.id)
    }
    commitSelection(next)
    return
  }
  if (modifiers.toggle) {
    const next = new Set(selection.value)
    if (next.has(item.id)) next.delete(item.id)
    else next.add(item.id)
    anchorIndex = index
    commitSelection(next)
    return
  }
  if (selection.value.size > 0 && !modifiers.double) {
    clearSelection()
  }
  anchorIndex = index
  openDetail(item.id)
}

watch(
  () => [state.filter, state.libraryId, state.search],
  () => clearSelection()
)

// —— 详情（路由驱动）——
const detailId = computed(() => {
  const raw = route.query.item
  const id = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
})

function openDetail(itemId: number): void {
  void router.push({ query: { ...route.query, item: String(itemId) } })
}

function closeDetail(): void {
  if (window.history.state?.back) router.back()
  else {
    const { item: _item, ...rest } = route.query
    void router.replace({ query: rest })
  }
}

// —— 面板 ——
const settingsOpen = ref(false)
const settingsMounted = ref(false)
const matchItemId = ref<number | null>(null)
const organizeIds = ref<number[]>([])

function openSettings(): void {
  settingsMounted.value = true
  settingsOpen.value = true
}

function openMatchSheet(itemId: number): void {
  matchItemId.value = itemId
}

function openOrganize(itemIds: number[]): void {
  if (!writerAvailable) {
    message.info(WRITER_UNAVAILABLE)
    return
  }
  organizeIds.value = itemIds
}

// —— 操作 ——
const {
  available: writerAvailable,
  write,
  progress: writerProgress,
} = useWriter()

/** 后台活动：写出 / 整理进度优先，其次识别与扫描。 */
const activity = computed(() =>
  writerProgress.value
    ? writerActivity(writerProgress.value)
    : libraryActivity.value
)

async function guarded(
  task: () => Promise<unknown>,
  done: string
): Promise<void> {
  try {
    await task()
    message.success(done)
  } catch (error) {
    message.error(errorText(error))
  }
}

async function addFolder(): Promise<void> {
  try {
    const lib = await pickFolder()
    if (lib) message.success(`已添加「${lib.name}」，正在扫描`)
  } catch (error) {
    message.error(errorText(error))
  }
}

function scanAll(): void {
  void guarded(() => scanLibraries(false), '已开始扫描')
}

function identifyAll(): void {
  void guarded(() => identifyLibraries(false), '已开始识别')
}

function identifySelected(): void {
  const itemIds = [...selection.value]
  void guarded(async () => {
    await bridge!.identify({ itemIds, force: true })
    clearSelection()
  }, `已开始重新识别 ${itemIds.length} 项`)
}

function writeSelected(): void {
  const itemIds = [...selection.value]
  void guarded(async () => {
    const failure = await write(itemIds)
    if (failure) throw new Error(failure)
  }, `已开始写出 ${itemIds.length} 项`)
}
</script>

<style scoped>
.lib-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-content);
}

/* —— 工具栏 —— */
.lib-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-6);
  padding: var(--space-6) var(--content-padding-x) var(--space-4);
}
.lib-toolbar-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
}
.lib-toolbar-title h1 {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--tracking-tight);
}
.lib-toolbar-count {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-toolbar-tools {
  display: flex;
  flex: 1 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}
.lib-search {
  flex: 0 0 200px;
}
/* 下拉按内容宽度，不被拉伸 */
.lib-select {
  flex: 0 0 auto;
  width: auto;
}

/* —— 后台任务 —— */
.lib-activity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 0;
  padding: 0 var(--content-padding-x);
  overflow: hidden;
  transition: height var(--duration-normal) var(--ease-out);
}
.lib-activity.is-on {
  height: 28px;
}
.lib-activity-track {
  position: relative;
  flex: 0 0 160px;
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}
.lib-activity-fill {
  position: absolute;
  inset: 0;
  background: var(--accent);
  transform-origin: left center;
  transition: transform var(--duration-slow) var(--ease-out);
}
.lib-activity-fill.is-indeterminate {
  width: 40%;
  animation: lib-indeterminate var(--duration-pulse) var(--ease-out) infinite;
}
@keyframes lib-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
.lib-activity-label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

/* —— 内容 —— */
.lib-main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.lib-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: 100%;
  padding: var(--space-11) var(--space-8);
  color: var(--text-tertiary);
  text-align: center;
}
.lib-empty.is-inline {
  height: auto;
}
.lib-empty h2 {
  margin: var(--space-2) 0 0;
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
}
.lib-empty p {
  max-width: 420px;
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

/* —— 多选操作条 —— */
.lib-selection {
  position: absolute;
  bottom: var(--space-6);
  left: 50%;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  transform: translateX(-50%);
}
.lib-selection > span {
  display: inline-flex;
}
.lib-selection-count {
  margin-right: var(--space-2);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}
.lib-selection-enter-active,
.lib-selection-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
.lib-selection-enter-from,
.lib-selection-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

@media (max-width: 1100px) {
  .lib-search {
    flex-basis: 160px;
  }
}
</style>
