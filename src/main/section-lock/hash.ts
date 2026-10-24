/**
 * 应用密码的 scrypt 哈希：随机盐，参数随哈希一起保存（格式 `scrypt$N$r$p$盐$哈希`，base64），
 * 校验用定长比较。只保存哈希，不保存明文。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/** 新哈希使用的参数：N = 2^14、r = 8、p = 1（约 16 MB 内存），32 字节输出、16 字节盐 */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const
const KEY_LENGTH = 32
const SALT_LENGTH = 16
/** 校验时接受的参数上限（防止被改坏的文件让校验吃光内存） */
const MAX_N = 1 << 17
const MAX_R = 16
const MAX_P = 4

interface ScryptOptions {
  N: number
  r: number
  p: number
}

function derive(
  password: string,
  salt: Buffer,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFC'),
      salt,
      KEY_LENGTH,
      { ...options, maxmem: 256 * options.N * options.r },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  })
}

/** 生成密码哈希 */
export async function hashPassword(
  password: string,
  options: ScryptOptions = SCRYPT_PARAMS
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, options)
  return [
    'scrypt',
    options.N,
    options.r,
    options.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$')
}

/** 解析保存的哈希；格式或参数不对返回 null */
export function parseHash(
  stored: string
): { options: ScryptOptions; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [N, r, p] = parts.slice(1, 4).map(Number)
  const powerOfTwo = Number.isSafeInteger(N) && N > 1 && (N & (N - 1)) === 0
  if (!powerOfTwo || N > MAX_N) return null
  if (!Number.isSafeInteger(r) || r < 1 || r > MAX_R) return null
  if (!Number.isSafeInteger(p) || p < 1 || p > MAX_P) return null
  const salt = Buffer.from(parts[4], 'base64')
  const key = Buffer.from(parts[5], 'base64')
  if (salt.length < 8 || key.length !== KEY_LENGTH) return null
  return { options: { N, r, p }, salt, key }
}

/** 校验密码；哈希损坏时一律不通过 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parsed = parseHash(stored)
  if (!parsed) return false
  const key = await derive(password, parsed.salt, parsed.options)
  return timingSafeEqual(key, parsed.key)
}
