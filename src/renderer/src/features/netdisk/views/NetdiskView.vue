<template>
  <div ref="scroller" class="netdisk-view primary-scroll" @scroll="onScroll">
    <NetdiskHero
      ref="heroEl"
      v-model:keyword="keyword"
      :match="match"
      :summary="summary"
      :status="statusItems"
      :specs="bestSpecs"
      :loading="loading"
      :disabled="!available || !configured"
      :settings-disabled="!available"
      :can-save-best="Boolean(bestShare)"
      :best-saving="bestShare ? actions.isSaving(bestShare.item.url) : false"
      :best-saved="bestShare ? actions.isSaved(bestShare.item.url) : false"
      @search="runSearch"
      @settings="openNetdiskSettings"
      @save-best="saveBest"
      @magnet="showMagnets"
    />

    <div class="netdisk-body">
      <StatusState
        v-if="!available"
        icon="database"
        title="网盘需要桌面端或片库服务"
        hint="网页版要连上片库服务才能登录 115"
      />
      <StatusState
        v-else-if="!configured"
        icon="search"
        title="先设置 PanSou 或 Torznab 地址"
        hint="PanSou 聚合各频道的 115 分享和磁力，Torznab（Prowlarr / Jackett）搜 BT 站的磁力。在设置 · 网盘里填自部署的地址。"
      >
        <UiButton size="sm" label="网盘设置" @click="openNetdiskSettings" />
      </StatusState>
      <template v-else>
        <NetdiskPreview
          v-if="preview.item.value"
          :item="preview.item.value"
          :snap="preview.snap.value"
          :loading="preview.loading.value"
          :saving="actions.isSaving(preview.item.value.url)"
          :saved="actions.isSaved(preview.item.value.url)"
          @save="actions.save(preview.item.value)"
          @close="actions.closePreview"
        />

        <div ref="tabsEl" class="netdisk-tabs">
          <UiSegmented v-model="tab" :options="tabs" label="结果类型" />
          <p
            v-if="tab !== 'offline' && notes.length"
            class="netdisk-notes"
            role="status"
          >
            {{ notes.join('；') }}
          </p>
          <UiSelect
            v-if="tab !== 'offline'"
            v-model="sort"
            class="netdisk-sort"
            size="sm"
            :options="sortOptions"
            aria-label="排序"
          />
        </div>
        <OfflineTasks v-if="tab === 'offline'" />
        <StatusState
          v-else-if="error"
          tone="danger"
          title="搜索失败"
          :hint="error"
        >
          <UiButton size="sm" label="网盘设置" @click="openNetdiskSettings" />
        </StatusState>
        <StatusState
          v-else-if="searched && !loading && !shown.length"
          icon="search"
          :title="tab === 'share' ? '没有找到 115 分享' : '没有找到磁力'"
          hint="换个关键词，或在设置里检查 PanSou / Torznab 地址"
        />
        <UiVirtualGrid
          v-if="!error && tab === 'magnet'"
          tag="ul"
          class="netdisk-results"
          :items="magnetRows"
          :item-key="item => `${item.kind}:${item.hash}`"
        >
          <template #default="{ item }">
            <MagnetResult
              :item="item"
              :adding="offlineAdd.isAdding(item.link)"
              :added="offlineAdd.isAdded(item.link)"
              @copy="actions.copy(item)"
              @offline="offlineAdd.add(item)"
            />
          </template>
        </UiVirtualGrid>
        <UiVirtualGrid
          v-else-if="!error && tab === 'share'"
          tag="ul"
          class="netdisk-results"
          :items="shareRows"
          :item-key="item => `${item.shareCode}/${item.receiveCode}`"
        >
          <template #default="{ item }">
            <NetdiskResult
              v-link-check="item"
              :item="item"
              :link-state="linkCheck.stateOf(item.url)"
              :previewing="preview.item.value?.url === item.url"
              :preview-loading="
                preview.loading.value && preview.item.value?.url === item.url
              "
              :saving="actions.isSaving(item.url)"
              :saved="actions.isSaved(item.url)"
              @copy="actions.copy(item)"
              @preview="togglePreview(item)"
              @save="actions.save(item)"
            />
          </template>
        </UiVirtualGrid>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 网盘搜索页：顶部海报 Hero（NetdiskHero：搜索框、真实状态行；搜到能对上 TMDB 的片时换成剧照、
 * 「转存最佳版本」与「磁力离线」），下面是 PanSou（115 分享 + 磁力 / 电驴）与 Torznab（磁力）两组结果，
 * 用分段控件切换，右侧可按画质 / 时间 / 体积排序（虚拟列表，行等高，左侧画质角标）。
 * 115 分享：查看文件是一个玻璃浮层（NetdiskPreview），转存在结果卡片与浮层上；磁力行可一键加进 115 离线下载；
 * 第三段「离线任务」看经影盒添加的云下载进度（打开页面带 ?tab=offline 直接显示）。
 * 一个来源失败时另一个照常出结果，失败说明显示在分段控件旁。两个来源都没填时引导去设置。
 * 页面铺到窗口左上角（Hero 压在浮动侧栏与窗口键胶囊下面）；Hero 在胶囊身后时经 useShellBackdrop 让胶囊换深色玻璃。
 */
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import UiSelect, { type SelectOption } from '@/components/ui/UiSelect.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { releaseSpecs } from '@/components/ui/spec-badge'
import { toast } from '@/components/ui/toast'
import { useShellBackdrop } from '@/composables/use-shell-backdrop'
import { useSetting } from '@/features/settings'
import type { NetdiskItem } from '../../../../../shared/contract/pan115'

