<template>
  <div class="lib-detail">
    <div
      ref="root"
      class="lib-detail-scroll"
      tabindex="-1"
      @scroll.passive="onScroll"
    >
      <div v-if="!node && loading" class="lib-detail-status">正在载入…</div>
      <div v-else-if="!node" class="lib-detail-status">
        {{ error || '条目不存在或已被移除' }}
        <UiButton label="返回" variant="secondary" @click="emit('close')" />
      </div>

      <template v-else>
        <DetailHero
          data-tab="overview"
          :node="node"
          :backdrop="backdrop"
          :logo="logo"
          :tagline="tagline"
          :meta-parts="metaParts"
          :specs="heroSpecs"
          :credits="credits"
          :play-label="playLabel"
          :can-play="Boolean(primaryPlay)"
          :restorable="restore.available.value"
          :restore-running="restore.running.value"
          @play="playPrimary"
          @restore="restore.start"
        />
        <DetailSeasons
          v-if="seasons.length"
          data-tab="episodes"
          :node="node"
          :seasons="seasons"
          @play-episode="playEpisode"
        />
        <DetailStills v-if="stills.length" data-tab="stills" :stills="stills" />
        <DetailPeople
          v-if="people.length"
          data-tab="cast"
          :people="people"
          @open-actor="emit('open-actor', $event)"
        />
        <DetailVersions
          v-if="showVersions(node)"
          v-model="versionChoice"
          data-tab="versions"
          :node="node"
          @split="splitMember"
          @join="joinMember"
        />
        <DetailInfo
          data-tab="about"
          :title="node.title"
          :kicker="aboutKicker"
          :overview="node.overview ?? ''"
          :info-rows="infoRows"
          :files="files"
        />
      </template>
    </div>

    <!-- 浮动控件：顶部渐隐带、返回圆钮、右上角「更多」（排在外壳窗口键胶囊左边）、底部分区胶囊 -->
    <div class="lib-detail-edge" aria-hidden="true" />
    <UiIconButton
      class="lib-float-button lib-detail-back"
      icon="back"
      variant="overlay"
      label="返回"
      @click="emit('close')"
    />
    <DetailActions
      v-if="node"
      class="lib-detail-more"
      :class="{ 'beside-window': isElectron }"
      :node="node"
      :jav="jav"
      :matched="matched"
      :busy="busy"
      :writer-available="writerAvailable"
      @fix-match="emit('fix-match', $event)"
      @toggle-lock="toggleLock"
      @refresh="refreshMetadata"
      @write="writeOut"
      @organize="emit('organize', $event)"
    />
    <DetailTabs
      v-if="node && tabs.length > 2"
      :tabs="tabs"
      :active="activeTab"
      @jump="jumpTo"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 条目详情（Apple TV 式，效果图 D-1 / D-2 / D-3）：铺满整个窗口（侧栏浮在上面），纯黑底。
 * 头图（大背景 + 渐进模糊、标志、播放 / 想看、简介、规格行与主演导演），剧集卡横排（按季切换），
 * 剧照横排（点开灯箱），圆头像演职员，版本，关于（信息卡 + 文件卡）。
 * 浮动控件：左上玻璃返回圆钮（外壳的前进 / 后退胶囊此时让位，use-shell-chrome），右上「更多」管理操作，
 * 底部玻璃胶囊做页内分区导航（滚动时跟随当前分区，点了滚过去）。
 * 播放接 openMediaPlayer（播放弹窗 / mpv），去码接 features/lada（use-restore）。
 *
 * 同一作品在几个文件夹里时引擎已合并成一棵树，DetailVersions 选播放哪个版本 / 来源、拆出误合并的。
 *
 * 本组件管载入、播放与操作；各区块在 DetailHero / DetailSeasons / DetailVersions / DetailPeople / DetailInfo，
 * 底部胶囊在 DetailTabs（状态在 use-detail-tabs），样式在 item-detail.css，
 * 纯规则在 detail-rules.ts / detail-view.ts / version-rules.ts。
 */
import { toast } from '@/components/ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { usePlatform } from '@/composables/use-platform'
import { useOwnBackButton } from '@/composables/use-shell-chrome'

