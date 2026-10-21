<template>
  <div
    class="amane-shell min-h-0 bg-yb-bg text-yb-text"
    :class="{ 'is-agent-view': lib.tab === 'agent' }"
  >
    <nav class="amane-tabs" aria-label="Amane 功能">
      <UiSegmented
        label="Amane 功能"
        :model-value="lib.tab"
        :options="TAB_OPTIONS"
        @update:model-value="lib.switchTab"
      />
      <UiIconButton
        v-if="lib.tab !== 'agent'"
        class="amane-nav-refresh"
        icon="refresh"
        label="刷新"
        :disabled="lib.busy"
        @click="conn.refreshAll"
      />
    </nav>
    <div v-if="lib.error" class="amane-error" role="alert">
      <span>{{ lib.error }}</span>
      <UiIconButton
        icon="close"
        label="关闭错误提示"
        size="sm"
        @click="lib.error = ''"
      />
    </div>

    <div class="amane-workspace">
      <main
        class="amane-library-content"
        :class="{ 'is-agent': lib.tab === 'agent' }"
        @scroll="lib.onListScroll"
      >
        <div
          v-if="conn.connecting || conn.status?.state === 'starting'"
          class="amane-empty"
          role="status"
          aria-live="polite"
        >
          <span class="amane-spinner" aria-hidden="true"></span>
          <h2>正在启动 Amane 后台</h2>
          <p>首次启动需要几秒，加载完成后会自动显示片库。</p>
        </div>
        <div v-else-if="!conn.connected" class="amane-empty">
          <h2>连接你的 Amane 片库</h2>
          <p>影盒会在后台运行 Amane，无需打开单独的程序或浏览器。</p>
          <p v-if="conn.status?.error">{{ conn.status.error }}</p>
          <UiButton
            variant="primary"
            icon="settings"
            label="连接设置"
            @click="() => openGlobalSettings()"
          />
        </div>
        <AgentPanel
          v-else-if="lib.tab === 'agent'"
          @settings="openGlobalSettings('agent')"
        />
        <template v-else>
          <LibraryToolbar
            v-if="SCROLL_TABS.includes(lib.tab)"
            v-model:search="lib.search"
            v-model:number="number"
            v-model:advanced-open="lib.advancedOpen"
            v-model:sort-open="lib.sortOpen"
            :tab="lib.tab"
            :sort-field="lib.sortField"
            :sort-order="lib.sortOrder"
            :filtered="Boolean(lib.actorFilter || lib.tagFilter)"
            :filter-label="lib.filterLabel"
            :busy="lib.busy"
            @search="lib.searchNow"
            @sort="lib.chooseSort"
            @clear-filters="lib.clearFilters"
            @scrape-number="scrapeNumberNow"
          />
          <AdvancedSearch
            v-if="lib.tab === 'films' && lib.advancedOpen"
            :filters="lib.advancedFilters"
            @change="lib.applyAdvanced"
          />
          <div v-if="lib.loading" class="amane-loading" role="status">
            正在读取片库…
          </div>
          <FilmGrid
            v-else-if="lib.tab === 'films'"
            :films="lib.films"
            :selected-ids="lib.selectedIds"
            :busy="lib.busy"
            :current-id="det.detail?.metadata.id"
            :preview-id="hov.hoverFilm?.id"
            @open="openFilm"
            @toggle="lib.toggleSelect"
            @scrape="act.scrapeFilms"
            @clear-selection="lib.selectedIds = []"
            @add-library="lib.switchTab('libraries')"
            @hover-enter="hov.filmHoverEnter"
            @hover-leave="hov.filmHoverLeave"
          />
          <ActorGrid
            v-else-if="lib.tab === 'actors'"
            :actors="lib.actors"
            @select="lib.filterActor"
          />
          <LibraryManager
            v-else-if="lib.tab === 'libraries'"
            v-model:name="libraryName"
            v-model:path="libraryPath"
            v-model:automation="automation"
            :libraries="lib.libraries"
            :busy="lib.busy"
            :is-web="conn.isWeb"
            @add="addLibraryNow"
            @scan="act.scanLibrary"
            @organize="act.organizeLibrary"
            @browse="lib.browseLibrary"
          />
          <TaskTable
            v-else-if="lib.tab === 'tasks'"
            v-model:status="lib.taskStatus"
            :tasks="lib.tasks"
            :worker-paused="lib.workerPaused"
            :busy="lib.busy"
            @filter="lib.searchNow"
            @set-worker="act.setWorker"
            @show="det.showTask"
            @retry="act.retryTask"
          />
          <FileTable
            v-else-if="lib.tab === 'files'"
            :files="lib.files"
            :numbers="fileNumbers"
            :busy="lib.busy"
            :live-busy="act.liveBusy"
            :restore-running="act.restoreRunning"
            @play="act.play"
            @live="act.watchLive"
            @restore="act.restoreFile"
            @range="act.rangeFile"
            @scrape="file => act.scrapeFile(file, fileNumbers[file.id])"
            @number="(id, value) => (fileNumbers[id] = value)"
            @organize="act.organizeFile"
          />
          <ListFooter
            v-if="lib.tab === 'tasks' || SCROLL_TABS.includes(lib.tab)"
            :paged="lib.tab === 'tasks'"
            :page="lib.page"
            :total="lib.total"
            :loading-more="lib.loadingMore"
            @page="lib.changePage"
          />
        </template>
      </main>
    </div>
    <Teleport to="body">
      <DetailDialog
        :detail="det.detail"
        :task-detail="det.taskDetail"
        :task-children="det.taskChildren"
        :loading="det.detailLoading"
        @close="det.closeDetail"
        @show-task="det.showTask"
      >
        <AmaneFilmDetail
          v-if="det.detail"
          :detail="det.detail"
          :busy="lib.busy"
          @play="act.play"
          @restore="act.restoreFile"
          @range="act.rangeFile"
          @organize="act.organizeFile"
          @live="act.watchLive"
          @scrape="id => act.scrapeFilms([id])"
          @actor="lib.filterActor"
          @tag="lib.filterTag"
          @tags-changed="det.updateDetailTags"
        />
      </DetailDialog>
    </Teleport>
    <!-- 悬停预览(Netflix 式):悬停意图延迟后弹出,横版剧照 + 详情级信息 + 直接操作 -->
    <Teleport to="body">
      <FilmHoverCard
        v-if="hov.hoverFilm"
        :film="hov.hoverFilm"
        :position="hov.hoverStyle"
        :is-web="conn.isWeb"
        :busy="lib.busy"
        :action-busy="hov.hoverActionBusy"
        @enter="hov.hoverCardEnter"
        @leave="hov.filmHoverLeave"
        @open="hov.hoverOpen"
        @play="hov.hoverFileAction(act.play)"
        @restore="hov.hoverFileAction(act.restoreFile)"
        @range="hov.hoverFileAction(act.rangeFile)"
        @live="hov.hoverFileAction(act.watchLive)"
        @rescrape="act.scrapeFilms([hov.hoverFilm.id])"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * Amane 片库页：连接 / 启动后台、六个视图（智能体、片库、演员、媒体库、文件、任务）、
 * 详情弹窗与海报悬停预览。
 *
 * 连接在 use-amane-connection，列表状态在 use-amane-library，操作在 use-amane-actions，
 * 详情在 use-amane-detail，悬停预览在 use-film-hover；各视图是 components/library 下的展示组件。
 */
