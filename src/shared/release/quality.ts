/**
 * 发布名的画质识别（全应用唯一的一份，纯函数）：从分享标题、磁力标题、文件名、在线源备注里认出
 * 分辨率、片源（REMUX / 蓝光 / WEB / HDTV）、杜比视界、HDR、编码、中文字幕、全景声和标题里写的体积。
 *
 * 用的地方：网盘页的画质角标 / 最佳版本 / 排序，规格标签（spec-badge），剧集追更、电影追踪与洗版的认文件。
 * 只看文字，认不出的不猜（返回 null / false）。
 */

/** 分辨率档：4K / 1080 / 720 / 480（含 576、360 这类标清） */
export type ReleaseResolution = '4K' | '1080' | '720' | '480'

/** 片源档：原盘重封装 / 蓝光 / 网络版 / 电视录制 */
export type ReleaseSource = 'REMUX' | 'BD' | 'WEB' | 'HDTV'

/** 视频编码 */
export type ReleaseCodec = 'HEVC' | 'AVC' | 'AV1'

/** 从文字里认出的画质 */
export interface ReleaseQuality {
  resolution: ReleaseResolution | null
  /** 分辨率的高度：2160 / 1080 / 720 / 480；认不出为 null */
  height: number | null
  source: ReleaseSource | null
  /** 杜比视界 */
  dolbyVision: boolean
  /** HDR（杜比视界之外的 HDR10 / HDR10+ / HDR） */
  hdr: boolean
  codec: ReleaseCodec | null
  /** 写明了中文字幕（中字 / 简繁 / 双语 / 字幕组 / chs …） */
  chineseSubs: boolean
  /** 杜比全景声 */
  atmos: boolean
  /** 排序分：分辨率 > 片源 > 动态范围；什么都没认出为 0 */
  rank: number
}

const RESOLUTIONS: Array<[ReleaseResolution, number, RegExp, number]> = [
  [
    '4K',
    2160,
    /(^|[^a-z0-9])(2160[pi]|4k|uhd|3840x2160)([^a-z0-9]|$)|ultra[\s._-]?hd/i,
    4,
  ],
  ['1080', 1080, /(^|\D)1080[pi]?(?!\d)|(^|[^a-z])fhd([^a-z]|$)/i, 3],
  ['720', 720, /(^|\D)720[pi](?!\d)|1280x720/i, 2],
  ['480', 480, /(^|[^a-z0-9])(480p|576p|360p)([^a-z0-9]|$)/i, 1],
]

// 片源按优先级认：REMUX 先于 BD（Remux 标题里常同时有 BluRay）；BD 认 BluRay / BDRip / BD1080P / 蓝光 / 原盘
const SOURCES: Array<[ReleaseSource, RegExp, number]> = [
  ['REMUX', /remux/i, 4],
  ['BD', /blu-?ray|bdrip|bdmv|蓝光|原盘|(^|[^a-z])bd(?=[^a-z]|$)/i, 3],
  ['WEB', /web-?dl|webrip|(^|[^a-z])web([^a-z]|$)/i, 2],
  ['HDTV', /hdtv/i, 1],
]

const CODECS: Array<[ReleaseCodec, RegExp]> = [
  ['HEVC', /x\.?265|h\.?265|hevc/i],
  ['AV1', /(^|[^a-z0-9])av1([^a-z0-9]|$)/i],
  ['AVC', /x\.?264|h\.?264|(^|[^a-z])avc([^a-z]|$)/i],
]

// 杜比视界允许空格 / 点 / 下划线 / 连字符分隔，DV 只认独立的词（不误认 DVD）；
// HDR 要求前后不是字母（HDR10 / HDR10+ 算，HDRip 片源标签不算）
const DV_RE = /杜比视界|dolby[\s._-]*vision|(^|[^a-z])dv([^a-z]|$)|dovi/i
const HDR_RE = /(^|[^a-z])hdr(10\+?)?([^a-z]|$)/i
const ATMOS_RE = /atmos|全景声/i
const CHINESE_SUB_RE =
  /中字|中英|简繁|简中|繁中|简体|繁体|中文字幕|双语|字幕组|(^|[^a-z])(chs|cht|zh-?cn|zh-?tw)([^a-z]|$)/i

/**
 * 认出一段文字里的画质。
 * @param text 分享 / 磁力标题、文件名或备注
 */