import { errorText, libraryBridge } from '../api/bridge'
import { heroImage, itemImage, tmdbImage } from '../api/images'
import { onLibraryEvent } from '../state/library-events'
import type { LibrarySection } from '../state/library-section'
import { useWriter } from '../writer/use-writer'
import DetailActions from './DetailActions.vue'
import DetailHero from './DetailHero.vue'
import DetailInfo from './DetailInfo.vue'
import DetailPeople from './DetailPeople.vue'
import DetailStills from './DetailStills.vue'
import DetailTabs from './DetailTabs.vue'
import DetailSeasons from './DetailSeasons.vue'
import DetailVersions from './DetailVersions.vue'
import {
  allVideoFiles,
  infoRowsOf,
  metaLineOf,
  peopleOf,
  playLabelOf,
  sortedSeasons,
  stillsOf,
  titleMetaOf,
} from './detail-rules'
import {
  type PlayRequest,
  episodePlayRequest,
  play,
  primaryPlayRequest,
} from './playback'
import {
  creditLinesOf,
  detailTabsOf,
  heroMetaParts,
  heroSpecsOf,
} from './detail-view'
import { prepareProgress } from '../progress/progress-cache'
import { useActorLinks } from './use-actor-links'
import { useDetailTabs } from './use-detail-tabs'
import { useRestore } from './use-restore'
import { showVersions } from './version-rules'

const props = defineProps<{
  itemId: number
  /** 所在分区：番号区显示去码、隐藏锁定（见 DetailHero） */
  section?: LibrarySection
}>()
const emit = defineEmits<{
  close: []
  'fix-match': [itemId: number]
  organize: [itemIds: number[]]
  'open-actor': [actorId: number]
}>()

const bridge = libraryBridge()
const { isElectron } = usePlatform()
useOwnBackButton()
const { available: writerAvailable, write } = useWriter()
const root = ref<HTMLElement | null>(null)
const node = shallowRef<LibraryItemNode | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
/** 选中的版本 / 来源（见 version-rules.ts）；换条目时回到默认 */
const versionChoice = ref<string | null>(null)
/** 合并展示的本地条目 id（含自身）：任何一个变了都要重取，写出 / 刷新也对它们全部做 */
const memberIds = computed(() =>
  node.value
    ? (node.value.merge?.members.map(m => m.itemId) ?? [node.value.id])
    : []
)

