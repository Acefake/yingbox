<template>
  <!-- 剧集（效果图 D-1 底部 / D-2）：季名做标题（多季时可下拉切换），剧集卡横排 -->
  <section class="lib-section lib-seasons">
    <div class="lib-section-head">
      <div class="lib-season-pick" :class="{ 'is-multi': seasons.length > 1 }">
        <h2 class="lib-section-title">
          {{ currentSeason ? seasonName(currentSeason) : '剧集'
          }}<UiIcon
            v-if="seasons.length > 1"
            class="lib-season-caret"
            name="chevronDown"
            size="md"
          />
        </h2>
        <!-- 透明的原生下拉盖在标题上：键盘、读屏与系统菜单都现成 -->
        <select
          v-if="seasons.length > 1"
          v-model="seasonKey"
          class="lib-season-select"
          aria-label="选择季"
        >
          <option v-for="o in seasonOptions" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </div>
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
    </div>
    <p v-if="seasonOverview" class="lib-season-overview">
      {{ seasonOverview }}
    </p>
    <ol class="lib-row lib-episodes">
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
          block
          class="lib-episode-hit"
          :label="`播放 ${ep.title}`"
          :disabled="!hasFile(ep)"
          @click="currentSeason && emit('play-episode', currentSeason, ep)"
        >
          <template v-if="ep.poster">
            <!-- 底层同图放大铺满整卡，给模糊区取样；上层剧照保持 16:9 并在底部羽化 -->
            <img
              class="lib-episode-fill"
              :src="ep.poster"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            />
            <img
              class="lib-episode-still"
              :src="ep.poster"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            />
          </template>
          <span v-else class="lib-episode-placeholder" aria-hidden="true"
            ><UiIcon name="tv" size="lg"
          /></span>
          <span class="lib-pblur lib-episode-blur" aria-hidden="true"
            ><i /><i /><i /><i
          /></span>
          <span class="lib-episode-copy">
            <span class="lib-episode-number"
              >第 {{ ep.episodeNumber ?? '?' }} 集</span
            >
            <span class="lib-episode-title" :title="ep.title">{{
              ep.title
            }}</span>
            <span v-if="ep.overview" class="lib-episode-overview">{{
              ep.overview
            }}</span>
            <span
              v-if="spoilerIds.has(ep.id) && ep.overview"
              class="lib-episode-spoiler-hint"
              >未看 · 悬停显示简介</span
            >
            <span v-if="markOf(ep)?.ratio" class="lib-episode-progress"
              ><i :style="{ width: ratioWidth(markOf(ep)!.ratio) }"
            /></span>
            <span class="lib-episode-foot">
              <span class="lib-episode-foot-main">
                <UiIcon name="play" size="sm" />
                {{ footText(ep) }}
              </span>
              <span v-if="!hasFile(ep)" class="lib-episode-missing"
                >本地缺失</span
              >
              <span v-else-if="ep.airDate" class="lib-episode-date">{{
                ep.airDate
              }}</span>
            </span>
          </span>
        </UiPressable>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的剧集区块（Apple TV 式，效果图 D-2）：标题是当前季名，多季时标题旁带下拉箭头（原生下拉盖在上面），
 * 季简介，剧集卡横排滚动：剧照占上部，下半同图渐进模糊 + 暗化，上面压「第 N 集」、标题、两行简介、
 * 观看进度条和「▶ 45 分钟 / 看到 12:30 / 已看」+ 播出日期或「本地缺失」。换条目时回到默认季。
 * 防剧透（设置 ui.spoilerGuard）打开时，没看过的集剧照模糊、简介折叠，悬停或键盘聚焦时显示（use-spoiler-guard）。
 * 桌面端在标题行右侧给「检测片头片尾」（use-intro-detect）。
 */
