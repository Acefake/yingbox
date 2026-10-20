/**
 * 发布信息词表：分辨率、来源、编码、音轨、HDR、版本、语言字幕等标记，以及附加内容关键字。
 *
 * “强标记”可以在片名中途截断片名（片名里几乎不会出现）；“弱标记”只在片名结束后才被当作噪音，
 * 避免误伤 Mad Max、Charlotte's Web 这类片名。所有判断都用小写比较。
 */
import { memoize } from './memo'

const STRONG_WORDS = new Set([
  // 分辨率
  '4k',
  '8k',
  '2k',
  'uhd',
  'fhd',
  'qhd',
  // 来源
  'bluray',
  'blu-ray',
  'bdrip',
  'brrip',
  'bdremux',
  'remux',
  'web-dl',
  'webdl',
  'webrip',
  'web-rip',
  'hdtv',
  'pdtv',
  'dvdrip',
  'dvdscr',
  'hdrip',
  'hddvd',
  'bd',
  'dvd5',
  'dvd9',
  'uhdtv',
  // 编码
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  'av1',
  'vp9',
  'xvid',
  'divx',
  '10bit',
  '8bit',
  '10-bit',
  '8-bit',
  'hi10p',
  'hevc-10bit',
  // 音轨
  'aac',
  'ac3',
  'eac3',
  'e-ac3',
  'dts',
  'dts-hd',
  'dts-x',
  'truehd',
  'atmos',
  'flac',
  'lpcm',
  'ddp',
  'dd+',
  'opus',
  'mp3',
  // HDR
  'hdr',
  'hdr10',
  'hdr10+',
  'hdr10plus',
  'dovi',
  'hlg',
  'sdr',
  // 流媒体（片名里不会出现的缩写）
  'amzn',
  'dsnp',
  'atvp',
  'hmax',
  'pcok',
  'hulu',
  'crav',
  'bcore',
  // 版本与发布标记
  'extended',
  'repack',
  'proper',
  'remastered',
  'unrated',
  'imax',
  'limited',
  'criterion',
  'directors',
  'uncut',
  'internal',
  'theatrical',
  'complete',
  'multi',
  'subbed',
  'dubbed',
  'rerip',
])

/** 只在片名结束后才视为噪音的标记。 */
const WEAK_WORDS = new Set([
  'web',
  'max',
  'nf',
  'it',
  'dv',
  'hd',
  'hq',
  'sd',
  'stan',
  'ma',
  'dl',
  'bili',
])

/** 出现在片名末尾时要剥掉的弱标记（“我不是药神.HD.1080p”）。 */
export const TRAILING_NOISE = new Set(['hd', 'hq', 'sd'])

const STRONG_PATTERNS: RegExp[] = [
  /^\d{3,4}[pi]$/, // 1080p / 1080i
  /^\d{3,4}x\d{3,4}$/, // 1920x1080
  /^(?:hd|fhd|uhd)\d{3,4}p$/, // HD1080P
  /^\d{2,3}fps$/,
  /^(?:ddp?|dd\+|aac|ac3|eac3|dts|truehd|flac|opus|lpcm)\d{1,2}$/, // DDP5 / AAC2
  /^h26[45]$/,
]

/** 中文发布标记：词里含这些片段即视为标记。 */
const CJK_TAG_RE =
  /国语|國語|粤语|粵語|国粤|国英|中字|中英|双字|雙字|字幕|内封|內封|简繁|簡繁|简日|简体|繁体|删减|刪減|双语|雙語|音轨|音軌|特效|蓝光|藍光|高清|超清|中文/

/** 只在方括号里出现的语言、平台、容器标记。 */
const BRACKET_ONLY_WORDS = new Set([
  'eng',
  'chs',
  'cht',
  'gb',
  'big5',
  'jpsc',
  'jptc',
  'chi',
  'jpn',
  'jap',
  'sub',
  'subs',
  'subtitle',
  'subtitles',
  'multiple',
  'multi-sub',
  'multisub',
  'baha',
  'mp4',
  'mkv',
  'avi',
  'vostfr',
  'raw',
  'dual',
  'audio',
  'tv',
  'web',
  'bdrip',
  'dvd',
  'v2',
  'v3',
  'fin',
  'end',
])

