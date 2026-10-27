/**
 * 网盘页共用的转存目标：「转存最佳版本」、每行转存与磁力离线都读同一份选择。
 * 默认跟着搜索命中的内容类型预选默认目录；在胶囊里另选后一直用它，直到下一次搜索（reset）回到自动预选。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'

import type {
  TargetFolder,
  TargetKind,
  TargetSettings,
} from '../../../../../shared/netdisk/target-folder'

import {
  type FolderPick,
  type FolderPreset,
  type ResolvedChoice,
  type TargetChoice,
  choiceFolder,
  kindPresets,
} from '../utils/transfer-target'

/** 页面上的转存目标状态 */
export interface TransferTarget {
  choice: Ref<TargetChoice>
  current: ComputedRef<ResolvedChoice>
  presets: ComputedRef<FolderPreset[]>
  /** 胶囊里选了一项 */
  pick(pick: FolderPick): void
  /** 回到按内容类型自动预选 */
  reset(): void
  /** 发给主进程的文件夹（普通对象，不带响应式代理） */
  folder(): TargetFolder
}

/**
 * @param detected 搜索命中的内容类型（没对上为 null）
 * @param settings 转存目标设置（useTargetSettings）
 */
export function useTransferTarget(
  detected: () => TargetKind | null,
  settings: () => TargetSettings
): TransferTarget {
  const choice = ref<TargetChoice>(null)
  const current = computed(() =>
    choiceFolder(choice.value, detected(), settings())
  )
  const presets = computed(() => kindPresets(settings()))

  function pick(next: FolderPick): void {
    choice.value =
      'preset' in next
        ? { kind: next.preset === 'tv' ? 'tv' : 'movie' }
        : { folder: { ...next.folder } }
  }

  return {
    choice,
    current,
    presets,
    pick,
    reset: () => void (choice.value = null),
    folder: () => {
      const { cid, name } = current.value.folder
      return { cid, name }
    },
  }
}
