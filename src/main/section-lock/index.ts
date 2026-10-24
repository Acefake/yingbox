/**
 * 板块密码锁（主进程）：应用密码的 scrypt 哈希存在 userData/section-lock.json（原子写，不存明文），
 * 连续输错限流；macOS 可用 Touch ID（systemPreferences.promptTouchID）。
 * Windows Hello 在 Electron 里没有可调用的 API，Windows 上只用应用密码。
 */
import { app, systemPreferences } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../file-operations'
import { implement } from '../rpc'
import { sectionLock } from '../../shared/contract/section-lock'
import type { LockVerifyResult, SystemAuth } from '../../shared/section-lock'
import { hashPassword, parseHash, verifyPassword } from './hash'
import { createAttemptLimiter } from './rules'

/** 落盘格式 */
interface LockFile {
  version: 1
  /** scrypt 哈希；没设密码时为 null */
  hash: string | null
}

function lockFilePath(): string {
  return join(app.getPath('userData'), 'section-lock.json')
}

async function readHash(file: string): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as Partial<LockFile>
    return typeof data.hash === 'string' && parseHash(data.hash)
      ? data.hash
      : null
  } catch {
    return null
  }
}

function systemAuth(): SystemAuth {
  if (process.platform !== 'darwin') return null
  try {
    return systemPreferences.canPromptTouchID() ? 'touchid' : null
  } catch {
    return null
  }
}

/** 注册 sectionLock 域（app ready 后调用一次） */
export async function registerSectionLockIpc(): Promise<void> {
  const file = lockFilePath()
  let hash = await readHash(file)
  const limiter = createAttemptLimiter()

  const save = async (next: string | null): Promise<void> => {
    const data: LockFile = { version: 1, hash: next }
    await atomicWrite(file, JSON.stringify(data))
    hash = next
  }

  /** 按限流校验当前密码；没设密码时视为通过 */
  const check = async (password: string): Promise<LockVerifyResult> => {
    if (!hash) return { ok: true, retryAfterMs: 0 }
    const wait = limiter.check()
    if (wait > 0) return { ok: false, retryAfterMs: wait }
    const ok = await verifyPassword(password, hash)
    limiter.record(ok)
    return { ok, retryAfterMs: ok ? 0 : limiter.check() }
  }

  implement(sectionLock, {
    status: () => ({ passwordSet: Boolean(hash), systemAuth: systemAuth() }),
    verify: async (_, password) =>
      hash ? check(password) : { ok: false, retryAfterMs: 0 },
    setPassword: async (_, current, next) => {
      const result = await check(current)
      if (result.ok) await save(await hashPassword(next))
      return result
    },
    clearPassword: async (_, current) => {
      const result = await check(current)
      if (result.ok) await save(null)
      return result
    },
    promptSystem: async (_, reason) => {
      if (systemAuth() !== 'touchid') return false
      try {
        await systemPreferences.promptTouchID(reason)
        return true
      } catch {
        return false
      }
    },
  })
}
