<template>
  <!-- 浏览胶囊一行：全部 · 未看 · 最近添加 | 常见类型 · 全部类型 ›；浮层挂在行外，不被横向滚动裁掉 -->
  <div ref="wrap" class="lib-browse">
    <div v-scroll-x class="lib-browse-row">
      <div class="lib-chips" role="group" aria-label="浏览">
        <UiChip
          v-for="o in BROWSE_OPTIONS"
          :key="o.value"
          size="md"
          :label="o.label"
          :selected="inWall && browseSelected(model, o.value)"
          @click="pickMode(o.value)"
        />
      </div>
      <template v-if="genres.length">
        <span class="lib-row-divider" aria-hidden="true" />
        <div class="lib-chips" role="group" aria-label="类型">
          <UiChip
            v-for="g in shown"
            :key="`genre-${g.value}`"
            size="md"
            :label="g.value"
            :selected="inWall && genre === g.value"
            @click="choose(g.value)"
          />
          <UiChip
            ref="moreChip"
            size="md"
            label="全部类型 ›"
            aria-haspopup="menu"
            :aria-expanded="popoverOpen"
            @click="togglePopover"
          />
        </div>
      </template>
    </div>
    <GenrePopover
      v-if="popoverOpen"
      :genres="genres"
      :selected="genre"
      :left="popoverLeft"
      :trigger="moreChipEl"
      @pick="pickFromPopover"
      @close="popoverOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 电影 / 剧集分区页头的浏览胶囊：
 * - 全部（清掉观看与类型）、未看（没看完的）、最近添加（最近 30 天，排序切到添加时间降序）；
 * - 本分区片数最多的 TOP_GENRES 个类型，选中的类型不在前几个时也会出现在行里；
 * - 「全部类型 ›」打开两列浮层（GenrePopover），每个类型后面带片数。
 * 观看与类型可以叠加；在待确认视图里点任一胶囊回到海报墙。
 * 条件经 v-model 交回页面保管（切换视图后保留）。
 */
import { computed, ref } from 'vue'

import UiChip from '@/components/ui/UiChip.vue'

import type { FacetValue } from '../../../../../shared/library/ipc'
import type { BrowseMode } from '../state/query-state'
import {
  BROWSE_OPTIONS,
  browseSelected,
  pickBrowse,
  pickGenre,
  topGenres,
} from './browse-rules'
import GenrePopover from './GenrePopover.vue'
import type { LibraryView } from './LibraryToolbar.vue'

const props = defineProps<{ genres: FacetValue[] }>()
const view = defineModel<LibraryView>('view', { required: true })
const browse = defineModel<BrowseMode>('browse', { required: true })
const genre = defineModel<string | null>('genre', { required: true })
const emit = defineEmits<{
  /** 选了「最近添加」：页面把排序切到添加时间降序。 */
  recent: []
}>()

/** 浮层的宽度（与 GenrePopover 样式一致），用于贴边时往左收。 */
const POPOVER_WIDTH = 400

const inWall = computed(() => view.value === 'wall')
const model = computed(() => ({ browse: browse.value, genre: genre.value }))
const shown = computed(() => topGenres(props.genres, genre.value))

const wrap = ref<HTMLElement | null>(null)
const moreChip = ref<{ $el: HTMLElement } | null>(null)
const moreChipEl = computed(() => moreChip.value?.$el ?? null)
const popoverOpen = ref(false)
const popoverLeft = ref(0)

function pickMode(value: BrowseMode): void {
  const next = inWall.value
    ? pickBrowse(model.value, value)
    : pickBrowse({ browse: 'all', genre: genre.value }, value)
  browse.value = next.browse
  genre.value = next.genre
  view.value = 'wall'
  if (next.browse === 'recent') emit('recent')
}

function choose(value: string): void {
  genre.value = inWall.value ? pickGenre(genre.value, value) : value
  view.value = 'wall'
}

function pickFromPopover(value: string): void {
  choose(value)
  popoverOpen.value = false
}

/** 浮层左缘对齐「全部类型」胶囊，放不下时往左收到行内。 */
function togglePopover(): void {
  if (popoverOpen.value) {
    popoverOpen.value = false
    return
  }
  const box = wrap.value?.getBoundingClientRect()
  const chip = moreChipEl.value?.getBoundingClientRect()
  if (box && chip) {
    const max = Math.max(0, box.width - POPOVER_WIDTH)
    popoverLeft.value = Math.min(Math.max(0, chip.left - box.left), max)
  }
  popoverOpen.value = true
}
</script>

<style scoped>
.lib-browse {
  position: relative;
}
.lib-browse-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  overflow-x: auto;
  scrollbar-width: none;
}
.lib-chips {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}
.lib-row-divider {
  flex: none;
  width: 1px;
  height: 20px;
  background: var(--border-glass-light);
}
</style>
