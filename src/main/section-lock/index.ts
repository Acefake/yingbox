/**
 * 板块密码锁（主进程）：应用密码的 scrypt 哈希与锁的配置存在 userData/section-lock.json
 * （原子写，不存明文），连续输错限流；macOS 可用 Touch ID（systemPreferences.promptTouchID）。
 * Windows Hello 在 Electron 里没有可调用的 API，Windows 上只用应用密码。
 *
 * 验证通过（密码或 Touch ID）时签发一次性凭据；降低保护的写入（改 / 清密码、取消锁定、
 * 放宽重新锁定）由 store 校验凭据，渲染层绕过界面直接调用也会被拒。
 */
import { app, systemPreferences } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../file-operations'
import { implement } from '../rpc'
import { sectionLock } from '../../shared/contract/section-lock'
import type { SystemAuth } from '../../shared/section-lock'
import { createSectionLockStore } from './store'

function lockFilePath(): string {
  return join(app.getPath('userData'), 'section-lock.json')
}

function systemAuth(): SystemAuth {
  if (process.platform !== 'darwin') return null
  try {
    return systemPreferences.canPromptTouchID() ? 'touchid' : null
  } catch {
    return null
  }
}

/** 弹 Touch ID；通过返回 true，取消 / 失败 / 不可用返回 false */
async function promptTouchId(reason: string): Promise<boolean> {
  if (systemAuth() !== 'touchid') return false
  try {
    await systemPreferences.promptTouchID(reason)
    return true
  } catch {
    return false
  }
}

/** 注册 sectionLock 域（app ready 后调用一次） */
export async function registerSectionLockIpc(): Promise<void> {
  const file = lockFilePath()
  const store = await createSectionLockStore({
    load: async () => JSON.parse(await readFile(file, 'utf8')),
    persist: data => atomicWrite(file, JSON.stringify(data)),
  })

  implement(sectionLock, {
    status: () => ({ ...store.status(), systemAuth: systemAuth() }),
    verify: (_, password) => store.verify(password),
    setPassword: (_, grant, next) => store.setPassword(grant, next),
    clearPassword: (_, grant) => store.clearPassword(grant),
    setConfig: (_, config, grant) => store.setConfig(config, grant),
    promptSystem: async (_, reason) =>
      (await promptTouchId(reason))
        ? store.grantForSystemAuth()
        : { ok: false, retryAfterMs: 0, grant: '' },
  })
}
