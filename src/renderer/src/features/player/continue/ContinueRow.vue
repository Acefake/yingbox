<template>
  <UiShelf
    v-if="items.length"
    class="cw-row"
    :title="title"
    :more="Boolean(onMore)"
    :more-label="moreLabel"
    @more="emit('more')"
  >
    <UiEpisodeCard
      v-for="record in items"
      :key="record.id"
      class="cw-card"
      :title="record.title"
      :subtitle="subtitleOf(record, now)"
      :image="record.cover"
      :progress="record.nextUp ? null : progressRatio(record)"
      :foot="footOf(record)"
      foot-icon="play"
      :label="`继续播放 ${record.title}`"
      menu-label="更多操作"
      @open="play(record)"
      @menu="openMenu($event, record)"
    />

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuEl"
        class="cw-menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @contextmenu.prevent
      >
        <UiListRow role="menuitem" @click="pick(r => play(r))">
          {{ resumeLabel(menu.record) }}
        </UiListRow>
        <UiListRow
          v-if="!menu.record.nextUp"
          role="menuitem"
          @click="pick(r => play(r, true))"
        >
          从头播放
        </UiListRow>
        <UiListRow
          v-if="canOpenDetail"
          role="menuitem"
          @click="pick(r => emit('detail', r))"
        >
          打开详情
        </UiListRow>
        <hr class="cw-menu-sep" />
        <UiListRow role="menuitem" @click="pick(r => finishContinue(r.id))">
          标记为已看完
        </UiListRow>
        <UiListRow
          role="menuitem"
          class="cw-menu-danger"
          @click="pick(r => removeContinue(r.id))"
        >
          从继续播放中移除
        </UiListRow>
      </div>
    </Teleport>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 板块顶部的「继续观看」一排（UiShelf + UiEpisodeCard）：横版剧照卡，渐进模糊上压片名、集数、进度条和剩余时间，
 * 看完一集指向下一集。
 *
 * - 每个板块只列自己的记录（section，首页传几个板块合并），没有记录时整块不渲染；
 * - 页面监听 more 时标题带 ›（如首页跳到「最近播放」）；
 * - 点卡片默认按记录里的载荷重新打开播放器并续播；板块有自己的续播方式（地址会过期的源）时传 resume；
 * - 右键或卡片上的 … 弹菜单：继续播放 / 从头播放 / 打开详情（页面监听 detail 才有）/ 标记已看完 / 移除。
 * 记录与规则见 continue-store.ts / continue-rules.ts。
 */
import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'

import { toast } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import UiEpisodeCard from '@/components/ui/UiEpisodeCard.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import { openMediaPlayer } from '../composables/use-media-player'
import {
  type ContinueRecord,
  type ContinueSection,
  clock,
  footOf,
  metaOf,
  progressRatio,
  recordsFor,
  replayOptions,
  subtitleOf,
} from './continue-rules'
import {
  continueRecords,
  finishContinue,
  removeContinue,
} from './continue-store'

const props = withDefaults(
  defineProps<{
    section: ContinueSection | readonly ContinueSection[]
    /** 板块自己的续播（返回 false 表示没打开）；不给就按记录的载荷直接打开播放器 */
    resume?: (record: ContinueRecord, fromStart: boolean) => Promise<boolean>
    title?: string
    /** 标题可点时的无障碍名称 */
    moreLabel?: string
  }>(),
  { resume: undefined, title: '继续观看', moreLabel: undefined }
)
const emit = defineEmits<{ detail: [record: ContinueRecord]; more: [] }>()

const records = continueRecords()
const items = computed(() => recordsFor(records.value, props.section))
const listeners = getCurrentInstance()?.vnode.props
const canOpenDetail = Boolean(listeners?.onDetail)
const onMore = listeners?.onMore
/** 「上次 x 分钟前」的基准时间：列表变化时刷新 */
const now = ref(Date.now())
watch(items, () => (now.value = Date.now()))

// —— 播放 ——
async function play(record: ContinueRecord, fromStart = false): Promise<void> {
  const ok = props.resume
    ? await props.resume(record, fromStart)
    : await openMediaPlayer({
        ...replayOptions(record),
        ...(fromStart ? { startAt: 0 } : {}),
        continueAs: metaOf(record),
      })
  if (!ok) toast.error('无法打开播放器')
}

function resumeLabel(record: ContinueRecord): string {
  if (record.nextUp) return '播放下一集'
  return record.progress > 0
    ? `继续播放 · ${clock(record.progress)}`
    : '继续播放'
}

// —— 右键菜单 ——
const menu = ref<{ x: number; y: number; record: ContinueRecord } | null>(null)
const menuEl = ref<HTMLElement | null>(null)
useEscapeLayer(() => menu.value !== null, closeMenu)

function closeMenu(): void {
  menu.value = null
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('blur', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
}

function onOutside(event: PointerEvent): void {
  if (!menuEl.value?.contains(event.target as Node)) closeMenu()
}

async function openMenu(
  event: MouseEvent,
  record: ContinueRecord
): Promise<void> {
  closeMenu()
  menu.value = { x: event.clientX, y: event.clientY, record }
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('blur', closeMenu)
  window.addEventListener('scroll', closeMenu, true)
  // 贴着右 / 下边缘时往回收
  await nextTick()
  const el = menuEl.value
  if (!el || !menu.value) return
  const { width, height } = el.getBoundingClientRect()
  menu.value = {
    ...menu.value,
    x: Math.min(menu.value.x, window.innerWidth - width - 8),
    y: Math.min(menu.value.y, window.innerHeight - height - 8),
  }
}

function pick(action: (record: ContinueRecord) => unknown): void {
  const record = menu.value?.record
  closeMenu()
  if (record) void action(record)
}

onBeforeUnmount(closeMenu)
</script>

<style src="./continue-row.css"></style>