/** 文件名末尾“-组名”里组名之外，可连在一起的带连字符标记。 */
export const HYPHEN_TAGS = new Set([
  'web-dl',
  'web-rip',
  'blu-ray',
  'dts-hd',
  'dts-x',
  'e-ac3',
  '10-bit',
  '8-bit',
  'hevc-10bit',
  'multi-sub',
])

/** 是否强标记。 */
export const isStrongTag = memoize((word: string): boolean => {
  const w = word.toLowerCase()
  return (
    STRONG_WORDS.has(w) ||
    STRONG_PATTERNS.some(re => re.test(w)) ||
    CJK_TAG_RE.test(w)
  )
})

/** 是否任意发布标记（强、弱或括号专用）。 */
export const isAnyTag = memoize((word: string): boolean => {
  const w = word.toLowerCase()
  return (
    isStrongTag(w) ||
    WEAK_WORDS.has(w) ||
    BRACKET_ONLY_WORDS.has(w) ||
    /^[0-9a-f]{8}$/i.test(w)
  )
})

/** 括号内容含这些片段时是中文标记括号（[国语音轨+中文字幕]、[简繁内封]）。 */
export function hasCjkTag(text: string): boolean {
  return CJK_TAG_RE.test(text)
}

/** 附加内容关键字（单独成词或作为 -suffix）。 */
const EXTRA_WORDS = new Set([
  'sample',
  'trailer',
  'teaser',
  'featurette',
  'featurettes',
  'behindthescenes',
  'deleted',
  'deletedscene',
  'deletedscenes',
  'interview',
  'short',
  'extra',
  'extras',
  'bloopers',
  '预告',
  '预告片',
  '花絮',
  '片花',
  '特辑',
  '幕后',
])

/** 是否附加内容关键字。 */
export function isExtraWord(word: string): boolean {
  return EXTRA_WORDS.has(word.toLowerCase())
}

/** 附加内容文件夹名（整名匹配）。 */
export const EXTRAS_FOLDER_RE =
  /^(?:extras?|featurettes?|behind[\s._-]?the[\s._-]?scenes|deleted[\s._-]?scenes|interviews?|scenes|shorts|trailers?|samples?|others?|bonus|花絮|预告片?|特辑|幕后)$/i

/** 光盘结构等不承载片名的文件夹。 */
export const STRUCTURAL_FOLDER_RE =
  /^(?:video_ts|audio_ts|bdmv|stream|playlist|clipinf|backup|certificate|auxdata|meta)$/i

/** 不承载片名、需要回退到文件夹名的文件名（已去扩展名）。 */
export const GENERIC_STEM_RE =
  /^(?:movie|film|video|main|feature|vts_\d+_\d+|video_ts|\d{5}|(?:cd|dvd|disc|disk|part|pt)[\s._-]?\d{1,2})$/i

/** 前置资源站名（“阳光电影www.ygdy8.com.片名”）。 */
export const SITE_PREFIX_RE =
  /^(?:阳光电影|电影天堂|高清影视之家(?:发布)?|BT天堂|飘花电影网?|人人影视|迅雷下载|龙部落|一起看小说)/

/** 字幕组 / 发布组名（桜都字幕组、LoliHouse 之外的 xx-raws、xxSubs）。 */
export const GROUP_NAME_RE =
  /(?:组|組|社|工作室|压制|汉化|漢化)$|raws$|subs$|fansub/i

/** 可识别的视频扩展名。 */
export const MEDIA_EXTENSION_RE =
  /\.(?:mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mts|rmvb|rm|vob|iso|mpe?g|3gp|divx|ogm|strm)$/i