async function load(resetView: boolean): Promise<void> {
  if (!bridge) return
  const id = props.itemId
  loading.value = true
  try {
    const item = await bridge.getItem(id)
    if (id !== props.itemId) return
    node.value = item
    error.value = null
    // 观看标记与防剧透读片库进度（读失败不影响详情）
    if (item) void prepareProgress(item)
    if (resetView) {
      await nextTick()
      root.value?.scrollTo({ top: 0 })
      root.value?.focus({ preventScroll: true })
      resetTabs()
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.itemId,
  () => {
    versionChoice.value = null
    void load(true)
  },
  { immediate: true }
)

// 识别 / 刷新元数据完成后，引擎推送 items-changed，详情跟着更新
onLibraryEvent(event => {
  if (
    event.type === 'items-changed' &&
    (event.reset ||
      event.updated.some(
        id => id === props.itemId || memberIds.value.includes(id)
      ))
  ) {
    void load(false)
  }
})

const titleMeta = computed(() => titleMetaOf(node.value))
/** 番号库条目：在番号区打开，或元数据来自番号刮削 */
const jav = computed(
  () => props.section === 'jav' || titleMeta.value?.ref.provider === 'jav'
)
/** 已有匹配：TMDB 条目有 tmdb id，番号条目有番号元数据 */
const matched = computed(() =>
  Boolean(
    node.value?.providerIds.tmdb || titleMeta.value?.ref.provider === 'jav'
  )
)
const restore = useRestore(node, jav)
const stills = computed(() => stillsOf(titleMeta.value))

const backdrop = computed(() => heroImage(node.value?.backdrop ?? null))
const logo = computed(() => node.value?.logo ?? null)
const tagline = computed(() => titleMeta.value?.tagline ?? '')
const seasons = computed(() => sortedSeasons(node.value))
const metaLine = computed(() => metaLineOf(node.value, seasons.value))
const metaParts = computed(() => heroMetaParts(metaLine.value, titleMeta.value))
const heroSpecs = computed(() =>
  node.value ? heroSpecsOf(node.value, titleMeta.value) : []
)
const credits = computed(() => creditLinesOf(titleMeta.value))
/** 关于卡片片名下的一行：类型 · 题材 */
const aboutKicker = computed(() => {
  const n = node.value
  if (!n) return ''
  const kind = n.type === 'series' ? '剧集' : '电影'
  return [kind, ...n.genres.slice(0, 3)].join(' · ')
})

// —— 播放 ——
const primaryPlay = computed<PlayRequest | null>(() =>
  node.value ? primaryPlayRequest(node.value, versionChoice.value) : null
)

const playLabel = computed(() => {
  const request = primaryPlay.value
  return playLabelOf(
    node.value?.type,
    request ? request.playlist[request.index].name : null
  )
})

async function startPlayback(request: PlayRequest): Promise<void> {
  const ok = await play(
    request,
    itemImage(node.value?.poster ?? null, 780) ?? undefined
  )
  if (!ok) toast.warning('当前环境无法播放本地文件')
}

function playPrimary(): void {
  if (primaryPlay.value) void startPlayback(primaryPlay.value)
}

function playEpisode(season: LibraryItemNode, ep: LibraryItemNode): void {
  const n = node.value
  if (!n) return
  const request = episodePlayRequest(n, season, ep, versionChoice.value)
  if (request) void startPlayback(request)
}

// 番号库条目：演员库里的演员可点开详情（use-actor-links）
const actorLinks = useActorLinks(
  computed(() =>
    titleMeta.value?.ref.provider === 'jav' ? node.value?.id : undefined
  )
)
const people = computed(() =>
  peopleOf(titleMeta.value, path => tmdbImage(path), actorLinks.value)
)
const infoRows = computed(() => infoRowsOf(node.value))
const files = computed(() => allVideoFiles(node.value))

// —— 页内分区（底部胶囊）——
const tabs = computed(() =>
  node.value
    ? detailTabsOf({
        episodes: seasons.value.length > 0,
        stills: stills.value.length > 0,
        cast: people.value.length > 0,
        versions: showVersions(node.value),
      })
    : []
)
const {
  activeTab,
  onScroll,
  jumpTo,
  reset: resetTabs,
} = useDetailTabs(root, tabs)

// —— 操作 ——
async function run(name: string, task: () => Promise<unknown>): Promise<void> {
  busy.value = name
  try {
    await task()
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    busy.value = null
  }
}

function toggleLock(): void {
  const n = node.value
  if (!n || !bridge) return
  void run('lock', async () => {
    await (n.matchState === 'locked'
      ? bridge.unlockMatch(n.id)
      : bridge.lockMatch(n.id))
    await load(false)
  })
}

function refreshMetadata(): void {
  const n = node.value
  if (!n || !bridge) return
  void run('refresh', async () => {
    await bridge.refreshMetadata({ itemIds: memberIds.value })
    toast.info('已开始重新获取元数据')
  })
}

/** 拆出误合并的一处 / 恢复合并：引擎推送 items-changed 后详情与海报墙重取。 */
function splitMember(itemId: number): void {
  if (!bridge) return
  void run('merge', async () => {
    await bridge.merge.split(itemId)
    versionChoice.value = null
    toast.info('已拆出，单独显示在片库里')
  })
}

function joinMember(itemId: number): void {
  if (!bridge) return
  void run('merge', async () => {
    await bridge.merge.join(itemId)
    toast.info('已恢复合并')
  })
}

function writeOut(): void {
  const n = node.value
  if (!n) return
  void run('write', async () => {
    const failure = await write(memberIds.value)
    if (failure) throw new Error(failure)
    toast.info('已开始写出 NFO 与图片')
  })
}
</script>

<style scoped src="./item-detail.css"></style>
