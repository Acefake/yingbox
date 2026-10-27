/**
 * 服务端设置存储：<dataDir>/server-settings.json（原子替换，权限 0600），只收 shared/settings/server-keys.ts 列出的键。
 *
 * 取值顺序：环境变量（只读覆盖，不写回文件）> 文件 > schema 默认值；不在白名单里的键一律是默认值。
 * 值的校验与桌面端 settings.json 相同（parseSetting）；坏文件、坏值当未设置。
 * 自成一个小模块：app.ts 创建并登记路由；网盘 / 追更模块经模块宿主的 setting() 读它，刮削偏好经 onChange 下发给片库，
 * 网页端经 routes.ts 读写。
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

import {
  type SettingValue,
  type ValueKey,
  defaultValues,
  parseSetting,
} from '../../shared/settings/schema'
import {
  SERVER_SETTING_KEYS,
  type ServerSettingKey,
  type ServerSettingsSnapshot,
  isServerSettingKey,
} from '../../shared/settings/server-keys'

/** 环境变量覆盖表：键 → 变量名（Docker / NAS 用编排文件固定） */
export const SETTING_ENV: Partial<Record<ServerSettingKey, string>> = {
  'pan115.pansouUrl': 'YINGBOX_PANSOU_URL',
  'library.notify.mountRoot': 'YINGBOX_MOUNT_ROOT',
}

/** 写入被拒（键不认识、值不合法、被环境变量固定） */
export class SettingRejected extends Error {}

/** 服务端设置存储 */
export class ServerSettingsStore {
  private values: Partial<Record<ServerSettingKey, unknown>>
  private readonly defaults = defaultValues()

  private readonly listeners = new Set<(key: ServerSettingKey) => void>()

  constructor(
    private readonly file: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.values = this.read()
  }

  /** 订阅写入（网页端改了一个键之后触发，如把刮削偏好下发给片库） */
  onChange(listener: (key: ServerSettingKey) => void): void {
    this.listeners.add(listener)
  }

  /** 取值：环境变量 > 文件 > 默认值 */
  get<K extends ValueKey>(key: K): SettingValue<K> {
    if (isServerSettingKey(key)) {
      const fromEnv = this.envValue(key)
      if (fromEnv !== undefined) return fromEnv as SettingValue<K>
      if (key in this.values) return this.values[key] as SettingValue<K>
    }
    return this.defaults[key]
  }

  /** 写一个键（校验同桌面端）；返回落盘后的值 */
  set(key: string, raw: unknown): unknown {
    if (!isServerSettingKey(key))
      throw new SettingRejected(`不支持的设置：${key}`)
    if (this.envValue(key) !== undefined)
      throw new SettingRejected(`${key} 已由环境变量 ${SETTING_ENV[key]} 固定`)
    const change = parseSetting(key, raw)
    if (!change) throw new SettingRejected(`设置 ${key} 的值不合法`)
    this.values = { ...this.values, [key]: change.value }
    this.save()
    for (const listener of this.listeners) listener(key)
    return change.value
  }

  /** 网页端启动时拉的快照 */
  snapshot(): ServerSettingsSnapshot {
    const values: ServerSettingsSnapshot['values'] = {}
    for (const key of SERVER_SETTING_KEYS) values[key] = this.get(key)
    return {
      values,
      locked: SERVER_SETTING_KEYS.filter(
        key => this.envValue(key) !== undefined
      ),
    }
  }

  private envValue(key: ServerSettingKey): unknown {
    const name = SETTING_ENV[key]
    const raw = name ? this.env[name]?.trim() : undefined
    return raw ? parseSetting(key, raw)?.value : undefined
  }

  private read(): Partial<Record<ServerSettingKey, unknown>> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Record<
        string,
        unknown
      >
      const out: Partial<Record<ServerSettingKey, unknown>> = {}
      for (const [key, raw] of Object.entries(parsed ?? {})) {
        if (!isServerSettingKey(key)) continue
        const change = parseSetting(key, raw)
        if (change) out[key] = change.value
      }
      return out
    } catch {
      return {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.values, null, 2)}\n`, {
      mode: 0o600,
    })
    renameSync(temp, this.file)
    try {
      chmodSync(this.file, 0o600)
    } catch {
      /* Windows 上 chmod 只影响只读位 */
    }
  }
}
