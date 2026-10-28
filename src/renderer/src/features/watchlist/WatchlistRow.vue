<template>
  <template v-if="pane && active">
    <UiPosterCard
      v-for="entry in all"
      :key="entry.id"
      class="wl-card"
      role="listitem"
      thumb
      :title="entry.title"
      :cover="entryImage(entry) || undefined"
      @open="open(entry)"
      @contextmenu.prevent="openMenu($event, entry)"
    >
      <template #actions>
        <UiIconButton
          class="wl-remove"
          icon="close"
          label="从想看中移除"
          size="sm"
          variant="overlay"
          @click.stop="removeFromWatchlist(entry.id)"
        />
      </template>
    </UiPosterCard>
  </template>
  <UiShelf
    v-else-if="!pane && items.length"
    v-bind="$attrs"
    class="wl-row"
    title="想看"
    kind="portrait"
    :grid="expanded"
  >
    <template #actions>
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
    </template>
    <UiPosterCard
      v-for="entry in items"
      :key="entry.id"
      class="wl-card"
      thumb
      :title="entry.title"
      :cover="entryImage(entry) || undefined"
      @open="open(entry)"
      @contextmenu.prevent="openMenu($event, entry)"
    >
      <template #actions>
        <UiIconButton
          class="wl-remove"
          icon="close"
          label="从想看中移除"
          size="sm"
          variant="overlay"
          @click.stop="removeFromWatchlist(entry.id)"
        />
      </template>
    </UiPosterCard>
    <article v-if="!expanded && hidden > 0" class="wl-card wl-more">
      <UiPressable
        block
        class="wl-more-thumb"
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
  </UiShelf>

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
 * 一排与标题用 UiShelf（超出时标题行出左右滚动键），卡片是 UiPosterCard；条目与规则见 watchlist-store.ts / watchlist-rules.ts。
 * pane 时只输出卡片（首页「我的动态」的「待看」）：active 为假时不画卡，数量仍通过 count 报出。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useEscapeLayer } from '@/composables/use-escape-layer'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import {
  type WatchlistEntry,
  type WatchlistSection,
  entriesFor,
  entryImage,
  hiddenCount,
  visibleEntries,
} from './watchlist-rules'
import { removeFromWatchlist, watchlistEntries } from './watchlist-store'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    section: WatchlistSection
    /** 只输出卡片，不包货架（首页「我的动态」） */
    pane?: boolean
    /** pane 时是否画出卡片；为假仍统计数量 */
    active?: boolean
  }>(),
  { active: true }
)
const emit = defineEmits<{
  open: [entry: WatchlistEntry]
  count: [n: number]
}>()

const entries = watchlistEntries()
/** 本板块全部条目；横排渲染 items（收起时截前 WATCHLIST_ROW_LIMIT 条） */
const all = computed(() => entriesFor(entries.value, props.section))
const expanded = ref(false)
const items = computed(() => visibleEntries(all.value, expanded.value))
const hidden = computed(() => hiddenCount(all.value))
watch(all, list => emit('count', list.length), { immediate: true })

function toggleExpanded(): void {
  expanded.value = !expanded.value
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
