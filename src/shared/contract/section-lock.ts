import {
  LOCK_PASSWORD_MAX,
  LOCK_PASSWORD_MIN,
  type LockVerifyResult,
  type SectionLockStatus,
  parseLockPassword,
} from '../section-lock'
import { ContractError, call, defineDomain, str } from './define'

/** 校验时输入的密码：只限长度上限（输错由主进程计数，不在边界拒绝） */
function attempt(value: unknown, name: string): string {
  const text = str(value, name)
  if (text.length > LOCK_PASSWORD_MAX * 4)
    throw new ContractError(`参数 ${name} 过长`)
  return text
}

/** 板块密码锁：应用密码（主进程 scrypt 哈希保存，不存明文）与系统认证（macOS Touch ID）。 */
export const sectionLock = defineDomain('sectionLock', {
  /** 是否已设密码、可用的系统认证 */
  status: call<SectionLockStatus>(),
  /** 校验应用密码；连续输错会被暂时拒绝（retryAfterMs） */
  verify: call<[password: string], LockVerifyResult>(a => [
    attempt(a[0], 'password'),
  ]),
  /** 设置 / 修改应用密码；已有密码时 current 必须正确（没有时传空串） */
  setPassword: call<[current: string, next: string], LockVerifyResult>(a => {
    const next = parseLockPassword(a[1])
    if (next === undefined)
      throw new ContractError(
        `新密码应为 ${LOCK_PASSWORD_MIN}–${LOCK_PASSWORD_MAX} 个字符`
      )
    return [attempt(a[0], 'current'), next]
  }),
  /** 清除应用密码；current 必须正确 */
  clearPassword: call<[current: string], LockVerifyResult>(a => [
    attempt(a[0], 'current'),
  ]),
  /** 弹出系统认证（Touch ID）；通过返回 true，取消 / 失败 / 不可用返回 false */
  promptSystem: call<[reason: string], boolean>(a => {
    const reason = str(a[0], 'reason').trim().slice(0, 120)
    if (!reason) throw new ContractError('参数 reason 不能为空')
    return [reason]
  }),
})
