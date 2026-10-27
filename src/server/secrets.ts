/**
 * 服务端密钥存储（替代桌面端的 safeStorage）：<dataDir>/secrets.json，文件权限 0600。
 *
 * 文件里存的是用户在网页端填写的 TMDB 令牌（scrape.tmdbToken），启动时补给片库（与桌面端 src/main/tmdb.ts 同一规则）；
 * TMDB 环境变量由片库核心直接当兜底（envSecrets），不经过这里。
 * 访问令牌不落盘：只认环境变量 YINGBOX_SERVER_TOKEN（见 {@link serverTokenFromEnv}），没设就不鉴权。
 * NAS 上没有系统密钥链可用，安全性等同于数据目录的文件权限；数据目录请只让服务用户可读。
 */
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
  tmdbToken: 'scrape.tmdbToken',
} as const

/** 早期版本首次启动自动生成并落盘的访问令牌键；启动时删掉（见 {@link dropLegacyServerToken}）。 */
const LEGACY_SERVER_TOKEN_KEY = 'server.token'

/** 文件密钥存储。 */
export class FileSecretStore {
  private values: Record<string, string>

  constructor(private readonly file: string) {
    this.values = this.read()
  }

  /** 取值。 */
  get(key: string): string | undefined {
    return this.values[key] || undefined
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

/** 访问令牌：只取环境变量 YINGBOX_SERVER_TOKEN（去掉首尾空白）；没设或为空时 null，表示不鉴权。 */
export function serverTokenFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.YINGBOX_SERVER_TOKEN?.trim() || null
}

/**
 * 删掉数据目录里自动生成的旧访问令牌（server.token）。它不再参与鉴权，留着只会让人误以为还要输入；
 * 返回是否删了（入口据此打一行日志）。
 */
export function dropLegacyServerToken(store: FileSecretStore): boolean {
  if (!store.get(LEGACY_SERVER_TOKEN_KEY)) return false
  store.set(LEGACY_SERVER_TOKEN_KEY, null)
  return true
}
