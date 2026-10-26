/**
 * 一个播放器的 hls.js 会话：生成交给 Artplayer 的 m3u8 自定义加载器，并保证同一时刻只有一个 Hls 实例。
 * 换源前、播放器销毁时调用 destroy()。
 */
import type Artplayer from 'artplayer'
import Hls, { type ErrorData } from 'hls.js'
import { splitStreamHeaders } from '../../../../../shared/net/stream-headers'
import { desktopHlsLoader } from './hls-loader'

import type { ArtOption } from './art-options'

/** HLS 加载过程中的回调 */
export interface HlsCallbacks {
  /** 清单解析完成（可在此续播、自动播放） */
  onManifestParsed: (video: HTMLVideoElement) => void
  /** 不可恢复的错误（data 为 hls.js 的错误数据，原因文案见 play-errors.ts） */
  onFatalError: (instance: Artplayer, data: ErrorData) => void
}

/** createHlsSession 的返回值 */
export interface HlsSession {
  /** 生成 Artplayer 的 customType（只含 m3u8） */
  customType: (callbacks: HlsCallbacks) => NonNullable<ArtOption['customType']>
  /** 销毁当前 Hls 实例（没有则什么都不做） */
  destroy: () => void
  /** 当前的 Hls 实例（播放信息面板读档位用）；非 HLS 或已销毁为 null */
  instance: () => Hls | null
}

/** 创建一个 hls.js 会话 */
export function createHlsSession(): HlsSession {
  let hls: Hls | null = null

  const destroy = (): void => {
    if (!hls) return
    hls.destroy()
    hls = null
  }

  const customType = (
    callbacks: HlsCallbacks
  ): NonNullable<ArtOption['customType']> => ({
    m3u8(videoEl: HTMLVideoElement, url: string, instance: Artplayer): void {
      destroy()
      // 直播线路可带 `|User-Agent=…&Referer=…`：拆开，头交给桌面加载器（网页端的地址已由 webPlayableUrl 换成代理地址）
      const line = splitStreamHeaders(url)
      hls = new Hls({
        enableWorker: true,
        ...(window.api ? { loader: desktopHlsLoader(line.headers) } : {}),
      })
      hls.loadSource(line.url)
      hls.attachMedia(videoEl)
      hls.on(Hls.Events.MANIFEST_PARSED, () =>
        callbacks.onManifestParsed(videoEl)
      )
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) callbacks.onFatalError(instance, data)
      })
      instance.on('destroy', destroy)
    },
  })

  return { customType, destroy, instance: () => hls }
}
