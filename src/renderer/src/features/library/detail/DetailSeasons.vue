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
        <!-- 透明的下拉（UiSelect，原生 select 撑满整块）盖在标题上：键盘、读屏与系统菜单都现成 -->
        <UiSelect
          v-if="seasons.length > 1"
          v-model="seasonKey"
          class="lib-season-select"
          :options="seasonOptions"
          aria-label="选择季"
        />
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
          :label="hasFile(ep) ? `播放 ${ep.title}` : `${ep.title}（本地缺失）`"
          :aria-disabled="hasFile(ep) ? undefined : 'true'"
          @click="playEpisode(ep)"
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
          <span class="yb-pblur lib-episode-blur" aria-hidden="true"
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
              <span v-if="hasFile(ep)" class="lib-episode-foot-main">
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
 * 观看进度条和「▶ 45 分钟 / 看到 12:30 / 已看」+ 播出日期；缺文件的集底行只写「本地缺失」。换条目时回到默认季。
 * 防剧透（设置 ui.spoilerGuard）打开时，没看过的集剧照模糊、简介折叠，悬停或键盘聚焦时显示（use-spoiler-guard）。
 * 桌面端在标题行右侧给「检测片头片尾」（use-intro-detect）。
 */
import { computed, ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
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
