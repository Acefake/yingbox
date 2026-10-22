/**
 * 详情页的去马赛克入口（接 features/lada）：整片去码、去码一段、边跑边看。
 *
 * 只在桌面端（有 window.api.lada、不是网页端的片库服务）、成人模式开启、番号库里有视频文件的电影时可用；
 * 普通电影 / 剧集不显示。
 * 处理的是第一个视频文件（分段电影的 CD1）。进度与产物在「后台任务」面板。
 */
import { type ComputedRef, type Ref, computed } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { toast } from '@/components/ui'
import { useLadaTasks } from '@/features/lada'
import { useSetting } from '@/features/settings'

import { errorText, usesLibraryServer } from '../api/bridge'
import { videoFiles } from './playback'

/** 去码操作 */
export type RestoreAction = 'restore' | 'range' | 'live'

/** useRestore 的返回值 */
export interface UseRestore {
  /** 能否显示去码入口 */
  available: ComputedRef<boolean>
  /** 整片去码正在跑（同一时间只跑一个） */
  running: ComputedRef<boolean>
  /** 执行一个去码操作 */
  start: (action: RestoreAction) => Promise<void>
}

export function useRestore(
  node: Ref<LibraryItemNode | null>,
  jav: Readonly<Ref<boolean>>
): UseRestore {
  const adultMode = useSetting('app.adultMode')
  const lada = useLadaTasks()
  const desktop = Boolean(window.api?.lada) && !usesLibraryServer()

  const target = computed(() => {
    const n = node.value
    return n?.type === 'movie' ? (videoFiles(n)[0] ?? null) : null
  })
  const available = computed(
    () => desktop && adultMode.value && jav.value && Boolean(target.value)
  )

  async function start(action: RestoreAction): Promise<void> {
    const path = target.value
    if (!available.value || !path) return
    try {
      if (action === 'restore') await lada.startRestoreSmart(path)
      else if (action === 'range') await lada.startRangeSmart(path)
      else await lada.startLive(path)
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  return { available, running: lada.restoreRunning, start }
}
