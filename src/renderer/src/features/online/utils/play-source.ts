/**
 * 渲染层的播放源解析：共享规则（shared/online/play-source.ts）接上引擎的插件解析与页面嗅探。
 * 同时服务于在线源与本地文件：本地 filePath 由播放器自己转成 local:// 地址，不经这里。
 */
import {
  type PlaySourceDeps,
  type PlaySourceItem,
  resolvePlaySource as resolve,
  resolvePageToMedia as resolvePage,
} from '../../../../../shared/online/play-source'
import { onlineApi } from '../api/online'
import { useVODParser } from '../composables/use-vod-parser'

const deps: PlaySourceDeps = {
  playinfo: async fields => {
    const r = await useVODParser().getPlayinfo(fields)
    return r?.success ? r.data : null
  },
  resolvePage: url => onlineApi().resolvePage(url),
}

/** 把播放源解析为可直接播放的地址；失败原样返回，交由播放器报错。 */
export const resolvePlaySource = (
  item: PlaySourceItem & { filePath?: string; name?: string }
): Promise<string> => resolve(item, deps)

/** 页面地址 → 媒体直链：由引擎跟随跳转并从 HTML 中提取 m3u8，失败返回原地址。 */
export const resolvePageToMedia = (url: string): Promise<string> =>
  resolvePage(url, deps.resolvePage)
