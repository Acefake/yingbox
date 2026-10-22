/**
 * AV 播放流程：CMS / 插件 / MissAV 三种条目开播、失败自动换同名的其它来源、
 * 播放历史与续播、连播下一集或列表下一部。
 * Electron 下一律打开独立播放窗；页内播放层只是非 Electron 的兜底。
 */
import { toast } from '@/components/ui'
import { type Ref, ref } from 'vue'
import { type RemovableRef, useStorage } from '@vueuse/core'
import { type Episode, useOnlineSearch } from '@/features/online'
import type { PluginExt } from '@/utils/vod-data'
import {
  canOpenElectronPlayer,
  closeInlinePlayer,
  getMediaProgress,
  openMediaPlayer,
} from '@/features/player'
import { type MissavStream, resolveMissav } from '../api/missav'
import type { AvVideo } from '../utils/av-catalog'
import { coverSrc } from '../utils/av-media'
import {
  type AvPlayRecord,
  type MergedGroup,
  type PlayingVideo,
  needsPluginResolve,
  nextEpisode,
  nextInList,
  parseCmsEpisodes,
  playTitle,
  upsertPlayHistory,
} from '../utils/av-playback'

type PlayGroup = Pick<MergedGroup, 'vod_name' | 'vod_pic' | 'items'>

/** AV 播放：播放历史、页内兜底播放层的状态，以及开播 / 换源 / 连播操作 */
export interface UseAvPlaybackReturn {
  playHistory: RemovableRef<AvPlayRecord[]>
  showPlayer: Ref<boolean>
  playingVideo: Ref<PlayingVideo | null>
  playingUrl: Ref<string>
  playerMessage: Ref<string>
  videoEl: Ref<HTMLVideoElement | null>
  playVideo: (video: AvVideo) => Promise<void>
  resumeHistory: (record: AvPlayRecord) => Promise<void>
  tryNextSource: () => Promise<void>
  onEnded: () => Promise<void>
  onPlayerReady: (video: HTMLVideoElement) => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  onVolumeChange: () => void
  onKeydown: (event: KeyboardEvent) => void
  closePlayer: () => void
  onNavigateBack: (event: Event) => void
}