export function parseReleaseQuality(text: string): ReleaseQuality {
  const res = RESOLUTIONS.find(([, , re]) => re.test(text))
  const src = SOURCES.find(([, re]) => re.test(text))
  const dolbyVision = DV_RE.test(text)
  const hdr = !dolbyVision && HDR_RE.test(text)
  return {
    resolution: res?.[0] ?? null,
    height: res?.[1] ?? null,
    source: src?.[0] ?? null,
    dolbyVision,
    hdr,
    codec: CODECS.find(([, re]) => re.test(text))?.[0] ?? null,
    chineseSubs: CHINESE_SUB_RE.test(text),
    atmos: ATMOS_RE.test(text),
    rank: rankOf(res?.[1] ?? null, src?.[0] ?? null, dolbyVision, hdr),
  }
}

/** 排序分：分辨率 ×100 + 片源 ×10 + 动态范围 */
function rankOf(
  height: number | null,
  source: ReleaseSource | null,
  dolbyVision: boolean,
  hdr: boolean
): number {
  const res = RESOLUTIONS.find(([, h]) => h === height)?.[3] ?? 0
  const src = SOURCES.find(([s]) => s === source)?.[2] ?? 0
  return res * 100 + src * 10 + (dolbyVision ? 2 : hdr ? 1 : 0)
}

/**
 * 文字里写明的分辨率高度。
 * @returns 2160 / 1080 / 720 / 480；认不出为 null
 */
export function resolutionOf(text: string): number | null {
  return RESOLUTIONS.find(([, , re]) => re.test(text))?.[1] ?? null
}

/** 分辨率高度的显示名：4K / 1080p / 720p …；null 为「未知」 */
export function resolutionLabel(height: number | null): string {
  if (height === null) return '未知'
  return height >= 2160 ? '4K' : `${height}p`
}

/**
 * 几段文字合起来的画质：前面的优先（文件名 → 文件夹 → 分享标题），每一项取第一段认得出的；
 * 中文字幕任何一段写了都算。
 * @param texts 按可信度排好的几段文字
 */
export function mergedQuality(texts: readonly string[]): ReleaseQuality {
  const parsed = texts.filter(Boolean).map(parseReleaseQuality)
  const first = <K extends keyof ReleaseQuality>(
    key: K,
    empty: ReleaseQuality[K]
  ): ReleaseQuality[K] => parsed.find(q => q[key] !== empty)?.[key] ?? empty
  const height = first('height', null)
  const resolution = first('resolution', null)
  const source = first('source', null)
  const dolbyVision = first('dolbyVision', false)
  const hdr = !dolbyVision && first('hdr', false)
  return {
    resolution,
    height,
    source,
    dolbyVision,
    hdr,
    codec: first('codec', null),
    chineseSubs: parsed.some(q => q.chineseSubs),
    atmos: parsed.some(q => q.atmos),
    rank: rankOf(height, source, dolbyVision, hdr),
  }
}

/**
 * 分享里一个文件的画质：文件名 → 所在文件夹 → 分享标题依次补；分辨率只认文件名与文件夹
 * （分享标题常写「4K / 1080P 合集」，替不了里面每个文件）。
 */
export function fileQuality(
  name: string,
  folder: string,
  shareTitle: string
): ReleaseQuality {
  const all = mergedQuality([name, folder, shareTitle])
  const own = mergedQuality([name, folder])
  return {
    ...all,
    resolution: own.resolution,
    height: own.height,
    rank: rankOf(own.height, all.source, all.dolbyVision, all.hdr),
  }
}

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(TB|GB|MB|T|G|M)(?![a-z])/i

/** 标题里写的体积（「106.6 GB」「73.3G」）→ 字节数；没写为 0 */
export function sizeFromTitle(title: string): number {
  const hit = SIZE_RE.exec(title)
  if (!hit) return 0
  const unit = hit[2].toUpperCase()[0]
  const power = unit === 'T' ? 4 : unit === 'G' ? 3 : 2
  return Math.round(Number(hit[1]) * 1024 ** power)
}

/** 给界面的短规格：「4K · WEB · DV · 中字」各一项；什么都没认出为空数组 */
export function qualitySpecs(q: ReleaseQuality): string[] {
  return [
    q.height !== null ? resolutionLabel(q.height) : '',
    q.source ?? '',
    q.dolbyVision ? 'DV' : q.hdr ? 'HDR' : '',
    q.chineseSubs ? '中字' : '',
  ].filter(Boolean)
}
