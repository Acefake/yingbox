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
      <ServerConnect v-if="serverGate" :state="serverState" :icon="spec.icon" />

      <!-- 不在桌面版 -->
      <LibraryEmpty
        v-else-if="!available"
        :icon="spec.icon"
        :title="`本地${kindLabel}库仅在桌面版可用`"
        text="媒体库需要读取本机文件夹，请在影盒桌面版中使用。"
      />

      <!-- 还没有文件夹 -->
      <LibraryEmpty
        v-else-if="librariesLoaded && !hasLibraries"
        :icon="spec.icon"
        :title="noFolder.title"
        :text="noFolder.text"
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
            <UiSkeleton v-if="!ready" class="lib-wall-skeleton" />
            <LibraryEmpty
              v-else-if="total === 0"
              inline
              :title="emptyTitle"
              :text="queryError || undefined"
            />
          </template>
        </PosterWall>
        <ReviewQueue
          v-if="view === 'review'"
          :section="section"
          :library-ids="libraryIds"
        />
        <ActorsView
          v-if="section === 'jav' && view === 'actors'"
          @open="id => openActor(id)"
        />
      </template>
    </main>

    <!-- 演员详情与条目详情覆盖整页（海报墙留在下面，返回时滚动位置不变）；条目详情在上层 -->
    <ActorDetail
      v-if="section === 'jav' && actorId !== null"
      :actor-id="actorId"
      @close="closeActor"
      @open-item="openDetail"
    />
    <ItemDetail
      v-if="detailId !== null && detailReady"
      :item-id="detailId"
      @close="closeDetail"
      @fix-match="openMatchSheet"
      @organize="openOrganize"
      @open-actor="id => openActor(id, ['item'])"
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
      :section="section"
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
 * 本地媒体库页面（电影 / 剧集 / 番号三个分区共用，按 section 区分，见 state/library-section.ts）：工具栏、后台任务进度、海报墙 / 待确认队列、
 * 详情（覆盖在海报墙上，返回时保留滚动位置）、设置、修正匹配、整理。
 *
 * 详情由路由 query（?item=123）驱动：浏览器后退即返回海报墙；指向别的分区的链接由 use-section-guard 换页。
 * 每个分区只查自己来源的库：电影页不出番号条目，演员库只在番号页。
 * 工具栏 / 任务条 / 多选条在 page/，多选与路由等纯规则在 page/page-rules.ts。
 */
import { toast } from '@/components/ui'
import { useDebounceFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { LibraryItemSummary } from '../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { libraryServerState } from '@/services/library-server'

import ActorDetail from './actors/ActorDetail.vue'
import ActorsView from './actors/ActorsView.vue'
import ItemDetail from './detail/ItemDetail.vue'
import ActivityBar from './page/ActivityBar.vue'
import LibraryEmpty from './page/LibraryEmpty.vue'
import LibraryToolbar from './page/LibraryToolbar.vue'
import SelectionBar from './page/SelectionBar.vue'
import ServerConnect from './page/ServerConnect.vue'
import { usesLibraryServer } from './api/bridge'
import {
  type ActivateModifiers,
  emptyTitleFor,
  libraryOptionsFor,
  noFolderCopy,
} from './page/page-rules'
import { useOverlayRoute } from './page/use-overlay-route'
import { useLibraryActions } from './page/use-library-actions'
import { useLibraryViews } from './page/use-library-views'
import { useSectionGuard } from './page/use-section-guard'
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
  saveSort,
  toLibraryQuery,
} from './state/query-state'
import { type LibrarySection, SECTIONS } from './state/library-section'
import { useLibraries } from './state/use-libraries'
import { usePagedQuery } from './state/use-paged-query'
import PosterWall from './wall/PosterWall.vue'
import OrganizeSheet from './writer/OrganizeSheet.vue'
import {
  WRITER_UNAVAILABLE,
  useWriter,
  writerActivity,
} from './writer/use-writer'

const props = defineProps<{ section: LibrarySection }>()

const route = useRoute()
// 分区在页面生命周期内不变（每个分区是一个路由组件）
const section = props.section
const spec = SECTIONS[section]
const kindLabel = spec.label
const noFolder = noFolderCopy(section)

// —— 媒体库 ——
const {
  available,
  libraries,
  loaded: librariesLoaded,
  activity: libraryActivity,
  addFolder: pickFolder,
  scanAll: scanLibraries,
  identifyAll: identifyLibraries,
} = useLibraries(section)
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
  ...loadSavedSort(section),
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
  saveSort(section, state)
}

function toggleOrder(): void {
  state.order = state.order === 'asc' ? 'desc' : 'asc'
  saveSort(section, state)
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
  () => toLibraryQuery(section, state),
  event => libraryIds.value.includes(event.libraryId)
)

// 换查询条件回到顶部
watch(
  () => [state.sort, state.order, state.filter, state.libraryId, state.search],
  () => wall.value?.scrollToTop()
)
const emptyTitle = computed(() => emptyTitleFor(state))

// —— 视图切换（资料库 / 演员 / 待确认）——
const { view, viewOptions } = useLibraryViews(section, libraryIds)

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

// —— 条目详情 / 演员详情（路由驱动）——
const {
  id: detailId,
  open: openDetail,
  close: closeDetail,
} = useOverlayRoute('item')
const {
  id: actorId,
  open: openActor,
  close: closeActor,
} = useOverlayRoute('actor')
const { detailReady } = useSectionGuard(
  section,
  detailId,
  actorId,
  id => list.indexOfId(id) >= 0
)

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
.lib-wall-skeleton {
  margin: 0 var(--content-padding-x);
}
</style>
