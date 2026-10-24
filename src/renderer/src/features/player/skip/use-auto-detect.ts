/**
 * 播放剧集时自动检测本季片头片尾（设置 player.autoDetectIntro，默认关）。
 *
 * 条件：桌面端、能认出是哪部剧、播放队列全是本地文件且至少两集、这部剧的片头或片尾还没有标记
 * （手动、自动都没有）。每部剧每次启动应用只自动试一次；检测在主进程后台低优先级跑，不影响播放。
 * 结果并入标记后，进度条上的片头 / 片尾区间会随 skip-store 自动重画。
 */
import { toast } from '@/components/ui'
import { watch } from 'vue'

import { INTRO_DETECT_MAX_FILES } from '../../../../../shared/contract/intro-detect'
import { getSetting } from '@/features/settings'

import type { PlaylistEntry } from '../utils/play-queue'
import { needsDetection } from './detect-merge'
import { detectSeason, introDetectSupported } from './intro-detect'
import { getSkipMarksWithSource } from './skip-store'

/** 本次启动已经自动试过的剧 */
const tried = new Set<string>()

/** 播放队列里的本地文件；有任何在线条目时返回空（只做本地文件） */
export function localQueueFiles(playlist: readonly PlaylistEntry[]): string[] {
  if (playlist.some(entry => entry.url || !entry.filePath)) return []
  return playlist
    .map(entry => entry.filePath as string)
    .slice(0, INTRO_DETECT_MAX_FILES)
}

export function useAutoIntroDetect(
  key: () => string,
  playlist: () => readonly PlaylistEntry[],
  label: () => string
): void {
  const maybeDetect = (): void => {
    const k = key()
    if (!k || tried.has(k) || !introDetectSupported()) return
    if (!getSetting('player.autoDetectIntro')) return
    const files = localQueueFiles(playlist())
    if (files.length < 2 || !needsDetection(getSkipMarksWithSource(k))) return
    tried.add(k)
    void detectSeason({ key: k, label: label(), files }).then(outcome => {
      if (
        outcome.merge?.intro === 'applied' ||
        outcome.merge?.outro === 'applied'
      )
        toast.success(outcome.message)
    })
  }
  watch(() => [key(), playlist().length], maybeDetect, { immediate: true })
}
