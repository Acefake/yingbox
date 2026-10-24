/**
 * 板块密码锁的主进程状态与写入规则（不依赖 Electron，便于测试）：应用密码哈希、锁的配置、
 * 输错限流、一次性验证凭据。
 *
 * 所有写入都在这里校验，不信任渲染层：
 * - 设了密码后，修改 / 清除密码、取消板块锁定、放宽重新锁定都要带一次性凭据，
 *   凭据只在本进程验证通过（密码正确或系统认证通过）时签发，用一次作废，过期作废；
 * - 增加锁定、收紧重新锁定不需要凭据；没设密码时锁不生效，配置随意改。
 */
import { randomBytes } from 'node:crypto'

import {
  DEFAULT_LOCK_CONFIG,
  type LockConfig,
  type LockVerifyResult,
  parseLockConfig,
  weakensLock,
} from '../../shared/section-lock'
import { hashPassword, parseHash, verifyPassword } from './hash'
import { createAttemptLimiter, createGrantStore } from './rules'

/** 落盘格式 */
export interface LockFile {
  version: 1
  /** scrypt 哈希；没设密码时为 null */
  hash: string | null
  sections: string[]
  relockMinutes: number
}

export interface SectionLockStoreOptions {
  /** 读出落盘内容（不存在或损坏时返回 null） */
  load: () => Promise<unknown>
  /** 原子写入落盘内容 */
  persist: (data: LockFile) => Promise<void>
  now?: () => number
  /** 新哈希的 scrypt 参数（测试用小参数） */
  hashOptions?: Parameters<typeof hashPassword>[1]
}

export interface SectionLockStore {
  /** 是否已设密码与当前配置 */
  status(): { passwordSet: boolean } & LockConfig
  /** 校验应用密码；通过时签发凭据。没设密码时不通过 */
  verify(password: string): Promise<LockVerifyResult>
  /** 系统认证（Touch ID）已由调用方确认通过：签发凭据 */
  grantForSystemAuth(): LockVerifyResult
  /** 设置 / 修改密码；已有密码时要有效凭据。写入返回 true，被拒返回 false */
  setPassword(grant: string, next: string): Promise<boolean>
  /** 清除密码并取消全部板块锁定；要有效凭据 */
  clearPassword(grant: string): Promise<boolean>
  /** 改锁的配置；设了密码且降低保护时要有效凭据 */
  setConfig(next: LockConfig, grant: string): Promise<boolean>
}

const failed = (retryAfterMs = 0): LockVerifyResult => ({
  ok: false,
  retryAfterMs,
  grant: '',
})

function initialState(raw: unknown): LockFile {
  const data = (raw ?? {}) as Partial<LockFile>
  const hash =
    typeof data.hash === 'string' && parseHash(data.hash) ? data.hash : null
  const config = parseLockConfig(data) ?? { ...DEFAULT_LOCK_CONFIG }
  return { version: 1, hash, ...config, sections: [...config.sections] }
}

export async function createSectionLockStore(
  options: SectionLockStoreOptions
): Promise<SectionLockStore> {
  const now = options.now ?? Date.now
  let state = initialState(await options.load().catch(() => null))
  const limiter = createAttemptLimiter(now)
  const grants = createGrantStore(
    () => randomBytes(32).toString('base64url'),
    now
  )

  const save = async (next: LockFile): Promise<void> => {
    await options.persist(next)
    state = next
  }

  const granted = (): LockVerifyResult => ({
    ok: true,
    retryAfterMs: 0,
    grant: grants.issue(),
  })

  return {
    status: () => ({
      passwordSet: Boolean(state.hash),
      sections: [...state.sections],
      relockMinutes: state.relockMinutes,
    }),

    async verify(password) {
      const hash = state.hash
      if (!hash) return failed()
      const wait = limiter.check()
      if (wait > 0) return failed(wait)
      const ok = await verifyPassword(password, hash)
      limiter.record(ok)
      return ok ? granted() : failed(limiter.check())
    },

    grantForSystemAuth: granted,

    async setPassword(grant, next) {
      if (state.hash && !grants.consume(grant)) return false
      const hash = await hashPassword(next, options.hashOptions)
      await save({ ...state, hash })
      return true
    },

    async clearPassword(grant) {
      if (!state.hash || !grants.consume(grant)) return false
      await save({ ...state, hash: null, sections: [] })
      return true
    },

    async setConfig(next, grant) {
      const config = parseLockConfig(next)
      if (!config) return false
      if (state.hash && weakensLock(state, config) && !grants.consume(grant))
        return false
      await save({ ...state, ...config })
      return true
    },
  }
}
