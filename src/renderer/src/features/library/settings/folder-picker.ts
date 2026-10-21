/**
 * 选择要添加的媒体库文件夹：桌面端用系统对话框，网页端用片库服务的目录浏览（FolderBrowser）。
 */
import { h } from 'vue'

import { confirmDialog } from '@/components/ui'
import FolderBrowser from './FolderBrowser.vue'

/** 网页端：弹出目录浏览，返回选中的文件夹；取消返回 null。 */
export async function pickServerFolder(): Promise<string | null> {
  let selected: string | null = null
  const ok = await confirmDialog({
    title: '选择文件夹',
    width: 480,
    okText: '添加',
    content: () =>
      h(FolderBrowser, {
        onSelect: (path: string | null) => (selected = path),
      }),
    onOk: () => {
      if (!selected) throw new Error('请先进入要添加的文件夹')
    },
  })
  return ok ? selected : null
}

/** 选一个文件夹：桌面端系统对话框，网页端目录浏览。取消返回 null。 */
export async function pickLibraryFolder(): Promise<string | null> {
  if (window.api?.dialog) {
    const picked = await window.api.dialog.openDirectory()
    return picked.success && !picked.canceled
      ? (picked.filePaths[0] ?? null)
      : null
  }
  return pickServerFolder()
}
