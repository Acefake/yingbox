/**
 * 播放会话接入系统：托盘菜单 / 全局媒体键（主进程 nowPlaying 域）与 navigator.mediaSession
 * （系统媒体控件里的标题、封面与按钮）。播放 / 暂停、上一集、下一集都落到同一个播放会话上。
 *
 * PlayerSession 只调用一次并把 UnifiedVideoPlayer 的 ready 交给 attach；换集、状态上报、
 * 卸载时清理都在这里。网页端没有 window.api，只设置 mediaSession。
 */
import {
  type Ref,
  computed,
  onBeforeUnmount,
  shallowRef,
  watch,
  watchEffect,
} from 'vue'

import type {
  MediaCommand,
  NowPlaying,
} from '../../../../../shared/now-playing'
import {
  createCommandGate,
  previousAction,
  stepTarget,
} from '../utils/media-commands'

/** usePlayerMediaControls 需要的播放会话状态 */
export interface MediaControlsSource {
  /** 当前线路的播放队列长度来源 */
  playlist: Ref<readonly unknown[]>
  /** 当前集下标 */
  position: Ref<number>
  /** 当前备用线路下标；换集时回到主线路（-1） */
  activeFallback: Ref<number>
  /** 加载当前集 */
  load: () => Promise<void>
  /** 当前条目名 */
  title: () => string
  /** 封面地址 */
  poster: Ref<string>
  /** 拿到新的 <video> 后交给外层（播放弹窗 / 小窗） */
  onVideo: (video: HTMLVideoElement) => void
}

/** mediaSession 里由本会话接管的动作 */
const SESSION_ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
]

export function usePlayerMediaControls(source: MediaControlsSource): {
  attach: (video: HTMLVideoElement) => void
} {
  const video = shallowRef<HTMLVideoElement | null>(null)
  const playing = shallowRef(false)
  const pass = createCommandGate()
  const bridge =
    typeof window !== 'undefined' ? window.api?.nowPlaying : undefined
  const session =
    typeof navigator !== 'undefined' && 'mediaSession' in navigator
      ? navigator.mediaSession
      : null

  const hasNext = computed(
    () =>
      stepTarget(source.position.value, source.playlist.value.length, 1) !==
      null
  )
  const hasPrevious = computed(() => source.position.value > 0)

  const syncPlaying = (): void => {
    playing.value = Boolean(video.value && !video.value.paused)
  }

  const attach = (next: HTMLVideoElement): void => {
    video.value?.removeEventListener('play', syncPlaying)
    video.value?.removeEventListener('pause', syncPlaying)
    video.value = next
    next.addEventListener('play', syncPlaying)
    next.addEventListener('pause', syncPlaying)
    syncPlaying()
    source.onVideo(next)
  }

  const step = (delta: number): void => {
    const target = stepTarget(
      source.position.value,
      source.playlist.value.length,
      delta
    )
    if (target === null) return
    source.activeFallback.value = -1
    source.position.value = target
    void source.load()
  }

  /** 播放 / 暂停；不传 want 时切换 */
  const setPlaying = (want?: boolean): void => {
    const el = video.value
    if (!el) return
    if (want ?? el.paused) void el.play()?.catch(() => {})
    else el.pause()
  }

  /**
   * 执行一条命令。系统媒体控件的 play / pause 与媒体键的 playpause 共用一道闸门，
   * 同一次按键从两条路同时到达时只执行一次。
   */
  const run = (command: MediaCommand, want?: boolean): void => {
    if (!pass(command)) return
    if (command === 'playpause') return setPlaying(want)
    if (command === 'next') return step(1)
    const el = video.value
    if (
      previousAction(el?.currentTime ?? 0, source.position.value) === 'previous'
    )
      step(-1)
    else if (el) el.currentTime = 0
  }

  bridge?.onCommand(command => run(command))

  // 托盘菜单与媒体键的开关依据：标题、播放中、能否换集（只传普通对象）
  watchEffect(() => {
    const state: NowPlaying = {
      title: source.title(),
      playing: playing.value,
      hasNext: hasNext.value,
      hasPrevious: hasPrevious.value,
    }
    void bridge?.report(state).catch(() => {})
  })

  if (session) {
    watch(
      [source.title, source.poster],
      ([title, poster]) => {
        session.metadata = new MediaMetadata({
          title,
          artist: '影盒',
          artwork: poster ? [{ src: poster }] : [],
        })
      },
      { immediate: true }
    )
    watchEffect(() => {
      session.playbackState = playing.value ? 'playing' : 'paused'
      // 没有上一集 / 下一集时不注册，系统控件里对应按钮置灰
      session.setActionHandler('play', () => run('playpause', true))
      session.setActionHandler('pause', () => run('playpause', false))
      session.setActionHandler(
        'nexttrack',
        hasNext.value ? () => run('next') : null
      )
      session.setActionHandler('previoustrack', () => run('previous'))
    })
  }

  onBeforeUnmount(() => {
    video.value?.removeEventListener('play', syncPlaying)
    video.value?.removeEventListener('pause', syncPlaying)
    bridge?.offCommand()
    void bridge?.report(null).catch(() => {})
    if (session) {
      session.metadata = null
      session.playbackState = 'none'
      for (const action of SESSION_ACTIONS)
        session.setActionHandler(action, null)
    }
  })

  return { attach }
}
