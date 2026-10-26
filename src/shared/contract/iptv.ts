import {
  ContractError,
  bool,
  call,
  defineDomain,
  int,
  optArray,
  str,
} from './define'
import type { StreamKind } from '../iptv/stream-kind'

/** 读到的播放列表原文（m3u / m3u8 / TVBox txt），由渲染层解析 */
export interface PlaylistText {
  ok: boolean
  text?: string
  error?: string
}

/** 直播线路探测的失败原因：超时、HTTP 状态码、被安全策略拦下（内网地址等）、网络错误 */
export type StreamProbeFailure = 'timeout' | 'http' | 'blocked' | 'network'

/** 直播线路探测结果（主进程按 Content-Type 与开头字节判断格式，见 shared/iptv/stream-kind.ts） */
export interface StreamProbe {
  ok: boolean
  /** 识别出的格式（StreamKind）；失败时没有 */
  kind?: StreamKind
  /** 上游 HTTP 状态码 */
  status?: number
  /** 跟随重定向后的最终地址 */
  finalUrl?: string
  contentType?: string
  failure?: StreamProbeFailure
  /** 失败原因原文（日志 / 提示用） */
  error?: string
}

/** 用户从对话框选中的本地播放列表 */
export interface PickedPlaylist extends PlaylistText {
  canceled?: boolean
  /** 文件完整路径（之后刷新按它重读） */
  path?: string
  /** 文件名，用作源的默认名称 */
  name?: string
}

/** 一档节目（时间为毫秒时间戳） */
export interface EpgProgramme {
  start: number
  stop: number
  title: string
}

/** EPG 加载结果 */
export interface EpgLoadResult {
  ok: boolean
  /** 这份节目单的下载时间（毫秒） */
  fetchedAt?: number
  /** 节目单里的频道数 */
  channels?: number
  error?: string
}

/** 按频道查节目：key 原样带回，tvgId / names 用来在节目单里匹配频道 */
export interface EpgQuery {
  key: string
  tvgId?: string
  names: string[]
}

/** 一次最多查询的频道数 */
export const EPG_QUERY_LIMIT = 5000

/** 校验并收窄 EpgQuery 数组 */
function parseQueries(value: unknown): EpgQuery[] {
  const list = optArray<unknown>(value, 'queries')
  if (!list) throw new ContractError('参数 queries 应为数组')
  if (list.length > EPG_QUERY_LIMIT)
    throw new ContractError(`参数 queries 最多 ${EPG_QUERY_LIMIT} 个`)
  return list.map((raw, index) => {
    const item = raw as Partial<EpgQuery> | null
    if (!item || typeof item !== 'object')
      throw new ContractError(`参数 queries[${index}] 应为对象`)
    const names = Array.isArray(item.names)
      ? item.names.filter((n): n is string => typeof n === 'string')
      : []
    return {
      key: str(item.key, `queries[${index}].key`),
      tvgId: typeof item.tvgId === 'string' ? item.tvgId : undefined,
      names,
    }
  })
}

/** IPTV 直播：播放列表读取与 XMLTV 节目单（下载、解压、解析都在主进程）。 */
export const iptv = defineDomain('iptv', {
  /** 下载远程播放列表（http/https，经主进程 SSRF 防护的出网口） */
  fetchPlaylist: call<[url: string], PlaylistText>(a => [str(a[0], 'url')]),
  /** 探测一条直播线路：跟随重定向、读开头几 KB 判断格式（HLS / MP4 / FLV / TS…），超时与 HTTP 错误带原因返回 */
  probeStream: call<[url: string], StreamProbe>(a => [str(a[0], 'url')]),
  /** 弹出对话框选择本地播放列表并读出原文 */
  pickPlaylistFile: call<PickedPlaylist>(),
  /** 重读之前选过的本地播放列表（只接受 .m3u / .m3u8 / .txt） */
  readPlaylistFile: call<[path: string], PlaylistText>(a => [
    str(a[0], 'path'),
  ]),
  /** 加载 XMLTV 节目单（支持 .xml.gz）；12 小时内用缓存，force 强制重新下载 */
  loadEpg: call<[url: string, force: boolean], EpgLoadResult>(a => [
    str(a[0], 'url'),
    bool(a[1], 'force'),
  ]),
  /** 在已加载的节目单里查这些频道在 [from, to) 内的节目，按 key 返回 */
  epgProgrammes: call<
    [url: string, queries: EpgQuery[], from: number, to: number],
    { ok: boolean; data?: Record<string, EpgProgramme[]>; error?: string }
  >(a => [
    str(a[0], 'url'),
    parseQueries(a[1]),
    int(a[2], 'from'),
    int(a[3], 'to'),
  ]),
})
