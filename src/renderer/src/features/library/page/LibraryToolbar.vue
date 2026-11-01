<template>
  <!-- 页头：大标题（番号页带视图切换）、右侧操作按钮；下面是待确认提示。筛选与排序在海报墙上方的「全部」一段 -->
  <header class="lib-toolbar">
    <div class="lib-toolbar-head">
      <div class="lib-toolbar-title">
        <h1>{{ kindLabel }}</h1>
        <UiSegmented
          v-if="showSwitch"
          class="lib-toolbar-switch"
          size="sm"
          :model-value="view === 'actors' ? 'actors' : 'wall'"
          label="视图"
          :options="viewOptions"
          @update:model-value="view = $event"
        />
      </div>
      <div v-if="actions.length" class="lib-toolbar-tools">
        <UiIconButton
          v-for="key in actions"
          :key="key"
          variant="glass"
          :icon="ACTIONS[key].icon"
          :label="ACTIONS[key].label"
          @click="run(key)"
        />
      </div>
    </div>
    <ReviewHint
      v-if="hasLibraries && view !== 'actors'"
      v-model:view="view"
      :count="reviewCount ?? 0"
    />
    <VisualSearch
      v-if="visualLibrary !== undefined"
      v-model:open="visualOpen"
      :library-id="visualLibrary"
      @open-item="id => ((visualOpen = false), emit('open-item', id))"
    />
  </header>
</template>

<script setup lang="ts">
/**
 * 媒体库页头（Apple TV 式）：大标题，右侧是扫描、识别、按画面搜（番号页）、视频墙几个玻璃圆钮（悬停显示名称），
 * 摆放规则见 page-rules.ts toolbarActions。视图切换（资料库 / 演员，番号页才有）在标题旁，标题下方是待确认提示。
 *
 * 页头不放筛选：排序、匹配状态、文件夹与类型胶囊在海报墙上方的「全部」一段（WallHeader），
 * 排在继续观看、想看之后；媒体库设置在「设置 → 媒体库」。搜索用顶栏全局搜索（按 ?q= 在本页过滤）。
 */
import { computed, ref } from 'vue'

import type { IconName } from '@/components/ui/icons'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import VisualSearch from '../visual/VisualSearch.vue'
import { type ToolbarAction, toolbarActions } from './page-rules'
import ReviewHint from './ReviewHint.vue'

/** 页面视图。 */
export type LibraryView = 'wall' | 'actors' | 'review'

const props = defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 为还不知道（没有条目时不出视频墙）。 */
  count: number | null
  hasLibraries: boolean
  viewOptions: SegmentedOption<LibraryView>[]
  /** 待确认条目数（标题下的提示） */
  reviewCount?: number
  /** 按画面搜的范围（番号页的媒体库 id，null 为全部）；不传表示该分区没有按画面搜。 */
  visualLibrary?: number | null
}>()

const view = defineModel<LibraryView>('view', { required: true })
const visualOpen = ref(false)

const emit = defineEmits<{
  scan: []
  identify: []
  'video-wall': []
  /** 按画面搜的结果里点开一部。 */
  'open-item': [itemId: number]
}>()

const showSwitch = computed(
  () => props.hasLibraries && props.viewOptions.length > 1
)

const actions = computed(() =>
  toolbarActions({
    view: view.value,
    hasLibraries: props.hasLibraries,
    count: props.count,
    facets: props.visualLibrary !== undefined,
  })
)

/** 每个操作的图标与名称（名称是无障碍名称，也是悬停提示）。 */
const ACTIONS: Record<ToolbarAction, { icon: IconName; label: string }> = {
  scan: { icon: 'refresh', label: '扫描文件夹' },
  identify: { icon: 'sparkle', label: '识别未匹配的条目' },
  visual: { icon: 'image', label: '按画面搜' },
  'video-wall': { icon: 'grid', label: '视频墙' },
}

function run(action: ToolbarAction): void {
  if (action === 'visual') visualOpen.value = true
  else if (action === 'scan') emit('scan')
  else if (action === 'identify') emit('identify')
  else emit('video-wall')
}
</script>

<style scoped src="./library-toolbar.css"></style>
