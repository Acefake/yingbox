<template>
  <section v-if="items.length" class="wl-row" aria-label="想看">
    <header class="wl-head">
      <h2 class="wl-title">想看</h2>
      <div class="wl-nav">
        <span class="wl-count">{{ all.length }} 部</span>
        <UiButton
          v-if="hidden > 0 || expanded"
          class="wl-toggle"
          size="sm"
          variant="plain"
          :aria-expanded="expanded"
          @click="toggleExpanded"
        >
          {{ expanded ? '收起' : '查看全部' }}
        </UiButton>
        <template v-if="!expanded">
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
        </template>
      </div>
    </header>

    <div
      ref="track"
      class="wl-track"
      :class="{ 'is-grid': expanded }"
      @scroll.passive="syncEdges"
    >
      <article
        v-for="entry in items"
        :key="entry.id"
        class="wl-card"
        @contextmenu.prevent="openMenu($event, entry)"
      >
        <UiPressable
          block
          class="wl-thumb"
          :label="`打开 ${entry.title} 详情`"
          @click="open(entry)"
        >
          <img
            v-if="entryImage(entry) && !broken.has(entry.id)"
            :src="entryImage(entry)"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="broken.add(entry.id)"
          />
          <span v-else class="wl-placeholder"
            ><UiIcon name="bookmark" size="lg"
          /></span>
        </UiPressable>
        <UiIconButton
          class="wl-remove"
          icon="close"
          label="从想看中移除"
          size="sm"
          variant="overlay"
          @click="removeFromWatchlist(entry.id)"
        />
        <h3 class="wl-name" :title="entry.title">{{ entry.title }}</h3>
      </article>
      <article v-if="!expanded && hidden > 0" class="wl-card wl-more">
        <UiPressable
          block
          class="wl-thumb wl-more-thumb"
          :label="`查看全部 ${all.length} 部想看`"
          @click="toggleExpanded"
        >
          <span class="wl-more-body">
            <UiIcon name="grid" size="lg" />
            <span>查看全部</span>
            <span class="wl-more-count">还有 {{ hidden }} 部</span>
          </span>
        </UiPressable>
      </article>
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuEl"
        class="wl-menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @contextmenu.prevent
      >
        <UiListRow role="menuitem" @click="pick(open)">打开详情</UiListRow>
        <hr class="wl-menu-sep" />
        <UiListRow
          role="menuitem"
          class="wl-menu-danger"
          @click="pick(removeEntry)"
        >
          从想看中移除
        </UiListRow>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
/**
 * 板块顶部的「想看」横排（放在「继续播放」下面）：竖版海报卡片，悬停出移除，点卡打开详情。
 *
 * - 每个板块只列自己的条目（section），没有条目时整块不渲染；
 * - 点卡片 emit open，由页面打开详情（在线是详情条目，媒体库是 { itemId }）；
 * - 右键菜单：打开详情 / 从想看中移除；
 * - 横排只放前 WATCHLIST_ROW_LIMIT 张，标题行计数是本板块真实总数；超出时标题行与横排末尾
 *   有「查看全部」，展开成换行的完整列表（再点「收起」回到横排）。
 * 视觉沿用 ContinueRow（标题行、左右滚动、右键菜单），条目与规则见 watchlist-store.ts / watchlist-rules.ts。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'

import { useEscapeLayer } from '@/composables/use-escape-layer'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import UiPressable from '@/components/ui/UiPressable.vue'

import {
  type WatchlistEntry,
  type WatchlistSection,
  entriesFor,
  entryImage,
  hiddenCount,
  visibleEntries,
} from './watchlist-rules'
import { removeFromWatchlist, watchlistEntries } from './watchlist-store'

const props = defineProps<{ section: WatchlistSection }>()
const emit = defineEmits<{ open: [entry: WatchlistEntry] }>()

const entries = watchlistEntries()
/** 本板块全部条目；横排渲染 items（收起时截前 WATCHLIST_ROW_LIMIT 条） */
const all = computed(() => entriesFor(entries.value, props.section))
const expanded = ref(false)
const items = computed(() => visibleEntries(all.value, expanded.value))
const hidden = computed(() => hiddenCount(all.value))

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

/** 封面加载失败的条目 */
const broken = reactive(new Set<string>())

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

function open(entry: WatchlistEntry): void {
  emit('open', entry)
}

function removeEntry(entry: WatchlistEntry): void {
  removeFromWatchlist(entry.id)
}

// —— 右键菜单 ——
const menu = ref<{ x: number; y: number; entry: WatchlistEntry } | null>(null)
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
  entry: WatchlistEntry
): Promise<void> {
  closeMenu()
  menu.value = { x: event.clientX, y: event.clientY, entry }
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

function pick(action: (entry: WatchlistEntry) => void): void {
  const entry = menu.value?.entry
  closeMenu()
  if (entry) action(entry)
}

onBeforeUnmount(closeMenu)
</script>

<style src="./watchlist-row.css"></style>
