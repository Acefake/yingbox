<template>
  <div class="live-channels">
    <UiInput
      v-model="query"
      class="live-channels-search"
      icon="search"
      size="sm"
      variant="filled"
      clearable
      placeholder="搜索频道"
      aria-label="搜索频道"
    />
    <p v-if="!channels.length" class="live-channels-empty">
      {{ emptyText }}
    </p>
    <div v-else class="live-channels-scroll">
      <UiVirtualGrid
        tag="ul"
        class="live-channels-list"
        :items="channels"
        :item-key="channel => channel.id"
      >
        <template #default="{ item: channel }">
          <li class="live-channel">
            <UiListRow
              class="live-channel-row"
              :selected="channel.id === selectedId"
              @click="emit('select', channel)"
            >
              <template #leading>
                <span class="live-channel-logo">
                  <img
                    v-if="channel.logo && !brokenLogos.has(channel.logo)"
                    :src="channel.logo"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="markBroken(channel.logo)"
                  />
                  <UiIcon v-else name="tv" size="sm" />
                </span>
              </template>
              <span class="live-channel-name">{{ channel.name }}</span>
              <template #description>
                <span class="live-channel-now">{{ nowTitle(channel) }}</span>
                <span class="live-channel-track" aria-hidden="true">
                  <span
                    class="live-channel-bar"
                    :style="{ transform: `scaleX(${nowProgress(channel)})` }"
                  />
                </span>
              </template>
            </UiListRow>
            <UiIconButton
              class="live-channel-fav"
              icon="star"
              size="sm"
              :filled="favorites.has(channel.id)"
              :active="favorites.has(channel.id)"
              :label="favorites.has(channel.id) ? '取消收藏' : '收藏频道'"
              @click="emit('toggle-favorite', channel.id)"
            />
          </li>
        </template>
      </UiVirtualGrid>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 直播频道列表：搜索框 + 虚拟列表（台标、名称、当前节目与播出进度、收藏按钮）。
 * 只渲染与转发，筛选在父组件按分组和搜索词算好后传入。
 */
import { ref } from 'vue'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'

import { currentProgramme, programmeProgress } from '../utils/epg-rules'
import type { LiveChannel } from '../utils/playlist-parse'
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

const props = defineProps<{
  channels: LiveChannel[]
  selectedId: string
  programmes: Record<string, EpgProgramme[]>
  now: number
  favorites: ReadonlySet<string>
  emptyText: string
}>()

const emit = defineEmits<{
  select: [channel: LiveChannel]
  'toggle-favorite': [id: string]
}>()

const query = defineModel<string>('query', { default: '' })

/** 加载失败的台标，改显示图标 */
const brokenLogos = ref(new Set<string>())

function markBroken(url: string): void {
  brokenLogos.value = new Set(brokenLogos.value).add(url)
}

function nowTitle(channel: LiveChannel): string {
  return currentProgramme(props.programmes[channel.id], props.now)?.title || ''
}

function nowProgress(channel: LiveChannel): number {
  const p = currentProgramme(props.programmes[channel.id], props.now)
  return p ? programmeProgress(p, props.now) : 0
}
</script>

<style scoped>
.live-channels {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--space-2);
}

.live-channels-search {
  flex: none;
}

.live-channels-empty {
  margin: 0;
  padding: var(--space-6) var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}

.live-channels-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.live-channels-list {
  margin: 0;
  padding-left: 0;
  padding-right: 0;
  list-style: none;
}

.live-channel {
  position: relative;
  display: flex;
  align-items: center;
  height: calc(var(--space-9) + var(--space-3));
}

.live-channel-row {
  height: 100%;
  padding-right: var(--space-9);
}

.live-channel-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--space-9);
  height: var(--space-7);
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-fill-tertiary);
}

.live-channel-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.live-channel-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}

.live-channel-now {
  display: block;
  min-height: 1lh;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-channel-track {
  display: block;
  height: 2px;
  margin-top: var(--space-1);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}

.live-channel-bar {
  display: block;
  height: 100%;
  background: var(--accent);
  transform-origin: left center;
}

.live-channel-fav {
  position: absolute;
  right: var(--space-1);
}
</style>
