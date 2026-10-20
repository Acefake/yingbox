import type { LegacySettings } from '../settings/legacy'
import {
  type SettingChange,
  type SettingValue,
  type SettingsSnapshot,
  type ValueKey,
  parseSetting,
} from '../settings/schema'
import {
  ContractError,
  call,
  defineDomain,
  event,
  record,
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
  },
  {
    /** 任一窗口改了设置后广播给所有窗口 */
    changed: event<SettingChange>(),
  }
)