import {
  netdisk,
  netdiskAvailable,
  offlineDownloads,
  openNetdiskSettings,
} from '../api'
import MagnetResult from '../components/MagnetResult.vue'
import NetdiskHero from '../components/NetdiskHero.vue'
import NetdiskPreview from '../components/NetdiskPreview.vue'
import NetdiskResult from '../components/NetdiskResult.vue'
import OfflineTasks from '../components/OfflineTasks.vue'
import { useHeroMatch } from '../composables/use-hero-match'
import { useLinkCheck } from '../composables/use-link-check'
import { useNetdiskSearch } from '../composables/use-netdisk-search'
import { useNetdiskStatus } from '../composables/use-netdisk-status'
import { useOfflineAdd } from '../composables/use-offline'
import { useShareActions } from '../composables/use-share-actions'
import { type HeroSummary, heroStatusItems } from '../utils/hero-status'
import { formatBytes } from '../utils/netdisk-rules'
import {
  type ReleaseSort,
  pickBest,
  qualityLabel,
  sizeFromTitle,
  sortReleases,
} from '../utils/release-quality'

const available = netdiskAvailable
const pansouUrl = useSetting('pan115.pansouUrl')
const {
  keyword,
  items,
  magnets,
  notes,
  loading,
  searched,
  error,
  search,
  reset,
} = useNetdiskSearch(netdisk)
const status = useNetdiskStatus({ pan115: netdisk, offline: offlineDownloads })
const configured = computed(
  () => Boolean(pansouUrl.value) || (status.torznabCount.value ?? 0) > 0
)
const statusItems = computed(() =>
  heroStatusItems({
    account: status.account.value,
    pansou: Boolean(pansouUrl.value),
    torznabCount: status.torznabCount.value,
    offline: status.offline.value,
  })
)

/** 最近一次提交搜索的词（Hero 拿它匹配影片，不跟着输入框每个字变） */
const submitted = ref('')
const { match } = useHeroMatch(submitted, {
  tmdb: async () => (await import('@/features/online')).tmdb,
})

// 搜索框清空（点 ✕ 或删光文字）：Hero 回到默认海报，结果与在途搜索一并清掉
watch(keyword, value => {
  if (value.trim()) return
  submitted.value = ''
  reset()
})

function runSearch(): void {
  if (!keyword.value.trim()) return
  submitted.value = keyword.value.trim()
  void search()
  if (available) void status.refresh()
}

type Tab = 'share' | 'magnet' | 'offline'
const route = useRoute()
const tab = ref<Tab>(route.query.tab === 'offline' ? 'offline' : 'share')
const count = (n: number): string => (searched.value ? ` ${n}` : '')
const tabs = computed<SegmentedOption<Tab>[]>(() => [
  { value: 'share', label: `115 分享${count(items.value.length)}` },
  { value: 'magnet', label: `磁力${count(magnets.value.length)}` },
  { value: 'offline', label: '离线任务' },
])
const sort = ref<ReleaseSort>('default')
const sortOptions: SelectOption[] = [
  { value: 'default', label: '默认排序' },
  { value: 'quality', label: '按画质' },
  { value: 'date', label: '按时间' },
  { value: 'size', label: '按体积' },
]
// 可见的 115 分享按需检测有效性，失效的沉到最后（useLinkCheck 节流提交，列表不会一条条跳）
const linkCheck = useLinkCheck({
  api: netdisk,
  instance: () => pansouUrl.value,
})
const vLinkCheck = linkCheck.vLinkCheck
const shareRows = computed(() =>
  linkCheck.order(sortReleases(items.value, sort.value, item => item))
)
const magnetRows = computed(() =>
  sortReleases(magnets.value, sort.value, item => item)
)
const shown = computed(() =>
  tab.value === 'share' ? shareRows.value : magnetRows.value
)
// 新结果里 115 分享为空、磁力有结果时自动切到磁力；在看离线任务时搜索后回到结果
watch([items, magnets], ([shares, links]) => {
  if (!searched.value) return
  if (!shares.length && links.length) tab.value = 'magnet'
  else if (shares.length && !links.length) tab.value = 'share'
  else if (tab.value === 'offline') tab.value = 'share'
})

