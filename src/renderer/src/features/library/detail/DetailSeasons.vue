<template>
  <!-- 剧集：季名做标题（多季时可下拉切换），16:9 剧照卡横排（UiShelf 翻页键 / 滚轮 / ← →），文字在卡下 -->
  <section class="lib-section lib-seasons">
    <UiShelf
      :title="currentSeason ? seasonName(currentSeason) : '剧集'"
      class="lib-episodes-shelf"
      list
    >
      <template #title>
        <div
          class="lib-season-pick"
          :class="{ 'is-multi': seasons.length > 1 }"
        >
          <h2 class="lib-section-title">
            {{ currentSeason ? seasonName(currentSeason) : '剧集'
            }}<UiIcon
              v-if="seasons.length > 1"
              class="lib-season-caret"
              name="chevronDown"
              size="md"
            />
          </h2>
          <!-- 透明的下拉（UiSelect，原生 select 撑满整块）盖在标题上：键盘、读屏与系统菜单都现成 -->
          <UiSelect
            v-if="seasons.length > 1"
            v-model="seasonKey"
            class="lib-season-select"
            :options="seasonOptions"
            aria-label="选择季"
          />
        </div>
      </template>
      <template v-if="detectVisible" #actions>
        <span v-tooltip="detectBlocked" class="lib-season-detect">
          <UiButton
            size="sm"
            :variant="detectRunning ? 'secondary' : 'plain'"
            icon="scan"
            :label="detectLabel"
            :disabled="!detectRunning && !!detectBlocked"
            @click="toggleDetect"
          />
        </span>
      </template>
      <template v-if="seasonOverview" #intro>
        <p class="lib-season-overview">{{ seasonOverview }}</p>
      </template>
      <div
        v-for="ep in episodes"
        :key="ep.id"
        role="listitem"
        class="lib-episode"
        :class="{
          'is-missing': !hasFile(ep),
          'is-spoiler': spoilerIds.has(ep.id),
        }"
      >
        <UiPressable
          block
          class="lib-episode-hit"
          :label="
            hasFile(ep)
              ? `播放 ${episodeLabel(ep)}`
              : `${episodeLabel(ep)}（本地缺失）`
          "
          :aria-disabled="hasFile(ep) ? undefined : 'true'"
          @click="playEpisode(ep)"
        >
          <span class="lib-episode-frame">
            <img
              v-if="ep.poster"
              class="lib-episode-still"
              :src="ep.poster"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            />
            <span v-else class="lib-episode-placeholder" aria-hidden="true"
              ><UiIcon name="tv" size="lg"
            /></span>
            <span
              v-if="hasFile(ep)"
              class="lib-episode-play yb-glass"
              aria-hidden="true"
              ><UiIcon name="play" size="sm"
            /></span>
            <span v-if="markOf(ep)?.ratio" class="lib-episode-progress"
              ><i :style="{ width: ratioWidth(markOf(ep)!.ratio) }"
            /></span>
          </span>
          <span class="lib-episode-copy">
            <span v-if="ep.episodeNumber !== null" class="lib-episode-number"
              >第 {{ ep.episodeNumber }} 集</span
            >
            <span
              class="lib-episode-title"
              :title="ep.title || episodeLabel(ep)"
              >{{ ep.title || episodeLabel(ep) }}</span
            >
            <span v-if="ep.overview" class="lib-episode-overview">{{
              ep.overview
            }}</span>
            <span
              v-if="spoilerIds.has(ep.id) && ep.overview"
              class="lib-episode-spoiler-hint"
              >未看 · 悬停显示简介</span
            >
            <span class="lib-episode-foot">
              <span v-if="!hasFile(ep)" class="lib-episode-missing"
                >本地缺失</span
              >
              <span v-else class="lib-episode-foot-main">{{
                footText(ep)
              }}</span>
              <span v-if="ep.airDate" class="lib-episode-date">{{
                ep.airDate
              }}</span>
            </span>
          </span>
        </UiPressable>
      </div>
    </UiShelf>
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的剧集区块：标题是当前季名，多季时标题旁带下拉箭头（原生下拉盖在上面），季简介，
 * 剧集卡放在 UiShelf 里横排（翻页键、鼠标滚轮、← → 都能往后翻）：上面 16:9 剧照（约 300px 宽，
 * 有文件时角上一个小播放钮，看过一部分时底边进度条），卡下是「第 N 集」、标题、两行简介和
 * 「45 分钟 / 看到 12:30 / 已看」+ 播出日期；缺文件的集写「本地缺失」。换条目时回到默认季。
 * 防剧透（设置 ui.spoilerGuard）打开时，没看过的集剧照模糊、简介折叠，悬停或键盘聚焦时显示（use-spoiler-guard）。
 * 桌面端在标题行右侧给「检测片头片尾」（use-intro-detect）。
 */
import { computed, ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import { vTooltip } from '@/components/ui/tooltip'

import { progressOf } from '../progress/progress-cache'
import { type WatchMark, itemMark, ratioWidth } from '../progress/watch-marks'
import { formatRuntime } from '../shared/format'
import { defaultSeasonKey, seasonEpisodes, seasonName } from './detail-rules'
import { episodeLabel, videoFiles } from './playback'
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

/**
 * 点剧集卡：有文件才播放。缺文件的卡不用 disabled（那样键盘到不了、聚焦时防剧透也揭不开），
 * 只标 aria-disabled 并在这里拦下。
 */
function playEpisode(ep: LibraryItemNode): void {
  if (currentSeason.value && hasFile(ep)) {
    emit('play-episode', currentSeason.value, ep)
  }
}

const markOf = (ep: LibraryItemNode): WatchMark | null =>
  itemMark(progressOf(ep.id))
/** 卡片底行（只在有文件时显示）：有观看标记时显示标记（已看 / 看到 12:30），否则显示时长 */
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
<style scoped src="./detail-seasons.css"></style>
