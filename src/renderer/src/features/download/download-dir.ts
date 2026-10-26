/**
 * 下载目录（设置 `download.dir`）。写入只在主进程：选择走 settings.chooseDownloadDir
 * （系统对话框 + 可写校验 + 保存），恢复默认就是把设置写回空串；新值经设置广播回到各窗口。
 */
import { setSetting } from '@/features/settings'

/** 设置为空时显示的默认目录说明（实际路径由主进程按系统「视频」文件夹决定） */
export const DEFAULT_DOWNLOAD_DIR_LABEL = '默认：「视频」文件夹 / 影盒下载'

/** 输入框里显示的目录文案 */
export function downloadDirLabel(dir: string): string {
  return dir || DEFAULT_DOWNLOAD_DIR_LABEL
}

/** 弹出系统对话框选择下载目录；取消返回 null，目录不可写时抛错（设置不变） */
export async function pickDownloadDir(): Promise<string | null> {
  const bridge =
    typeof window !== 'undefined' ? window.api?.settings : undefined
  if (!bridge)
    throw new Error(
      '网页端的下载目录由片库服务的 YINGBOX_DOWNLOAD_DIR 决定，在服务端修改'
    )
  return bridge.chooseDownloadDir()
}

/** 恢复默认下载目录 */
export function resetDownloadDir(): Promise<void> {
  return setSetting('download.dir', '')
}
