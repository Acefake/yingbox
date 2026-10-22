import {
  ContractError,
  call,
  defineDomain,
  optArray,
  str,
  strs,
} from './define'
import { FOCUS_BATCH, type MediaFocus, parseFocus } from '../media-focus'

/** 海报取景的焦点（缩略图管线算、随缩略图缓存持久化，见 shared/media-focus.ts）。 */
export const media = defineDomain('media', {
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
})
