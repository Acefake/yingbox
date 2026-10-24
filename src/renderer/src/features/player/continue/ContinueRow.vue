<template>
  <section v-if="items.length" class="cw-row" aria-label="继续播放">
    <header class="cw-head">
      <h2 class="cw-title">继续播放</h2>
      <div class="cw-nav">
        <span class="cw-count">{{ items.length }} 部</span>
        <UiIconButton
          icon="back"
          label="向左滚动"
          size="sm"
          variant="secondary"
          :disabled="atStart"
          @click="scrollBy(-1)"
        />
        <UiIconButton
          icon="forward"
          label="向右滚动"
          size="sm"
          variant="secondary"
          :disabled="atEnd"
          @click="scrollBy(1)"
        />
      </div>
    </header>

    <div ref="track" class="cw-track" @scroll.passive="syncEdges">
      <article
        v-for="record in items"
        :key="record.id"
        class="cw-card"
        @contextmenu.prevent="openMenu($event, record)"
      >
        <UiPressable
          block
          class="cw-thumb"
          :label="`继续播放 ${record.title}`"
          @click="play(record)"
        >
          <img
            v-if="record.cover && !broken.has(record.id)"
            :src="record.cover"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="broken.add(record.id)"
          />
          <span v-else class="cw-placeholder"
            ><UiIcon name="movie" size="lg"
          /></span>
          <span class="cw-play" aria-hidden="true"
            ><UiIcon name="play" filled
          /></span>
          <span v-if="record.nextUp" class="cw-next">{{
            record.episode ? `下一集 ${record.episode}` : '下一集'
          }}</span>
          <span v-else-if="remainingLabel(record)" class="cw-left">{{
            remainingLabel(record)
          }}</span>
          <span class="cw-progress" aria-hidden="true"
            ><i :style="{ width: `${progressRatio(record) * 100}%` }"
          /></span>
        </UiPressable>
        <UiIconButton
          class="cw-remove"
          icon="close"
          label="从继续播放中移除"
          size="sm"
          variant="overlay"
          @click="removeContinue(record.id)"
        />
        <div class="cw-meta">
          <h3 class="cw-name" :title="record.title">{{ record.title }}</h3>
          <p class="cw-sub">{{ subtitleOf(record, now) }}</p>
        </div>
      </article>
    </div>

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
  </section>
</template>

<script setup lang="ts">
/**
 * 板块顶部的「继续播放」横排：16:9 卡片、进度条、剩余时间，悬停出播放键和移除，看完一集指向下一集。
 *
 * - 每个板块只列自己的记录（section），没有记录时整块不渲染；
 * - 点卡片默认按记录里的载荷重新打开播放器并续播；板块有自己的续播方式（地址会过期的源）时传 resume；
 * - 右键菜单：继续播放 / 从头播放 / 打开详情（页面监听 detail 才有）/ 标记已看完 / 移除。
 * 记录与规则见 continue-store.ts / continue-rules.ts。
 */
import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from 'vue'

import { toast } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import UiPressable from '@/components/ui/UiPressable.vue'

import { openMediaPlayer } from '../composables/use-media-player'
import {
  type ContinueRecord,
  type ContinueSection,
  clock,
  metaOf,
  progressRatio,
  recordsFor,
  remainingLabel,
  replayOptions,
  subtitleOf,
} from './continue-rules'
import {
  continueRecords,
  finishContinue,
  removeContinue,
} from './continue-store'

const props = defineProps<{
  section: ContinueSection
  /** 板块自己的续播（返回 false 表示没打开）；不给就按记录的载荷直接打开播放器 */
  resume?: (record: ContinueRecord, fromStart: boolean) => Promise<boolean>
}>()
const emit = defineEmits<{ detail: [record: ContinueRecord] }>()

const records = continueRecords()
const items = computed(() => recordsFor(records.value, props.section))
const canOpenDetail = Boolean(getCurrentInstance()?.vnode.props?.onDetail)

/** 封面加载失败的记录 */
const broken = reactive(new Set<string>())
/** 「上次 x 分钟前」的基准时间：列表变化时刷新 */
const now = ref(Date.now())
watch(items, () => (now.value = Date.now()))

// —— 横向滚动 ——
const track = ref<HTMLElement | null>(null)
const atStart = ref(true)
const atEnd = ref(true)

function syncEdges(): void {
  const el = track.value
  if (!el) return
  atStart.value = el.scrollLeft <= 1
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
}

watch(items, () => nextTick(syncEdges), { immediate: true })

function scrollBy(direction: 1 | -1): void {
  const el = track.value
  if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8 })
}

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
