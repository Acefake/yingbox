/**
 * 从文件名中提取 AV 号（如 "AAA-001"、"BBB_123"）
 * @returns 标准化的 AV 号，无法提取时返回 null
 */
export function extractAvid(fileName: string): string | null {
  const cleaned = fileName
    .replace(/\.[^/.]+$/, '') // 去扩展名
    .replace(/\s*\(\d{4}\)\s*$/, '') // 去年份后缀 (2020)
    .trim()

  const match = cleaned.match(/([A-Z]{2,6})[-_]?\s*(\d{2,4})/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

/**
 * 清理电影文件名用于搜索
 * 移除分辨率、编码、音频标记等场景发布组信息
 */
export function cleanSearchParams(movieName: string): string {
  return movieName
    // 移除文件扩展名
    .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rmvb)$/i, '')
    // 把点和下划线替换为空格
    .replace(/[._]/g, ' ')
    // 移除括号内容 [] () 【】（】
    .replace(/\s*[\[\(【（].*?[\]\)】）]\s*/g, ' ')
    // 移除分辨率
    .replace(/\b(1080[pi]|720p|480p|2160p|4K|UHD|576p)\b/gi, '')
    // 移除 HDR 标记
    .replace(/\b(HDR\d*|DV|Dolby[\s.]?Vision|HLG|SDR|10bit|12bit|8bit)\b/gi, '')
    // 移除流媒体平台标记
    .replace(/\b(MAX|NF|AMZN|DSNP|HULU|iTUNES|ATVP|PCOK|STAN|CRAV|BCORE|iP)\b/gi, '')
    // 移除来源标记
    .replace(/\b(BluRay|Blu-?Ray|BDRip|BDRemux|REMUX|WEB-?DL|WEBRip|WEB|HDTV|DVDRip|DVD|HDDVD)\b/gi, '')
    // 移除编码标记
    .replace(/\b(x264|x265|H[\s.]?264|H[\s.]?265|HEVC|AVC|VP9|AV1)\b/gi, '')
    // 移除音频标记
    .replace(/\b(AAC|DTS[\s-]?HD|DTS|TrueHD|Atmos|FLAC|AC3|EAC3|DDP?[\s.]?\d[\s.]?\d|MA[\s.]?\d[\s.]?\d)\b/gi, '')
    // 移除发布组 -GROUP 和 @GROUP
    .replace(/-[A-Za-z0-9]+$/i, '')
    .replace(/@[A-Za-z0-9]+$/i, '')
    // 移除其它常见标记
    .replace(/\b(PROPER|REPACK|COMPLETE|DUBBED|SUBBED|MULTI|EXTENDED|UNCUT|REMASTERED|DIRECTORS[\s.]?CUT|LIMITED|INTERNAL)\b/gi, '')
    // 清理多余空格和尾部连字符
    .replace(/[-\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}
