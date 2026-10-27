/**
 * 追更面板切「全自动」的守卫：这部剧没选文件夹、剧集默认目录也解析到根目录时，主进程会拒绝全自动，
 * 而「不追」时转存位置胶囊不显示，用户无处可选。这里改成先弹这部剧的文件夹选择：
 * 选好一个非根目录的文件夹后同时存文件夹并切到全自动；取消则什么都不改（仍是原来的模式）。
 */
import { type Ref, ref } from 'vue'

import type {
  AutograbMode,
  AutograbOverview,
  AutograbSeries,
  AutograbSeriesPatch,
} from '../../../../shared/contract/autograb'
import {
  type TargetFolder,
  normalizeCid,
} from '../../../../shared/netdisk/target-folder'

import { needsFolderForAuto } from './autograb-rules'

/** 守卫要用到的面板能力（面板传 useAutograb 的，单测传假的） */
export interface FullAutoFolderDeps {
  overview: () => AutograbOverview | null
  setSeries(seriesId: number, patch: AutograbSeriesPatch): Promise<boolean>
  /** 提示一句人话（面板用 toast.warning） */
  warn(text: string): void
}

/** 切全自动的守卫状态与操作 */
export interface FullAutoFolder {
  /** 正在给哪部剧选文件夹；null = 没有 */
  picking: Ref<number | null>
  /** 分段控件改模式：要先选文件夹时打开选择，否则直接存 */
  changeMode(series: AutograbSeries, mode: AutograbMode): Promise<void>
  /** 选好文件夹：存文件夹并切到全自动；根目录不行，继续选 */
  pick(folder: TargetFolder): Promise<void>
  /** 取消选择，模式保持不变 */
  cancel(): void
}

/** 切全自动的守卫 */
export function useFullAutoFolder(deps: FullAutoFolderDeps): FullAutoFolder {
  const picking = ref<number | null>(null)

  async function changeMode(
    series: AutograbSeries,
    mode: AutograbMode
  ): Promise<void> {
    const overview = deps.overview()
    if (
      mode === 'auto' &&
      overview &&
      needsFolderForAuto(series, overview.defaultFolder)
    ) {
      picking.value = series.seriesId
      return
    }
    if (picking.value === series.seriesId) picking.value = null
    await deps.setSeries(series.seriesId, { mode })
  }

  async function pick(folder: TargetFolder): Promise<void> {
    const seriesId = picking.value
    if (seriesId === null) return
    const cid = normalizeCid(folder.cid)
    if (cid === '0') {
      deps.warn('全自动不能存到根目录，换一个文件夹')
      return
    }
    const ok = await deps.setSeries(seriesId, {
      cid,
      cidName: folder.name,
      mode: 'auto',
    })
    if (ok && picking.value === seriesId) picking.value = null
  }

  function cancel(): void {
    picking.value = null
  }

  return { picking, changeMode, pick, cancel }
}
