<template>
  <!-- 剧集：按季分段 + 集列表 -->
  <section class="lib-section">
    <div class="lib-section-head">
      <h2 class="lib-section-title">剧集</h2>
      <div class="lib-season-tools">
        <span
          v-if="detectVisible"
          v-tooltip="detectBlocked"
          class="lib-season-detect"
        >
          <UiButton
            size="sm"
            :variant="detectRunning ? 'secondary' : 'plain'"
            icon="scan"
            :label="detectLabel"
            :disabled="!detectRunning && !!detectBlocked"
            @click="toggleDetect"
          />
        </span>
        <UiSegmented
          v-if="seasons.length <= 8"
          v-model="seasonKey"
          size="sm"
          label="选择季"
          :options="seasonOptions"
        />
        <UiSelect
          v-else
          v-model="seasonKey"
          size="sm"
          aria-label="选择季"
          :options="
            seasonOptions.map(o => ({ value: o.value, label: o.label! }))
          "
        />
      </div>
    </div>
    <p v-if="seasonOverview" class="lib-season-overview">
      {{ seasonOverview }}
    </p>
    <ol class="lib-episodes">
      <li
        v-for="ep in episodes"
        :key="ep.id"
        class="lib-episode"
        :class="{
          'is-missing': !hasFile(ep),
          'is-spoiler': spoilerIds.has(ep.id),
        }"
      >
        <UiPressable
          class="lib-episode-still"
          :label="`播放 ${ep.title}`"
          :disabled="!hasFile(ep)"
          @click="currentSeason && emit('play-episode', currentSeason, ep)"
        >
          <img
            v-if="ep.poster"
            :src="ep.poster"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
          />
          <span class="lib-episode-play" aria-hidden="true">
            <UiIcon name="play" filled />
          </span>
          <!-- 进度条沿用「继续播放」卡片的样式（continue-row.css） -->
          <span v-if="markOf(ep)?.ratio" class="cw-progress" aria-hidden="true">
            <i :style="{ width: ratioWidth(markOf(ep)!.ratio) }" />
          </span>
        </UiPressable>
        <div class="lib-episode-text">
          <div class="lib-episode-head">
            <span class="lib-episode-number">{{ ep.episodeNumber }}</span>
            <span class="lib-episode-title">{{ ep.title }}</span>
          </div>
          <div class="lib-episode-meta">
            <span v-if="ep.airDate">{{ ep.airDate }}</span>
            <span v-if="ep.runtime">{{ formatRuntime(ep.runtime) }}</span>
            <span v-if="!hasFile(ep)">本地缺失</span>
            <span v-if="markOf(ep)">{{ markOf(ep)!.label }}</span>
            <span
              v-if="spoilerIds.has(ep.id) && ep.overview"
              class="lib-episode-spoiler-hint"
              >未看 · 悬停显示简介</span
            >
          </div>
          <p v-if="ep.overview" class="lib-episode-overview">
            {{ ep.overview }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的剧集区块：季切换（8 季以内分段控件，更多用下拉）、季简介、集列表
 * （剧照、集号与标题、播出日期、时长、本地缺失）。换条目时回到默认季。
 * 每集带观看标记（片库观看进度：「已看」或「看到 12:30」加进度条，见 progress/watch-marks）。
 * 防剧透（设置 ui.spoilerGuard）打开时，没看过的集剧照模糊、简介折叠，悬停或键盘聚焦到这一集时显示（use-spoiler-guard）。
 * 桌面端在季切换旁给「检测片头片尾」（use-intro-detect）。
 */
import { computed, ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { vTooltip } from '@/components/ui/tooltip'

import { progressOf } from '../progress/progress-cache'
import { type WatchMark, itemMark, ratioWidth } from '../progress/watch-marks'
import { formatRuntime } from '../shared/format'
import { defaultSeasonKey, seasonEpisodes, seasonName } from './detail-rules'
import { videoFiles } from './playback'
import { useSpoilerGuard } from './use-spoiler-guard'
import { useIntroDetect } from './use-intro-detect'

const props = defineProps<{
  /** 剧集条目（季在 children 里）。 */
  node: LibraryItemNode
  /** 已排序的季（sortedSeasons）。 */
  seasons: LibraryItemNode[]
}>()

const emit = defineEmits<{
  'play-episode': [season: LibraryItemNode, episode: LibraryItemNode]
}>()

const seasonKey = ref(defaultSeasonKey(props.node))
watch(
  () => props.node.id,
  () => {
    seasonKey.value = defaultSeasonKey(props.node)
  }
)

const seasonOptions = computed(() =>
  props.seasons.map(s => ({ value: String(s.id), label: seasonName(s) }))
)
const currentSeason = computed(
  () => props.seasons.find(s => String(s.id) === seasonKey.value) ?? null
)
const seasonOverview = computed(() => currentSeason.value?.overview ?? '')
const episodes = computed(() => seasonEpisodes(currentSeason.value))
const spoilerIds = useSpoilerGuard(
  () => props.node,
  () => episodes.value
)

const hasFile = (ep: LibraryItemNode): boolean => videoFiles(ep).length > 0
const markOf = (ep: LibraryItemNode): WatchMark | null =>
  itemMark(progressOf(ep.id))

const {
  visible: detectVisible,
  blocked: detectBlocked,
  label: detectLabel,
  running: detectRunning,
  toggle: toggleDetect,
} = useIntroDetect(
  () => props.node,
  () => currentSeason.value
)
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-season-tools {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.lib-season-overview {
  max-width: 720px;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

/* —— 集列表 —— */
.lib-episodes {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}
.lib-episode {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.lib-episode.is-missing {
  opacity: 0.55;
}
.lib-episode-still {
  position: relative;
  display: block;
  width: 240px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}
.lib-episode-still img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lib-episode-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--overlay-scrim-soft);
  color: var(--media-text);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.lib-episode-still:hover .lib-episode-play,
.lib-episode-still:focus-visible .lib-episode-play {
  opacity: 1;
}
.lib-episode-head {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
}
.lib-episode-number {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.lib-episode-meta {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.lib-episode-overview {
  display: -webkit-box;
  margin: var(--space-2) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* —— 防剧透：没看过的集剧照模糊、简介折叠，悬停 / 聚焦时显示 —— */
.lib-episode.is-spoiler .lib-episode-still img {
  filter: blur(18px);
  transform: scale(1.1);
  transition:
    filter var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
.lib-episode.is-spoiler .lib-episode-overview {
  display: none;
}
.lib-episode-spoiler-hint {
  color: var(--text-quaternary);
}
.lib-episode.is-spoiler:hover .lib-episode-still img,
.lib-episode.is-spoiler:focus-within .lib-episode-still img {
  filter: none;
  transform: none;
}
.lib-episode.is-spoiler:hover .lib-episode-overview,
.lib-episode.is-spoiler:focus-within .lib-episode-overview {
  display: -webkit-box;
}
.lib-episode.is-spoiler:hover .lib-episode-spoiler-hint,
.lib-episode.is-spoiler:focus-within .lib-episode-spoiler-hint {
  display: none;
}

@media (max-width: 720px) {
  .lib-episode {
    grid-template-columns: 1fr;
  }
  .lib-episode-still {
    width: 100%;
  }
}
</style>
