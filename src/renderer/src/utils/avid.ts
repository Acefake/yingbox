/** 常见视频扩展名（含 iso），用于显示名与搜索清洗。 */
const MEDIA_EXT_RE = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rmvb|iso)$/i

/** 去掉文件名末尾的常见视频扩展名（大小写不敏感）。 */
export function stripMediaExtension(name: string): string {
  return name.replace(MEDIA_EXT_RE, '')
}

/**
 * 清理电影文件名用于搜索
 * 移除分辨率、编码、音频标记等场景发布组信息。
 * 纯年份括号（如 (2026) / 【2026】）会保留为年份 token，避免被整段括号剥离吃掉。
 */
export function cleanSearchParams(movieName: string): string {
  return (
    movieName
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
      .replace(
        /\b(HDR\d*|DV|Dolby[\s.]?Vision|HLG|SDR|10[-\s]?bit|12[-\s]?bit|8[-\s]?bit)\b/gi,
        ''
      )
      // 移除流媒体平台标记
      .replace(
        /\b(MAX|NF|AMZN|DSNP|HULU|iTUNES|ATVP|PCOK|STAN|CRAV|BCORE|iP)\b/gi,
        ''
      )
      // 移除来源标记
      .replace(
        /\b(BluRay|Blu-?Ray|BDRip|BDRemux|REMUX|WEB-?DL|WEBRip|WEB|HDTV|DVDRip|DVD|HDDVD)\b/gi,
        ''
      )
      // 移除编码标记
      .replace(/\b(x264|x265|H[\s.]?264|H[\s.]?265|HEVC|AVC|VP9|AV1)\b/gi, '')
      // 移除音频标记（含后续声道如 AC3 2.0 / DDP 5.1）
      .replace(
        /\b(AAC|DTS[\s-]?HD|DTS|TrueHD|Atmos|FLAC|AC3|EAC3|DDP?|MA)(?:[\s.]+\d+(?:[\s.]+\d+)?)?\b/gi,
        ''
      )
      // 移除发布组 -GROUP 和 @GROUP
      .replace(/-[A-Za-z0-9]+$/i, '')
      .replace(/@[A-Za-z0-9]+$/i, '')
      // 移除其它常见标记
      .replace(
        /\b(PROPER|REPACK|COMPLETE|DUBBED|SUBBED|MULTI|EXTENDED|UNCUT|REMASTERED|DIRECTORS[\s.]?CUT|LIMITED|INTERNAL)\b/gi,
        ''
      )
      // 清理多余空格和连字符碎片
      .replace(/\s+-\s+/g, ' ')
      .replace(/[-\s]+$/g, '')
      .replace(/^[-\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

type MediaDisplayTitleInput = {
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
export function resolveMediaDisplayTitle(
  input: MediaDisplayTitleInput | string
): string {
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
