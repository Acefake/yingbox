<template>
  <section class="live-channels" aria-label="频道">
    <div class="live-channels-bar">
      <nav v-scroll-x class="live-channels-groups" aria-label="频道分组">
        <UiChip
          v-for="item in groups"
          :key="item.key"
          size="md"
          :count="item.count"
          :selected="item.key === group"
          @click="group = item.key"
        >
          <template v-if="item.key === FAVORITES_GROUP" #leading>
            <UiIcon name="star" size="sm" filled />
          </template>
          {{ item.label }}
        </UiChip>
      </nav>
      <UiInput
        v-model="query"
        class="live-channels-search"
        icon="search"
        variant="filled"
        clearable
        placeholder="搜索频道"
        aria-label="搜索频道"
      />
    </div>

    <p v-if="!channels.length" class="live-channels-empty">
      {{ emptyText }}
    </p>
    <UiVirtualGrid
      v-else
      tag="ul"
      class="live-channels-grid"
      :items="channels"
      :item-key="channel => channel.id"
    >
      <template #default="{ item: channel }">
        <li
          class="live-card"
          :class="{ 'is-selected': channel.id === selectedId }"
        >
          <UiPressable
            class="live-card-main"
            :aria-current="channel.id === selectedId ? 'true' : undefined"
            @click="emit('select', channel)"
          >
            <LiveLogo :name="channel.name" :logo="channel.logo" />
            <span class="live-card-text">
              <span class="live-card-name">
                <span class="live-card-title">{{ channel.name }}</span>
                <span
                  v-if="channel.id === selectedId"
                  class="live-card-eq"
                  aria-hidden="true"
                  ><i /><i /><i
                /></span>
              </span>
              <span class="live-card-now">{{ nowTitle(channel) }}</span>
              <span class="live-card-track" aria-hidden="true">
                <span
                  class="live-card-bar"
                  :style="{ transform: `scaleX(${nowProgress(channel)})` }"
                />
              </span>
            </span>
          </UiPressable>
          <UiIconButton
            class="live-card-fav"
            :class="{ 'is-on': favorites.has(channel.id) }"
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
  </section>
</template>

<script setup lang="ts">
/**
 * 直播频道区：分组胶囊（收藏、全部、各分组，带数量）+ 右侧搜索框，下面是频道卡片网格（虚拟网格，列数随宽度变）。
 * 每张卡：台标方块（没有台标显示台名缩写）、频道名、当前节目名与细进度条；选中卡底色提升并带「正在播放」小指示。
 * 收藏星标只在已收藏、悬停或聚焦时显示。只渲染与转发，筛选在父组件按分组和搜索词算好后传入。
 */
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'

import { currentProgramme, programmeProgress } from '../utils/epg-rules'
import { FAVORITES_GROUP, type LiveGroup } from '../utils/live-rules'
import type { LiveChannel } from '../utils/playlist-parse'
import LiveLogo from './LiveLogo.vue'
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

const props = defineProps<{
  groups: LiveGroup[]
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

const group = defineModel<string>('group', { required: true })
const query = defineModel<string>('query', { default: '' })

function nowTitle(channel: LiveChannel): string {
  return (
    currentProgramme(props.programmes[channel.id], props.now)?.title ||
    channel.group ||
    ''
  )
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
  gap: var(--space-4);
}

.live-channels-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.live-channels-groups {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: var(--space-2);
  overflow-x: auto;
  scrollbar-width: none;
}

.live-channels-groups :deep(.ui-chip) {
  flex: none;
}

.live-channels-search {
  flex: none;
  width: 240px;
  height: var(--control-height);
  border-radius: var(--radius-full);
}

.live-channels-empty {
  margin: 0;
  padding: var(--space-6) var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}

.live-channels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding-right: 0;
  padding-left: 0;
  list-style: none;
}

.live-card {
  position: relative;
  min-width: 0;
  height: 76px;
}

.live-card-main {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  transition: background-color var(--duration-fast) var(--ease-out);
}

/* 悬停与选中都在卡片实色上叠一层（卡片直接放在页面底色上，单独的半透明填充看不出提升） */
.live-card-main:hover {
  background-image: linear-gradient(
    var(--bg-active-soft),
    var(--bg-active-soft)
  );
}

.live-card.is-selected .live-card-main {
  background-image: linear-gradient(var(--bg-active), var(--bg-active));
}

.live-card-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.live-card-name {
  display: flex;
  align-items: center;
  min-width: 0;
  padding-right: var(--space-6);
  gap: var(--space-1_5);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}

.live-card-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-card-now {
  display: block;
  min-height: 1lh;
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-card-track {
  display: block;
  height: 3px;
  margin-top: var(--space-2);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-active);
}

.live-card-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--text-secondary);
  transform-origin: left center;
}

.live-card.is-selected .live-card-bar {
  background: var(--text-primary);
}

/* 正在播放：三根跳动的红色小竖条（减少动态效果时静止） */
.live-card-eq {
  display: inline-flex;
  flex: none;
  align-items: flex-end;
  gap: var(--space-0_5);
  height: 10px;
}

.live-card-eq i {
  width: 2px;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--danger);
  transform-origin: bottom;
  animation: live-eq var(--duration-pulse) var(--ease-out) infinite alternate;
}

.live-card-eq i:nth-child(2) {
  animation-delay: calc(var(--duration-pulse) / -3);
}

.live-card-eq i:nth-child(3) {
  animation-delay: calc(var(--duration-pulse) / -1.5);
}

@keyframes live-eq {
  from {
    transform: scaleY(0.35);
  }
  to {
    transform: scaleY(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-card-eq i {
    animation: none;
  }

  .live-card-eq i:nth-child(odd) {
    transform: scaleY(0.6);
  }
}

.live-card-fav {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  opacity: 0;
}

.live-card-fav.is-on {
  background: transparent;
  color: var(--rating);
}

.live-card:hover .live-card-fav,
.live-card-fav:focus-visible,
.live-card-fav.is-on {
  opacity: 1;
}
</style>
