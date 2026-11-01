<template>
  <div class="lib-page" :style="ambientVars(section)">
    <LibraryAmbient
      v-if="actorId === null"
      :section="section"
      :poster="ambientPoster"
    />
    <LibraryToolbar
      v-model:view="view"
      v-model:filter="state.filter"
      v-model:facets="state.facets"
      v-model:browse="state.browse"
      v-model:genre="state.genre"
      v-model:library="libraryChoice"
      :facet-scope="facetScopeOf(section, state)"
      :genre-scope="genreScopeOf(section, state)"
      :kind-label="kindLabel"
      :count="view === 'wall' && ready ? total : null"
      :has-libraries="hasLibraries"
      :view-options="viewOptions"
      :review-count="reviewCount"
      :library-options="libraryOptions"
      :sort="state.sort"
      :order="state.order"
      @sort="setSort"
      @toggle-order="toggleOrder"
      @scan="scanAll"
      @identify="identifyAll"
      @settings="openLibrarySettings"
      @video-wall="videoWall.open"
      @open-item="openDetail"
    />
    <NlSearchBar v-if="view === 'wall' && hasLibraries" :nl="nl" />

    <ActivityBar :activity="activity" />

    <main class="lib-main">
      <!-- 网页端：片库服务就绪前（探测中 / 连不上 / 未登录）什么都不放；登录与报错由外壳统一显示 -->
      <template v-if="serverGate" />

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
          :show-state-badge="state.filter !== 'all'"
          @visible="setVisible"
          @activate="onActivate"
          @open="openDetail"
          @identify="id => actions.identifySelected([id], () => {})"
        >
          <template #before>
            <LibraryTopRows :section="section" @open="openDetail" />
          </template>
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
      :ambient-poster="ambientPoster"
      @close="closeActor"
      @open-item="openDetail"
    />
    <ItemDetail
      v-if="detailId !== null && detailReady"
      :item-id="detailId"
      :section="section"
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

    <LibrarySheet
      :open="matchItemId !== null"
      title="修正匹配"
      icon="wand"
      size="lg"
      @close="matchItemId = null"
    >
      <MatchPane :item-id="matchItemId" @resolved="matchItemId = null" />
    </LibrarySheet>
    <VideoWall
      v-if="videoWall.items.value.length"
      :items="videoWall.items.value"
      @close="videoWall.close"
      @open="id => (videoWall.close(), openDetail(id))"
    />
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
 * 本地媒体库页面（电影 / 剧集 / 动漫 / 综艺 / 纪录片 / 番号各分区共用，按 section 区分，见 state/library-section.ts）：
 * 工具栏、后台任务进度、海报墙 / 待确认队列、详情（覆盖在海报墙上，返回时保留滚动位置）、修正匹配、整理。
 * 设置只有一份，在「设置 → 媒体库」。
 *
 * 详情由路由 query（?item=123）驱动：浏览器后退即返回海报墙；指向别的分区的链接由 use-section-guard 换页。每个分区只查自己来源的库：电影页不出番号条目，演员库只在番号页。
 * 工具栏 / 任务条 / 多选条在 page/，多选与路由等纯规则在 page/page-rules.ts；视频墙在 video-wall/。
 */
import { toast } from '@/components/ui'
import { computed, reactive, ref, watch } from 'vue'

import type { LibraryItemSummary } from '../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { libraryServerState } from '@/services/library-server'

import ActorDetail from './actors/ActorDetail.vue'
import LibraryAmbient from './ambient/LibraryAmbient.vue'
import { ambientPosterOf, ambientVars } from './ambient/ambient-rules'
import ActorsView from './actors/ActorsView.vue'
import ItemDetail from './detail/ItemDetail.vue'
import ActivityBar from './page/ActivityBar.vue'
import LibraryEmpty from './page/LibraryEmpty.vue'
import LibraryTopRows from './page/LibraryTopRows.vue'
import LibraryToolbar from './page/LibraryToolbar.vue'
import SelectionBar from './page/SelectionBar.vue'
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
import NlSearchBar from './nl-search/NlSearchBar.vue'
import { useNlSearch } from './nl-search/use-nl-search'
import MatchPane from './review/MatchPane.vue'
import ReviewQueue from './review/ReviewQueue.vue'
import { openLibrarySettings } from './settings/section'
import LibrarySheet from './shared/LibrarySheet.vue'
import {
  type WallQueryState,
  type WallSort,
  defaultOrder,
  defaultWallQuery,
  facetScopeOf,
  filterKeyOf,
  genreScopeOf,
  loadSavedSort,
  saveSort,
  toLibraryQuery,
} from './state/query-state'
import { type LibrarySection, SECTIONS } from './state/library-section'
import { useLibraries } from './state/use-libraries'
import { usePagedQuery } from './state/use-paged-query'
import VideoWall from './video-wall/VideoWall.vue'
import { useWallEntry } from './video-wall/use-wall-entry'
import PosterWall from './wall/PosterWall.vue'
import OrganizeSheet from './writer/OrganizeSheet.vue'
import {
  WRITER_UNAVAILABLE,
  useWriter,
  writerActivity,
} from './writer/use-writer'

const props = defineProps<{ section: LibrarySection }>()

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
// 搜索只在顶栏（?q=）：像一句描述时交给 AI 解析成条件（nl-search/），否则按片名搜索
const nl = useNlSearch(section, () => toLibraryQuery(section, state))
watch(nl.search, q => (state.search = q), { immediate: true })
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
} = usePagedQuery(nl.query, event => libraryIds.value.includes(event.libraryId))
// 环境光跟着海报墙最前面几格的海报走（ambient/）
const ambientPoster = computed(() => (version.value, ambientPosterOf(list)))

// 换查询条件回到顶部；换筛选（不含排序）清空多选
watch(
  () => [state.sort, state.order, ...filterKeyOf(state), nl.key.value],
  () => wall.value?.scrollToTop()
)
const emptyTitle = computed(
  () => nl.emptyTitle.value ?? emptyTitleFor(state, section)
)

// —— 视图切换（资料库 / 演员 / 待确认）——
const { view, viewOptions, reviewCount } = useLibraryViews(section, libraryIds)

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

watch(() => [...filterKeyOf(state), nl.key.value], clearSelection)

// —— 视频墙（选中项或当前筛选结果）——
const videoWall = useWallEntry({
  selection,
  list,
  query: nl.query,
})

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
const matchItemId = ref<number | null>(null)
const organizeIds = ref<number[]>([])

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

<style scoped src="./page/library-page.css"></style>
