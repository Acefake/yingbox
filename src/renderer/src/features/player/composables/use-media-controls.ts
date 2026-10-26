/**
 * 播放会话接入系统：托盘菜单 / 全局媒体键（主进程 nowPlaying 域）与 navigator.mediaSession
 * （系统媒体控件里的标题、封面与按钮）。播放 / 暂停、上一集、下一集都落到同一个播放会话上。
 *
 * PlayerSession 只调用一次并把 UnifiedVideoPlayer 的 ready 交给 attach；换集、状态上报、
 * 卸载时清理都在这里。网页端没有 window.api，只设置 mediaSession。
 *
 * 手动换集时下一集可能要异步解析地址，旧 <video> 在解析完成前仍在页面上：换集前先暂停并「退役」它，
 * 退役视频再被播放会立即暂停。换集加载期间的 ended / error（播放器的 error 不带 target）一律丢弃，
 * 之后退役视频的事件也经 accepts 过滤，不会推动已经改过的队列。
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
  /** 拿到新的 <video> 后交给外层（播放台据此在暂停时常显顶栏） */
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
  accepts: (event: Event | undefined) => boolean
} {
  const video = shallowRef<HTMLVideoElement | null>(null)
  /** 手动换集时退役的旧视频：它们的事件不再驱动播放队列 */
  const retired = new WeakSet<EventTarget>()
  /** 手动换集的世代；switching 为真表示最近一次换集的加载还没结束 */
  let switchSeq = 0
  let switching = false
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

  /** 停下并退役旧视频：之后再被播放会立即暂停 */
  const retire = (el: HTMLVideoElement): void => {
    retired.add(el)
    el.addEventListener('play', () => el.pause())
    el.pause()
  }

  /** 视频事件是否仍属于当前会话：换集加载中、或来自退役视频的事件一律忽略 */
  const accepts = (event: Event | undefined): boolean =>
    !switching && !(event?.target && retired.has(event.target))

  const step = (delta: number): void => {
    const target = stepTarget(
      source.position.value,
      source.playlist.value.length,
      delta
    )
    if (target === null) return
    // 先停旧视频再改队列位置：异步解析期间旧视频播完也不会再触发连播
    if (video.value) retire(video.value)
    source.activeFallback.value = -1
    source.position.value = target
    const seq = ++switchSeq
    switching = true
    void source
      .load()
      .catch(() => {})
      .finally(() => {
        if (seq === switchSeq) switching = false
      })
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

  return { attach, accepts }
}
