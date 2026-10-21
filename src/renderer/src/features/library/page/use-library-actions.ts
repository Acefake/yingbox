/**
 * 媒体库页面的操作：添加文件夹、扫描 / 识别全部、对选中条目重新识别 / 写出。
 * 成功、失败都用全局提示告知；只在按下按钮时调用。
 */
import { message } from 'ant-design-vue'

import { errorText, libraryBridge } from '../api/bridge'
import { guarded } from '../shared/guarded'
import type { UseLibraries } from '../state/use-libraries'

/** 页面操作。 */
export interface LibraryActions {
  addFolder: () => Promise<void>
  scanAll: () => void
  identifyAll: () => void
  identifySelected: (itemIds: number[], onDone: () => void) => void
  writeSelected: (itemIds: number[]) => void
}

/**
 * @param libraries useLibraries 的结果
 * @param write 写出这些条目；失败时返回错误文本
 */
export function useLibraryActions(
  libraries: Pick<UseLibraries, 'addFolder' | 'scanAll' | 'identifyAll'>,
  write: (itemIds: number[]) => Promise<string | null | undefined>
): LibraryActions {
  const bridge = libraryBridge()

  async function addFolder(): Promise<void> {
    try {
      const lib = await libraries.addFolder()
      if (lib) message.success(`已添加「${lib.name}」，正在扫描`)
    } catch (error) {
      message.error(errorText(error))
    }
  }

  return {
    addFolder,
    scanAll: () => void guarded(() => libraries.scanAll(false), '已开始扫描'),
    identifyAll: () =>
      void guarded(() => libraries.identifyAll(false), '已开始识别'),
    identifySelected: (itemIds, onDone) =>
      void guarded(async () => {
        await bridge!.identify({ itemIds, force: true })
        onDone()
      }, `已开始重新识别 ${itemIds.length} 项`),
    writeSelected: itemIds =>
      void guarded(async () => {
        const failure = await write(itemIds)
        if (failure) throw new Error(failure)
      }, `已开始写出 ${itemIds.length} 项`),
  }
}
