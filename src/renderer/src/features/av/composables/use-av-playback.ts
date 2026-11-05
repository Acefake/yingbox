/**
 * AV 播放流程：CMS / 插件两种条目开播、播放历史与续播。
 * 播放一律经 openMediaPlayer（应用内播放弹窗或 mpv），进度由播放器保存。
 */
import { toast } from '@/components/ui'
import { type Ref, ref } from 'vue'
import { type RemovableRef, useStorage } from '@vueuse/core'
import { isIncognito } from '@/features/incognito'
import { type Episode, useOnlineSearch } from '@/features/online'
import type { ContinueRecord } from '@/features/player'
import { parseCatSpiderGroups } from '../../../../../shared/online/vod-payload'
import {
  getMediaProgress,
  openMediaPlayer,
  playerSession,
  closePlayer as stopPlayer,
} from '@/features/player'
import type { AvVideo } from '../utils/av-catalog'
import { coverSrc } from '../utils/av-media'
import {
  type AvPlayRecord,
  type PlayingVideo,
  needsPluginResolve,
  parseCmsEpisodes,
  playTitle,
  upsertPlayHistory,
} from '../utils/av-playback'

/** 「继续播放」记录里存的条目（重新解析用） */
interface ContinueDetail {
  video: PlayingVideo
  epName: string
  url: string
}

/** AV 播放：播放历史与正在播的条目，以及开播 / 续播操作 */
export interface UseAvPlaybackReturn {
  playHistory: RemovableRef<AvPlayRecord[]>
  playingVideo: Ref<PlayingVideo | null>
  playingUrl: Ref<string>
  playVideo: (video: AvVideo) => Promise<void>
  /** 按搜索结果中的来源顺序尝试解析线路。 */
  playSources: (videos: readonly AvVideo[]) => Promise<void>
  resumeHistory: (record: AvPlayRecord, resumeAt?: number) => Promise<void>
  /** 「继续播放」卡片：按记录里的条目重新解析再播 */
  resumeContinue: (
    record: ContinueRecord,
    fromStart: boolean
  ) => Promise<boolean>
  closePlayer: () => void
  onNavigateBack: (event: Event) => void
}

export function useAvPlayback(): UseAvPlaybackReturn {
  const { fetchDetail, resolvePlayUrl } = useOnlineSearch()
  const playHistory = useStorage<AvPlayRecord[]>('av_play_history', [])
  const playingVideo = ref<PlayingVideo | null>(null)
  const playingUrl = ref('')
  let playRequest = 0

  /** 用已解析的地址开播，并记录播放历史。 */
  const startPlay = async (
    playUrl: string,
    epName = '',
    resumeAt?: number
  ): Promise<void> => {
    playingUrl.value = playUrl
    // 无痕模式不记播放历史
    if (playingVideo.value && !isIncognito())
      playHistory.value = upsertPlayHistory(
        playHistory.value,
        playingVideo.value,
        epName,
        playUrl
      )
    const title = playTitle(playingVideo.value?.vod_name, epName)
    const poster = coverSrc(playingVideo.value) || undefined
    const startAt = resumeAt ?? getMediaProgress(playUrl)
    const video = playingVideo.value
    const ok = await openMediaPlayer({
      url: playUrl,
      title,
      poster,
      startAt,
      ...(video
        ? {
            continueAs: {
              section: 'av' as const,
              key: video._uid || `${video._source}-${video.vod_id}`,
              title: video.vod_name || title,
              cover: poster,
              detail: { video, epName, url: playUrl } satisfies ContinueDetail,
            },
          }
        : {}),
    })
    if (!ok) toast.error('无法打开播放器，请完全重启应用后再试')
  }

  const loadPluginEpisodes = async (video: AvVideo): Promise<Episode[]> => {
    const groups = await fetchDetail({
      vod_id: video.vod_id,
      vod_name: video.vod_name || '',
      type_name: video.type_name || '',
      vod_year: video.vod_year || '',
      vod_remarks: video.vod_remarks || '',
      vod_pic: video.vod_pic || '',
      _source: 'catspider',
      _siteName: video._siteName,
      _ext: video._ext,
    }).catch(() => [])
    return groups
      .flatMap(group => group.episodes || [])
      .filter(episode => episode?.url)
  }

  const tryEpisodes = async (
    video: AvVideo,
    episodes: Episode[],
    request: number
  ): Promise<boolean> => {
    for (const episode of episodes) {
      if (request !== playRequest) return false
      const siteName = video._siteName
      const url =
        siteName && needsPluginResolve(episode.url, siteName)
          ? await resolvePlayUrl(siteName, { ...episode.ext, url: episode.url })
          : episode.url
      if (request !== playRequest) return false
      if (!/^https?:\/\//i.test(url)) continue
      playingVideo.value = { ...video, episodes }
      await startPlay(url, episode.name)
      return true
    }
    return false
  }

  const playSources = async (videos: readonly AvVideo[]): Promise<void> => {
    const request = ++playRequest
    for (const video of videos) {
      if (request !== playRequest) return
      if (!video._isPlugin) {
        if (await tryEpisodes(video, parseCmsEpisodes(video), request)) return
        continue
      }
      const inline = parseCatSpiderGroups([video], video._source).flatMap(
        group => group.episodes
      )
      if (await tryEpisodes(video, inline, request)) return
      if (request !== playRequest) return
      if (await tryEpisodes(video, await loadPluginEpisodes(video), request))
        return
    }
    if (request === playRequest) toast.error('没有可用的播放线路')
  }

  const playVideo = (video: AvVideo): Promise<void> => playSources([video])

  const resumeHistory = async (
    record: AvPlayRecord,
    resumeAt?: number
  ): Promise<void> => {
    ++playRequest
    const video = record.video
    const episodes = video.episodes?.length
      ? video.episodes
      : parseCmsEpisodes(video)
    playingVideo.value = { ...video, episodes }
    await startPlay(record.url, record.epName, resumeAt)
  }

  const resumeContinue = async (
    record: ContinueRecord,
    fromStart: boolean
  ): Promise<boolean> => {
    const detail = record.detail as ContinueDetail | undefined
    if (!detail?.video || !detail.url) return false
    await resumeHistory(
      {
        vod_name: record.title,
        vod_pic: record.cover || '',
        _source: detail.video._source || '',
        epName: detail.epName,
        url: detail.url,
        timestamp: record.updatedAt,
        progress: record.progress,
        duration: record.duration,
        video: detail.video,
      },
      fromStart ? 0 : record.progress
    )
    return true
  }

  const closePlayer = (): void => {
    ++playRequest
    playingVideo.value = null
    playingUrl.value = ''
    stopPlayer()
  }

  /** 全局「后退」：播放层盖在页面上（网页端）时先关播放器；桌面端在独立窗口里播，不拦。 */
  const onNavigateBack = (event: Event): void => {
    if (!playerSession().value?.inPage) return
    closePlayer()
    event.preventDefault()
  }

  return {
    playHistory,
    playingVideo,
    playingUrl,
    playVideo,
    playSources,
    resumeHistory,
    resumeContinue,
    closePlayer,
    onNavigateBack,
  }
}
