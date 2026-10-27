<template>
  <div class="netdisk-toolbar">
    <UiSegmented v-model="tab" :options="tabs" label="结果类型" />
    <template v-if="tab !== 'offline'">
      <span v-if="episode" class="netdisk-toolbar-episode">
        <UiChip :label="episode" disabled />
        <UiIconButton
          icon="close"
          label="搜整部剧"
          size="sm"
          @click="emit('clearEpisode')"
        />
      </span>
      <p v-if="notes.length" class="netdisk-toolbar-notes" role="status">
        {{ notes.join('；') }}
      </p>
      <TargetFolderPill
        v-bind="target"
        class="netdisk-toolbar-target"
        size="sm"
        align="right"
        @pick="pick => emit('pick', pick)"
      />
      <UiSelect
        v-model="sort"
        class="netdisk-toolbar-sort"
        size="sm"
        :options="SORT_OPTIONS"
        aria-label="排序"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 网盘页结果区的工具条：结果类型分段（115 分享 / 磁力 / 离线任务），看结果时右侧是来源失败说明、
 * 转存目标胶囊（与 Hero 上的共用一份选择）和排序。
 * 搜索词带集号时分段后面有一枚「第 20 集」胶囊，旁边的 × 去掉集号、搜整部剧。
 */
import { computed } from 'vue'

import UiChip from '@/components/ui/UiChip.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect, { type SelectOption } from '@/components/ui/UiSelect.vue'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'

import type { ReleaseSort } from '../utils/release-quality'
import type { FolderPick, FolderPreset } from '../utils/transfer-target'
import TargetFolderPill from './TargetFolderPill.vue'

/** 结果类型 */
export type NetdiskTab = 'share' | 'magnet' | 'offline'

const SORT_OPTIONS: SelectOption[] = [
  { value: 'default', label: '默认排序' },
  { value: 'quality', label: '按画质' },
  { value: 'date', label: '按时间' },
  { value: 'size', label: '按体积' },
]

const props = defineProps<{
  /** 搜过之后在页签上带数量 */
  counts: { share: number; magnet: number } | null
  notes: string[]
  /** 搜索词里的集号（「第 20 集」）；没写为空串 */
  episode?: string
  /** 转存目标胶囊的属性 */
  target: {
    folder: TargetFolder
    active: string | null
    presets: FolderPreset[]
    disabled: boolean
  }
}>()
const emit = defineEmits<{ pick: [pick: FolderPick]; clearEpisode: [] }>()
const tab = defineModel<NetdiskTab>('tab', { required: true })
const sort = defineModel<ReleaseSort>('sort', { required: true })

const tabs = computed(() => {
  const count = (n: number | undefined): string =>
    n === undefined ? '' : ` ${n}`
  return [
    { value: 'share' as const, label: `115 分享${count(props.counts?.share)}` },
    { value: 'magnet' as const, label: `磁力${count(props.counts?.magnet)}` },
    { value: 'offline' as const, label: '离线任务' },
  ]
})
</script>

<style scoped>
.netdisk-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  scroll-margin-top: var(--shell-top);
}
.netdisk-toolbar-episode {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-0_5);
}
.netdisk-toolbar-notes {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-toolbar-target {
  margin-left: auto;
}
.netdisk-toolbar-sort {
  flex: none;
  width: auto;
}
</style>
