/**
 * 全局策略切「全自动」的守卫（剧集 / 电影各用一份）：转存目标解析到 115 根目录时主进程会拒绝，
 * 所以先弹目录选择——选好一个非根目录的文件夹就存成这个种类的默认目录（设置 `pan115.tvCid` /
 * `pan115.movieCid`，桌面与 NAS 同一份设置），再切到全自动；取消则什么都不改。
 */
import { type Ref, ref } from 'vue'

import type { GrabMode } from '../../../../shared/contract/grab-policy'
import {
  type TargetFolder,
  normalizeCid,
} from '../../../../shared/netdisk/target-folder'

/** 守卫要用到的能力（界面传真的，单测传假的） */
export interface PolicyFolderDeps {
  /** 现在的转存目标 cid（"0" = 根目录）；还没加载为 null */
  targetCid(): string | null
  /** 改全局方式；成功为 true */
  setMode(mode: GrabMode): Promise<boolean>
  /** 把选好的文件夹存成这个种类的默认目录 */
  saveDefaultFolder(folder: TargetFolder): Promise<void>
  /** 提示一句人话 */
  warn(text: string): void
}

/** 全局切全自动的守卫状态与操作 */
export interface PolicyFolder {
  /** 正在选默认目录 */
  picking: Ref<boolean>
  /** 改全局方式：全自动而目标是根目录时先打开选择 */
  changeMode(mode: GrabMode): Promise<void>
  /** 选好文件夹：存成默认目录并切到全自动；根目录不行，继续选 */
  pick(folder: TargetFolder): Promise<void>
  cancel(): void
}

/** 全局切全自动的守卫 */
export function usePolicyFolder(deps: PolicyFolderDeps): PolicyFolder {
  const picking = ref(false)

  async function changeMode(mode: GrabMode): Promise<void> {
    const cid = deps.targetCid()
    if (mode === 'auto' && cid !== null && normalizeCid(cid) === '0') {
      picking.value = true
      return
    }
    picking.value = false
    await deps.setMode(mode)
  }

  async function pick(folder: TargetFolder): Promise<void> {
    if (!picking.value) return
    if (normalizeCid(folder.cid) === '0') {
      deps.warn('全自动不能存到根目录，换一个文件夹')
      return
    }
    await deps.saveDefaultFolder(folder)
    if (await deps.setMode('auto')) picking.value = false
  }

  function cancel(): void {
    picking.value = false
  }

  return { picking, changeMode, pick, cancel }
}
