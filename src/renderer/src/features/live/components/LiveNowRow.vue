<template>
  <UiShelf
    v-if="cards.length"
    class="live-now-row"
    title="正在直播"
    more
    more-label="打开直播"
    list
    @more="router.push('/live')"
  >
    <template #actions>
      <UiButton
        size="sm"
        variant="secondary"
        label="收藏频道"
        @click="router.push('/live')"
      />
    </template>
    <UiEpisodeCard
      v-for="card in cards"
      :key="card.channel.id"
      role="listitem"
      :title="card.title"
      :subtitle="card.subtitle"
      :progress="card.progress"
      :label="`观看直播 ${card.channel.name}`"
      @open="openChannel(card.channel.id)"
    >
      <template #art>
        <span class="live-now-art" />
      </template>
      <template #badge>
        <span class="live-now-tag yb-glass is-media"><i />直播</span>
        <LiveLogo
          class="live-now-logo"
          :name="card.channel.name"
          :logo="card.channel.logo"
        />
      </template>
    </UiEpisodeCard>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页「正在直播」一排：收藏频道的当前节目（按收藏顺序，最多 8 张）。横版卡是深色画面，左上红点「直播」胶囊、右上台标，
 * 底部压「频道 · 节目」、时段与剩余时间、播出进度；没有节目单的频道只写「正在直播」。
 * 点卡跳到直播页并播这个频道（/live?channel=<id>），标题 › 与「收藏频道」打开直播页。
 *
 * 网页版（没有 iptv 域）、没有收藏、收藏的频道不在当前直播源里时整排不渲染；有收藏时才加载直播源
 * （useLiveSources 是模块单例，直播页加载过就不重复拉），节目单只查收藏的频道。
 */
import { computed, onActivated, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'
import UiEpisodeCard from '@/components/ui/UiEpisodeCard.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import { useLiveEpg } from '../composables/use-live-epg'
import { useLiveSources } from '../composables/use-live-sources'
import { liveNowCards } from '../utils/live-now'
import LiveLogo from './LiveLogo.vue'

const router = useRouter()
const live = useLiveSources()
const { available, sources, channels, epgUrls, favorites } = live

/** 收藏且在当前直播源里的频道（节目单只查这些） */
const favoriteChannels = computed(() =>
  channels.value.filter(channel => favorites.value.has(channel.id))
)
const { programmes, now } = useLiveEpg(favoriteChannels, epgUrls)

const cards = computed(() =>
  available
    ? liveNowCards(
        favoriteChannels.value,
        favorites.value,
        programmes.value,
        now.value
      )
    : []
)

/** 有收藏和直播源时才拉直播源（首页不为没用到的直播发请求） */
function ensureSources(): void {
  if (available && favorites.value.size && sources.value.length)
    live.ensureStarted()
}

onMounted(ensureSources)
onActivated(ensureSources)

function openChannel(id: string): void {
  void router.push({ path: '/live', query: { channel: id } })
}
</script>

<style scoped>
.live-now-art {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 82% 18%,
    var(--media-hover),
    var(--media-bg) 72%
  );
}
.live-now-logo {
  width: 40px; /* style-tokens: layout（直播卡台标） */
  height: 40px;
  background: var(--glass-light-bg);
}
.live-now-logo :deep(.live-logo-mark) {
  color: var(--media-text);
  font-size: var(--text-sm);
}

.live-now-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  height: 24px; /* style-tokens: layout（与直播页画面标签同高） */
  margin-right: auto;
  padding: 0 var(--space-2_5);
  border-radius: var(--radius-full);
  color: var(--media-text);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}
.live-now-tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
}
</style>