export function useAvPlayback(options: {
  findGroup: (name: string) => MergedGroup | null
  /** 当前视图里可连播的列表（一部片没有下一集时播列表里的下一部） */
  upNext: () => { items: AvVideo[] }[]
}): UseAvPlaybackReturn {
  const { fetchDetail, resolvePlayUrl } = useOnlineSearch()
  const playHistory = useStorage<AvPlayRecord[]>('av_play_history', [])
  const showPlayer = ref(false)
  const playingVideo = ref<PlayingVideo | null>(null)
  const playingUrl = ref('')
  const playerMessage = ref('')
  /** 页内兜底播放层的 <video>（独立播放窗模式下为 null） */
  const videoEl = ref<HTMLVideoElement | null>(null)
  const playingGroup = ref<PlayGroup | null>(null)
  const attempted = new Set<string>()
  let switching = false
  /** 页内播放层加载元数据后跳到的位置 */
  let resumeTime = 0

  const groupFor = (video: AvVideo): PlayGroup =>
    options.findGroup(video.vod_name ?? '') || {
      vod_name: video.vod_name ?? '',
      vod_pic: video.vod_pic ?? '',
      items: [video],
    }

  /** 开播：插件线路先解析成真实地址，记历史，然后打开独立播放窗（或页内层）。 */
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
    if (canOpenElectronPlayer()) {
      const poster = coverSrc(playingVideo.value) || undefined
      const startAt = resumeAt ?? getMediaProgress(playUrl)
      const ok = await openMediaPlayer({ url: playUrl, title, poster, startAt })
      showPlayer.value = false
      videoEl.value = null
      if (!ok) toast.error('无法打开播放器，请完全重启应用后再试')
      return
    }
    showPlayer.value = true
  }

  /** 插件源：先用 getTracks 取回线路，再由 startPlay 解析成可播放地址。 */
  const playPluginVideo = async (video: AvVideo): Promise<void> => {
    playerMessage.value = ''
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
      playerMessage.value = '没有可用的播放线路'
      toast.error('没有可用的播放线路')
      return
    }
    playingVideo.value = { ...video, episodes }
    playingGroup.value = groupFor(video)
    resumeTime = 0
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
    playingGroup.value = {
      vod_name: video.vod_name,
      vod_pic: video.vod_pic,
      items: [video],
    }
    attempted.clear()
    attempted.add(video._uid)
    switching = false
    playerMessage.value = ''
    resumeTime = startAt
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
    if (video._isPlugin) {
      attempted.clear()
      attempted.add(video._uid)
      resumeTime = 0
      return playPluginVideo(video)
    }
    if (!video.vod_play_url) return
    const episodes = parseCmsEpisodes(video)
    if (episodes.length === 0) return
    playingVideo.value = { ...video, episodes }
    playingGroup.value = groupFor(video)
    attempted.clear()
    attempted.add(video._uid)
    resumeTime = 0
    playerMessage.value = ''
    await startPlay(episodes[0].url, episodes[0].name)
  }

  /** 换到同名的另一个来源；automatic 时提示「已切换到 X」。 */
  const switchSource = async (
    video: AvVideo,
    automatic: boolean
  ): Promise<void> => {
    const notice = automatic ? `当前线路不可用，已切换到 ${video._source}` : ''
    if (video._isPlugin) {
      playerMessage.value = notice
      attempted.add(video._uid)
      resumeTime = 0
      return playPluginVideo(video)
    }
    if (!video.vod_play_url) return
    const episodes = parseCmsEpisodes(video)
    if (episodes.length === 0) return
    playingVideo.value = { ...video, episodes }
    attempted.add(video._uid)
    resumeTime = 0
    playerMessage.value = notice
    await startPlay(episodes[0].url, episodes[0].name)
  }

  /** 播放出错：按顺序试同组里还没试过的来源。 */
  const tryNextSource = async (): Promise<void> => {
    if (switching) return
    const next = playingGroup.value?.items.find(
      item => !attempted.has(item._uid)
    )
    if (!next) {
      playerMessage.value = '当前内容的可用线路均播放失败'
      return
    }
    switching = true
    try {
      await switchSource(next, true)
    } finally {
      switching = false
    }
  }

  const resumeHistory = async (record: AvPlayRecord): Promise<void> => {
    const video = record.video
    if (video._missavInput) {
      try {
        const stream = await resolveMissav(video._missavInput)
        await playMissavStream(stream, record.progress)
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
    playingGroup.value = groupFor(video)
    attempted.clear()
    switching = false
    attempted.add(video._uid)
    resumeTime = record.progress
    playerMessage.value = record.progress > 5 ? '继续上次播放' : ''
    // Electron 内置播放器自己存进度；仅页内层模式支持 resumeTime
    await startPlay(record.url, record.epName)
  }

  /** 播完：有下一集播下一集，否则播当前列表里的下一部。 */
  const onEnded = async (): Promise<void> => {
    const next = nextEpisode<Episode>(
      playingVideo.value?.episodes ?? [],
      playingUrl.value
    )
    if (next) {
      playerMessage.value = `即将播放：${next.name}`
      await startPlay(
        next.url,
        next.name,
        next.ext,
        playingVideo.value?._siteName
      )
      return
    }
    const nextVideo = nextInList(options.upNext(), playingVideo.value?.vod_name)
    if (nextVideo) {
      playerMessage.value = `即将播放：${nextVideo.vod_name}`
      await playVideo(nextVideo)
    } else playerMessage.value = '已播放完当前内容'
  }

  // ── 页内兜底播放层（非 Electron）：音量记忆、续播、进度回写、快捷键 ──
  const volume = useStorage<number>('av_volume', 1)
  let lastProgressSave = 0
  const applyVolume = (): void => {
    const el = videoEl.value
    if (el) el.volume = Math.min(1, Math.max(0, Number(volume.value) || 0))
  }
  const onPlayerReady = (video: HTMLVideoElement): void => {
    videoEl.value = video
    applyVolume()
  }
  /** 加载元数据后续播（5 秒以后、离结尾 10 秒以上）。 */
  const onLoadedMetadata = (): void => {
    const el = videoEl.value
    if (!el) return
    applyVolume()
    if (resumeTime > 5 && resumeTime < el.duration - 10)
      el.currentTime = resumeTime
    resumeTime = 0
  }
  /** 每秒最多一次把进度写回播放历史。 */
  const onTimeUpdate = (): void => {
    const el = videoEl.value
    if (!el || !playingVideo.value || !playingUrl.value) return
    if (Date.now() - lastProgressSave < 1000) return
    lastProgressSave = Date.now()
    const record = playHistory.value.find(item => item.url === playingUrl.value)
    if (!record) return
    record.progress = el.currentTime
    record.duration = Number.isFinite(el.duration) ? el.duration : 0
    record.timestamp = Date.now()
  }
  const onVolumeChange = (): void => {
    const el = videoEl.value
    if (el && !el.muted) volume.value = el.volume
  }
  /** 空格播放 / 暂停，左右方向键 ±10 秒，M 静音。 */
  const onKeydown = (event: KeyboardEvent): void => {
    const el = videoEl.value
    if (!el) return
    if (event.key === ' ') {
      event.preventDefault()
      if (el.paused) el.play().catch(() => {})
      else el.pause()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -10 : 10
      el.currentTime = Math.max(0, el.currentTime + step)
    } else if (event.key.toLowerCase() === 'm') {
      el.muted = !el.muted
    }
  }

  const closePlayer = (): void => {
    showPlayer.value = false
    playingVideo.value = null
    playingUrl.value = ''
    playerMessage.value = ''
    resumeTime = 0
    if (videoEl.value) videoEl.value.src = ''
    closeInlinePlayer()
  }

  /** 全局「后退」：正在播放时先关播放器。 */
  const onNavigateBack = (event: Event): void => {
    if (!showPlayer.value && !playingUrl.value) return
    closePlayer()
    event.preventDefault()
  }

  return {
    playHistory,
    showPlayer,
    playingVideo,
    playingUrl,
    playerMessage,
    videoEl,
    playVideo,
    resumeHistory,
    tryNextSource,
    onEnded,
    onPlayerReady,
    onLoadedMetadata,
    onTimeUpdate,
    onVolumeChange,
    onKeydown,
    closePlayer,
    onNavigateBack,
  }
}
