/**
 * 内置播放器 → mpv 的接力：内置解不了的文件（HEVC 画面、AC3 / EAC3 / DTS 音频等）交给 mpv 播；
 * 以及 mpv 自动下载期间的提示（主进程推 installing 事件，任何窗口订阅一次即可）。
 */
import { toast } from '@/components/ui'
import type { PlaylistEntry } from './play-queue'

let watching = false
let dismissInstall: (() => void) | null = null

/** 订阅 mpv 自动下载的开始 / 结束，显示一条进行中的提示；重复调用无副作用 */
export function watchMpvInstall(): void {
  const mpv = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (watching || !mpv?.onInstalling) return
  watching = true
  mpv.onInstalling((on: boolean) => {
    dismissInstall?.()
    dismissInstall = on
      ? toast.loading('首次使用 mpv，正在下载便携版（约 30 MB）…')
      : null
  })
}

/** 当前环境有没有 mpv 桥（桌面端） */
export function hasMpvBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api?.mpv)
}

/**
 * 用 mpv 播一个条目（本地文件或地址），从 startAt 秒开始；找不到 mpv 时主进程会先自动下载。
 * @returns 成功与否；失败时 error 是给用户看的原因
 */
export async function playEntryInMpv(
  entry: Pick<PlaylistEntry, 'filePath' | 'url'>,
  title: string,
  startAt: number
): Promise<{ success: boolean; error?: string }> {
  const mpv = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (!mpv) return { success: false, error: '当前环境没有 mpv' }
  if (!entry.filePath && !entry.url)
    return { success: false, error: '这一集没有可用的播放地址' }
  watchMpvInstall()
  return mpv
    .open({
      ...(entry.filePath ? { filePath: entry.filePath } : {}),
      ...(!entry.filePath && entry.url ? { url: entry.url } : {}),
      title,
      ...(startAt > 0 ? { startAt } : {}),
    })
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }))
}