import { computed, ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
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
/** 卡片底行：有观看标记时显示标记（已看 / 看到 12:30），否则显示时长 */
const footText = (ep: LibraryItemNode): string =>
  markOf(ep)?.label || formatRuntime(ep.runtime) || '播放'

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
.lib-seasons {
  padding-top: var(--space-2);
}
/* 季名标题 + 下拉箭头；透明原生下拉盖满整块 */
.lib-season-pick {
  position: relative;
  min-width: 0;
}
.lib-season-pick .lib-section-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
}
.lib-season-caret {
  color: var(--text-tertiary);
  transition: color var(--duration-fast) ease;
}
.lib-season-pick.is-multi:hover .lib-season-caret,
.lib-season-pick:focus-within .lib-season-caret {
  color: var(--text-primary);
}
.lib-season-select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}
.lib-season-pick:focus-within {
  border-radius: var(--radius-sm);
  box-shadow: var(--focus-ring);
}
.lib-season-overview {
  display: -webkit-box;
  max-width: 720px;
  margin: calc(var(--space-2) * -1) 0 var(--space-4);
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* —— 剧集卡：360×340，剧照在上，下半渐进模糊，文字压在上面 —— */
.lib-episode {
  width: 360px;
  height: 340px;
}
.lib-episode.is-missing {
  opacity: 0.55;
}
.lib-episode-hit {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--bg-fill-secondary);
  color: var(--media-text);
  text-align: left;
  isolation: isolate;
  transition:
    transform var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}
/* 0.5px 发丝边 */
.lib-episode-hit::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px var(--media-glass-border);
  content: '';
  pointer-events: none;
}
.lib-episode-hit:hover:not(:disabled),
.lib-episode-hit:focus-visible {
  transform: scale(1.02);
  box-shadow: var(--shadow-lg);
}
.lib-episode-fill,
.lib-episode-still {
  position: absolute;
  inset: 0 0 auto;
  width: 100%;
  object-fit: cover;
}
.lib-episode-fill {
  height: 100%;
  transform: scale(1.15);
  transform-origin: center top;
}
.lib-episode-still {
  height: 68%;
  object-position: center 30%;
  -webkit-mask: linear-gradient(#000 70%, transparent);
  mask: linear-gradient(#000 70%, transparent);
}
.lib-episode-placeholder {
  position: absolute;
  inset: 0 0 auto;
  display: grid;
  place-items: center;
  height: 60%;
  color: var(--text-quaternary);
}
.lib-episode-blur {
  --pblur-height: 64%;
  --pblur-tint: linear-gradient(
    transparent 0%,
    color-mix(in srgb, var(--media-bg) 22%, transparent) 45%,
    color-mix(in srgb, var(--media-bg) 42%, transparent) 100%
  );
}
.lib-episode-copy {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-5) var(--space-4);
}
.lib-episode-number {
  margin-bottom: var(--space-0_5);
  color: var(--media-text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.lib-episode-title {
  margin-bottom: var(--space-1);
  overflow: hidden;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-episode-overview {
  display: -webkit-box;
  min-height: 3em;
  overflow: hidden;
  color: var(--media-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.lib-episode-progress {
  display: block;
  height: 4px;
  margin-top: var(--space-2);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--media-track);
}
.lib-episode-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--media-text);
}
.lib-episode-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 22px;
  margin-top: var(--space-2);
  color: var(--media-text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-episode-foot-main {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.lib-episode-date,
.lib-episode-missing {
  flex: none;
  color: var(--media-text-tertiary);
  font-size: var(--text-xs);
}

/* —— 防剧透：没看过的集剧照模糊、简介折叠，悬停 / 聚焦时显示 —— */
.lib-episode.is-spoiler .lib-episode-still,
.lib-episode.is-spoiler .lib-episode-fill {
  filter: blur(18px);
  transition: filter var(--duration-normal) var(--ease-out);
}
.lib-episode.is-spoiler .lib-episode-overview {
  display: none;
}
.lib-episode-spoiler-hint {
  min-height: 3em;
  color: var(--media-text-tertiary);
  font-size: var(--text-sm);
}
.lib-episode.is-spoiler:hover .lib-episode-still,
.lib-episode.is-spoiler:hover .lib-episode-fill,
.lib-episode.is-spoiler:focus-within .lib-episode-still,
.lib-episode.is-spoiler:focus-within .lib-episode-fill {
  filter: none;
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
    width: 280px;
    height: 280px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lib-episode-hit:hover:not(:disabled),
  .lib-episode-hit:focus-visible {
    transform: none;
  }
}
</style>
