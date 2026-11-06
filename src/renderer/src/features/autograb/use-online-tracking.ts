/**
 * 在线剧的追更流程（ADR-0052）：匹配 TMDB → 创建或复用独立网盘任务 → 打开追更侧板。
 * 剧名不确定时先选候选；身份和目录不依赖媒体库。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'
import type { CalendarEpisode } from '../../../../shared/library/ipc'

import { toast } from '@/components/ui/toast'
import type {
  TrackCandidate,
  TrackOnlineRequest,
} from '../../../../shared/contract/autograb'

import {
  linkOnline,
  onlineLinks,
  sameTitle,
} from '@/services/online-series-links'

import { autograbApi } from './api'
import { autograbStore } from './autograb-store'
import { showTrackingError } from './tracking-error'

/** 要追的在线剧 */
export interface OnlineShow {
  recordId: string
  title: string
  year?: number
}

/** 让用户选的候选 */
export interface TrackChoice {
  show: OnlineShow
  candidates: TrackCandidate[]
}

/** 追更侧板要开的剧 */
export interface TrackedSheet {
  seriesId: number
  title: string
}

export interface UseOnlineTrackingReturn {
  /** 独立追剧任务的播出表，不要求媒体库或播放历史。 */
  schedule: ComputedRef<CalendarEpisode[]>
  /** 正在建的记录 id */
  busy: Ref<string | null>
  choice: Ref<TrackChoice | null>
  sheet: Ref<TrackedSheet | null>
  /** 这部在线剧是否已经在追（建过且方式不是「不追」） */
  isTracked(show: OnlineShow): boolean
  track(show: OnlineShow): Promise<void>
  pick(candidate: TrackCandidate): Promise<void>
  closeChoice(): void
  closeSheet(): void
}

/** 在线剧追更的状态与操作 */
export function useOnlineTracking(): UseOnlineTrackingReturn {
  const busy = ref<string | null>(null)
  const choice = ref<TrackChoice | null>(null)
  const sheet = ref<TrackedSheet | null>(null)

  /** 在追的剧（方式不是「不追」） */
  const following = computed(() =>
    (autograbStore.overview.value?.series ?? []).filter(
      s => !s.pending && s.effectiveMode !== 'off'
    )
  )

  /** 本次点过追更的按记录对应，否则（重启后）按剧名对应 */
  function followedId(show: OnlineShow): number | undefined {
    const linked = onlineLinks.value.get(show.recordId)
    if (linked !== undefined)
      return following.value.some(s => s.seriesId === linked)
        ? linked
        : undefined
    return following.value.find(s => sameTitle(s.title, show.title))?.seriesId
  }

  function isTracked(show: OnlineShow): boolean {
    return followedId(show) !== undefined
  }

  async function run(show: OnlineShow, tmdbId?: string): Promise<void> {
    busy.value = show.recordId
    try {
      const request: TrackOnlineRequest = {
        title: show.title,
        ...(show.year ? { year: show.year } : {}),
        ...(tmdbId ? { tmdbId } : {}),
      }
      const result = await autograbApi().trackOnline(request)
      if (result.status === 'ready') {
        linkOnline(show.recordId, result.seriesId)
        await autograbStore.reload()
        choice.value = null
        sheet.value = { seriesId: result.seriesId, title: show.title }
      } else if (result.status === 'choose') {
        choice.value = { show, candidates: result.candidates }
      } else {
        void toast.warning(`在 TMDB 上没找到「${show.title}」，暂时不能追更`)
      }
    } catch (error) {
      await showTrackingError(error)
    } finally {
      busy.value = null
    }
  }

  async function track(show: OnlineShow): Promise<void> {
    if (busy.value) return
    // 本次运行里建过的直接开侧板；重启后只靠剧名认出的，再走一遍后端（幂等，顺带登记「存整部剧」）
    const linked = onlineLinks.value.get(show.recordId)
    if (linked !== undefined && followedId(show) === linked) {
      sheet.value = { seriesId: linked, title: show.title }
      return
    }
    await run(show)
  }

  return {
    schedule: computed(
      () => autograbStore.overview.value?.calendarEpisodes ?? []
    ),
    busy,
    choice,
    sheet,
    isTracked,
    track,
    pick: candidate =>
      choice.value ? run(choice.value.show, candidate.id) : Promise.resolve(),
    closeChoice: () => (choice.value = null),
    closeSheet: () => (sheet.value = null),
  }
}
