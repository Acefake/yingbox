import { fetchHttp, readLimited } from './http-client'

/**
 * OpenSubtitles.com API v1 客户端（搜索 + 下载）。
 *
 * - API key 从环境变量 YINGBOX_OPENSUBTITLES_KEY 读取，未配置时搜索/下载直接返回明确错误
 * - 所有请求走 fetchHttp（SSRF 防护 + 重定向逐跳校验）
 * - 下载响应最大 10MB（普通 srt/ass 字幕足够；防异常响应撑爆内存）
 */

const API_BASE = 'https://api.opensubtitles.com/api/v1'
const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024
const USER_AGENT = 'yingbox v1.0.0'

interface OsSubtitleHit {
  /** 展示名：release 名或文件名 */
  name: string
  /** 语言代码（zh / en ...） */
  language: string
  /** 下载次数（排序参考） */
  downloads: number
  /** 评分（0-10，可能缺失） */
  rating?: number
  /** 文件大小（字节，可能缺失） */
  size?: number
  /** 上传格式 srt/ass/vtt */
  format: string
  /** 下载所需的 file_id */
  fileId: number
}

interface OsSearchResult {
  success: boolean
  data?: OsSubtitleHit[]
  error?: string
  /** true 表示未配置 API key */
  notConfigured?: boolean
}

function getApiKey(): string {
  return (process.env.YINGBOX_OPENSUBTITLES_KEY || '').trim()
}

function authHeaders(): Record<string, string> {
  return {
    'Api-Key': getApiKey(),
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  }
}

interface OsSearchFeature {
  attributes?: {
    feature_type?: string
    title?: string
    year?: number
  }
}

interface OsSearchData {
  id?: string
  attributes?: {
    language?: string
    download_count?: number
    rating?: number
    foreign_format_id?: string
    legacy_format?: string
    format?: string
    release?: string
    files?: Array<{
      file_id?: number
      file_name?: string
    }>
    feature_details?: {
      movie_title?: string
      year?: number
    }
  }
}

/** 归一化搜索结果为播放器可展示的条目 */
function mapHit(
  item: OsSearchData,
  fallbackTitle: string
): OsSubtitleHit | null {
  const attrs = item.attributes || {}
  const files = attrs.files || []
  const file = files.find(f => typeof f.file_id === 'number')
  if (!file || typeof file.file_id !== 'number') return null

  const language = attrs.language || 'zh'
  const release = (attrs.release || '').trim()
  const fileName = (file.file_name || '').trim()
  const featureTitle =
    attrs.feature_details?.movie_title ||
    (item as OsSearchFeature).attributes?.title ||
    ''
  const name = release || fileName || featureTitle || fallbackTitle

  return {
    name: `${name} [${language}]`,
    language,
    downloads: attrs.download_count || 0,
    rating: typeof attrs.rating === 'number' ? attrs.rating : undefined,
    format: (attrs.format || attrs.legacy_format || 'srt').toLowerCase(),
    fileId: file.file_id,
    size: undefined,
  }
}

/** 按标题搜索字幕（query 支持影视名；TMDB 有 imdb id 时传 imdbId 可大幅提准） */
export async function searchSubtitles(options: {
  query?: string
  imdbId?: string
  episode?: number
  season?: number
  languages?: string
}): Promise<OsSearchResult> {
  const key = getApiKey()
  if (!key) {
    return {
      success: false,
      notConfigured: true,
      error:
        '未配置 OpenSubtitles API key（环境变量 YINGBOX_OPENSUBTITLES_KEY）',
    }
  }
  if (!options.query && !options.imdbId) {
    return { success: false, error: 'query 与 imdbId 至少提供一个' }
  }

  const params = new URLSearchParams()
  if (options.imdbId) params.set('imdb_id', options.imdbId.replace(/^tt/i, ''))
  if (options.query) params.set('query', options.query)
  if (typeof options.season === 'number')
    params.set('season', String(options.season))
  if (typeof options.episode === 'number')
    params.set('episode_number', String(options.episode))
  params.set('languages', options.languages || 'zh,en')

  try {
    const response = await fetchHttp(
      `${API_BASE}/subtitles?${params.toString()}`,
      { headers: authHeaders() },
      20000
    )
    const text = (await readLimited(response, 4 * 1024 * 1024)).toString(
      'utf-8'
    )
    const parsed = JSON.parse(text) as { data?: OsSearchData[] }
    const list = Array.isArray(parsed.data) ? parsed.data : []
    const hits = list
      .map(item => mapHit(item, options.query || ''))
      .filter((hit): hit is OsSubtitleHit => hit !== null)
    return { success: true, data: hits }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

interface OsDownloadResult {
  success: boolean
  /** 转换后的 WebVTT 文本 */
  data?: string
  format?: string
  error?: string
  notConfigured?: boolean
}

/** 按 file_id 下载字幕并统一转成 WebVTT 文本 */
export async function downloadSubtitle(
  fileId: number
): Promise<OsDownloadResult> {
  const key = getApiKey()
  if (!key) {
    return {
      success: false,
      notConfigured: true,
      error:
        '未配置 OpenSubtitles API key（环境变量 YINGBOX_OPENSUBTITLES_KEY）',
    }
  }
  try {
    // 1) 换取临时下载地址
    const linkResponse = await fetchHttp(
      `${API_BASE}/download`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
      },
      20000
    )
    const linkText = (await readLimited(linkResponse, 1024 * 1024)).toString(
      'utf-8'
    )
    const link = JSON.parse(linkText) as { link?: string; remaining?: number }
    if (!link.link) throw new Error('未获取到下载地址')

    // 2) 下载字幕内容（通常是 gzip 压缩的 srt）
    const fileResponse = await fetchHttp(link.link, {}, 30000)
    const buffer = await readLimited(fileResponse, MAX_SUBTITLE_BYTES)

    // 3) 可能是 gzip（OpenSubtitles 对 srt 常返回 gzip）；逐字节探测魔数解压
    let bytes = buffer
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      const zlib = (await import('node:zlib')) as typeof import('node:zlib')
      // 解压后同样限长：防 gzip 炸弹把主进程内存撑爆
      bytes = zlib.gunzipSync(buffer, { maxOutputLength: MAX_SUBTITLE_BYTES })
    }

    // OpenSubtitles 常返回 UTF-8，但老字幕可能 GBK / Big5：转 VTT 前过一遍编码修正
    const { decodeSubtitleText, convertSubtitleText } =
      await import('./subtitle')
    const normalized = decodeSubtitleText(bytes)
    const converted = convertSubtitleText(normalized, 'srt')
    if (!converted.success) return { success: false, error: converted.error }

    // SRT 转换没产出 cue 时 convertSubtitleText 原样交回解码后的文本（与本地链路一致）
    return { success: true, data: converted.data, format: 'srt' }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
