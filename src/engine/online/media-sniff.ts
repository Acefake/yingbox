/**
 * 测速用的媒体校验：判断一个 HTTP 成功响应是不是可播放的媒体，
 * 防止把登录页、失效提示、接口报错等 HTML / JSON 页面当成可用源。
 *
 * - Content-Type 是网页 / 文本标记 / JSON / 脚本 / 样式的，直接判定不是媒体（不必下载正文）；
 * - 其余按正文首字节嗅探：m3u8（#EXTM3U）、mp4 / fMP4（ftyp、styp、moof 等 box）、MPEG-TS（0x47 同步字节）、
 *   flv、mkv / webm（EBML）、ID3 / ADTS 音频、avi（RIFF）、MPEG-PS；都不匹配的不是媒体。
 */

/** 嗅探需要的正文首部字节数（TS 要看第 0 和第 188 字节） */
export const SNIFF_BYTES = 192

/** 明确不是媒体的 Content-Type */
const NON_MEDIA_TYPE =
  /^(text\/(html|xml|css|javascript)|application\/(xhtml\+xml|xml|json|javascript|x-javascript|ecmascript)|application\/[\w.-]+\+(json|xml))$/

/** 取 Content-Type 的 MIME 部分（去掉 charset 等参数，小写）。 */
const mimeOf = (contentType: string): string =>
  contentType.split(';')[0].trim().toLowerCase()

/** Content-Type 已表明不是媒体时返回 true。 */
export function isNonMediaType(contentType: string): boolean {
  return NON_MEDIA_TYPE.test(mimeOf(contentType))
}

/** ISO BMFF（mp4 / fMP4 分片）开头常见的 box 类型 */
const MP4_BOXES = new Set([
  'ftyp',
  'styp',
  'moof',
  'moov',
  'sidx',
  'free',
  'mdat',
])

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end))

/** 去掉 UTF-8 BOM 和开头空白后的文本前缀（判断 m3u8 用）。 */
const textHead = (bytes: Uint8Array): string =>
  new TextDecoder()
    .decode(bytes.subarray(0, 64))
    .replace(/^\uFEFF/, '')
    .trimStart()

/** 按首字节嗅探媒体格式；不是已知媒体返回 undefined。 */
export function sniffMedia(head: Uint8Array): string | undefined {
  if (!head.length) return undefined
  if (textHead(head).startsWith('#EXTM3U')) return 'm3u8'
  if (head.length >= 8 && MP4_BOXES.has(ascii(head, 4, 8))) return 'mp4'
  if (head[0] === 0x47 && (head.length <= 188 || head[188] === 0x47))
    return 'ts'
  if (ascii(head, 0, 3) === 'FLV') return 'flv'
  if (
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  )
    return 'mkv'
  if (ascii(head, 0, 3) === 'ID3') return 'id3'
  if (head[0] === 0xff && head.length > 1 && (head[1] & 0xf0) === 0xf0)
    return 'adts'
  if (ascii(head, 0, 4) === 'RIFF') return 'avi'
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0xba)
    return 'mpeg-ps'
  return undefined
}

/** 校验响应是媒体：是则返回 undefined，否则返回失败原因。 */
export function mediaError(
  contentType: string,
  head: Uint8Array
): string | undefined {
  if (isNonMediaType(contentType)) return `不是媒体（${mimeOf(contentType)}）`
  return sniffMedia(head) ? undefined : '不是媒体数据'
}
