import { ref, computed } from 'vue'
import type { MpvOpenOptions, MpvStatus, MpvTrack } from '@shared/mpv'

const DEFAULT_STATUS: MpvStatus = {
  running: false,
  paused: true,
  volume: 100,
  muted: false,
  speed: 1,
  tracks: [],
  playlist: [],
  playlistPos: 0,
}

const status = ref<MpvStatus>({ ...DEFAULT_STATUS })
let isListenerRegistered = false

/** 初始化监听主进程推送的 mpv 状态 */
function initMpvListeners(): void {
  if (isListenerRegistered || typeof window === 'undefined' || !window.api?.mpv) {
    return
  }
  isListenerRegistered = true
  window.api.mpv.onStatus((newStatus: MpvStatus) => {
    status.value = newStatus
  })
}

/**
 * mpv 播放器交互 Composable。
 * 提供响应式状态以及播放、音轨、字幕控制接口。
 */
export function useMpvPlayer() {
  initMpvListeners()

  const isRunning = computed<boolean>(() => status.value.running)
  const isPaused = computed<boolean>(() => status.value.paused)
  const duration = computed<number>(() => status.value.duration ?? 0)
  const position = computed<number>(() => status.value.position ?? 0)
  const volume = computed<number>(() => status.value.volume)
  const isMuted = computed<boolean>(() => status.value.muted)
  const speed = computed<number>(() => status.value.speed)
  const title = computed<string>(() => status.value.title ?? '')

  const subtitleTracks = computed<MpvTrack[]>(() =>
    status.value.tracks.filter(t => t.type === 'sub')
  )
  const audioTracks = computed<MpvTrack[]>(() =>
    status.value.tracks.filter(t => t.type === 'audio')
  )

  const canUseMpv = (): boolean =>
    typeof window !== 'undefined' && Boolean(window.api?.mpv)

  const openMpv = async (options: MpvOpenOptions): Promise<boolean> => {
    if (!canUseMpv()) return false
    try {
      const res = await window.api.mpv.open(options)
      return res.success
    } catch {
      return false
    }
  }

  const togglePause = async (): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.pause(!status.value.paused)
  }

  const seek = async (
    seconds: number,
    mode: 'absolute' | 'relative' = 'absolute'
  ): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.seek(seconds, mode)
  }

  const setVolume = async (val: number): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.volume(val)
  }

  const toggleMute = async (): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.mute(!status.value.muted)
  }

  const setSpeed = async (val: number): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.speed(val)
  }

  const setSubTrack = async (id: number | false): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.setSubTrack(id)
  }

  const setAudioTrack = async (id: number): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.setAudioTrack(id)
  }

  const addSubFile = async (filePath: string): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.addSubFile(filePath)
  }

  const quit = async (): Promise<void> => {
    if (!canUseMpv()) return
    await window.api.mpv.quit()
  }

  return {
    status,
    isRunning,
    isPaused,
    duration,
    position,
    volume,
    isMuted,
    speed,
    title,
    subtitleTracks,
    audioTracks,
    canUseMpv,
    openMpv,
    togglePause,
    seek,
    setVolume,
    toggleMute,
    setSpeed,
    setSubTrack,
    setAudioTrack,
    addSubFile,
    quit,
  }
}
