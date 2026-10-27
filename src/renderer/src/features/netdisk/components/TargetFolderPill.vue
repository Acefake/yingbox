<template>
  <div ref="root" class="target-pill">
    <UiButton
      v-tooltip="folderLabel(folder)"
      class="target-pill-trigger"
      :class="{ 'is-open': open }"
      :variant="variant"
      :size="size"
      icon="folder"
      aria-haspopup="true"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="target-pill-text">{{ prefix }}：{{ text }}</span>
      <UiIcon name="chevronDown" size="sm" />
    </UiButton>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="target-pill-panel"
        :style="place"
        role="dialog"
        :aria-label="`${prefix}哪个 115 文件夹`"
      >
        <template v-if="view === 'menu'">
          <template v-if="presets.length">
            <span class="target-pill-heading">默认目录</span>
            <UiListRow
              v-for="preset in presets"
              :key="preset.key"
              :selected="active === preset.key"
              role="menuitemradio"
              :aria-checked="active === preset.key"
              @click="pickPreset(preset.key)"
            >
              <template #leading
                ><UiIcon :name="preset.icon" size="sm"
              /></template>
              {{ preset.label }}
              <template #description>{{ folderLabel(preset.folder) }}</template>
              <template v-if="active === preset.key" #trailing>
                <UiIcon name="check" size="sm" />
              </template>
            </UiListRow>
          </template>
          <template v-if="recent.length">
            <span class="target-pill-heading">最近使用</span>
            <UiListRow
              v-for="item in recent"
              :key="item.cid"
              :selected="!active && item.cid === folder.cid"
              role="menuitemradio"
              :aria-checked="!active && item.cid === folder.cid"
              @click="pickFolder(item)"
            >
              <template #leading><UiIcon name="history" size="sm" /></template>
              {{ folderLabel(item) }}
            </UiListRow>
          </template>
          <UiListRow class="target-pill-browse" @click="view = 'browse'">
            <template #leading><UiIcon name="folder" size="sm" /></template>
            浏览 115 文件夹…
          </UiListRow>
        </template>
        <template v-else>
          <div class="target-pill-browse-head">
            <UiIconButton
              size="sm"
              icon="back"
              label="返回"
              @click="view = 'menu'"
            />
            <span class="target-pill-heading">选择文件夹</span>
          </div>
          <FolderTree
            class="target-pill-tree"
            :selected-cid="active ? undefined : folder.cid"
            @select="pickFolder"
          />
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 转存目标胶囊：按钮上写「存到：电影」，点开是挂在下方的玻璃面板（与浏览页筛选胶囊同一套面板样式）：
 * 「默认目录」（如电影 / 剧集默认目录，当前的打勾）、「最近使用」（最多 5 个，见 recent-folders.ts）、
 * 「浏览 115 文件夹…」切到目录树（FolderTree，懒加载）。选中即生效并关上面板，不另弹确认；
 * 从最近使用或目录树选的文件夹记进最近使用。点外面、页面滚动、窗口失焦或 Esc（useEscapeLayer）关上。
 * 面板挂到 body、按胶囊位置 fixed 定位（下方放不下时翻到上方）：Hero（overflow 隐藏）与设置面板的滚动区都不会把它裁掉。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import {
  type TargetFolder,
  folderLabel,
} from '../../../../../shared/netdisk/target-folder'

import {
  readRecentFolders,
  rememberRecentFolder,
} from '../utils/recent-folders'
import type { FolderPick, FolderPreset } from '../utils/transfer-target'
import FolderTree from './FolderTree.vue'

const props = withDefaults(
  defineProps<{
    /** 当前生效的文件夹 */
    folder: TargetFolder
    presets?: FolderPreset[]
    /** 当前用的是哪个默认目录；null = 单独选了文件夹 */
    active?: string | null
    prefix?: string
    variant?: 'secondary' | 'glass' | 'plain'
    size?: 'sm' | 'md' | 'lg'
    /** 面板贴左还是贴右展开 */
    align?: 'left' | 'right'
    disabled?: boolean
  }>(),
  {
    presets: () => [],
    active: null,
    prefix: '存到',
    variant: 'secondary',
    size: 'md',
    align: 'left',
  }
)
const emit = defineEmits<{ pick: [pick: FolderPick] }>()

const open = ref(false)
const view = ref<'menu' | 'browse'>('menu')
const recent = ref<TargetFolder[]>([])
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
/** 面板位置（打开时按胶囊的位置算） */
const place = ref<Record<string, string>>({})

const text = computed(() => {
  const preset = props.presets.find(p => p.key === props.active)
  return preset ? preset.label : folderLabel(props.folder)
})

useEscapeLayer(() => open.value, close)

const inside = (target: EventTarget | null): boolean =>
  !!root.value?.contains(target as Node) ||
  !!panel.value?.contains(target as Node)

function onPointerDown(event: PointerEvent): void {
  if (!inside(event.target)) close()
}

/** 页面滚动时关上（面板里目录树自己的滚动不算） */
function onScroll(event: Event): void {
  if (!inside(event.target)) close()
}

function close(): void {
  if (!open.value) return
  open.value = false
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
}

/** 面板贴在胶囊下方（下面放不下且上面更宽时翻到上方），左对齐或右对齐，高度不超过可用空间 */
function measure(): void {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  const gap = 8
  const below = window.innerHeight - rect.bottom - gap * 2
  const above = rect.top - gap * 2
  const up = below < 320 && above > below
  place.value = {
    ...(up
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
    ...(props.align === 'right'
      ? { right: `${window.innerWidth - rect.right}px` }
      : { left: `${rect.left}px` }),
    maxHeight: `${Math.min(440, up ? above : below)}px`,
  }
}

function toggle(): void {
  if (open.value) return close()
  recent.value = readRecentFolders()
  view.value = 'menu'
  measure()
  open.value = true
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
}

function pickPreset(key: string): void {
  close()
  emit('pick', { preset: key })
}

function pickFolder(folder: TargetFolder): void {
  recent.value = rememberRecentFolder(folder)
  close()
  emit('pick', { folder: { cid: folder.cid, name: folder.name } })
}

onBeforeUnmount(close)
</script>

<style scoped>
.target-pill {
  position: relative;
  display: inline-flex;
  flex: none;
  min-width: 0;
}
.target-pill-trigger {
  max-width: 260px;
}
.target-pill-trigger :deep(span:not(.target-pill-text)) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}
.target-pill-trigger.is-open {
  box-shadow: var(--focus-ring);
}
.target-pill-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.target-pill-panel {
  position: fixed;
  z-index: var(--z-dialog);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  box-sizing: border-box;
  width: 300px;
  max-width: 80vw;
  overflow-y: auto;
  padding: var(--space-3);
  border-radius: var(--radius-xl);
  background: var(--menu-bg);
  box-shadow: var(--glass-shadow);
  color: var(--text-primary);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
.target-pill-heading {
  padding: var(--space-2) var(--space-3) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  letter-spacing: 0.1em;
}
.target-pill-browse {
  margin-top: var(--space-1);
}
.target-pill-browse-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.target-pill-browse-head .target-pill-heading {
  padding: 0;
}
</style>
