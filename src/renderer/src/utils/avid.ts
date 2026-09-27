/** 常见视频扩展名（含 iso），用于显示名与搜索清洗。 */
const MEDIA_EXT_RE = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rmvb|iso)$/i

/** 去掉文件名末尾的常见视频扩展名（大小写不敏感）。 */
export function stripMediaExtension(name: string): string {
  return name.replace(MEDIA_EXT_RE, '')
}

/** 规范化本地 AV 文件名，移除网址、清晰度、编码与常见发布信息。 */
function cleanAvidCandidate(fileName: string): string {
  return fileName
    .replace(/[－—–_]/g, '-')
    .replace(MEDIA_EXT_RE, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|net|org|tv|cc|me|io|vip|xyz|top|site|info)(?:\/\S*)?/gi, ' ')
    .replace(/\b(?:4320|2160|1440|1080|720|576|540|480|360)[pi]\b/gi, ' ')
    .replace(/\b(?:4k|8k|uhd|fhd|hd|sd|hdr(?:10)?|dv|dolby[ .-]?vision|10bit|8bit)\b/gi, ' ')
    .replace(/\b(?:web[ .-]?(?:dl|rip)?|blu[ .-]?ray|bdrip|bdremux|remux|hdtv|dvd(?:rip)?|hddvd)\b/gi, ' ')
    .replace(/\b(?:x264|x265|h[ .-]?26[45]|hevc|avc|vp9|av1|aac|dts(?:[ .-]?hd)?|truehd|atmos|flac|ac3|eac3|ddp?[ .-]?\d(?:[ .-]?\d)?)\b/gi, ' ')
    .replace(/\b(?:chs|cht|中文字幕|中字|sub(?:bed)?|uncensored|uncut|leak|sample|trailer)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 从本地名称提取并标准化 AV 番号。
 * 支持 MIDE-123、ABC_001、FC2-PPV、1PONDO、加勒比等常见格式。
 */
export function extractAvid(fileName: string): string | null {
  const cleaned = cleanAvidCandidate(fileName).toUpperCase()
  if (!cleaned) return null

  const specialPatterns: Array<{ pattern: RegExp; format: (match: RegExpMatchArray) => string }> = [
    {
      pattern: /(?:^|[^A-Z0-9])FC2[-\s]*PPV[-\s]*(\d{5,8})(?=$|[^A-Z0-9])/,
      format: match => `FC2-PPV-${match[1]}`,
    },
    {
      pattern: /(?:^|[^A-Z0-9])1PONDO[-\s]*(\d{6})[-\s]?(\d{2,3})(?=$|[^A-Z0-9])/,
      format: match => `1PONDO-${match[1]}-${match[2]}`,
    },
    {
      pattern: /(?:^|[^A-Z0-9])CARIB(?:BEANCOM)?[-\s]*(\d{6})[-\s]?(\d{2,3})(?=$|[^A-Z0-9])/,
      format: match => `CARIB-${match[1]}-${match[2]}`,
    },
  ]

  for (const { pattern, format } of specialPatterns) {
    const match = cleaned.match(pattern)
    if (match) return format(match)
  }

  const match = cleaned.match(/(?:^|[^A-Z0-9])([A-Z]{2,8})[-\s.]*(\d{2,6})(?=$|[^A-Z0-9])/)
  return match ? `${match[1]}-${match[2]}` : null
}

/**
 * 清理电影文件名用于搜索
 * 移除分辨率、编码、音频标记等场景发布组信息。
 * 纯年份括号（如 (2026) / 【2026】）会保留为年份 token，避免被整段括号剥离吃掉。
 */
export function cleanSearchParams(movieName: string): string {
  return movieName
    // 移除文件扩展名
    .replace(MEDIA_EXT_RE, '')
    // 把点和下划线替换为空格
    .replace(/[._]/g, ' ')
    // 年份括号先展开为纯年份，再剥离其它括号内容
    .replace(/[[(【（]\s*((?:19|20)\d{2})\s*[\]】）]/g, ' $1 ')
    // 移除其它括号内容 [] () 【】（）
    .replace(/\s*[[(【（].*?[\]】）]\s*/g, ' ')
    // 移除分辨率
    .replace(/\b(1080[pi]|720p|480p|2160p|4K|UHD|576p)\b/gi, '')
    // 移除帧率标记
    .replace(/\b\d+(?:[.\s]\d+)?\s*fps\b/gi, '')
    // 移除 HDR 标记
    .replace(/\b(HDR\d*|DV|Dolby[\s.]?Vision|HLG|SDR|10[-\s]?bit|12[-\s]?bit|8[-\s]?bit)\b/gi, '')
    // 移除流媒体平台标记
    .replace(/\b(MAX|NF|AMZN|DSNP|HULU|iTUNES|ATVP|PCOK|STAN|CRAV|BCORE|iP)\b/gi, '')
    // 移除来源标记
    .replace(/\b(BluRay|Blu-?Ray|BDRip|BDRemux|REMUX|WEB-?DL|WEBRip|WEB|HDTV|DVDRip|DVD|HDDVD)\b/gi, '')
    // 移除编码标记
    .replace(/\b(x264|x265|H[\s.]?264|H[\s.]?265|HEVC|AVC|VP9|AV1)\b/gi, '')
    // 移除音频标记（含后续声道如 AC3 2.0 / DDP 5.1）
    .replace(/\b(AAC|DTS[\s-]?HD|DTS|TrueHD|Atmos|FLAC|AC3|EAC3|DDP?|MA)(?:[\s.]+\d+(?:[\s.]+\d+)?)?\b/gi, '')
    // 移除发布组 -GROUP 和 @GROUP
    .replace(/-[A-Za-z0-9]+$/i, '')
    .replace(/@[A-Za-z0-9]+$/i, '')
    // 移除其它常见标记
    .replace(/\b(PROPER|REPACK|COMPLETE|DUBBED|SUBBED|MULTI|EXTENDED|UNCUT|REMASTERED|DIRECTORS[\s.]?CUT|LIMITED|INTERNAL)\b/gi, '')
    // 清理多余空格和连字符碎片
    .replace(/\s+-\s+/g, ' ')
    .replace(/[-\s]+$/g, '')
    .replace(/^[-\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type MediaDisplayTitleInput = {
  name?: string
  metaTitle?: string
  metaYear?: string
  /** Live detail/scraped title (preferred when present) */
  movieInfo?: { title?: string; year?: string } | null
  /** Adult / backend meta title */
  meta?: { title?: string } | null
}

/**
 * Unified list/detail display title.
 * Prefer scraped/NFO title (+ year), else cleanSearchParams(name).
 */
export function resolveMediaDisplayTitle(input: MediaDisplayTitleInput | string): string {
  if (typeof input === 'string') {
    return cleanSearchParams(input) || stripMediaExtension(input) || input
  }

  const formatWithYear = (title: string, year?: string): string => {
    const t = title.trim()
    if (!t) return ''
    const y = String(year || '').trim()
    if (y && !t.includes(y)) return `${t} (${y})`
    return t
  }

  const fromMovie = formatWithYear(
    String(input.movieInfo?.title || ''),
    input.movieInfo?.year
  )
  if (fromMovie) return fromMovie

  const fromMetaTitle = formatWithYear(
    String(input.metaTitle || ''),
    input.metaYear
  )
  if (fromMetaTitle) return fromMetaTitle

  const fromAdult = String(input.meta?.title || '').trim()
  if (fromAdult) return fromAdult

  const name = String(input.name || '')
  if (!name) return ''
  return cleanSearchParams(name) || stripMediaExtension(name) || name
}
