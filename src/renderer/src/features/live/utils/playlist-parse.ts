/**
 * 直播源解析（纯函数）：m3u / m3u8 播放列表与 TVBox 风格 txt。
 *
 * - m3u：`#EXTM3U x-tvg-url="…"` 头给出节目单地址；`#EXTINF` 行带 tvg-id / tvg-name / tvg-logo / group-title，
 *   逗号后是频道名，下一条非注释行是地址（`$` 之后是备注，去掉）；`#EXTGRP` 也可指定分组；
 *   按频道写的 User-Agent / Referer（#EXTVLCOPT、#KODIPROP、#EXTHTTP、地址后缀 `|…`）见 playlist-headers.ts。
 * - txt：`分组,#genre#` 开一个分组，`频道名,地址` 是一条线路；地址可用 `#` 写多条，`$` 之后是线路备注。
 * 同名频道（忽略大小写与空白）合并成一个，多个地址作为线路，按出现顺序排列。只保留 http / https 地址。
 * 带请求头的线路地址形如 `地址|User-Agent=…&Referer=…`（规范写法见 shared/net/stream-headers）。
 */
import {
  type StreamHeaders,
  splitStreamHeaders,
} from '../../../../../shared/net/stream-headers'
import {
  headersFromAttrs,
  headersFromDirective,
  lineUrl,
} from './playlist-headers'

/** 一个频道（多个地址 = 多条线路） */
export interface LiveChannel {
  /** 频道键：归一后的名称，同名频道合并后共用 */
  id: string
  name: string
  group: string
  tvgId?: string
  tvgName?: string
  logo?: string
  urls: string[]
}

/** 解析结果 */
export interface ParsedPlaylist {
  format: 'm3u' | 'txt'
  channels: LiveChannel[]
  /** m3u 头里的节目单地址（x-tvg-url / url-tvg，可能有多个） */
  epgUrls: string[]
}

/** 没写分组的频道归到这里 */
export const DEFAULT_GROUP = '未分组'

/** 频道键：去空白、转小写（全角转半角） */
export const channelKey = (name: string): string =>
  name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()

const isPlayableUrl = (url: string): boolean => /^https?:\/\/\S+$/i.test(url)

/** 判断格式：出现 #EXTM3U / #EXTINF 即为 m3u，否则按 txt */
export function detectFormat(text: string): 'm3u' | 'txt' {
  return /^\s*#EXT(M3U|INF)/im.test(text) ? 'm3u' : 'txt'
}

/** 解析 `key="value"` 形式的属性（属性名转小写） */
export function parseExtAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = m[2].trim()
  return attrs
}

/** 拆开 `#EXTINF:` 行：引号外的第一个逗号左边是属性，右边是频道名 */
export function splitExtinf(line: string): {
  attrs: Record<string, string>
  title: string
} {
  const body = line.replace(/^#EXTINF:/i, '')
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted)
      return {
        attrs: parseExtAttributes(body.slice(0, i)),
        title: body.slice(i + 1).trim(),
      }
  }
  return { attrs: parseExtAttributes(body), title: '' }
}

/** 把逗号分隔的节目单地址拆开、去重 */
export function splitEpgUrls(raw: string | undefined): string[] {
  if (!raw) return []
  const urls = raw
    .split(/[,\s]+/)
    .map(url => url.trim())
    .filter(isPlayableUrl)
  return [...new Set(urls)]
}

/** 频道合并器：同名合并、地址去重、保留首次出现的分组与台标 */
function createCollector(): {
  add: (channel: Omit<LiveChannel, 'id' | 'urls'>, urls: string[]) => void
  list: () => LiveChannel[]
} {
  const byKey = new Map<string, LiveChannel>()
  return {
    add(channel, urls) {
      const playable = urls
        .map(url => lineUrl(url.trim()))
        .filter(url => isPlayableUrl(splitStreamHeaders(url).url))
      const key = channelKey(channel.name)
      if (!key || !playable.length) return
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, { ...channel, id: key, urls: [...new Set(playable)] })
        return
      }
      for (const url of playable)
        if (!existing.urls.includes(url)) existing.urls.push(url)
      existing.tvgId ||= channel.tvgId
      existing.tvgName ||= channel.tvgName
      existing.logo ||= channel.logo
    },
    list: () => [...byKey.values()],
  }
}

/** 解析 m3u / m3u8 */
export function parseM3u(text: string): ParsedPlaylist {
  const collector = createCollector()
  const epgUrls: string[] = []
  let pending: { attrs: Record<string, string>; title: string } | null = null
  let groupLine = ''
  /** 上一条地址之后出现的请求头指令（可写在 #EXTINF 前后） */
  let directive: StreamHeaders | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#EXTM3U/i.test(line)) {
      const attrs = parseExtAttributes(line)
      epgUrls.push(...splitEpgUrls(attrs['x-tvg-url'] || attrs['url-tvg']))
    } else if (/^#EXTINF:/i.test(line)) {
      pending = splitExtinf(line)
      groupLine = ''
    } else if (/^#EXTGRP:/i.test(line)) {
      groupLine = line.slice(8).trim()
    } else if (line.startsWith('#')) {
      const headers = headersFromDirective(line)
      if (headers) directive = { ...directive, ...headers }
    } else if (pending) {
      const { attrs, title } = pending
      const name = title || attrs['tvg-name'] || ''
      collector.add(
        {
          name,
          group: attrs['group-title'] || groupLine || DEFAULT_GROUP,
          tvgId: attrs['tvg-id'] || undefined,
          tvgName: attrs['tvg-name'] || undefined,
          logo: attrs['tvg-logo'] || undefined,
        },
        [lineUrl(line, { ...headersFromAttrs(attrs), ...directive })]
      )
      pending = null
      directive = undefined
    }
  }
  return {
    format: 'm3u',
    channels: collector.list(),
    epgUrls: [...new Set(epgUrls)],
  }
}

/** 解析 TVBox 风格 txt */
export function parseTvboxTxt(text: string): ParsedPlaylist {
  const collector = createCollector()
  let group = DEFAULT_GROUP
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const comma = line.indexOf(',')
    if (!line || line.startsWith('//') || comma <= 0) continue
    const name = line.slice(0, comma).trim()
    const rest = line.slice(comma + 1).trim()
    if (/^#genre#$/i.test(rest)) {
      group = name || DEFAULT_GROUP
      continue
    }
    const urls = rest.split('#').map(part => part.split('$')[0])
    collector.add({ name, group }, urls)
  }
  return { format: 'txt', channels: collector.list(), epgUrls: [] }
}

/** 按内容自动选择解析器 */
export function parsePlaylist(text: string): ParsedPlaylist {
  const clean = text.replace(/^\uFEFF/, '')
  return detectFormat(clean) === 'm3u' ? parseM3u(clean) : parseTvboxTxt(clean)
}
