/**
 * 服务端密钥存储（替代桌面端的 safeStorage）：<dataDir>/secrets.json，文件权限 0600。
 *
 * 环境变量优先、只读覆盖（不写回文件），便于 Docker / NAS 用编排文件注入：
 * - server.token      ← YINGBOX_SERVER_TOKEN（访问令牌）
 * - scrape.tmdbToken  ← 不覆盖：TMDB 环境变量由片库核心直接当兜底（envSecrets），
 *   文件里存的是用户在网页端填写的令牌，启动时补给片库（与桌面端 src/main/tmdb.ts 同一规则）。
 * NAS 上没有系统密钥链可用，安全性等同于数据目录的文件权限；数据目录请只让服务用户可读。
 */
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

/** 密钥键。 */
export const SECRET_KEYS = {
  serverToken: 'server.token',
  tmdbToken: 'scrape.tmdbToken',
} as const

/** 环境变量覆盖表：键 → 变量名。 */
const ENV_OVERRIDES: Record<string, string> = {
  [SECRET_KEYS.serverToken]: 'YINGBOX_SERVER_TOKEN',
}

/** 文件 + 环境变量的密钥存储。 */
export class FileSecretStore {
  private values: Record<string, string>

  constructor(
    private readonly file: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.values = this.read()
  }

  /** 取值：环境变量 > 文件。 */
  get(key: string): string | undefined {
    const envName = ENV_OVERRIDES[key]
    const fromEnv = envName ? this.env[envName]?.trim() : undefined
    return fromEnv || this.values[key] || undefined
  }

  /** 写入文件（null 或空串删除）；原子替换，权限 0600。 */
  set(key: string, value: string | null): void {
    const next = { ...this.values }
    if (value?.trim()) next[key] = value.trim()
    else delete next[key]
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, this.file)
    // 旧文件权限可能更宽（手动创建的），替换后再收紧一次；Windows 上 chmod 只影响只读位
    try {
      chmodSync(this.file, 0o600)
    } catch {
      /* 收紧失败不影响使用 */
    }
    this.values = next
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    } catch {
      return {}
    }
  }
}

/** 取访问令牌；没有时生成一个（32 字节随机，base64url）并落盘。 */
export function ensureServerToken(store: FileSecretStore): {
  token: string
  generated: boolean
} {
  const existing = store.get(SECRET_KEYS.serverToken)
  if (existing) return { token: existing, generated: false }
  const token = randomBytes(32).toString('base64url')
  store.set(SECRET_KEYS.serverToken, token)
  return { token, generated: true }
}
