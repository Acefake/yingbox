/**
 * 一个播放器实例：Artplayer + 它的 hls.js 会话 + 承载它们的节点。
 *
 * 实例和创建它的组件分开：应用内小窗交接时，节点整体搬进小窗、之后搬进认领它的新组件，
 * 实例本身不重建；事件经 sink 转发，交接时把 sink 指向新组件即可。
 */
import Artplayer from 'artplayer'

import { getSetting, setSetting } from '@/features/settings'

import {
  applyPlaybackRate,
  artOptions,
  isValidPlaybackRate,
} from './art-options'
import { type HlsSession, createHlsSession } from './hls-session'

/** 转给组件的播放器事件 */
export type ArtEventName =
  | 'loadedmetadata'
  | 'timeupdate'
  | 'volumechange'
  | 'ended'
  | 'play'
  | 'pause'

/** 实例的事件去向（当前持有它的组件） */
export interface ArtSink {
  /** 普通事件，原样转成组件事件 */
  event: (name: ArtEventName, event: Event) => void
  /** 播放失败（地址解析之后的任何错误） */
  error: () => void
  keydown: (event: KeyboardEvent) => void
  /** 开播：收起加载层 */
  started: () => void
  /** 元数据 / HLS 清单就绪：跳到续播位置 */
  seek: (video: HTMLVideoElement) => void
  /** 清单就绪后是否自动播放 */
  autoplay: () => boolean
}

/** 一个可交接的播放器实例 */
export interface ArtCore {
  art: Artplayer
  hls: HlsSession
  /** Artplayer 的容器，交接时整体搬移 */
  node: HTMLDivElement
  /** 事件去向：当前持有实例的组件 */
  sink: { current: ArtSink }
  /** 最终拆除时额外要释放的东西（例如创建方挂的字幕 blob） */
  disposers: Array<() => void>
}

/** createArtCore 的输入 */
export interface ArtCoreInput {
  url: string
  useHls: boolean
  autoplay: boolean
  controls: boolean
  sink: ArtSink
}

/** 创建实例。节点还没挂到文档上，调用方把 core.node 放进自己的容器。 */
export function createArtCore(input: ArtCoreInput): ArtCore {
  const node = document.createElement('div')
  node.className = 'unified-player-core'
  const sink = { current: input.sink }
  const hls = createHlsSession()

  // HLS 走 hls.js 自定义类型；其余格式交给 Artplayer 按扩展名自动识别（见 artOptions）。
  const hlsType = input.useHls
    ? hls.customType({
        onManifestParsed: video => {
          sink.current.seek(video)
          if (sink.current.autoplay()) video.play().catch(() => {})
        },
        onFatalError: instance => {
          sink.current.error()
          instance.notice.show = '播放失败'
        },
      })
    : null

  const art = new Artplayer(
    artOptions({
      container: node,
      url: input.url,
      autoplay: input.autoplay,
      controls: input.controls,
      hls: hlsType,
    })
  )

  // 恢复上次使用的倍速，并记住本次改动（跨集 / 跨会话）
  applyPlaybackRate(art.video, getSetting('player.playbackRate'))
  art.on('video:ratechange', () => {
    const rate = art.video.playbackRate
    if (isValidPlaybackRate(rate)) void setSetting('player.playbackRate', rate)
  })

  art.on('video:loadedmetadata', (event: Event) => {
    sink.current.seek(art.video)
    sink.current.event('loadedmetadata', event)
  })
  art.on('video:playing', () => sink.current.started())
  art.on('video:play', (event: Event) => {
    sink.current.started()
    sink.current.event('play', event)
  })
  art.on('video:timeupdate', (event: Event) => {
    if (art.video.currentTime > 0.2) sink.current.started()
    sink.current.event('timeupdate', event)
  })
  art.on('video:volumechange', (event: Event) =>
    sink.current.event('volumechange', event)
  )
  art.on('video:error', () => sink.current.error())
  art.on('video:ended', (event: Event) => sink.current.event('ended', event))
  art.on('video:pause', (event: Event) => sink.current.event('pause', event))

  const onKeydown = (event: KeyboardEvent): void => sink.current.keydown(event)
  art.template.$player.addEventListener('keydown', onKeydown)
  art.on('destroy', () => {
    art.template?.$player?.removeEventListener('keydown', onKeydown)
  })

  return { art, hls, node, sink, disposers: [] }
}

/** 最终拆除：销毁 hls 与 Artplayer，节点移出文档 */
export function destroyArtCore(core: ArtCore): void {
  core.hls.destroy()
  for (const dispose of core.disposers) dispose()
  try {
    core.art.destroy(false)
  } catch {
    // ignore
  }
  core.node.remove()
}
