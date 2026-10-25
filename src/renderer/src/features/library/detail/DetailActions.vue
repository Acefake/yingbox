<template>
  <!-- 管理操作：Hero 操作行下面一排 icon + 文字的玻璃次级按钮 -->
  <div class="lib-actions" role="group" aria-label="管理">
    <span
      v-for="item in items"
      :key="item.key"
      v-tooltip="item.hint"
      class="lib-actions-slot"
    >
      <UiButton
        class="lib-actions-button"
        variant="glass"
        size="sm"
        :icon="item.icon"
        :label="item.label"
        :loading="item.busy"
        :disabled="item.disabled"
        @click="choose(item)"
      />
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情的管理操作（放在 DetailHero 操作行下面）：一排 icon + 文字的玻璃次级按钮，
 * 修正匹配 / 锁定匹配（番号库不显示）/ 重新获取 / 写出 NFO / 整理…。可用条件：
 * 重新获取、锁定、写出 NFO 要已有匹配，写出 NFO 与整理要写出功能可用。
 * 不可用的按钮外面包一层 span 挂悬停说明（禁用的按钮本身收不到指针事件）；进行中的操作转圈。
 */
import { computed } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import type { IconName } from '@/components/ui/icons'
import UiButton from '@/components/ui/UiButton.vue'
import { vTooltip } from '@/components/ui/tooltip'

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
  if (key === 'fix-match') emit('fix-match', props.node.id)
  else if (key === 'toggle-lock') emit('toggle-lock')
  else if (key === 'refresh') emit('refresh')
  else if (key === 'write') emit('write')
  else emit('organize', [props.node.id])
}
</script>

<style scoped>
.lib-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: calc(var(--space-2) * -1) 0 var(--space-5);
}
.lib-actions-slot {
  display: inline-flex;
}
/* 不可用：不叠加按钮基类的半透明，只把字和图标压成四级灰，玻璃底保持完整，画面上仍看得清是哪一项 */
.lib-actions-button.ui-button:disabled {
  color: var(--text-quaternary);
  opacity: 1;
  cursor: default;
}
</style>
