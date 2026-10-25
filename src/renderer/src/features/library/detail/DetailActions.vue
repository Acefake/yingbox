<template>
  <div ref="root" class="lib-actions">
    <UiIconButton
      class="lib-float-button"
      icon="more"
      variant="overlay"
      label="更多操作"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    />
    <Transition name="lib-actions-pop">
      <div
        v-if="open"
        class="lib-actions-menu yb-glass"
        role="menu"
        aria-label="更多操作"
      >
        <UiListRow
          v-for="item in items"
          :key="item.key"
          v-tooltip="item.hint"
          role="menuitem"
          class="lib-actions-item"
          :aria-disabled="item.disabled || undefined"
          :aria-busy="item.busy || undefined"
          @click="choose(item)"
        >
          <template #leading>
            <UiIcon :name="item.busy ? 'refresh' : item.icon" size="md" />
          </template>
          {{ item.label }}
        </UiListRow>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情右上角的「更多」玻璃圆钮（效果图 D-1 分享钮的位置）：点开一列管理操作，
 * 修正匹配 / 锁定匹配（番号库不显示）/ 重新获取 / 写出 NFO / 整理…，可用条件与原来的图标按钮一致：
 * 重新获取、锁定、写出 NFO 要已有匹配，写出 NFO 与整理要写出功能可用（不可用时悬停说明原因）。
 * 不可用的项只标 aria-disabled、点击时拦下，不用原生 disabled：浏览器不给禁用控件派发指针事件，
 * 悬停说明就出不来，键盘也到不了。
 * 选一项或点外面、按 Esc 收起；进行中的操作图标转圈。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { useEscapeLayer } from '@/composables/use-escape-layer'

import { WRITER_UNAVAILABLE } from '../writer/use-writer'

type ActionKey = 'fix-match' | 'toggle-lock' | 'refresh' | 'write' | 'organize'

const props = defineProps<{
  node: LibraryItemNode
  /** 番号库条目：不显示锁定（只认 TMDB 匹配） */
  jav: boolean
  /** 已有匹配：重新获取 / 锁定 / 写出 NFO 才可用 */
  matched: boolean
  /** 进行中的操作（lock / refresh / write），null 表示空闲 */
  busy: string | null
  writerAvailable: boolean
}>()
const emit = defineEmits<{
  'fix-match': [itemId: number]
  'toggle-lock': []
  refresh: []
  write: []
  organize: [itemIds: number[]]
}>()

interface ActionItem {
  key: ActionKey
  label: string
  icon: IconName
  disabled: boolean
  busy: boolean
  hint: string
}

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const items = computed<ActionItem[]>(() => {
  const locked = props.node.matchState === 'locked'
  const writerHint = props.writerAvailable ? '' : WRITER_UNAVAILABLE
  const list: ActionItem[] = [
    {
      key: 'fix-match',
      label: '修正匹配',
      icon: 'wand',
      disabled: false,
      busy: false,
      hint: '',
    },
  ]
  if (!props.jav) {
    list.push({
      key: 'toggle-lock',
      label: locked ? '解除锁定' : '锁定匹配',
      icon: locked ? 'lock' : 'pin',
      disabled: !props.matched,
      busy: props.busy === 'lock',
      hint: '',
    })
  }
  list.push(
    {
      key: 'refresh',
      label: '重新获取',
      icon: 'refresh',
      disabled: !props.matched,
      busy: props.busy === 'refresh',
      hint: '',
    },
    {
      key: 'write',
      label: '写出 NFO',
      icon: 'save',
      disabled: !props.writerAvailable || !props.matched,
      busy: props.busy === 'write',
      hint: writerHint,
    },
    {
      key: 'organize',
      label: '整理…',
      icon: 'folder',
      disabled: !props.writerAvailable,
      busy: false,
      hint: writerHint,
    }
  )
  return list
})

function choose(item: ActionItem): void {
  if (item.busy || item.disabled) return
  const { key } = item
  open.value = false
  if (key === 'fix-match') emit('fix-match', props.node.id)
  else if (key === 'toggle-lock') emit('toggle-lock')
  else if (key === 'refresh') emit('refresh')
  else if (key === 'write') emit('write')
  else emit('organize', [props.node.id])
}

useEscapeLayer(
  () => open.value,
  () => (open.value = false)
)

/** 点菜单外面收起 */
function onPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

watch(open, value => {
  if (value) document.addEventListener('pointerdown', onPointerDown, true)
  else document.removeEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() =>
  document.removeEventListener('pointerdown', onPointerDown, true)
)
watch(
  () => props.node.id,
  () => (open.value = false)
)
</script>

<style scoped>
.lib-actions {
  position: relative;
}
.lib-actions-menu {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 188px;
  padding: var(--space-1_5);
  border-radius: var(--radius-xl);
  color: var(--text-primary);
}
.lib-actions-item {
  gap: var(--space-2_5);
  height: 36px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  color: inherit;
  font-size: var(--text-sm);
  transition: background var(--duration-fast) ease;
}
.lib-actions-item .app-icon {
  color: var(--text-secondary);
}
.lib-actions-item:hover:not([aria-disabled='true']),
.lib-actions-item:focus-visible {
  background: var(--bg-active-soft);
}
.lib-actions-item[aria-disabled='true'] {
  color: var(--text-quaternary);
  cursor: default;
}
.lib-actions-item[aria-disabled='true']:hover {
  background: none;
}
.lib-actions-item[aria-disabled='true'] .app-icon {
  color: var(--text-quaternary);
}
.lib-actions-item[aria-busy='true'] .app-icon {
  animation: lib-actions-spin var(--duration-spin) linear infinite;
}
@keyframes lib-actions-spin {
  to {
    transform: rotate(1turn);
  }
}
.lib-actions-pop-enter-active,
.lib-actions-pop-leave-active {
  transition:
    opacity var(--duration-fast) ease,
    transform var(--duration-fast) var(--ease-out);
}
.lib-actions-pop-enter-from,
.lib-actions-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
