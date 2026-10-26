/**
 * 115 客户端接口（lixianssp 等）的 m115 编码：请求体 data = base64(RSA(随机 16 字节 + 异或 / 反转后的 JSON))，
 * 响应 data 用同一把公钥还原。115 云下载的「添加任务」只认这种编码（网页端旧接口已提示升级客户端）。
 *
 * 算法移植自 elevengo（github.com/deadblue/elevengo，internal/crypto/m115，MIT License，
 * Copyright (c) deadblue），按 TypeScript 重写；公钥与异或种子是 115 客户端里的公开常量。
 * RSA 是 1024 位、PKCS#1 v1.5（加密时类型 2 填充；还原响应用公钥做模幂、去掉填充）。
 * 公钥可注入，单测用自己生成的密钥对验证往返。
 */
import {
  constants,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from 'node:crypto'

/** RSA 公钥（模数与指数） */
export interface M115Key {
  n: bigint
  e: bigint
}

/** 115 客户端公钥 */
export const M115_PUBLIC: M115Key = {
  n: BigInt(
    '0x8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b86021' +
      '36477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad633' +
      '8c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f1' +
      '0a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683'
  ),
  e: 0x10001n,
}

const KEY_SEED = Buffer.from(
  'f0e569aebfdcbf8a1a45e8be7da673b8de8fe7c445da86c49b648b146ab4f1aa' +
    '3801359e26692c86006b4fa5363462a62a966818f24afdbd6b978f4d8f8913b7' +
    '6c8e93ed0e0d483ed72f88d8fefe7e8650954fd1eb832634db667b9c7e9d7a81' +
    '32eab633de3aa95934663baaba816048b9d5819cf86c8477ff5478265fbee81e' +
    '369f34805c452c9b76d51b8fccc3b8f5',
  'hex'
)
const CLIENT_KEY = Buffer.from('7806ad4c33865d184c013f46', 'hex')

/** 由 16 字节种子派生异或密钥 */
export function deriveKey(seed: Uint8Array, size: number): Buffer {
  const key = Buffer.alloc(size)
  for (let i = 0; i < size; i++) {
    key[i] = (seed[i] + KEY_SEED[size * i]) & 0xff
    key[i] ^= KEY_SEED[size * (size - i - 1)]
  }
  return key
}

/** 原地异或：前 len % 4 个字节从密钥头开始，其余从头循环 */
export function xorInPlace(data: Buffer, key: Uint8Array): void {
  const mod = data.length % 4
  for (let i = 0; i < mod; i++) data[i] ^= key[i % key.length]
  for (let i = mod; i < data.length; i++) data[i] ^= key[(i - mod) % key.length]
}

const toBytes = (value: bigint, length: number): Buffer =>
  Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex')

/** 模幂 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

const keyLength = (key: M115Key): number =>
  Math.ceil(key.n.toString(16).length / 2)

/** 公钥分块加密（PKCS#1 v1.5 类型 2，每块明文最多 keyLength - 11 字节） */
function rsaEncrypt(data: Buffer, key: M115Key): Buffer {
  const length = keyLength(key)
  const publicKey = createPublicKey({
    key: {
      kty: 'RSA',
      n: toBytes(key.n, length).toString('base64url'),
      e: Buffer.from(
        key.e
          .toString(16)
          .padStart(Math.ceil(key.e.toString(16).length / 2) * 2, '0'),
        'hex'
      ).toString('base64url'),
    },
    format: 'jwk',
  })
  const chunks: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += length - 11)
    chunks.push(
      publicEncrypt(
        { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
        data.subarray(offset, offset + length - 11)
      )
    )
  return Buffer.concat(chunks)
}

/** 用公钥还原服务端（私钥）加密的分块，去掉 PKCS#1 填充（第一个非首位的 0 之后是正文） */
function rsaRestore(data: Buffer, key: M115Key): Buffer {
  const length = keyLength(key)
  const out: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += length) {
    const block = BigInt(
      `0x${data.subarray(offset, offset + length).toString('hex') || '0'}`
    )
    const plain = toBytes(modPow(block, key.e, key.n), length)
    const start = plain.indexOf(0, 1)
    if (start > 0) out.push(plain.subarray(start + 1))
  }
  return Buffer.concat(out)
}

/** 编码请求：返回 base64 与这次用的 16 字节密钥（还原响应要用） */
export function m115Encode(
  json: string,
  key: M115Key = M115_PUBLIC,
  seed: Buffer = randomBytes(16)
): { data: string; seed: Buffer } {
  const body = Buffer.from(json, 'utf8')
  xorInPlace(body, deriveKey(seed, 4))
  body.reverse()
  xorInPlace(body, CLIENT_KEY)
  return {
    data: rsaEncrypt(Buffer.concat([seed, body]), key).toString('base64'),
    seed,
  }
}

/** 还原响应里的 data；格式不对时抛错 */
export function m115Decode(
  data: string,
  seed: Buffer,
  key: M115Key = M115_PUBLIC
): string {
  const plain = rsaRestore(Buffer.from(data, 'base64'), key)
  if (plain.length < 16) throw new Error('m115 响应太短')
  const body = Buffer.from(plain.subarray(16))
  xorInPlace(body, deriveKey(plain.subarray(0, 16), 12))
  body.reverse()
  xorInPlace(body, deriveKey(seed, 4))
  return body.toString('utf8')
}
