<template>
  <div class="live-view">
    <PageHeader
      title="直播"
      :count="channels.length || undefined"
      description="导入 m3u / txt 直播源，边看直播边看节目单"
    >
      <template #actions>
        <UiButton
          icon="list"
          :label="panelOpen ? '收起直播源' : '直播源'"
          :disabled="!available"
          @click="togglePanel"
        />
        <UiIconButton
          icon="refresh"
          label="刷新直播源与节目单"
          :disabled="!available || !sources.length"
          :loading="anyLoading || epgLoading"
          @click="refreshAll"
        />
      </template>
    </PageHeader>

    <StatusState
      v-if="!available"
      icon="livePlay"
      title="直播需要桌面端"
      hint="网页版不能读取直播源与节目单"
    />
    <template v-else>
      <LiveSourcePanel v-if="panelOpen || !sources.length" />
      <p v-if="epgError" class="live-epg-error" role="status">
        {{ epgError }}
      </p>

      <div v-if="sources.length" class="live-body">
        <nav class="live-groups" aria-label="频道分组">
          <UiListRow
            v-for="group in groups"
            :key="group.key"
            class="live-group"
            :selected="group.key === activeGroup"
            @click="pickGroup(group.key)"
          >
            {{ group.label }}
            <template #trailing>
              <span class="live-group-count">{{ group.count }}</span>
            </template>
          </UiListRow>
        </nav>

        <LiveChannelList
          v-model:query="query"
          class="live-list"
          :channels="visibleChannels"
          :selected-id="selectedId"
          :programmes="programmes"
          :now="now"
          :favorites="favorites"
          :empty-text="emptyText"
          @select="select"
          @toggle-favorite="toggleFavorite"
        />

        <LiveStage
          class="live-player"
          :channel="selected"
          :programmes="selected ? programmes[selected.id] : undefined"
          :now="now"
          :favorite="!!selected && favorites.has(selected.id)"
          :schedule-empty-text="scheduleEmptyText"
          @toggle-favorite="toggleFavorite"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 直播页（/live）：左侧分组 + 频道列表，右侧播放器与今日节目单；顶部管理直播源。
 * 源与收藏在 useLiveSources（模块单例），节目单在 useLiveEpg（随页面挂载 / 卸载）。
 */
import { computed, onMounted, ref } from 'vue'

import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'

import LiveChannelList from '../components/LiveChannelList.vue'
import LiveSourcePanel from '../components/LiveSourcePanel.vue'
import LiveStage from '../components/LiveStage.vue'
import { useLiveEpg } from '../composables/use-live-epg'
import { useLiveSources } from '../composables/use-live-sources'
import {
  ALL_GROUP,
  FAVORITES_GROUP,
  buildGroups,
  filterChannels,
} from '../utils/live-rules'
import type { LiveChannel } from '../utils/playlist-parse'

const live = useLiveSources()
const { available, sources, channels, epgUrls, favorites, anyLoading } = live

const {
  programmes,
  now,
  loading: epgLoading,
  error: epgError,
  reload: reloadEpg,
} = useLiveEpg(channels, epgUrls)

const panelOpen = ref(false)
const activeGroup = ref(ALL_GROUP)
const query = ref('')
const selectedId = ref('')

const groups = computed(() => buildGroups(channels.value, favorites.value))
const visibleChannels = computed(() =>
  filterChannels(
    channels.value,
    activeGroup.value,
    query.value,
    favorites.value
  )
)
const selected = computed<LiveChannel | null>(
  () => channels.value.find(c => c.id === selectedId.value) ?? null
)

const emptyText = computed(() => {
  if (query.value.trim()) return '没有匹配的频道'
  if (activeGroup.value === FAVORITES_GROUP) return '还没有收藏频道'
  return anyLoading.value ? '正在加载直播源' : '没有频道'
})

const scheduleEmptyText = computed(() => {
  if (!epgUrls.value.length)
    return '没有节目单。可在直播源里填写 XMLTV 节目单地址'
  return epgLoading.value ? '正在加载节目单' : '节目单里没有这个频道'
})

function togglePanel(): void {
  panelOpen.value = !panelOpen.value
}

function pickGroup(key: string): void {
  activeGroup.value = key
}

function select(channel: LiveChannel): void {
  selectedId.value = channel.id
}

function toggleFavorite(id: string): void {
  live.toggleFavorite(id)
}

async function refreshAll(): Promise<void> {
  await live.refreshAll()
  await reloadEpg(true)
}

onMounted(() => live.ensureStarted())
</script>

<style scoped>
.live-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--space-4);
  padding: var(--content-padding-y) var(--content-padding-x);
  overflow: hidden;
}

.live-epg-error {
  margin: 0;
  color: var(--warning);
  font-size: var(--text-sm);
}

.live-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(120px, 160px) minmax(240px, 320px) minmax(
      0,
      1fr
    );
  grid-template-rows: minmax(0, 1fr);
  gap: var(--space-5);
  min-height: 0;
}

.live-groups {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--space-0_5);
  overflow-y: auto;
}

.live-group-count {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.live-list,
.live-player {
  min-height: 0;
}
</style>
