/**
 * 测速用的 HLS 加密处理：解析 EXT-X-KEY、算 IV、解密首分片开头、识别错误页。
 *
 * - AES-128：整段 AES-128-CBC 加密，拿到 16 字节密钥后解密分片开头若干个整块即可嗅探魔数
 *   （CBC 解密任意整块前缀不依赖后续数据，不需要处理填充）；
 * - IV 缺省时按分片的媒体序号（EXT-X-MEDIA-SEQUENCE 起算）转成 16 字节大端数；
 * - SAMPLE-AES 等只加密部分样本的方式、或密钥拿不到时无法校验魔数，
 *   只用 looksLikeErrorPage 排除明显的 HTML / JSON 错误页。
 */
import { createDecipheriv } from 'node:crypto'

import { sequenceIv } from '../download/hls'

/** 首个分片生效的加密信息（原始写法，URI 未补全）。 */
export interface HlsKey {
  /** METHOD 原值：AES-128、SAMPLE-AES、SAMPLE-AES-CTR 等 */
  method: string
  uri?: string
  /** 16 字节 IV；缺省时按媒体序号 */
  iv?: Uint8Array
}

/** AES 块大小（字节） */
const BLOCK = 16

/** 读标签属性（支持带引号、含逗号的值）。 */
const attr = (line: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|[:,])${name}=("([^"]*)"|[^,]*)`, 'i').exec(line)
  return m ? (m[2] ?? m[1]) : undefined
}

/** 解析 IV 属性（0x 开头的十六进制，不足 32 位左补 0）；格式不对返回 undefined。 */
const parseIv = (value: string | undefined): Uint8Array | undefined => {
  const hex = value?.replace(/^0x/i, '')
  if (!hex || !/^[0-9a-f]{1,32}$/i.test(hex)) return undefined
  return Uint8Array.from(Buffer.from(hex.padStart(32, '0'), 'hex'))
}

/** 解析一行 #EXT-X-KEY；METHOD=NONE（取消加密）返回 undefined。 */
export function parseKeyTag(line: string): HlsKey | undefined {
  const method = (attr(line, 'METHOD') || '').toUpperCase()
  if (!method || method === 'NONE') return undefined
  const uri = attr(line, 'URI')
  const iv = parseIv(attr(line, 'IV'))
  return { method, ...(uri ? { uri } : {}), ...(iv ? { iv } : {}) }
}

/** 分片实际用的 IV：清单写了就用，否则按媒体序号。 */
export const keyIv = (key: HlsKey, sequence: number): Uint8Array =>
  key.iv ?? Uint8Array.from(sequenceIv(sequence))

/**
 * AES-128-CBC 解密分片开头的整块部分（不足一块返回 undefined）。
 * 密钥不是 16 字节时也返回 undefined。
 */
export function decryptHead(
  head: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Uint8Array | undefined {
  const size = head.byteLength - (head.byteLength % BLOCK)
  if (!size || key.byteLength !== BLOCK || iv.byteLength !== BLOCK)
    return undefined
  const decipher = createDecipheriv('aes-128-cbc', key, iv)
  decipher.setAutoPadding(false)
  return Uint8Array.from(decipher.update(head.subarray(0, size)))
}

/** 控制字符（除 \t \n \r 外）：文本错误页里不会出现 */
const isControl = (byte: number): boolean =>
  byte < 0x09 || byte === 0x0b || byte === 0x0c || (byte > 0x0d && byte < 0x20)

/**
 * 正文开头像 HTML / XML / JSON 文本错误页时返回 true。
 * 要求首个非空白字符是 < { [ 且前 64 字节没有控制字符，密文随机字节几乎不可能同时满足。
 */
export function looksLikeErrorPage(head: Uint8Array): boolean {
  const start = head.subarray(0, 64)
  if (!start.length || start.some(isControl)) return false
  const text = new TextDecoder()
    .decode(start)
    .replace(/^\uFEFF/, '')
    .trimStart()
  return /^[<{[]/.test(text)
}
