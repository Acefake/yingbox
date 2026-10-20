<template>
  <div v-if="selectedIds.length" class="amane-selection">
    <span>已选择 {{ selectedIds.length }} 部</span>
    <UiButton
      variant="primary"
      icon="download"
      label="批量刮削"
      :disabled="busy"
      @click="emit('scrape', selectedIds)"
    />
    <UiIconButton
      icon="close"
      label="取消选择"
      @click="emit('clearSelection')"
    />
  </div>
  <div v-if="films.length" class="ui-poster-grid amane-posters">
    <UiPosterCard
      v-for="film in films"
      :key="film.id"
      class="amane-poster"
      :class="{
        'is-current': currentId === film.id,
        'is-previewing': previewId === film.id,
      }"
      :title="film.title || film.number"
      :cover="cover(film)"
      :subtitle="filmSubtitle(film)"
      :rating="film.score != null ? film.score.toFixed(1) : undefined"
      @open="emit('open', film.id)"
      @pointerenter="emit('hoverEnter', film, $event)"
      @mouseleave="emit('hoverLeave')"
    >
      <template #badges>
        <span v-if="film.release" class="ui-poster-badge">{{
          film.release.slice(0, 7)
        }}</span>
        <span v-else-if="film.file_count" class="ui-poster-badge"
          >{{ film.file_count }} 个文件</span
        >
      </template>
      <template #actions>
        <UiIconButton
          class="amane-poster-check"
          :class="{ 'is-on': selectedIds.includes(film.id) }"
          icon="check"
          variant="overlay"
          size="sm"
          :active="selectedIds.includes(film.id)"
          :label="
            selectedIds.includes(film.id)
              ? `取消选择 ${film.number}`
              : `选择 ${film.number}`
          "
          @click.stop="emit('toggle', film.id)"
          @keydown.enter.stop
          @keydown.space.stop
        />
      </template>
    </UiPosterCard>
  </div>
  <div v-else class="amane-empty">
    <h2>这里还没有影片</h2>
    <p>添加媒体目录并扫描，或输入番号获取影片资料。</p>
    <UiButton
      variant="primary"
      icon="plus"
      label="添加媒体库"
      @click="emit('addLibrary')"
    />
  </div>
</template>

<script setup lang="ts">
/** 影片海报墙：多选与批量刮削、当前详情 / 悬停预览高亮、空状态。 */
import { UiButton, UiIconButton, UiPosterCard } from '@/components/ui'
import { type AmaneFilm, amaneImage } from '../../api/amane'
import { filmCoverSource, filmSubtitle } from '../../utils/film'

defineProps<{
  films: AmaneFilm[]
  selectedIds: number[]
  busy: boolean
  /** 正在看详情的影片 */
  currentId?: number
  /** 正在悬停预览的影片 */
  previewId?: number
}>()
const emit = defineEmits<{
  open: [id: number]
  toggle: [id: number]
  scrape: [ids: number[]]
  clearSelection: []
  addLibrary: []
  hoverEnter: [film: AmaneFilm, event: PointerEvent]
  hoverLeave: []
}>()

/** 海报卡的封面：优先竖版海报，没有时退到横版缩略图 */
function cover(film: AmaneFilm): string | undefined {
  const url = filmCoverSource(film)
  return url ? amaneImage(url) : undefined
}
</script>
