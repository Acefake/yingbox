import {
  ContractError,
  call,
  defineDomain,
  event,
  num,
  optArray,
  str,
  strs,
} from './define'
import { FOCUS_BATCH, type MediaFocus, parseFocus } from '../media-focus'
import type { SeekManifest, SeekStatus } from '../seek-thumbnails'

/**
 * 缩略图管线的渲染层接口：海报取景的焦点（缩略图管线算、随缩略图缓存持久化，见 shared/media-focus.ts），
 * 以及本地视频的进度条缩略图（雪碧图，见 shared/seek-thumbnails.ts）。
 */
export const media = defineDomain(
  'media',
  {
    /**
     * 这些图片地址（yingbox-media://image/ 或 thumb/，与 <img src> 相同）的焦点，按顺序返回；
     * 不是缩略图地址、原图取不到时为 null。缺的会现算（编解码线程里），一次最多 FOCUS_BATCH 张。
     */
    focus: call<[urls: string[]], Array<MediaFocus | null>>(a => {
      const urls = optArray<unknown>(a[0], 'urls')
      if (!urls) throw new ContractError('参数 urls 应为数组')
      if (urls.length > FOCUS_BATCH)
        throw new ContractError(`参数 urls 最多 ${FOCUS_BATCH} 个`)
      return [strs(urls, 'urls')]
    }),
    /** 写回渲染层 FaceDetector 的结果（或「检过、没有脸」）。 */
    saveFocus: call<[url: string, focus: MediaFocus], void>(a => {
      const focus = parseFocus(a[1])
      if (!focus) throw new ContractError('参数 focus 不是合法的焦点')
      return [str(a[0], 'url'), focus]
    }),
    /**
     * 本地视频（只接受 local:// 地址）的进度条缩略图：已生成带清单；否则后台排队生成，
     * 生成完推送 seekReady。没有 ffmpeg、时长太短 / 太长时返回 null 或始终等不到通知。
     */
    seekThumbnails: call<
      [localUrl: string, duration: number],
      SeekStatus | null
    >(a => [str(a[0], 'localUrl'), num(a[1], 'duration')]),
  },
  {
    /** 某部视频的进度条缩略图生成完（按 key 对应 seekThumbnails 的返回）。 */
    seekReady: event<SeekManifest>(),
  }
)
