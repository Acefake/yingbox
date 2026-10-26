/**
 * 渲染层读写设置的唯一入口。
 *
 * 启动时（本模块首次 import，早于 app.mount）经 preload 同步取一次快照，首屏直接用真实值、不闪烁；
 * 首启还会同步迁移一次旧 localStorage 设置。之后订阅主进程广播，任一窗口改了设置，所有窗口同步。
 * 写入先乐观更新本地，再交主进程校验落盘；失败则回滚。
 * Web / PWA 模式没有主进程，改由 browser-storage 存在浏览器里；其中片库服务也要读的几个键（网盘 / 追更）
 * 另外同步到服务端（server-settings.ts）。
 */
import { type WritableComputedRef, computed, reactive } from 'vue'
import type { SetSettingArgs } from '../../../../shared/contract/settings'
import {
  type SettingValue,
  type SettingValues,
  type SettingsSnapshot,
  type ValueKey,
  defaultValues,
} from '../../../../shared/settings/schema'
import {
  loadWebSettings,
  readLegacySettings,
  saveWebSetting,
} from './browser-storage'
import {
  pullServerSettings,
  pushServerSetting,
  syncsToServer,
} from './server-settings'

const bridge = typeof window !== 'undefined' ? window.api?.settings : undefined

function boot(): SettingsSnapshot {
  if (!bridge) return loadWebSettings()
  const snapshot = bridge.snapshot()
  return snapshot.legacyMigrated
    ? snapshot
    : bridge.migrateLegacy(readLegacySettings())
}

const values = reactive(boot().values) as SettingValues

bridge?.onChanged(change => {
  ;(values as Record<ValueKey, unknown>)[change.key] = change.value
})

if (!bridge)
  void pullServerSettings((key, value) => {
    ;(values as Record<string, unknown>)[key] = value
    saveWebSetting(key as ValueKey, value, values)
  }).catch(error => console.warn('[settings] 读取片库服务设置失败', error))

/** 读一个设置（在 computed / watchEffect 里调用时是响应式的） */
export function getSetting<K extends ValueKey>(key: K): SettingValue<K> {
  return values[key]
}

/** 写一个设置：先更新本地，主进程拒绝时回滚并抛错 */
export async function setSetting<K extends ValueKey>(
  key: K,
  value: SettingValue<K>
): Promise<void> {
  const previous = values[key]
  if (previous === value) return
  values[key] = value
  try {
    if (bridge) await bridge.set(...([key, value] as SetSettingArgs))
    else {
      if (syncsToServer(key)) await pushServerSetting(key, value)
      saveWebSetting(key, value, values)
    }
  } catch (error) {
    values[key] = previous
    throw error
  }
}

/** 把一组设置恢复为默认值 */
export async function resetSettings(keys: readonly ValueKey[]): Promise<void> {
  const defaults = defaultValues()
  await Promise.all(keys.map(key => setSetting(key, defaults[key])))
}

/** 绑定到组件的设置：读取是响应式的，赋值即写入（失败时回滚并在控制台告警） */
export function useSetting<K extends ValueKey>(
  key: K
): WritableComputedRef<SettingValue<K>> {
  return computed({
    get: () => values[key],
    set: value => {
      setSetting(key, value).catch(error =>
        console.warn(`[settings] 写入 ${key} 失败`, error)
      )
    },
  })
}
