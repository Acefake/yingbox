import type { LegacySettings } from '../settings/legacy'
import {
  RENDERER_READABLE_SECRETS,
  type ReadableSecretKey,
  type SecretKey,
  type SettingChange,
  type SettingValue,
  type SettingsSnapshot,
  type ValueKey,
  parseSetting,
  secretKeys,
} from '../settings/schema'
import {
  ContractError,
  call,
  defineDomain,
  event,
  record,
  str,
  syncCall,
} from './define'

/** settings.set 的参数：键与值的类型一一对应 */
export type SetSettingArgs = {
  [K in ValueKey]: [key: K, value: SettingValue<K>]
}[ValueKey]

/** 设置：主进程是唯一写入者，渲染层启动时同步拿快照，之后订阅变更。 */
export const settings = defineDomain(
  'settings',
  {
    /** 启动时同步取全部设置（首屏前调用，避免闪烁） */
    snapshot: syncCall<SettingsSnapshot>(),
    /** 首启迁移旧 localStorage 设置（幂等；已迁移过则原样返回快照） */
    migrateLegacy: syncCall<[legacy: LegacySettings], SettingsSnapshot>(a => [
      record<LegacySettings>(a[0], 'legacy'),
    ]),
    /** 写入一个设置；值按 schema 在边界校验 */
    set: call<SetSettingArgs, void>(a => {
      const change = parseSetting(String(a[0]), a[1])
      if (!change) throw new ContractError(`设置 ${String(a[0])} 的值不合法`)
      return [change.key, change.value] as SetSettingArgs
    }),
    /** 写入一个密钥（空字符串表示清除）；主进程加密落盘 */
    setSecret: call<[key: SecretKey, value: string], void>(a => [
      oneOfKeys(a[0], secretKeys, 'key'),
      str(a[1], 'value'),
    ]),
    /** 读出渲染层可用的密钥明文（只限 RENDERER_READABLE_SECRETS） */
    readSecret: call<[key: ReadableSecretKey], string>(a => [
      oneOfKeys(a[0], RENDERER_READABLE_SECRETS, 'key'),
    ]),
  },
  {
    /** 任一窗口改了设置后广播给所有窗口 */
    changed: event<SettingChange>(),
    /** 任一窗口改了密钥后广播（只带是否已配置，不带明文） */
    secretChanged: event<{ key: SecretKey; configured: boolean }>(),
  }
)

/** 校验参数是给定键集合里的一个 */
function oneOfKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
  name: string
): K {
  if (typeof value === 'string' && (keys as readonly string[]).includes(value))
    return value as K
  throw new ContractError(`参数 ${name} 不是允许的密钥`)
}
