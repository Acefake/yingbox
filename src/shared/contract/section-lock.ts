import {
  LOCK_PASSWORD_MAX,
  LOCK_PASSWORD_MIN,
  type LockConfig,
  type LockVerifyResult,
  type SectionLockStatus,
  parseLockConfig,
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

/** 一次性凭据：verify / promptSystem 通过时签发；没有时传空串 */
function grantArg(value: unknown): string {
  const text = str(value, 'grant')
  if (text.length > 128) throw new ContractError('参数 grant 过长')
  return text
}

/**
 * 板块密码锁：应用密码（主进程 scrypt 哈希保存，不存明文）、锁的配置与系统认证（macOS Touch ID）。
 * 验证通过时签发一次性凭据（短时有效、用一次作废）；设了密码后，降低保护的写入必须带凭据，主进程校验。
 */
export const sectionLock = defineDomain('sectionLock', {
  /** 是否已设密码、可用的系统认证、锁的配置 */
  status: call<SectionLockStatus>(),
  /** 校验应用密码，通过时签发凭据；连续输错会被暂时拒绝（retryAfterMs） */
  verify: call<[password: string], LockVerifyResult>(a => [
    attempt(a[0], 'password'),
  ]),
  /** 设置 / 修改应用密码；已有密码时要有效凭据。写入返回 true，被拒返回 false */
  setPassword: call<[grant: string, next: string], boolean>(a => {
    const next = parseLockPassword(a[1])
    if (next === undefined)
      throw new ContractError(
        `新密码应为 ${LOCK_PASSWORD_MIN}–${LOCK_PASSWORD_MAX} 个字符`
      )
    return [grantArg(a[0]), next]
  }),
  /** 清除应用密码并取消全部板块锁定；要有效凭据 */
  clearPassword: call<[grant: string], boolean>(a => [grantArg(a[0])]),
  /** 改锁的配置（整份）；设了密码且取消锁定 / 放宽重新锁定时要有效凭据 */
  setConfig: call<[config: LockConfig, grant: string], boolean>(a => {
    const config = parseLockConfig(a[0])
    if (!config) throw new ContractError('参数 config 不合法')
    return [config, grantArg(a[1])]
  }),
  /** 弹出系统认证（Touch ID），通过时签发凭据；取消 / 失败 / 不可用时 ok 为 false */
  promptSystem: call<[reason: string], LockVerifyResult>(a => {
    const reason = str(a[0], 'reason').trim().slice(0, 120)
    if (!reason) throw new ContractError('参数 reason 不能为空')
    return [reason]
  }),
})