/** 画质最高的 115 分享（「转存最佳版本」转存它）与全部结果里最好的一条（小结里的「最佳」） */
const bestShare = computed(() => pickBest(items.value, item => item.title))
const bestOverall = computed(() => {
  const magnet = pickBest(magnets.value, item => item.title)
  const share = bestShare.value
  if (!share || (magnet && magnet.quality.rank > share.quality.rank))
    return magnet
      ? { ...magnet, size: magnet.item.size ?? 0, title: magnet.item.title }
      : null
  return { ...share, size: 0, title: share.item.title }
})
const summary = computed<HeroSummary | null>(() => {
  if (!searched.value || error.value) return null
  const best = bestOverall.value
  const label = best ? qualityLabel(best.quality) : ''
  const size = best ? formatBytes(best.size || sizeFromTitle(best.title)) : ''
  return {
    shares: items.value.length,
    magnets: magnets.value.length,
    best: label ? [label, size].filter(Boolean).join(' ') : '',
  }
})
const bestSpecs = computed(() =>
  bestOverall.value ? releaseSpecs([bestOverall.value.title]) : []
)

const actions = useShareActions({
  api: linkCheck.guardReceive(netdisk),
  notify: toast,
  clipboard: () => navigator.clipboard,
})
const preview = actions.preview
const offlineAdd = useOfflineAdd({
  api: offlineDownloads,
  notify: toast,
  openLogin: openNetdiskSettings,
})

function saveBest(): void {
  if (bestShare.value) void actions.save(bestShare.value.item)
}

const tabsEl = ref<HTMLElement | null>(null)

/** 「磁力离线」：切到磁力页签并把结果区滚进视野 */
function showMagnets(): void {
  tab.value = 'magnet'
  tabsEl.value?.scrollIntoView({ block: 'start' })
}

/** 再点同一条收起预览，点别的换成那一条 */
function togglePreview(item: NetdiskItem): void {
  if (preview.item.value?.url === item.url) actions.closePreview()
  else void actions.openPreview(item)
}

// Hero 还在窗口键胶囊身后时，胶囊换成画面上的深色玻璃
const scroller = ref<HTMLElement | null>(null)
const heroEl = ref<{ $el: HTMLElement } | null>(null)
const setShell = useShellBackdrop()

function onScroll(): void {
  const hero = heroEl.value?.$el
  const top = scroller.value?.scrollTop ?? 0
  setShell(Boolean(hero) && top < (hero?.offsetHeight ?? 0) - 80)
}

onActivated(() => {
  onScroll()
  if (available) void status.refresh()
})
onDeactivated(() => setShell(false))
</script>

<style scoped>
/*
 * 整页往左上让回外壳留出的 --shell-left / --shell-top，Hero 从窗口左上角开始，浮动侧栏和胶囊压在它上面
 * （这里不建层叠上下文）。Hero 文案与结果区左边距 --netdisk-x = 侧栏让出的宽度 + 28px。
 */
.netdisk-view {
  --netdisk-x: calc(var(--shell-left) + var(--space-6_5));
  display: flex;
  flex-direction: column;
  height: calc(100% + var(--shell-top));
  margin: calc(var(--shell-top) * -1) 0 0 calc(var(--shell-left) * -1);
  overflow-y: auto;
}
.netdisk-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  box-sizing: border-box;
  width: 100%;
  max-width: calc(1136px + var(--netdisk-x) + var(--space-8));
  padding: var(--space-2) var(--space-8) var(--space-11) var(--netdisk-x);
}
.netdisk-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  scroll-margin-top: var(--shell-top);
}
.netdisk-notes {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-sort {
  flex: none;
  width: auto;
  margin-left: auto;
}
.netdisk-results {
  margin: 0;
  list-style: none;
  padding-inline: 0;
}
@media (max-width: 860px) {
  .netdisk-view {
    --netdisk-x: calc(var(--shell-left) + var(--space-5));
  }
  .netdisk-body {
    padding-right: var(--space-5);
  }
}
</style>
