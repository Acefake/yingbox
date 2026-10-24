/**
 * AV 播放流程：CMS / 插件 / MissAV 三种条目开播、播放历史与续播。
 * 播放一律经 openMediaPlayer（应用内播放弹窗或 mpv），进度由播放器保存。
 */
import { toast } from '@/components/ui'
import { type Ref, ref } from 'vue'
import { type RemovableRef, useStorage } from '@vueuse/core'
import { useOnlineSearch } from '@/features/online'
import type { ContinueRecord } from '@/features/player'
import type { PluginExt } from '@/utils/vod-data'
import {
  closePlayerModal,
  getMediaProgress,
  openMediaPlayer,
  playerModal,
} from '@/features/player'
import { type MissavStream, resolveMissav } from '../api/missav'
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
  resumeHistory: (record: AvPlayRecord, resumeAt?: number) => Promise<void>
  /** 「继续播放」卡片：按记录里的条目重新解析再播（MissAV 等地址会过期） */
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

  /** 开播：插件线路先解析成真实地址，记历史，然后打开播放弹窗（或 mpv）。 */
  const startPlay = async (
    url: string,
    epName = '',
    ext?: PluginExt,
    siteName?: string,
    resumeAt?: number
  ): Promise<void> => {
    let playUrl = url
    if (needsPluginResolve(url, siteName)) {
      const resolved = await resolvePlayUrl(siteName!, { ...(ext || {}), url })
      if (resolved) playUrl = resolved
    }
    playingUrl.value = playUrl
    if (playingVideo.value)
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

  /** 插件源：先用 getTracks 取回线路，再由 startPlay 解析成可播放地址。 */
  const playPluginVideo = async (video: AvVideo): Promise<void> => {
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
    const episodes = (groups || [])
      .flatMap(group => group.episodes || [])
      .filter(episode => episode?.url)
    if (!episodes.length) {
      toast.error('没有可用的播放线路')
      return
    }
    playingVideo.value = { ...video, episodes }
    const [first] = episodes
    await startPlay(first.url, first.name, first.ext, video._siteName)
  }

  const playMissavStream = async (
    stream: MissavStream,
    startAt = 0
  ): Promise<void> => {
    const video = {
      vod_id: stream.input,
      vod_name: stream.title,
      vod_pic: stream.poster || '',
      _source: 'MissAV',
      _uid: `missav-${stream.input}`,
      _missavInput: stream.input,
      episodes: [{ name: '在线播放', url: stream.url }],
    }
    playingVideo.value = video
    await startPlay(stream.url, '在线播放', undefined, undefined, startAt)
  }

  const playListedMissav = async (video: AvVideo): Promise<void> => {
    const hide = toast.loading('正在解析 MissAV…')
    try {
      const stream = await resolveMissav(video._missavInput ?? '')
      await playMissavStream({
        ...stream,
        title: video.vod_name || stream.title,
        poster: coverSrc(video),
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'MissAV 解析失败')
    } finally {
      hide()
    }
  }

  const playVideo = async (video: AvVideo): Promise<void> => {
    if (video._missavInput) return playListedMissav(video)
    if (video._isPlugin) return playPluginVideo(video)
    if (!video.vod_play_url) return
    const episodes = parseCmsEpisodes(video)
    if (episodes.length === 0) return
    playingVideo.value = { ...video, episodes }
    await startPlay(episodes[0].url, episodes[0].name)
  }

  const resumeHistory = async (
    record: AvPlayRecord,
    resumeAt?: number
  ): Promise<void> => {
    const video = record.video
    if (video._missavInput) {
      try {
        const stream = await resolveMissav(video._missavInput)
        await playMissavStream(stream, resumeAt ?? record.progress)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'MissAV 重新解析失败'
        )
      }
      return
    }
    const episodes = video.episodes?.length
      ? video.episodes
      : parseCmsEpisodes(video)
    playingVideo.value = { ...video, episodes }
    await startPlay(record.url, record.epName, undefined, undefined, resumeAt)
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
    playingVideo.value = null
    playingUrl.value = ''
    closePlayerModal()
  }

  /** 全局「后退」：播放弹窗开着（没缩成小窗）时先关播放器。 */
  const onNavigateBack = (event: Event): void => {
    const modal = playerModal().value
    if (!modal || modal.minimized) return
    closePlayer()
    event.preventDefault()
  }

  return {
    playHistory,
    playingVideo,
    playingUrl,
    playVideo,
    resumeHistory,
    resumeContinue,
    closePlayer,
    onNavigateBack,
  }
}