import {
  computed,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'
import type { AmaneLibrary } from '../api/amane'
import { UiButton, UiIconButton, UiSegmented } from '@/components/ui'
import AdvancedSearch from '../components/AdvancedSearch.vue'
import AgentPanel from '../components/AgentPanel.vue'
import AmaneFilmDetail from '../components/FilmDetail.vue'
import FilmHoverCard from '../components/film/FilmHoverCard.vue'
import ActorGrid from '../components/library/ActorGrid.vue'
import DetailDialog from '../components/library/DetailDialog.vue'
import FileTable from '../components/library/FileTable.vue'
import FilmGrid from '../components/library/FilmGrid.vue'
import LibraryManager from '../components/library/LibraryManager.vue'
import LibraryToolbar from '../components/library/LibraryToolbar.vue'
import ListFooter from '../components/library/ListFooter.vue'
import TaskTable from '../components/library/TaskTable.vue'
import { useAmaneActions } from '../composables/use-amane-actions'
import {
  openGlobalSettings,
  useAmaneConnection,
} from '../composables/use-amane-connection'
import { useAmaneDetail } from '../composables/use-amane-detail'
import { useAmaneLibrary } from '../composables/use-amane-library'
import { useFilmHover } from '../composables/use-film-hover'
import { SCROLL_TABS, TAB_OPTIONS } from '../utils/library-query'

const route = useRoute()
const number = ref('')
const libraryName = ref(''),
  libraryPath = ref(''),
  automation = ref<AmaneLibrary['automation']>('none')
const fileNumbers = reactive<Record<number, string>>({})
let disposed = false

// 组合函数之间的回调只在运行时调用，此时各个实例都已创建
const library = useAmaneLibrary({
  connected: computed(() => connection.connected.value),
  beforeSwitch: () => {
    hover.hideHover()
    details.closeDetail()
  },
  hideHover: () => hover.hideHover(),
  onFilmsReplaced: films => hover.onFilmsReplaced(films),
})
const { busy, error, tab, run, load, selectedIds } = library
const connection = useAmaneConnection({ busy, error, tab, run, load })
const details = useAmaneDetail(error, () => disposed)
const hover = useFilmHover({
  error,
  isDisposed: () => disposed,
  selecting: () => selectedIds.value.length > 0,
  openFilm: id => openFilm(id),
})
const actions = useAmaneActions({
  isWeb: connection.isWeb,
  run,
  detail: details.detail,
  files: library.files,
  selectedIds,
  workerPaused: library.workerPaused,
  switchTab: library.switchTab,
  load,
})
// 模板经 reactive 访问，ref 自动解包
const lib = reactive(library),
  conn = reactive(connection),
  det = reactive(details),
  hov = reactive(hover),
  act = reactive(actions)

/** 打开影片详情（先收起悬停预览） */
async function openFilm(id: number): Promise<void> {
  hover.hideHover()
  await details.openFilm(id)
}

async function scrapeNumberNow(): Promise<void> {
  if (await actions.scrapeNumber(number.value)) number.value = ''
}

async function addLibraryNow(): Promise<void> {
  const added = await actions.addLibrary({
    name: libraryName.value,
    path: libraryPath.value,
    automation: automation.value,
  })
  if (added) {
    libraryPath.value = ''
    libraryName.value = ''
  }
}

// 顶栏搜索带 ?q= 进来：回到片库按关键字搜
watch(
  () => route.query.q,
  query => {
    library.search.value = typeof query === 'string' ? query : ''
    library.sortOpen.value = false
    tab.value = 'films'
    library.searchNow()
  }
)
onDeactivated(() => {
  hover.hideHover()
  details.closeDetail()
})
onMounted(() => {
  library.search.value = typeof route.query.q === 'string' ? route.query.q : ''
  // 去码进度与边跑边看状态由 useLadaTasks 统一接推送（后台任务面板也在用）
  void connection.start()
})
onBeforeUnmount(() => {
  disposed = true
  library.dispose()
  details.dispose()
  connection.dispose()
})
</script>

<style src="../styles/amane.css"></style>
