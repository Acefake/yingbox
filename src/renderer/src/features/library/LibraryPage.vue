<template>
  <div class="lib-page">
    <LibraryToolbar
      v-model:view="view"
      v-model:search="searchText"
      v-model:filter="state.filter"
      v-model:library="libraryChoice"
      :kind-label="kindLabel"
      :count="view === 'wall' && ready ? total : null"
      :has-libraries="hasLibraries"
      :view-options="viewOptions"
      :library-options="libraryOptions"
      :sort="state.sort"
      :order="state.order"
      @sort="setSort"
      @toggle-order="toggleOrder"
      @scan="scanAll"
      @identify="identifyAll"
      @settings="openSettings"
    />

    <ActivityBar :activity="activity" />

    <main class="lib-main">
      <!-- 网页端：片库服务连不上 / 需要登录 -->
      <ServerConnect v-if="serverGate" :state="serverState" :kind="kind" />

      <!-- 不在桌面版 -->
      <LibraryEmpty
        v-else-if="!available"
        :icon="kind"
        :title="`本地${kindLabel}库仅在桌面版可用`"
        text="媒体库需要读取本机文件夹，请在影盒桌面版中使用。"
      />

      <!-- 还没有文件夹 -->
      <LibraryEmpty
        v-else-if="librariesLoaded && !hasLibraries"
        :icon="kind"
        :title="`添加你的${kindLabel}文件夹`"
        text="影盒会扫描文件夹里的视频，自动识别片名并补全海报、简介和演职员。"
      >
        <UiButton
          variant="primary"
          size="lg"
          icon="plus"
          label="添加文件夹…"
          @click="addFolder"
        />
      </LibraryEmpty>

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
            <LibraryEmpty
              v-if="ready && total === 0"
              inline
              :title="emptyTitle"
              :text="queryError || undefined"
            />
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

    <SelectionBar
      :count="view === 'wall' ? selection.size : 0"
      :writer-available="writerAvailable"
      @identify="identifySelected"
      @write="writeSelected"
      @organize="openOrganize([...selection])"
      @clear="clearSelection"
    />

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
 * 工具栏 / 任务条 / 多选条在 page/，多选与路由等纯规则在 page/page-rules.ts。
 */
import { toast } from '@/components/ui'
import { useDebounceFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type {
  LibraryItemSummary,
  LibraryKind,
} from '../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import { libraryServerState } from '@/services/library-server'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'

import ItemDetail from './detail/ItemDetail.vue'
import ActivityBar from './page/ActivityBar.vue'
import LibraryEmpty from './page/LibraryEmpty.vue'
import LibraryToolbar, { type LibraryView } from './page/LibraryToolbar.vue'
import SelectionBar from './page/SelectionBar.vue'
import ServerConnect from './page/ServerConnect.vue'
import { usesLibraryServer } from './api/bridge'
import {
  type ActivateModifiers,
  emptyTitleFor,
  libraryOptionsFor,
  parseDetailId,
  reviewTabLabel,
} from './page/page-rules'
import { useLibraryActions } from './page/use-library-actions'
import { useWallSelection } from './page/use-wall-selection'
import MatchPane from './review/MatchPane.vue'
import ReviewQueue from './review/ReviewQueue.vue'
import LibrarySettings from './settings/LibrarySettings.vue'
import LibrarySheet from './shared/LibrarySheet.vue'
import {
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
// 网页端：片库服务就绪前（探测中 / 连不上 / 未登录）不显示海报墙
const serverState = libraryServerState()
const serverGate = computed(
  () => usesLibraryServer() && serverState.value !== 'online'
)
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
const libraryOptions = computed(() => libraryOptionsFor(libraries.value))
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
const emptyTitle = computed(() => emptyTitleFor(state))

// —— 待确认数量（视图切换上的角标）——
const reviewCount = usePagedQuery(
  () => ({ ...reviewQuery(props.kind), limit: 1 }),
  event => libraryIds.value.includes(event.libraryId),
  1
)
const view = ref<LibraryView>('wall')
const viewOptions = computed<SegmentedOption<LibraryView>[]>(() => [
  { value: 'wall', label: '资料库' },
  { value: 'review', label: reviewTabLabel(reviewCount.total.value) },
])

// —— 多选 ——
const { selection, selectionVersion, clearSelection, activate } =
  useWallSelection(list)

function onActivate(
  index: number,
  item: LibraryItemSummary,
  modifiers: ActivateModifiers
): void {
  activate(index, item, modifiers, openDetail)
}

watch(
  () => [state.filter, state.libraryId, state.search],
  () => clearSelection()
)

// —— 详情（路由驱动）——
const detailId = computed(() => parseDetailId(route.query.item))

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
    toast.info(WRITER_UNAVAILABLE)
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

const { addFolder, scanAll, identifyAll, ...actions } = useLibraryActions(
  {
    addFolder: pickFolder,
    scanAll: scanLibraries,
    identifyAll: identifyLibraries,
  },
  write
)

function identifySelected(): void {
  actions.identifySelected([...selection.value], clearSelection)
}

function writeSelected(): void {
  actions.writeSelected([...selection.value])
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

/* —— 内容 —— */
.lib-main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
